/**
 * 지하철 레이어 스크립트의 순수 함수. I/O 없음 — tests/transit.test.ts 가 직접 돌린다.
 * 스펙: docs/superpowers/specs/2026-09-29-transit-layers-design.md
 */
import { distance } from '@turf/turf'
import { SCHEMA as LEAD50_SCHEMA, TRADES_BLOCK_ID } from '../lead50/build.ts'
import type { FeatureRow } from '../../src/db/mappers.ts'
import type { Properties, PropertySchemaField } from '../../src/types.ts'

/* ---------- GTFS (스펙 3절) ---------- */

/** 수도권 도시철도. route_type 은 KTDB 자체 코드라 보지 않고 id 접두사로 거른다. */
export const ROUTE_PREFIX = 'RR_ACC1_S-1-'
export const STOP_PREFIX = 'RS_ACC1_S-1-'

export interface Stop { id: string; name: string; lat: number; lng: number }
export interface Route { id: string; shortName: string; longName: string }
export interface StopTime { tripId: string; arrival: number; stopId: string; seq: number }
export interface Transfer { from: string; to: string; seconds: number }

/** 따옴표 없는 CSV 한 줄 (스펙 3절 — 도시철도 행에는 따옴표가 없다). 첫 줄 BOM 은 호출자가 뗀다. */
export const splitCsv = (line: string): string[] => line.replace(/^﻿/, '').split(',')

/** "25:10:30" → 초. 24시를 넘는 값이 있다. */
export function parseTime(s: string): number {
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(s)
  if (!m) throw new Error(`시각 형식이 아니다: ${s}`)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/** "시청(1호선)" → "시청". 괄호가 없으면 그대로. */
export const baseName = (name: string): string => name.replace(/\([^)]*\)$/, '')

/* ---------- 호선 (D5) ---------- */

/** code = route_id 의 호선 칸 (`RR_ACC1_S-1-02-1I` 의 `02`). 도형·레이어 id 에 쓴다. */
export interface LineDef { gtfs: string; code: string; layer: string; color: string }

/** GTFS route_short_name → 레이어. 색은 각 운영기관 노선색. 여기 없는 호선이 나오면 쓰기 전에 실패한다. */
export const LINES: LineDef[] = [
  { gtfs: '서울1호선', code: '01', layer: '지하철 1호선', color: '#0052A4' },
  { gtfs: '서울2호선', code: '02', layer: '지하철 2호선', color: '#00A84D' },
  { gtfs: '서울3호선', code: '03', layer: '지하철 3호선', color: '#EF7C1C' },
  { gtfs: '서울4호선', code: '04', layer: '지하철 4호선', color: '#00A5DE' },
  { gtfs: '서울5호선', code: '05', layer: '지하철 5호선', color: '#996CAC' },
  { gtfs: '서울6호선', code: '06', layer: '지하철 6호선', color: '#CD7C2F' },
  { gtfs: '서울7호선', code: '07', layer: '지하철 7호선', color: '#747F00' },
  { gtfs: '서울8호선', code: '08', layer: '지하철 8호선', color: '#E6186C' },
  { gtfs: '서울9호선', code: '09', layer: '지하철 9호선', color: '#BDB092' },
  { gtfs: '인천1호선', code: 'I1', layer: '지하철 인천1호선', color: '#7CA8D5' },
  { gtfs: '인천2호선', code: 'I2', layer: '지하철 인천2호선', color: '#ED8B00' },
  { gtfs: '신분당선', code: 'SB', layer: '지하철 신분당선', color: '#D4003B' },
  { gtfs: '수인분당선', code: 'SD', layer: '지하철 수인분당선', color: '#F5A200' },
  { gtfs: '경의중앙선', code: 'KJ', layer: '지하철 경의중앙선', color: '#77C4A3' },
  { gtfs: '공항철도', code: 'AP', layer: '지하철 공항철도', color: '#0090D2' },
  { gtfs: '경춘선', code: 'GC', layer: '지하철 경춘선', color: '#178C72' },
  { gtfs: '경강선', code: 'KK', layer: '지하철 경강선', color: '#0054A6' },
  { gtfs: '서해선', code: 'SH', layer: '지하철 서해선', color: '#8FC31F' },
  { gtfs: 'GTX-A', code: 'XA', layer: '지하철 GTX-A', color: '#9A6292' },
  { gtfs: '신림선', code: 'SL', layer: '지하철 신림선', color: '#6789CA' },
  { gtfs: '우이신설경전철', code: 'WS', layer: '지하철 우이신설선', color: '#B0CE18' },
  { gtfs: '의정부경전철', code: 'UI', layer: '지하철 의정부경전철', color: '#FDA600' },
  { gtfs: '용인경전철', code: 'EB', layer: '지하철 용인경전철', color: '#509F22' },
  { gtfs: '김포도시철도', code: 'KP', layer: '지하철 김포골드라인', color: '#AD8605' },
]

