import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SCHEMA, TRADES_BLOCK_ID, leafRegions, jibunOf, matchTrades, summarizeTrades, formatPrice,
  recentTradeLine, tradesBlock, buildProperties, mergeSchema, mergeFeature, duplicateIds, sggCodesFor,
} from '../scripts/lead50/build.ts'
import type { Complex, Trade } from '../scripts/lead50/build.ts'
import type { FeatureRow } from '../src/db/mappers.ts'
import { parseMolitXml, recentMonths } from '../scripts/lead50/molit.ts'

const t = (p: Partial<Trade>): Trade => ({
  dong: '호계동', aptName: '평촌어바인퍼스트', area: 84.6, price: 100000, ymd: '2026-08-01', floor: '10', cancelled: false, jibun: '1296', ...p,
})
const complex = (p: Partial<Complex['item']> = {}): Complex => ({
  region: { code: '4117300000', name: '경기 안양시 동안구' },
  item: { rank: 2, kbComplexId: '41747', aptName: '평촌어바인퍼스트', generalHouseholds: 3661, completion: '21년 01월 (6년차)', pricePerPyeong: 3572, marketCap: '3.56조', baseMonth: '202609', ...p },
  detail: { lat: 37.37260921234, lng: 126.95605181234, households: 3850, sigungu: '안양시 동안구', dong: '호계동', jibun: '1296', minArea: '39.26', maxArea: '84.60' },
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

test('matchTrades: 같은 동 + 같은 지번만, 이름은 보지 않는다', () => {
  const c = complex()   // detail.dong '호계동', detail.jibun '1296'
  const r = matchTrades(c, [
    t({ jibun: '1296', aptName: '완전히다른이름' }),
    t({ jibun: '1296', dong: '평촌동' }),
    t({ jibun: '1296-1' }),
  ])
  assert.equal(r.length, 1)
  assert.equal(r[0].aptName, '완전히다른이름')
})

test('matchTrades: KB 지번이 비어 있으면 매칭하지 않는다', () => {
  const c = complex()
  c.detail.jibun = ''
  assert.deepEqual(matchTrades(c, [t({ jibun: '' })]), [])
})

test('jibunOf: 부번 0 은 본번만, 앞자리 0 제거, 본번 없으면 빈 문자열', () => {
  assert.equal(jibunOf('484', '0'), '484')
  assert.equal(jibunOf('1053', '3'), '1053-3')
  assert.equal(jibunOf('0075', '0002'), '75-2')
  assert.equal(jibunOf(undefined, '0'), '')
  assert.equal(jibunOf('', undefined), '')
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

test('sggCodesFor: 앞 5자리, 화성시는 신설 구 코드 4개', () => {
  assert.deepEqual(sggCodesFor({ code: '4117300000', name: '경기 안양시 동안구' }), ['41173'])
  assert.deepEqual(sggCodesFor({ code: '4159000000', name: '경기 화성시' }), ['41591', '41593', '41595', '41597'])
})

test('parseMolitXml: 금액 쉼표·해제·날짜 패딩', () => {
  const xml = `<response><header><resultCode>000</resultCode></header><body><items>
    <item><aptNm>평촌어바인퍼스트</aptNm><umdNm>호계동</umdNm><jibun>1296</jibun><excluUseAr>84.6</excluUseAr><dealAmount> 151,000</dealAmount>
    <dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>3</dealDay><floor>12</floor><cdealType></cdealType></item>
    <item><aptNm>평촌어바인퍼스트</aptNm><umdNm>호계동</umdNm><jibun>1296</jibun><excluUseAr>59.9</excluUseAr><dealAmount>90,000</dealAmount>
    <dealYear>2026</dealYear><dealMonth>7</dealMonth><dealDay>21</dealDay><floor>3</floor><cdealType>O</cdealType></item>
  </items><totalCount>2</totalCount></body></response>`
  const p = parseMolitXml(xml)
  assert.equal(p.resultCode, '000')
  assert.equal(p.totalCount, 2)
  assert.deepEqual(p.trades[0], { dong: '호계동', aptName: '평촌어바인퍼스트', jibun: '1296', area: 84.6, price: 151000, ymd: '2026-08-03', floor: '12', cancelled: false })
  assert.equal(p.trades[1].cancelled, true)
})

test('recentMonths: 연도 경계를 넘는다', () => {
  assert.deepEqual(recentMonths(new Date(2026, 1, 15), 3), ['202602', '202601', '202512'])
})
