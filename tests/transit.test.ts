import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FILTER_LAYERS, appendTransitSchema, baseName, buildReverseGraph, copyRow, lineStopOrders, minutesVia, nearStops,
  parseTime, patternOf, secondsTo, targetStops, transitProps, tripSequences, walkSeconds, withTransit, filterSchema,
} from '../scripts/transit/build.ts'
import type { Route, Stop, StopTime } from '../scripts/transit/build.ts'
import type { FeatureRow } from '../src/db/mappers.ts'

const st = (tripId: string, stopId: string, seq: number, arrival: number): StopTime => ({ tripId, stopId, seq, arrival })
const stop = (id: string, name: string, lng: number, lat: number): Stop => ({ id, name, lng, lat })

test('parseTime: 24시를 넘는 값', () => {
  assert.equal(parseTime('05:02:30'), 5 * 3600 + 150)
  assert.equal(parseTime('25:10:00'), 25 * 3600 + 600)
  assert.throws(() => parseTime('5:2'))
})

test('baseName: 끝 괄호만 뗀다', () => {
  assert.equal(baseName('시청(1호선)'), '시청')
  assert.equal(baseName('시청·용인대'), '시청·용인대')
})

test('patternOf: 상·하행과 내·외선을 한 갈래로', () => {
  assert.equal(patternOf('RR_ACC1_S-1-01-1D'), 'RR_ACC1_S-1-01-1')
  assert.equal(patternOf('RR_ACC1_S-1-02-1O'), 'RR_ACC1_S-1-02-1')
  assert.equal(patternOf('RR_ACC1_S-1-06-00'), 'RR_ACC1_S-1-06-00')
})

test('buildReverseGraph + secondsTo: 간선은 중앙값, 환승 포함, 방향 구분', () => {
  const trips = tripSequences([
    st('R_Ord001', 'A', 1, 0), st('R_Ord001', 'B', 2, 120), st('R_Ord001', 'C', 3, 300),
    st('R_Ord002', 'A', 1, 1000), st('R_Ord002', 'B', 2, 1100),
    st('R_Ord003', 'A', 1, 2000), st('R_Ord003', 'B', 2, 2600),   // 이상값 — 중앙값이 흡수
    st('Q_Ord001', 'X', 1, 0), st('Q_Ord001', 'Y', 2, 60),
  ])
  const g = buildReverseGraph(trips, [{ from: 'C', to: 'X', seconds: 90 }])
  const d = secondsTo(g, ['Y'])
  // A→B 중앙값 120, B→C 180, C→X 환승 90, X→Y 60
  assert.equal(d.get('A'), 120 + 180 + 90 + 60)
  assert.equal(d.get('X'), 60)
  // 역방향 운행이 없으면 닿지 않는다
  assert.equal(secondsTo(g, ['A']).get('C'), undefined)
})

test('lineStopOrders: 갈래마다 가장 긴 운행, 급행 제외, 순환은 되돌아온 역에서 끊는다', () => {
  const routes: Route[] = [
    { id: 'L-1D', shortName: 'L', longName: 'L<하행>' },
    { id: 'L-1U', shortName: 'L', longName: 'L<상행>' },
    { id: 'L-2D', shortName: 'L', longName: 'L(급행)<하행>' },
    { id: 'O-1I', shortName: 'O', longName: 'O<내선>' },
  ]
  const trips = tripSequences([
    st('L-1D_Ord001', 'a', 1, 0), st('L-1D_Ord001', 'b', 2, 1),
    st('L-1U_Ord001', 'c', 1, 0), st('L-1U_Ord001', 'b', 2, 1), st('L-1U_Ord001', 'a', 3, 2),
    st('L-2D_Ord001', 'a', 1, 0), st('L-2D_Ord001', 'b', 2, 1), st('L-2D_Ord001', 'c', 3, 2), st('L-2D_Ord001', 'd', 4, 3),
    st('O-1I_Ord001', 'p', 1, 0), st('O-1I_Ord001', 'q', 2, 1), st('O-1I_Ord001', 'r', 3, 2), st('O-1I_Ord001', 'p', 4, 3), st('O-1I_Ord001', 'q', 5, 4),
  ])
  const o = lineStopOrders(routes, trips)
  assert.deepEqual(o.map((x) => x.key).sort(), ['L-1-0', 'O-1-0'])
  assert.deepEqual(o.find((x) => x.key === 'L-1-0')!.stops, ['c', 'b', 'a'])   // 하행 a-b 는 이미 그린 구간
  assert.deepEqual(o.find((x) => x.key === 'O-1-0')!.stops, ['p', 'q', 'r', 'p'])
})