/** 역 포인트 반지름(px). 앱 기본(6)의 절반 — 사용자 요청 2026-09-29. */
export const STATION_POINT_RADIUS = 3

export const LINE_SCHEMA: PropertySchemaField[] = [
  { key: 'line', label: '호선', type: 'text' },
  { key: 'stopId', label: '역ID', type: 'text' },
]

/** 운행별 정차 순서 (stop_sequence 오름차순). */
export function tripSequences(stopTimes: StopTime[]): Map<string, StopTime[]> {
  const trips = new Map<string, StopTime[]>()
  for (const st of stopTimes) {
    const list = trips.get(st.tripId)
    if (list) list.push(st)
    else trips.set(st.tripId, [st])
  }
  for (const list of trips.values()) list.sort((a, b) => a.seq - b.seq)
  return trips
}

export const routeOfTrip = (tripId: string): string => tripId.replace(/_Ord\d+$/, '')

/** 호선(short name) → 그 호선 운행이 서는 stop id. 직결 운행역은 두 호선에 다 들어간다. */
export function stopsByLine(routes: Route[], trips: Map<string, StopTime[]>): Map<string, Set<string>> {
  const byId = new Map(routes.map((r) => [r.id, r]))
  const out = new Map<string, Set<string>>()
  for (const [tripId, seq] of trips) {
    const route = byId.get(routeOfTrip(tripId))
    if (!route) continue
    const set = out.get(route.shortName) ?? new Set<string>()
    for (const st of seq) set.add(st.stopId)
    out.set(route.shortName, set)
  }
  return out
}

/* ---------- 소요시간 (스펙 4절) ---------- */

/** to → [from, 초] 역방향 인접 목록. 다익스트라를 기준역에서 거꾸로 돌리기 위한 것. */
export type ReverseGraph = Map<string, [string, number][]>

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 출근 시간 창 (스펙 transit-wait W2). 도착시각 기준, 끝은 제외. */
export const PEAK_WINDOW: [number, number] = [7 * 3600, 9 * 3600]
/** 창 안에 운행이 없을 때의 폴백 (W4). */
const DAY_WINDOW: [number, number] = [5 * 3600, 24 * 3600]

/**
 * 구간 a→b 로 출발하는 열차를 탈 때의 평균 대기 = 배차간격 ÷ 2 (W1·W3).
 * 방향별로 센다 — 양방향을 합치면 대기가 절반으로 준다. 급행(다음 정차가 다름)은 다른 키다.
 * 창 안에 그 방향만 없고 반대 방향(b→a)은 있으면 반대 방향 배차를 쓴다 (W10) — KTDB 2025-03 은 7호선 남행(07-1D)이
 * 16시 이후 75회뿐이라, 하루 폴백이면 출근 대기가 8분(실제 2~3분)으로 부풀었다. 둘 다 없으면 하루 폴백 (W4).
 */
