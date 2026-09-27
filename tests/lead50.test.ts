import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SCHEMA, TRADES_BLOCK_ID, leafRegions, normalizeName, matchTrades, summarizeTrades, formatPrice,
  recentTradeLine, tradesBlock, buildProperties, mergeSchema, mergeFeature, duplicateIds,
} from '../scripts/lead50/build.ts'
import type { Complex, Trade } from '../scripts/lead50/build.ts'
import type { FeatureRow } from '../src/db/mappers.ts'

const t = (p: Partial<Trade>): Trade => ({
  dong: '호계동', aptName: '평촌어바인퍼스트', area: 84.6, price: 100000, ymd: '2026-08-01', floor: '10', cancelled: false, ...p,
})
const complex = (p: Partial<Complex['item']> = {}): Complex => ({
  region: { code: '4117300000', name: '경기 안양시 동안구' },
  item: { rank: 2, kbComplexId: '41747', aptName: '평촌어바인퍼스트', generalHouseholds: 3661, completion: '21년 01월 (6년차)', pricePerPyeong: 3572, marketCap: '3.56조', baseMonth: '202609', ...p },
  detail: { lat: 37.37260921234, lng: 126.95605181234, households: 3850, sigungu: '안양시 동안구', dong: '호계동', minArea: '39.26', maxArea: '84.60' },
})

test('leafRegions: 하위 구가 있는 시는 빼고, 화성 신설 구는 화성시로 대체한다', () => {
  const rows = [
    { 법정동코드: '4111000000', 시군구명: '수원시', 하위시군구존재여부: '1' },
    { 법정동코드: '4111300000', 시군구명: '수원시 권선구', 하위시군구존재여부: '0' },
    { 법정동코드: '4180000000', 시군구명: '연천군', 하위시군구존재여부: '0' },
    { 법정동코드: '4159000000', 시군구명: '화성시', 하위시군구존재여부: '1' },
    { 법정동코드: '4159700000', 시군구명: '화성시 동탄구', 하위시군구존재여부: '0' },
    { 법정동코드: '4159100000', 시군구명: '화성시 만세구', 하위시군구존재여부: '0' },
  ]
  assert.deepEqual(leafRegions('경기', rows), [
    { code: '4111300000', name: '경기 수원시 권선구' },
    { code: '4180000000', name: '경기 연천군' },
    { code: '4159000000', name: '경기 화성시' },
  ])
})

test('normalizeName: 공백·괄호·아파트 접미사를 지우고 괄호 안 글자는 남긴다', () => {
  assert.equal(normalizeName('목련(우성7단지)'), '목련우성7단지')
  assert.equal(normalizeName('평촌 어바인퍼스트 아파트'), '평촌어바인퍼스트')
  assert.equal(normalizeName('석수LG빌리지APT'), '석수lg빌리지')
  assert.notEqual(normalizeName('목련(두산)'), normalizeName('목련(신동아)'))
})

test('matchTrades: 같은 동 + 정규화 이름 일치', () => {
  const r = matchTrades(complex(), [t({}), t({ aptName: '다른단지' }), t({ dong: '평촌동' })])
  assert.equal(r.how, 'exact')
  assert.equal(r.trades.length, 1)
})

test('matchTrades: 포함 관계는 후보 이름이 하나일 때만 쓴다', () => {
  const one = matchTrades(complex(), [t({ aptName: '평촌어바인퍼스트1단지' })])
  assert.equal(one.how, 'contains')
  const two = matchTrades(complex(), [t({ aptName: '평촌어바인퍼스트1단지' }), t({ aptName: '평촌어바인퍼스트2단지' })])
  assert.equal(two.how, 'none')
  assert.equal(two.trades.length, 0)
})

test('summarizeTrades: 해제·기간 밖 제외, 정수 ㎡ 로 묶고 최신 1건', () => {
  const g = summarizeTrades([
    t({ area: 84.6, ymd: '2026-07-01', price: 90000 }),
    t({ area: 84.9, ymd: '2026-08-15', price: 95000, floor: '12' }),
    t({ area: 84.7, ymd: '2026-09-01', price: 99999, cancelled: true }),
    t({ area: 59.9, ymd: '2025-01-01', price: 50000 }),
    t({ area: 59.9, ymd: '2026-06-01', price: 70000 }),
  ], '2025-10-01')
  assert.deepEqual(g.map((x) => [x.area, x.count, x.latest.price]), [[60, 1, 70000], [85, 2, 95000]])
})

