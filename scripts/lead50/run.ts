/**
 * 월간선도50 갱신. 사용법:
 *   node scripts/lead50/run.ts <projectId> [--only 4117300000,4117100000] [--dry-run]
 * 전부 모은 뒤에만 쓴다 — 수집·매칭 중 실패하면 서버에 아무것도 쓰지 않는다 (스펙 5절).
 * 불변 규칙 1 의 명시적 예외 (스펙 D2): 앱의 저장 게이트를 거치지 않고 Supabase REST 에 직접 쓴다.
 */
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  BAND_LAYERS, OUT_LAYER, bandOf, buildProperties, duplicateIds, matchTrades, mergeFeature, retireRows, sggCodesFor,
  summarizeTrades, tradesBlock,
} from './build.ts'
import type { Complex, KbRankItem, Region, Trade } from './build.ts'
import { KbHttpError, fetchComplex, fetchRanking, fetchRegions } from './kb.ts'
import { fetchTrades, recentMonths } from './molit.ts'
import { syncTop } from './top9.ts'
import { syncPrice } from './price.ts'
import { ensureLayer, readLayerFeatures, readLayers, supabaseClient, upsertFeatures } from './sb.ts'
import type { FeatureRow, LayerRow } from '../../src/db/mappers.ts'

const args = process.argv.slice(2)
const projectId = args[0]
let only: Set<string> | null = null
if (args.includes('--only')) {
  const idx = args.indexOf('--only') + 1
  if (idx >= args.length || args[idx].startsWith('--')) {
    console.error('usage: node scripts/lead50/run.ts <projectId> [--only codes] [--dry-run]')
    process.exit(2)
  }
  only = new Set(args[idx].split(','))
}
const dryRun = args.includes('--dry-run')
if (!projectId || !/^[0-9a-f-]{36}$/.test(projectId)) {
  console.error('usage: node scripts/lead50/run.ts <projectId> [--only codes] [--dry-run]')
  process.exit(2)
}

process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
const { MOLIT_KEY } = process.env
if (!MOLIT_KEY) throw new Error('.env 에 MOLIT_KEY 가 필요하다')
const sb = supabaseClient(projectId)

/* ---------- 1. 수집 (쓰기 없음) ---------- */
const report = { regions: 0, failedRegions: [] as string[], complexes: 0, noCoord: [] as string[], unmatched: [] as string[] }
let regions = await fetchRegions()
if (only) regions = regions.filter((r) => only.has(r.code))
if (only && regions.length === 0) {
  throw new Error(`--only 에 맞는 지역이 없다: ${Array.from(only).join(',')}`)
}
report.regions = regions.length

const complexes: Complex[] = []
const collected: Region[] = []
for (const region of regions) {
  let items: KbRankItem[]
  try {
    items = await fetchRanking(region)
  } catch (e) {
    if (e instanceof KbHttpError && e.status === 500) { report.failedRegions.push(`${region.name} (500)`); continue }
    throw e
  }
  if (items.length === 0) {
    throw new Error(`${region.name}: KB 순위가 0건이다 — 응답 형식이 바뀌었는지 확인하라`)
  }
  collected.push(region)
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
  const matched = matchTrades(c, pool)
  if (!matched.length) report.unmatched.push(`${c.region.name} ${c.item.aptName} (${c.detail.dong} ${c.detail.jibun || '지번 없음'})`)
  const groups = summarizeTrades(matched, since)
  return { c, props: buildProperties(c, groups), block: tradesBlock(groups) }
})

/* ---------- 3. 쓰기 ---------- */
// 구간 레이어 5개 + 순위 밖. 이름으로 찾고 없으면 만든다 (dry-run 이면 만들 id 만 정한다).
const layers = await readLayers(sb, projectId)
const newLayerId = () => `lyr_${randomUUID().slice(0, 12)}`
const bands: LayerRow[] = []
for (const def of BAND_LAYERS) bands.push(await ensureLayer(sb, projectId, layers, def, newLayerId(), dryRun))
const out = await ensureLayer(sb, projectId, layers, OUT_LAYER, newLayerId(), dryRun)

const existing: FeatureRow[] = []
for (const l of [...bands, out]) existing.push(...(await readLayerFeatures(sb, l.id)))
const byKbId = new Map(existing.filter((f) => f.properties.kbComplexId).map((f) => [String(f.properties.kbComplexId), f]))

const now = new Date().toISOString()
const rows = built.map(({ c, props, block }) => mergeFeature({
  existing: byKbId.get(c.item.kbComplexId), c, props, block, layerId: bands[bandOf(c.item.rank)].id, projectId, now,
  newId: `ftr_${randomUUID().slice(0, 12)}`,
}))
const created = rows.filter((r) => !byKbId.has(String(r.properties.kbComplexId))).length
const moved = rows.filter((r) => { const e = byKbId.get(String(r.properties.kbComplexId)); return e && e.layer_id !== r.layer_id }).length
const seen = new Set(rows.map((r) => String(r.properties.kbComplexId)))
const retired = retireRows(existing, seen, collected, out.id, now)

console.log(JSON.stringify({ ...report, unmatchedCount: report.unmatched.length, created, updated: rows.length - created, moved, retired: retired.length, dryRun }, null, 2))
if (dryRun) process.exit(0)

await upsertFeatures(sb, [...rows, ...retired])
console.error(`기록 완료: ${rows.length + retired.length}행 (신규 ${created}, 구간 이동 ${moved}, 순위 밖 ${retired.length})`)

// 구간 레이어가 다 써진 뒤에 사본을 맞춘다 (계획 2026-09-29 T6).
await syncTop(sb, projectId, false)
await syncPrice(sb, projectId, false)
