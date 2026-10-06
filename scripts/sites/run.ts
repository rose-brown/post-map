/**
 * 사업장 레이어 동기화 — sites.ts 의 주소를 VWorld 지오코딩(getcoord, type=road — 실패하면 parcel 로 지번)으로 좌표만 얻어 레이어에 쓴다.
 *   node scripts/sites/run.ts <projectId> [--dry-run]
 * 지오코더 응답에서 저장하는 것은 좌표뿐이다 (불변 규칙 1 — 앱의 검색 결과 point 와 같다). 제목·주소는 sites.ts 의 조사 결과.
 * 레이어는 스크립트 소유 — sites.ts 에 없는 도형(사용자가 그린 것 포함)은 지운다.
 */
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ensureLayer, findLayer, readLayerFeatures, readLayers, supabaseClient, upsertFeatures } from '../lead50/sb.ts'
import type { FeatureRow } from '../../src/db/mappers.ts'
import type { PropertySchemaField } from '../../src/types.ts'
import { GROUPS } from './sites.ts'
import type { Site } from './sites.ts'

const SCHEMA: PropertySchemaField[] = [
  { key: 'company', label: '회사', type: 'text' },
  { key: 'siteType', label: '유형', type: 'text' },
  { key: 'address', label: '주소', type: 'text' },
  { key: 'note', label: '메모', type: 'text' },
  { key: 'source', label: '출처', type: 'text' },
]
const KEYS = new Set(SCHEMA.map((f) => f.key))
const siteSchema = (existing: PropertySchemaField[]) => [...SCHEMA.map((f) => existing.find((e) => e.key === f.key) ?? f), ...existing.filter((e) => !KEYS.has(e.key))]

/** Terra Draw 는 소수점 9자리를 넘는 좌표를 거부한다 (CLAUDE.md 함정). */
const trim = (v: number) => Number(v.toFixed(7))

async function geocode(address: string, type: 'road' | 'parcel', key: string): Promise<{ point: [number, number]; refined: string } | null> {
  const q = new URLSearchParams({ service: 'address', request: 'getcoord', version: '2.0', crs: 'epsg:4326', address, type, refine: 'true', simple: 'false', format: 'json', key })
  const r = (await (await fetch(`https://api.vworld.kr/req/address?${q}`)).json()) as {
    response: { status: string; result?: { point: { x: string; y: string } }; refined?: { text: string } }
  }
  const p = r.response.result?.point
  if (r.response.status !== 'OK' || !p) return null
  return { point: [trim(Number(p.x)), trim(Number(p.y))], refined: r.response.refined?.text ?? '' }
}

const idOf = (prefix: string, s: Site) => `ftr_site_${prefix}_${createHash('sha1').update(s.title).digest('hex').slice(0, 10)}`

const [projectId] = process.argv.slice(2)
if (!projectId || !/^[0-9a-f-]{36}$/.test(projectId)) {
  console.error('usage: node scripts/sites/run.ts <projectId> [--dry-run]')
  process.exit(2)
}
process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
const key = process.env.VWORLD_SEARCH_KEY
if (!key) throw new Error('.env 에 VWORLD_SEARCH_KEY 가 필요하다')
const dryRun = process.argv.includes('--dry-run')
const sb = supabaseClient(projectId)
const layers = await readLayers(sb, projectId)
const now = new Date().toISOString()
const failed: string[] = []

for (const g of GROUPS) {
  const existed = findLayer(layers, g.layer)
  const layer = await ensureLayer(sb, projectId, layers, { name: g.layer, color: g.color, visible: true }, `lyr_site_${g.idPrefix}_${projectId.slice(0, 8)}`, dryRun, siteSchema)
  const old = existed ? await readLayerFeatures(sb, existed.id) : []
  const rows: FeatureRow[] = []
  for (const s of g.sites) {
    const hit = (await geocode(s.address, 'road', key)) ?? (s.parcel ? await geocode(s.parcel, 'parcel', key) : null)
    console.log(`${hit ? 'OK ' : 'XX '} ${s.title} | ${s.address} → ${hit ? `${hit.refined} [${hit.point}]` : '실패'}`)
    if (!hit) { failed.push(`${g.layer} ${s.title}`); continue }
    const id = idOf(g.idPrefix, s)
    const prev = old.find((f) => f.id === id)
    const properties: FeatureRow['properties'] = { company: s.company, siteType: s.siteType, address: s.address, source: s.source, icon: s.siteType === '캠퍼스' || s.siteType === '공장' ? 'factory' : 'building' }
    if (s.note) properties.note = s.note
    rows.push({
      id, project_id: projectId, layer_id: layer.id, parent_id: null,
      geometry: { type: 'Point', coordinates: hit.point }, title: s.title, properties,
      blocks: prev?.blocks ?? [], derived_from: null, created_at: prev?.created_at ?? now, updated_at: now,
    })
  }
  const keep = new Set(rows.map((r) => r.id))
  const stale = old.filter((f) => !f.derived_from && !keep.has(f.id))
  console.log(JSON.stringify({ layer: g.layer, rows: rows.length, deleted: stale.length, dryRun }))
  if (dryRun) continue
  await upsertFeatures(sb, rows)
  // 링(derived)은 parent_id FK cascade 로 중심과 같이 지워진다.
  for (const f of stale) await sb(`features?id=eq.${f.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
}
if (failed.length) console.error(`지오코딩 실패 ${failed.length}: ${failed.join(', ')}`)
console.error(dryRun ? 'dry-run — 쓰지 않았다' : '기록 완료')