export function boardWaits(
  trips: Map<string, StopTime[]>,
  window: [number, number] = PEAK_WINDOW,
): { waits: Map<string, number>; fallback: string[]; mirrored: string[] } {
  const inWindow = new Map<string, number>()
  const inDay = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  for (const seq of trips.values()) {
    for (let i = 0; i + 1 < seq.length; i++) {
      const a = seq[i]
      const b = seq[i + 1]
      if (a.stopId === b.stopId) continue
      const k = `${a.stopId}>${b.stopId}`
      if (a.arrival >= window[0] && a.arrival < window[1]) bump(inWindow, k)
      if (a.arrival >= DAY_WINDOW[0] && a.arrival < DAY_WINDOW[1]) bump(inDay, k)
    }
  }
  const waits = new Map<string, number>()
  const fallback: string[] = []
  const mirrored: string[] = []
  for (const k of new Set([...inWindow.keys(), ...inDay.keys()])) {
    const n = inWindow.get(k)
    if (n) {
      waits.set(k, (window[1] - window[0]) / n / 2)
      continue
    }
    const [a, b] = k.split('>')
    const back = inWindow.get(`${b}>${a}`)
    if (back) {
      waits.set(k, (window[1] - window[0]) / back / 2)
      mirrored.push(k)
      continue
    }
    const d = inDay.get(k)
    if (d) {
      waits.set(k, (DAY_WINDOW[1] - DAY_WINDOW[0]) / d / 2)
      fallback.push(k)
    }
  }
  return { waits, fallback: fallback.sort(), mirrored: mirrored.sort() }
}

/**
 * 정류장 P:<stop> 과 열차 위 R:<a>><b> 로 나눈 역방향 그래프 (스펙 transit-wait W5·W6).
 *   탑승 P(a)→R(a>b) = 대기(a>b) + 승차(a>b)   — 대기가 붙는 유일한 간선
 *   계속 R(a>b)→R(b>c) = 승차(b>c)               — 실제 운행에 a,b,c 가 이어서 있을 때만 (급행·완행을 섞지 않는다)
 *   하차 R(a>b)→P(b) = 0,  환승 P(a)→P(b) = transfers.txt 초
 * 승차 = 연속 정차 간 도착시각 차의 중앙값(방향별). dt ≤ 0 인 구간은 끊긴 것으로 본다.
 */
export function buildWaitGraph(trips: Map<string, StopTime[]>, transfers: Transfer[], waits: Map<string, number>): ReverseGraph {
  const samples = new Map<string, number[]>()
  const continues = new Set<string>()
  for (const seq of trips.values()) {
    let prevKey: string | undefined
    for (let i = 1; i < seq.length; i++) {
      const dt = seq[i].arrival - seq[i - 1].arrival
      if (dt <= 0 || seq[i].stopId === seq[i - 1].stopId) {
        prevKey = undefined
        continue
      }
      const k = `${seq[i - 1].stopId}>${seq[i].stopId}`
      const list = samples.get(k)
      if (list) list.push(dt)
      else samples.set(k, [dt])
      if (prevKey) continues.add(`${prevKey}|${k}`)
      prevKey = k
    }
  }
  const g: ReverseGraph = new Map()
  const add = (from: string, to: string, s: number) => {
    const list = g.get(to)
    if (list) list.push([from, s])
    else g.set(to, [[from, s]])
  }
  const ride = new Map([...samples].map(([k, xs]) => [k, median(xs)]))
  for (const [k, r] of ride) {
    const [a, b] = k.split('>')
    const w = waits.get(k)
    if (w !== undefined) add(`P:${a}`, `R:${k}`, w + r)
    add(`R:${k}`, `P:${b}`, 0)
  }
  for (const c of continues) {
    const [k1, k2] = c.split('|')
    add(`R:${k1}`, `R:${k2}`, ride.get(k2)!)
  }
  for (const t of transfers) add(`P:${t.from}`, `P:${t.to}`, t.seconds)
  return g
}

/** 각 stop 에서 targets 중 하나까지의 최소 초. 역 수가 천 단위라 단순 배열 우선순위로 충분하다. */
export function secondsTo(g: ReverseGraph, targets: string[]): Map<string, number> {
  const dist = new Map<string, number>(targets.map((t) => [t, 0]))
  const done = new Set<string>()
  for (;;) {
    let cur: string | undefined
    let best = Infinity
    for (const [k, d] of dist) if (!done.has(k) && d < best) { best = d; cur = k }
    if (cur === undefined) return dist
    done.add(cur)
    for (const [from, s] of g.get(cur) ?? []) {
      const nd = best + s
      if (nd < (dist.get(from) ?? Infinity)) dist.set(from, nd)
    }
  }
}

