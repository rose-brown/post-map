/**
 * 지하철 호선 레이어 · 역세권 · 기준역 소요시간 레이어. 사용법:
 *   node scripts/transit/run.ts <projectId> <GTFS 디렉터리> [--dry-run]
 * GTFS 디렉터리 = KTDB 배포본의 *_GTFS_DataSet (stops.txt 등이 있는 곳). 저장소에 넣지 않는다 (스펙 D2).
 * 월간선도50 을 갱신한 뒤 다시 돌린다 — 새 단지에 속성이 붙고 필터 레이어가 맞춰진다.
 * 모두 계산한 뒤에만 쓴다 (스펙 6절). 스펙: docs/superpowers/specs/2026-09-29-transit-layers-design.md, 대기시간 docs/superpowers/specs/2026-09-30-transit-wait-design.md
 */
import { fileURLToPath } from 'node:url'
import {
  FILTER_LAYERS, LINES, STATION_POINT_RADIUS, TARGETS, appendTransitSchema, boardWaits, buildWaitGraph, copyRow, filterSchema, isComplex,
  lineSchema, stationRow, stationSecondsTo, stopsByLine, targetStops, transitProps, tripSequences, withTransit,
} from './build.ts'
import { readGtfs } from './gtfs.ts'
import { BAND_LAYERS, OUT_LAYER, SIZE_FIELD } from '../lead50/build.ts'
import { ensureLayer, findLayer, readLayerFeatures, readLayers, supabaseClient, upsertFeatures } from '../lead50/sb.ts'
import type { Point } from 'geojson'
import type { FeatureRow, LayerRow } from '../../src/db/mappers.ts'

const [projectId, gtfsDir] = process.argv.slice(2)
const dryRun = process.argv.includes('--dry-run')
if (!projectId || !/^[0-9a-f-]{36}$/.test(projectId) || !gtfsDir || gtfsDir.startsWith('--')) {
  console.error('usage: node scripts/transit/run.ts <projectId> <GTFS 디렉터리> [--dry-run]')
  process.exit(2)
}
process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
const sb = supabaseClient(projectId)
const now = new Date().toISOString()
const tag = projectId.slice(0, 8)

/* ---------- 1. GTFS → 그래프 (쓰기 없음) ---------- */
console.error('GTFS 읽는 중…')
const gtfs = await readGtfs(gtfsDir)
const trips = tripSequences(gtfs.stopTimes)
const stopById = new Map(gtfs.stops.map((s) => [s.id, s]))
const unknownLines = [...new Set(gtfs.routes.map((r) => r.shortName))].filter((n) => !LINES.some((l) => l.gtfs === n))
if (unknownLines.length) throw new Error(`LINES 에 없는 호선: ${unknownLines.join(', ')}`)

// 정점 키를 '>' 와 '|' 로 이어 붙인다 (build.ts buildWaitGraph) — stop id 에 있으면 키가 깨진다.
const badIds = gtfs.stops.filter((s) => /[>|]/.test(s.id)).map((s) => s.id)
if (badIds.length) throw new Error(`stop id 에 '>' 또는 '|' 가 있다: ${badIds.slice(0, 5).join(', ')}`)
// 대기시간 (스펙 2026-09-30-transit-wait): 07~09시 방향별 배차간격 ÷ 2, 탈 때마다.
const { waits, fallback, mirrored } = boardWaits(trips)
const graph = buildWaitGraph(trips, gtfs.transfers, waits)
const routingStart = Date.now()
const toTargets = TARGETS.map((t) => stationSecondsTo(graph, targetStops(gtfs.stops, t.name)))
const routingMs = Date.now() - routingStart
const served = new Set(gtfs.stopTimes.map((st) => st.stopId))
const servedStops = gtfs.stops.filter((s) => served.has(s.id))

/* ---------- 2. 서버 읽기 ---------- */
const layers = await readLayers(sb, projectId)
const sources = [...BAND_LAYERS, OUT_LAYER].map((d) => findLayer(layers, d.name)).filter((l): l is LayerRow => !!l)
if (!sources.length) throw new Error('월간선도50 레이어가 없다 — scripts/lead50/run.ts 를 먼저 돌려라')
const originals: FeatureRow[] = []
for (const l of sources) originals.push(...(await readLayerFeatures(sb, l.id)).filter(isComplex))

/* ---------- 3. 계산 ---------- */
const updated = originals.map((f) => withTransit(f, transitProps((f.geometry as Point).coordinates as [number, number], servedStops, toTargets), now))

