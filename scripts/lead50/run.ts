/**
 * 월간선도50 갱신. 사용법:
 *   node scripts/lead50/run.ts <projectId> [--only 4117300000,4117100000] [--dry-run]
 * 전부 모은 뒤에만 쓴다 — 수집·매칭 중 실패하면 서버에 아무것도 쓰지 않는다 (스펙 5절).
 * 불변 규칙 1 의 명시적 예외 (스펙 D2): 앱의 저장 게이트를 거치지 않고 Supabase REST 에 직접 쓴다.
 */
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  LAYER_NAME, buildProperties, duplicateIds, matchTrades, mergeFeature, mergeSchema, sggCodesFor,
  summarizeTrades, tradesBlock,
} from './build.ts'
import type { Complex, KbRankItem, Trade } from './build.ts'
import { KbHttpError, fetchComplex, fetchRanking, fetchRegions } from './kb.ts'
import { fetchTrades, recentMonths } from './molit.ts'
import type { FeatureRow, LayerRow } from '../../src/db/mappers.ts'

const args = process.argv.slice(2)
const projectId = args[0]
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null
const dryRun = args.includes('--dry-run')
if (!projectId || !/^[0-9a-f-]{36}$/.test(projectId)) {
  console.error('usage: node scripts/lead50/run.ts <projectId> [--only codes] [--dry-run]')
  process.exit(2)
}

process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
const { MOLIT_KEY, VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: ANON } = process.env
if (!MOLIT_KEY || !SB || !ANON) throw new Error('.env 에 MOLIT_KEY / VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 필요하다')

const sbHeaders = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-project-id': projectId, 'Content-Type': 'application/json' }
async function sb(path: string, init: RequestInit = {}): Promise<unknown> {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...sbHeaders, ...(init.headers ?? {}) } })
  const text = await r.text()
  if (!r.ok) throw new Error(`Supabase ${r.status} ${path.split('?')[0]}: ${text}`)
  // return=minimal 이면 본문이 비어 온다.
  return text ? JSON.parse(text) : null
}

/* ---------- 1. 수집 (쓰기 없음) ---------- */
const report = { regions: 0, failedRegions: [] as string[], complexes: 0, noCoord: [] as string[], unmatched: [] as string[], contains: 0 }
let regions = await fetchRegions()
if (only) regions = regions.filter((r) => only.has(r.code))
report.regions = regions.length

const complexes: Complex[] = []
for (const region of regions) {
  let items: KbRankItem[]
  try {
    items = await fetchRanking(region)
  } catch (e) {
    if (e instanceof KbHttpError && e.status === 500) { report.failedRegions.push(`${region.name} (500)`); continue }
    throw e
  }
  for (const item of items) {
    const detail = await fetchComplex(item.kbComplexId)
    if (!detail) { report.noCoord.push(`${region.name} ${item.aptName}`); continue }
    complexes.push({ region, item, detail })
  }
  console.error(`수집 ${region.name}: ${items.length}`)
}
const dups = duplicateIds(complexes)
if (dups.length) throw new Error(`지역 간 중복 단지: ${dups.join(', ')}`)
report.complexes = complexes.length

const months = recentMonths(new Date(), 12)
const since = `${months.at(-1)!.slice(0, 4)}-${months.at(-1)!.slice(4)}-01`
const tradesBySgg = new Map<string, Trade[]>()
for (const sgg of new Set(regions.flatMap(sggCodesFor))) {
  const all: Trade[] = []
  for (const [i, ym] of months.entries()) all.push(...(await fetchTrades(sgg, ym, MOLIT_KEY, i < 2)))
  tradesBySgg.set(sgg, all)
  console.error(`실거래 ${sgg}: ${all.length}`)
}

/* ---------- 2. 계산 ---------- */
const built = complexes.map((c) => {
  const pool = sggCodesFor(c.region).flatMap((s) => tradesBySgg.get(s) ?? [])
  const m = matchTrades(c, pool)
  if (m.how === 'none') report.unmatched.push(`${c.region.name} ${c.item.aptName} (${c.detail.dong})`)
  if (m.how === 'contains') report.contains++
  const groups = summarizeTrades(m.trades, since)
  return { c, props: buildProperties(c, groups), block: tradesBlock(groups) }
})

/* ---------- 3. 쓰기 ---------- */
const layers = (await sb(`layers?project_id=eq.${projectId}&select=*`)) as LayerRow[]
const mine = layers.filter((l) => l.name === LAYER_NAME)
if (mine.length > 1) throw new Error(`"${LAYER_NAME}" 레이어가 ${mine.length}개다. 하나만 남겨라.`)
let layer = mine[0]

const existing: FeatureRow[] = []
if (layer) {
  for (let offset = 0; ; offset += 1000) {
    const page = (await sb(`features?layer_id=eq.${layer.id}&select=*&order=id&limit=1000&offset=${offset}`)) as FeatureRow[]
    existing.push(...page)
    if (page.length < 1000) break
  }
}
const byKbId = new Map(existing.filter((f) => f.properties.kbComplexId).map((f) => [String(f.properties.kbComplexId), f]))

const now = new Date().toISOString()
const layerId = layer?.id ?? `lyr_${randomUUID().slice(0, 12)}`
const rows = built.map(({ c, props, block }) => mergeFeature({
  existing: byKbId.get(c.item.kbComplexId), c, props, block, layerId, projectId, now, newId: `ftr_${randomUUID().slice(0, 12)}`,
}))
const created = rows.filter((r) => !byKbId.has(String(r.properties.kbComplexId))).length

console.log(JSON.stringify({ ...report, unmatchedCount: report.unmatched.length, created, updated: rows.length - created, dryRun }, null, 2))
if (dryRun) process.exit(0)

if (!layer) {
  const order = layers.reduce((m, l) => Math.max(m, l.order), -1) + 1
  layer = {
    id: layerId, project_id: projectId, name: LAYER_NAME, kind: 'vector', visible: true, order,
    style: { color: '#b45309', opacity: 0.25, strokeWidth: 2, pointRadius: 6 }, schema: mergeSchema([]), locked: false,
  }
  await sb('layers', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(layer) })
} else {
  await sb(`layers?id=eq.${layer.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ schema: mergeSchema(layer.schema) }) })
}
for (let i = 0; i < rows.length; i += 500) {
  await sb('features', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows.slice(i, i + 500)),
  })
}
console.error(`기록 완료: ${rows.length}행 (신규 ${created})`)