/** 역(stop id) 에서 기준역까지의 초 — 정류장 정점만 골라 키를 stop id 로 되돌린다. */
export function stationSecondsTo(g: ReverseGraph, targetStopIds: string[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const [node, s] of secondsTo(g, targetStopIds.map((t) => `P:${t}`))) if (node.startsWith('P:')) out.set(node.slice(2), s)
  return out
}

/** 기준역 = 이름 괄호 앞이 정확히 같은 stop 들 ("시청·용인대" 는 아니다). */
export function targetStops(stops: Stop[], name: string): string[] {
  const ids = stops.filter((s) => baseName(s.name) === name).map((s) => s.id)
  if (!ids.length) throw new Error(`기준역 "${name}" 을 GTFS 에서 못 찾았다`)
  return ids
}

export const DETOUR = 1.3
export const WALK_M_PER_MIN = 72
export const WALK_LIMIT_M = 2000
export const STATION_RADIUS_M = 500

export const walkSeconds = (meters: number): number => (meters * DETOUR / WALK_M_PER_MIN) * 60

export const metersBetween = (a: [number, number], b: [number, number]): number =>
  distance(a, b, { units: 'kilometers' }) * 1000

export interface Near { stop: Stop; meters: number }

/** 단지 좌표에서 WALK_LIMIT_M 이내 역을 가까운 순으로. */
export function nearStops(point: [number, number], stops: Stop[]): Near[] {
  return stops
    .map((stop) => ({ stop, meters: metersBetween(point, [stop.lng, stop.lat]) }))
    .filter((n) => n.meters <= WALK_LIMIT_M)
    .sort((a, b) => a.meters - b.meters)
}

/** 도보 + 역→기준역 의 최소를 분으로 반올림. 닿는 역이 없으면 undefined (키를 저장하지 않는다). */
export function minutesVia(near: Near[], toTarget: Map<string, number>): number | undefined {
  let best = Infinity
  for (const n of near) {
    const s = toTarget.get(n.stop.id)
    if (s !== undefined) best = Math.min(best, walkSeconds(n.meters) + s)
  }
  return Number.isFinite(best) ? Math.round(best / 60) : undefined
}

/* ---------- 레이어·행 (스펙 5절) ---------- */

export interface Target { name: string; key: 'minSeolleung' | 'minYeouido' | 'minCityHall'; code: string }
export const TARGETS: Target[] = [
  { name: '선릉', key: 'minSeolleung', code: 'sl' },
  { name: '여의도', key: 'minYeouido', code: 'yd' },
  { name: '시청', key: 'minCityHall', code: 'ch' },
]
export const BANDS_MIN = [30, 60]

export const TRANSIT_SCHEMA: PropertySchemaField[] = [
  { key: 'nearestStation', label: '가까운 역', type: 'text' },
  { key: 'stationDistance', label: '역까지', type: 'number', unit: 'm' },
  { key: 'minSeolleung', label: '선릉까지', type: 'number', unit: '분' },
  { key: 'minYeouido', label: '여의도까지', type: 'number', unit: '분' },
  { key: 'minCityHall', label: '시청까지', type: 'number', unit: '분' },
]
const TRANSIT_KEYS = new Set(TRANSIT_SCHEMA.map((f) => f.key))
const LEAD50_KEYS = new Set(LEAD50_SCHEMA.map((f) => f.key))

export interface FilterLayer { name: string; suffix: string; pick: (p: Properties) => boolean }

const bandLabel = (m: number) => (m % 60 === 0 ? `${m / 60}시간` : `${m}분`)

export const FILTER_LAYERS: FilterLayer[] = [
  { name: `역 ${STATION_RADIUS_M}m 이내 (월간선도50)`, suffix: `st${STATION_RADIUS_M}`, pick: (p) => typeof p.stationDistance === 'number' && p.stationDistance <= STATION_RADIUS_M },
  ...TARGETS.flatMap((t) => BANDS_MIN.map((m) => ({
    name: `${t.name} ${bandLabel(m)} 이내 (월간선도50)`,
    suffix: `${t.code}${m}`,
    pick: (p: Properties) => typeof p[t.key] === 'number' && (p[t.key] as number) <= m,
  }))),
]