test('lineStopOrders: 한 route 안의 지선은 선이 하나 더, 회차 운행은 빠진다', () => {
  const routes: Route[] = [{ id: 'F-1D', shortName: 'F', longName: 'F<하행>' }]
  const trips = tripSequences([
    st('F-1D_Ord001', 'a', 1, 0), st('F-1D_Ord001', 'b', 2, 1), st('F-1D_Ord001', 'c', 3, 2), st('F-1D_Ord001', 'd', 4, 3),
    st('F-1D_Ord002', 'a', 1, 0), st('F-1D_Ord002', 'b', 2, 1), st('F-1D_Ord002', 'x', 3, 2),   // 지선
    st('F-1D_Ord003', 'b', 1, 0), st('F-1D_Ord003', 'c', 2, 1),                               // 회차
  ])
  assert.deepEqual(lineStopOrders(routes, trips).map((x) => x.stops), [['a', 'b', 'c', 'd'], ['a', 'b', 'x']])
})

test('lineStopOrders: 급행 표시 없이 역을 건너뛰는 운행은 선을 그리지 않는다', () => {
  const routes: Route[] = [{ id: 'G-1D', shortName: 'G', longName: 'G<하행>' }]
  const trips = tripSequences([
    st('G-1D_Ord001', 'a', 1, 0), st('G-1D_Ord001', 'b', 2, 1), st('G-1D_Ord001', 'c', 3, 2),
    st('G-1D_Ord002', 'a', 1, 0), st('G-1D_Ord002', 'c', 2, 1), st('G-1D_Ord002', 'd', 3, 2), st('G-1D_Ord002', 'e', 4, 3),
    st('G-1D_Ord003', 'c', 1, 0), st('G-1D_Ord003', 'd', 2, 1),
  ])
  // Ord002 가 가장 길지만 a→c 는 Ord001 에서 b 를 끼고 있다 — 건너뛴 현
  assert.deepEqual(lineStopOrders(routes, trips).map((x) => x.stops), [['a', 'b', 'c'], ['c', 'd']])
})

test('targetStops: 이름이 정확히 같은 역만, 없으면 실패', () => {
  const stops = [stop('1', '시청(1호선)', 0, 0), stop('2', '시청(2호선)', 0, 0), stop('3', '시청·용인대', 0, 0)]
  assert.deepEqual(targetStops(stops, '시청'), ['1', '2'])
  assert.throws(() => targetStops(stops, '선릉'))
})

test('walkSeconds: 직선 × 1.3 ÷ 72m/분', () => {
  assert.equal(walkSeconds(720), 13 * 60)
})

test('minutesVia: 가장 가까운 역이 아니라 합이 가장 작은 역을 고른다', () => {
  const near = [
    { stop: stop('near', 'n', 0, 0), meters: 100 },
    { stop: stop('far', 'f', 0, 0), meters: 720 },   // 도보 13분
  ]
  const to = new Map([['near', 40 * 60], ['far', 10 * 60]])
  assert.equal(minutesVia(near, to), 23)
  assert.equal(minutesVia(near, new Map()), undefined)
})