const byLine = stopsByLine(gtfs.routes, trips)

const waitList = [...waits.values()].sort((a, b) => a - b)
// 이번 계산 전 서버 값으로 센 수 — 한 번 새 값으로 쓴 뒤 다시 돌리면 before = after 가 정상이다.
const before = Object.fromEntries(FILTER_LAYERS.map((d) => [d.name, originals.filter((f) => d.pick(f.properties)).length]))

const report = {
  stops: servedStops.length, trips: trips.size, transfers: gtfs.transfers.length, complexes: updated.length,
  lines: {} as Record<string, number>,
  filters: {} as Record<string, number>,
  noStationWithin2km: updated.filter((f) => f.properties.nearestStation === undefined).length,
  samples: updated.slice(0, 5).map((f) => ({ title: f.title, ...Object.fromEntries(Object.entries(f.properties).filter(([k]) => ['nearestStation', 'stationDistance', ...TARGETS.map((t) => t.key)].includes(k))) })),
  sanity: {
    gangnamToSeolleungMin: Math.round((toTargets[0].get('RS_ACC1_S-1-0222') ?? NaN) / 60),
    cityHall2ToYeouidoMin: Math.round((toTargets[1].get('RS_ACC1_S-1-0201') ?? NaN) / 60),
  },
  before,
  waits: {
    edges: waitList.length,
    medianMin: Number((waitList[waitList.length >> 1] / 60).toFixed(1)),
    maxMin: Number((waitList[waitList.length - 1] / 60).toFixed(1)),
    fallback: fallback.length,
    mirrored: mirrored.length,
  },
  routingMs,
  dryRun,
}

/* ---------- 4. 쓰기 ---------- */
/** 스크립트 소유 레이어 (D7): rows 로 맞추고 rows 에 없는 도형은 지운다. */
async function replaceLayer(layer: LayerRow, rows: FeatureRow[]): Promise<number> {
  const keep = new Set(rows.map((r) => r.id))
  const existing = existedIds.has(layer.id) ? await readLayerFeatures(sb, layer.id) : []
  const stale = existing.filter((f) => !f.derived_from && !keep.has(f.id))
  if (dryRun) return stale.length
  await upsertFeatures(sb, rows)
  for (let i = 0; i < stale.length; i += 100) {
    const ids = stale.slice(i, i + 100).map((f) => `"${f.id}"`).join(',')
    await sb(`features?id=in.(${ids})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
  }
  return stale.length
}

const existedIds = new Set(layers.map((l) => l.id))
let deleted = 0

for (const line of LINES) {
  const stationIds = [...(byLine.get(line.gtfs) ?? [])]
  const layer = await ensureLayer(sb, projectId, layers, { name: line.layer, color: line.color, visible: false }, `lyr_line_${line.code}_${tag}`, dryRun, lineSchema)
  // 역은 앱 기본 점의 절반. ensureLayer 는 기존 스타일을 덮지 않으므로 여기서 맞춘다 (반지름을 바꾸는 UI 는 없다).
  if (layer.style.pointRadius !== STATION_POINT_RADIUS) {
    layer.style = { ...layer.style, pointRadius: STATION_POINT_RADIUS }
    if (!dryRun) await sb(`layers?id=eq.${layer.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ style: layer.style }) })
  }
  // 선은 그리지 않는다 — 역을 직선으로 이은 선이 배경지도의 선로와 어긋났다 (사용자 요청 2026-09-29). 남은 선은 replaceLayer 가 지운다.
  const rows = stationIds.map((id) => stationRow(stopById.get(id)!, line, layer.id, projectId, now))
  report.lines[line.layer] = stationIds.length
  deleted += await replaceLayer(layer, rows)
}

for (const def of FILTER_LAYERS) {
  const layer = await ensureLayer(sb, projectId, layers, { name: def.name, color: '#0f766e', visible: false, sizeField: SIZE_FIELD }, `lyr_${def.suffix}_${tag}`, dryRun, filterSchema)
  const rows = updated.filter((f) => def.pick(f.properties)).map((f) => copyRow(f, def, layer.id, now))
  report.filters[def.name] = rows.length
  deleted += await replaceLayer(layer, rows)
}

if (!dryRun) {
  for (const l of sources) {
    await sb(`layers?id=eq.${l.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ schema: appendTransitSchema(l.schema) }) })
  }
  await upsertFeatures(sb, updated)
}

console.log(JSON.stringify({ ...report, deleted }, null, 2))
console.error(dryRun ? 'dry-run — 쓰지 않았다' : '기록 완료')