/** 원본 레이어 스키마 뒤에 우리 필드를 붙인다 (D8). 이미 있으면 그 필드 객체를 유지. */
export function appendTransitSchema(existing: PropertySchemaField[]): PropertySchemaField[] {
  const have = new Set(existing.map((f) => f.key))
  return [...existing, ...TRANSIT_SCHEMA.filter((f) => !have.has(f.key))]
}

/** 필터 레이어 스키마 = 월간선도50 필드 + 우리 필드. 사용자가 고친 필드 객체는 유지. */
export function filterSchema(existing: PropertySchemaField[]): PropertySchemaField[] {
  const base = [...LEAD50_SCHEMA, ...TRANSIT_SCHEMA]
  const keys = new Set(base.map((f) => f.key))
  return [...base.map((f) => existing.find((e) => e.key === f.key) ?? f), ...existing.filter((e) => !keys.has(e.key))]
}

export function lineSchema(existing: PropertySchemaField[]): PropertySchemaField[] {
  const keys = new Set(LINE_SCHEMA.map((f) => f.key))
  return [...LINE_SCHEMA.map((f) => existing.find((e) => e.key === f.key) ?? f), ...existing.filter((e) => !keys.has(e.key))]
}

/** 단지 하나의 우리 속성. 값이 없는 키는 넣지 않는다. */
export function transitProps(point: [number, number], stops: Stop[], toTargets: Map<string, number>[]): Properties {
  const near = nearStops(point, stops)
  const out: Properties = {}
  if (near[0]) {
    out.nearestStation = near[0].stop.name
    out.stationDistance = Math.round(near[0].meters)
  }
  TARGETS.forEach((t, i) => {
    const m = minutesVia(near, toTargets[i])
    if (m !== undefined) out[t.key] = m
  })
  return out
}

/** 원본 행의 우리 키만 교체 (D8). */
export function withTransit(f: FeatureRow, props: Properties, now: string): FeatureRow {
  const properties: Properties = {}
  for (const [k, v] of Object.entries(f.properties)) if (!TRANSIT_KEYS.has(k)) properties[k] = v
  return { ...f, properties: { ...properties, ...props }, updated_at: now }
}

/** 원본(우리 속성이 붙은) → 사본. 월간선도50 필드·아이콘·거래 블록·우리 속성만 복사 (TOP9 와 같은 이유 — 이미지 블록을 두 도형이 공유하지 않게). */
export function copyRow(f: FeatureRow, layer: FilterLayer, layerId: string, now: string): FeatureRow {
  const properties: Properties = {}
  for (const [k, v] of Object.entries(f.properties)) if (LEAD50_KEYS.has(k) || TRANSIT_KEYS.has(k) || k === 'icon') properties[k] = v
  return {
    id: `${f.id}__${layer.suffix}`,
    project_id: f.project_id,
    layer_id: layerId,
    parent_id: null,
    geometry: f.geometry,
    title: f.title,
    properties,
    blocks: f.blocks.filter((b) => b.id === TRADES_BLOCK_ID),
    derived_from: null,
    created_at: f.created_at,
    updated_at: now,
  }
}

/** 월간선도50 단지 도형만 (사용자가 그린 도형·링 제외). */
export const isComplex = (f: FeatureRow): boolean =>
  !f.derived_from && !f.parent_id && f.geometry.type === 'Point' && f.properties.kbComplexId !== undefined

/** Terra Draw 가 소수점 9자리를 넘는 좌표를 거부한다 (CLAUDE.md 함정). GTFS 는 9자리라 7자리로 맞춘다. */
export const coord = (s: Stop): [number, number] => [Number(s.lng.toFixed(7)), Number(s.lat.toFixed(7))]

const slug = (stopId: string) => stopId.slice(STOP_PREFIX.length)

export function stationRow(s: Stop, line: LineDef, layerId: string, projectId: string, now: string): FeatureRow {
  return {
    id: `ftr_stn_${line.code}_${slug(s.id)}`,
    project_id: projectId,
    layer_id: layerId,
    parent_id: null,
    geometry: { type: 'Point', coordinates: coord(s) },
    title: baseName(s.name),
    properties: { line: line.layer.replace(/^지하철 /, ''), stopId: s.id },
    blocks: [],
    derived_from: null,
    created_at: now,
    updated_at: now,
  }
}
