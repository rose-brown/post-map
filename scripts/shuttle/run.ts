/**
 * 셔틀 탑승지 레이어 동기화 — stops.ts 의 단지·역을 점으로 쓴다.
 *   node scripts/shuttle/run.ts <projectId> [--dry-run]
 * 좌표는 프로젝트에 이미 있는 같은 이름 도형(원본, derived 아님)에서 복사하거나 VWorld 지오코딩(좌표만 저장 — 불변 규칙 1).
 * 노선(stops.ts 의 route)마다 정류장을 차례로 이어 캠퍼스(사업장 레이어의 같은 제목 도형)에서 끝나는 선을 같이 쓴다 (버스 노선도 모양).
 * 실제 운행 경로·정류 순서는 공개되지 않아 모식도다 — 순서는 총길이가 짧게 나오도록 고른다 (chain).
 * 레이어는 스크립트 소유 — stops.ts 에 없는 도형은 지운다.
 */
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { distance } from '@turf/turf'
import { ensureLayer, findLayer, readLayerFeatures, readLayers, supabaseClient, upsertFeatures } from '../lead50/sb.ts'
import type { FeatureRow } from '../../src/db/mappers.ts'
import type { PropertySchemaField } from '../../src/types.ts'
import { GROUPS } from './stops.ts'
import type { Stop } from './stops.ts'

const SCHEMA: PropertySchemaField[] = [
  { key: 'campus', label: '사업장', type: 'text' },
  { key: 'minutes', label: '셔틀 소요시간', type: 'number', unit: '분' },
  { key: 'note', label: '메모', type: 'text' },
  { key: 'source', label: '출처', type: 'text' },
]
const KEYS = new Set(SCHEMA.map((f) => f.key))
const stopSchema = (existing: PropertySchemaField[]) => [...SCHEMA.map((f) => existing.find((e) => e.key === f.key) ?? f), ...existing.filter((e) => !KEYS.has(e.key))]

/** Terra Draw 는 소수점 9자리를 넘는 좌표를 거부한다 (CLAUDE.md 함정). */
const trim = (v: number) => Number(v.toFixed(7))

async function geocode(address: string, key: string): Promise<[number, number] | null> {
  const q = new URLSearchParams({ service: 'address', request: 'getcoord', version: '2.0', crs: 'epsg:4326', address, type: 'road', refine: 'true', simple: 'false', format: 'json', key })
  const r = (await (await fetch(`https://api.vworld.kr/req/address?${q}`)).json()) as { response: { status: string; result?: { point: { x: string; y: string } } } }
  const p = r.response.result?.point
  return r.response.status === 'OK' && p ? [trim(Number(p.x)), trim(Number(p.y))] : null
}

const [projectId] = process.argv.slice(2)
if (!projectId || !/^[0-9a-f-]{36}$/.test(projectId)) {
  console.error('usage: node scripts/shuttle/run.ts <projectId> [--dry-run]')
  process.exit(2)
}
process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
const key = process.env.VWORLD_SEARCH_KEY
if (!key) throw new Error('.env 에 VWORLD_SEARCH_KEY 가 필요하다')
const dryRun = process.argv.includes('--dry-run')
const sb = supabaseClient(projectId)
const layers = await readLayers(sb, projectId)

async function locate(s: Pick<Stop, 'feature' | 'layerPrefix' | 'address'>): Promise<[number, number] | null> {
  if (s.address) return geocode(s.address, key!)
  const rows = (await sb(`features?project_id=eq.${projectId}&derived_from=is.null&title=eq.${encodeURIComponent(s.feature!)}&select=layer_id,geometry`)) as Pick<FeatureRow, 'layer_id' | 'geometry'>[]
  for (const r of rows) {
    if (r.geometry.type === 'Point' && (!s.layerPrefix || r.layer_id.startsWith(s.layerPrefix))) return r.geometry.coordinates as [number, number]
  }
  return null
}

/**
 * 정류장을 잇는 순서 — 출발 정류장마다 "가장 가까운 다음 정류장" 으로 이어 보고 캠퍼스까지 총길이가 가장 짧은 것.
 * 마지막은 캠퍼스. 같은 좌표 정류장은 하나로 친다.
 */