test('nearStops · transitProps: 2km 밖 역은 무시하고 없는 값은 키를 두지 않는다', () => {
  const stops = [stop('s1', '역삼(2호선)', 127.0366, 37.5006), stop('far', '먼역', 127.3, 37.5)]
  const p: [number, number] = [127.0366, 37.5033]   // 약 300m 북쪽
  assert.deepEqual(nearStops(p, stops).map((n) => n.stop.id), ['s1'])
  const props = transitProps(p, stops, [new Map([['s1', 600]]), new Map(), new Map()])
  assert.equal(props.nearestStation, '역삼(2호선)')
  assert.ok(Math.abs(Number(props.stationDistance) - 300) < 5)
  assert.equal(props.minSeolleung, Math.round((walkSeconds(Number(props.stationDistance)) + 600) / 60))
  assert.equal('minYeouido' in props, false)
  assert.deepEqual(transitProps([128, 36], stops, [new Map(), new Map(), new Map()]), {})
})

const row = (p: Partial<FeatureRow> = {}): FeatureRow => ({
  id: 'ftr_1', project_id: 'p', layer_id: 'lyr_a', parent_id: null, geometry: { type: 'Point', coordinates: [127, 37.5] },
  title: '단지', properties: { rank: 3, kbComplexId: '1', icon: 'star', memo: '사용자', minYeouido: 99 },
  blocks: [{ id: 'blk_lead50_trades', type: 'text', text: '거래' }, { id: 'blk_user', type: 'gallery', refs: [] }],
  derived_from: null, created_at: 'c', updated_at: 'u', ...p,
})

test('withTransit: 우리 키만 교체하고 사용자 속성은 둔다', () => {
  const r = withTransit(row(), { minSeolleung: 20 }, 'now')
  assert.deepEqual(r.properties, { rank: 3, kbComplexId: '1', icon: 'star', memo: '사용자', minSeolleung: 20 })
  assert.equal(r.updated_at, 'now')
  assert.equal(r.blocks.length, 2)
})

test('copyRow: 고정 id, 월간선도50·우리 키·아이콘·거래 블록만', () => {
  const layer = FILTER_LAYERS.find((l) => l.suffix === 'sl30')!
  const c = copyRow(row(), layer, 'lyr_f', 'now')
  assert.equal(c.id, 'ftr_1__sl30')
  assert.equal(c.layer_id, 'lyr_f')
  assert.deepEqual(c.properties, { rank: 3, kbComplexId: '1', icon: 'star', minYeouido: 99 })
  assert.deepEqual(c.blocks.map((b) => b.id), ['blk_lead50_trades'])
})

test('FILTER_LAYERS: 역세권 1 + 기준역 3 × 2 구간, 누적', () => {
  assert.equal(FILTER_LAYERS.length, 7)
  const by = (s: string) => FILTER_LAYERS.find((l) => l.suffix === s)!
  assert.equal(by('st500').name, '역 500m 이내 (월간선도50)')
  assert.equal(by('yd60').name, '여의도 1시간 이내 (월간선도50)')
  assert.equal(by('ch30').pick({ minCityHall: 30 }), true)
  assert.equal(by('ch30').pick({ minCityHall: 31 }), false)
  assert.equal(by('ch60').pick({ minCityHall: 31 }), true)
  assert.equal(by('st500').pick({ stationDistance: 501 }), false)
  assert.equal(by('st500').pick({}), false)
})

test('스키마: 원본에는 뒤에 붙이고, 필터 레이어는 사용자가 고친 필드를 유지', () => {
  const s = appendTransitSchema([{ key: 'memo', label: '메모', type: 'text' }])
  assert.equal(s[0].key, 'memo')
  assert.equal(s.at(-1)!.key, 'minCityHall')
  assert.equal(appendTransitSchema(s).length, s.length)
  const f = filterSchema([{ key: 'minSeolleung', label: '선릉(분)', type: 'number' }])
  assert.equal(f.find((x) => x.key === 'minSeolleung')!.label, '선릉(분)')
})
