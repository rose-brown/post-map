import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FILTER_LAYERS, appendTransitSchema, baseName, boardWaits, buildReverseGraph, copyRow, minutesVia, nearStops,
  parseTime, secondsTo, targetStops, transitProps, tripSequences, walkSeconds, withTransit, filterSchema,
} from '../scripts/transit/build.ts'
import type { Stop, StopTime } from '../scripts/transit/build.ts'
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

const H7 = 7 * 3600

test('boardWaits: 방향별, 07~09시만, 급행은 다른 키, 창 밖이면 하루 폴백', () => {
  const trips = tripSequences([
    st('L_Ord001', 'A', 1, H7), st('L_Ord001', 'B', 2, H7 + 120),
    st('L_Ord002', 'A', 1, H7 + 600), st('L_Ord002', 'B', 2, H7 + 720),
    st('L_Ord003', 'A', 1, H7 + 1200), st('L_Ord003', 'B', 2, H7 + 1320),
    st('L_Ord004', 'A', 1, H7 + 1800), st('L_Ord004', 'B', 2, H7 + 1920),
    st('L_Ord005', 'A', 1, 10 * 3600), st('L_Ord005', 'B', 2, 10 * 3600 + 120),   // 창 밖 — 안 센다
    st('R_Ord001', 'B', 1, H7), st('R_Ord001', 'A', 2, H7 + 120),                  // 반대 방향 1회
    st('E_Ord001', 'A', 1, H7 + 100), st('E_Ord001', 'C', 2, H7 + 400),            // 급행 A→C
    st('N_Ord001', 'D', 1, 12 * 3600), st('N_Ord001', 'E', 2, 12 * 3600 + 60),     // 낮에만 2회
    st('N_Ord002', 'D', 1, 13 * 3600), st('N_Ord002', 'E', 2, 13 * 3600 + 60),
    st('M_Ord001', 'F', 1, 25 * 3600), st('M_Ord001', 'G', 2, 25 * 3600 + 60),     // 24시 넘어서만
  ])
  const { waits, fallback } = boardWaits(trips)
  assert.equal(waits.get('A>B'), 7200 / 4 / 2)
  assert.equal(waits.get('B>A'), 7200 / 1 / 2)
  assert.equal(waits.get('A>C'), 3600)
  assert.equal(waits.get('D>E'), 68400 / 2 / 2)
  assert.equal(waits.has('F>G'), false)
  assert.deepEqual(fallback, ['D>E'])
})