test('formatPrice: 억 + 만원 나머지', () => {
  assert.equal(formatPrice(151000), '15억 1,000')
  assert.equal(formatPrice(120000), '12억')
  assert.equal(formatPrice(9500), '9,500만')
})

test('recentTradeLine: 거래가 가장 많은 평형의 최신 거래 한 줄', () => {
  const g = summarizeTrades([t({ area: 59.9 }), t({ area: 84.6, ymd: '2026-08-20', price: 151000, floor: '12' }), t({ area: 84.6, ymd: '2026-05-01' })], '2025-10-01')
  assert.equal(recentTradeLine(g), '85㎡ 15억 1,000 · 26.08.20 · 12층')
  assert.equal(recentTradeLine([]), undefined)
})

test('tradesBlock: 평형별 한 줄씩, 고정 id', () => {
  const b = tradesBlock(summarizeTrades([t({ area: 59.9, price: 70000, floor: '3' }), t({ area: 84.6 })], '2025-10-01'))
  assert.equal(b?.id, TRADES_BLOCK_ID)
  assert.equal(b?.type, 'text')
  assert.equal(b?.text, '매매 실거래 (최근 12개월)\n60㎡  7억  26.08.01  3층  (1건)\n85㎡  10억  26.08.01  10층  (1건)')
  assert.equal(tradesBlock([]), undefined)
})

test('buildProperties: 없는 값은 키를 넣지 않는다', () => {
  const p = buildProperties(complex({ generalHouseholds: undefined, marketCap: undefined }), [])
  assert.equal('generalHouseholds' in p, false)
  assert.equal('marketCap' in p, false)
  assert.equal('recentTrade' in p, false)
  assert.equal(p.households, 3850)
  assert.equal(p.exclusiveArea, '39.26~84.60㎡')
  assert.equal(p.region, '안양시 동안구 호계동')
  assert.equal(p.kbComplexId, '41747')
})

test('mergeSchema: 우리 필드가 스펙 순서로 앞, 사용자 필드는 뒤, 사용자가 고친 라벨 유지', () => {
  const merged = mergeSchema([
    { key: 'memo', label: '메모', type: 'text' },
    { key: 'rank', label: '내 순위', type: 'number' },
  ])
  assert.deepEqual(merged.map((f) => f.key), [...SCHEMA.map((f) => f.key), 'memo'])
  assert.equal(merged[0].key, 'recentTrade')
  assert.equal(merged.find((f) => f.key === 'rank')?.label, '내 순위')
})

test('mergeFeature: 사용자 속성·블록 보존, 우리 키와 거래 블록만 교체', () => {
  const existing: FeatureRow = {
    id: 'ftr_old', project_id: 'P', layer_id: 'L', parent_id: null,
    geometry: { type: 'Point', coordinates: [0, 0] }, title: '옛이름',
    properties: { recentTrade: '옛 거래', memo: '임장함', rank: 9 },
    blocks: [{ id: TRADES_BLOCK_ID, type: 'text', text: '옛' }, { id: 'blk_user', type: 'text', text: '내 메모' }],
    derived_from: null, created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
  }
  const row = mergeFeature({
    existing, c: complex(), props: { rank: 2 }, block: { id: TRADES_BLOCK_ID, type: 'text', text: '새' },
    layerId: 'L', projectId: 'P', now: '2026-10-01T00:00:00.000Z', newId: 'ftr_new',
  })
  assert.equal(row.id, 'ftr_old')
  assert.equal(row.created_at, '2026-09-01T00:00:00.000Z')
  assert.equal(row.updated_at, '2026-10-01T00:00:00.000Z')
  assert.equal(row.title, '평촌어바인퍼스트')
  assert.deepEqual(row.properties, { memo: '임장함', rank: 2 })
  assert.deepEqual(row.blocks.map((b) => [b.id, b.text]), [[TRADES_BLOCK_ID, '새'], ['blk_user', '내 메모']])
  assert.deepEqual(row.geometry, { type: 'Point', coordinates: [126.9560518, 37.3726092] })
})

test('mergeFeature: 새 도형은 newId, 거래가 없으면 거래 블록을 지운다', () => {
  const row = mergeFeature({ c: complex(), props: {}, layerId: 'L', projectId: 'P', now: 'N', newId: 'ftr_new' })
  assert.equal(row.id, 'ftr_new')
  assert.equal(row.created_at, 'N')
  assert.deepEqual(row.blocks, [])
})

test('duplicateIds: 지역 간 중복 단지를 찾는다', () => {
  assert.deepEqual(duplicateIds([complex(), complex({ rank: 1 }), complex({ kbComplexId: '1' })]), ['41747'])
})