function chain(points: [number, number][], campus: [number, number]): [number, number][] {
  const uniq = points.filter((p, i) => points.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i)
  let best: [number, number][] = []
  let bestLen = Infinity
  for (const start of uniq) {
    const left = uniq.filter((p) => p !== start)
    const out = [start]
    while (left.length) {
      const cur = out[out.length - 1]
      const next = left.reduce((a, b) => (distance(cur, b) < distance(cur, a) ? b : a))
      left.splice(left.indexOf(next), 1)
      out.push(next)
    }
    out.push(campus)
    const len = out.slice(1).reduce((sum, p, i) => sum + distance(out[i], p), 0)
    if (len < bestLen) { best = out; bestLen = len }
  }
  return best
}

const now = new Date().toISOString()
const failed: string[] = []
for (const g of GROUPS) {
  const existed = findLayer(layers, g.layer)
  const layer = await ensureLayer(sb, projectId, layers, { name: g.layer, color: g.color, visible: true }, `lyr_shuttle_${g.idPrefix}_${projectId.slice(0, 8)}`, dryRun, stopSchema)
  const old = existed ? await readLayerFeatures(sb, existed.id) : []
  const campus = (await locate({ feature: g.campus, layerPrefix: 'lyr_site_' }))
  if (!campus) throw new Error(`사업장 레이어에 "${g.campus}" 가 없다 — scripts/sites/run.ts 를 먼저 돌려라`)
  const rows: FeatureRow[] = []
  const byRoute = new Map<string, { title: string; point: [number, number] }[]>()
  for (const s of g.stops) {
    const point = await locate(s)
    console.log(`${point ? 'OK ' : 'XX '} ${s.title} ← ${s.address ?? s.feature} ${point ? `[${point}]` : '실패'}`)
    if (!point) { failed.push(`${g.layer} ${s.title}`); continue }
    const id = `ftr_shuttle_${g.idPrefix}_${createHash('sha1').update(s.title).digest('hex').slice(0, 10)}`
    const prev = old.find((f) => f.id === id)
    const properties: FeatureRow['properties'] = { campus: g.campus, source: s.source }
    if (s.minutes !== undefined) properties.minutes = s.minutes
    if (s.note) properties.note = s.note
    rows.push({
      id, project_id: projectId, layer_id: layer.id, parent_id: null,
      geometry: { type: 'Point', coordinates: point }, title: s.title, properties,
      blocks: prev?.blocks ?? [], derived_from: null, created_at: prev?.created_at ?? now, updated_at: now,
    })
    byRoute.set(s.route, [...(byRoute.get(s.route) ?? []), { title: s.title, point }])
  }
  for (const [route, stops] of byRoute) {
    const coords = chain(stops.map((s) => s.point), campus)
    const order = coords.slice(0, -1).map((c) => stops.find((s) => s.point[0] === c[0] && s.point[1] === c[1])!.title)
    const id = `ftr_shuttle_${g.idPrefix}_route_${createHash('sha1').update(route).digest('hex').slice(0, 10)}`
    const prev = old.find((f) => f.id === id)
    console.log(`노선 ${route}: ${order.join(' → ')} → ${g.campus}`)
    rows.push({
      id, project_id: projectId, layer_id: layer.id, parent_id: null,
      geometry: { type: 'LineString', coordinates: coords }, title: `${route} 노선 → ${g.campus}`,
      properties: { campus: g.campus, source: [...new Set(g.stops.filter((s) => s.route === route).map((s) => s.source))].join(' '), note: `모식도 — 실제 운행 경로·순서 아님. ${order.join(' → ')}` },
      blocks: prev?.blocks ?? [], derived_from: null, created_at: prev?.created_at ?? now, updated_at: now,
    })
  }
  const keep = new Set(rows.map((r) => r.id))
  const stale = old.filter((f) => !f.derived_from && !keep.has(f.id))
  console.log(JSON.stringify({ layer: g.layer, rows: rows.length, deleted: stale.length, dryRun }))
  if (dryRun) continue
  await upsertFeatures(sb, rows)
  for (const f of stale) await sb(`features?id=eq.${f.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
}
if (failed.length) console.error(`좌표 실패 ${failed.length}: ${failed.join(', ')}`)
console.error(dryRun ? 'dry-run — 쓰지 않았다' : '기록 완료')
