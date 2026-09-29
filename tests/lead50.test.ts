import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SCHEMA, TRADES_BLOCK_ID, STAR_RANK, leafRegions, jibunOf, dongOf, matchTrades, summarizeTrades, formatPrice,
  recentTradeLine, tradesBlock, buildProperties, mergeSchema, mergeFeature, duplicateIds, sggCodesFor, rankIcon,
  regionPrefix, retireRows, topRows, bandOf, BAND_LAYERS,
  entryTradeLine, parsePrice, parseTradesBlock, priceBandOf, priceRows, PRICE_LAYERS,
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

test('dongOf: 동은 동, 읍·면은 읍 + 리, 못 찾으면 fallback', () => {
  assert.equal(dongOf('경기도 안양시 만안구 석수동 484', '석수동', 'X'), '석수동')
  assert.equal(dongOf('경기도 가평군 가평읍 대곡리 695', '가평읍', '가평읍'), '가평읍 대곡리')
  assert.equal(dongOf('경기도 양평군 양서면 양수리 12-3', '양서면', '양서면'), '양서면 양수리')
  assert.equal(dongOf(undefined, '가평읍', '가평읍'), '가평읍')
  assert.equal(dongOf('경기도 가평군 가평읍 대곡리 695', '청평면', '청평면'), '청평면')
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
  assert.deepEqual(row.properties, { memo: '임장함', rank: 2, icon: 'star' })
  assert.deepEqual(row.blocks.map((b) => [b.id, b.text]), [[TRADES_BLOCK_ID, '새'], ['blk_user', '내 메모']])
  assert.deepEqual(row.geometry, { type: 'Point', coordinates: [126.9560518, 37.3726092] })
})

test('mergeFeature: 새 도형은 newId, 거래가 없으면 거래 블록을 지운다', () => {
  const row = mergeFeature({ c: complex(), props: {}, layerId: 'L', projectId: 'P', now: 'N', newId: 'ftr_new' })
  assert.equal(row.id, 'ftr_new')
  assert.equal(row.created_at, 'N')
  assert.deepEqual(row.blocks, [])
  assert.equal(row.properties.icon, 'star')
})

test('duplicateIds: 지역 간 중복 단지를 찾는다', () => {
  assert.deepEqual(duplicateIds([complex(), complex({ rank: 1 }), complex({ kbComplexId: '1' })]), ['41747'])
})

test('sggCodesFor: 앞 5자리, 화성시는 신설 구 코드 4개', () => {
  assert.deepEqual(sggCodesFor({ code: '4117300000', name: '경기 안양시 동안구' }), ['41173'])
  assert.deepEqual(sggCodesFor({ code: '4159000000', name: '경기 화성시' }), ['41591', '41593', '41595', '41597'])
})

test('rankIcon: Top 10 은 ★, 밖으로 밀리면 ★ 만 뗀다, 사용자 아이콘은 보존', () => {
  assert.equal(STAR_RANK, 10)
  assert.equal(rankIcon(undefined, 1), 'star')
  assert.equal(rankIcon('dot', 10), 'star')
  assert.equal(rankIcon('star', 3), 'star')
  assert.equal(rankIcon('home', 3), 'home')
  assert.equal(rankIcon('star', 11), undefined)
  assert.equal(rankIcon(undefined, 30), undefined)
  assert.equal(rankIcon('flag', 30), 'flag')
})

test('mergeFeature: 순위에 따라 ★ 를 붙이고 뗀다', () => {
  const top = mergeFeature({ c: complex({ rank: 3 }), props: {}, layerId: 'L', projectId: 'P', now: 'N', newId: 'n' })
  assert.equal(top.properties.icon, 'star')
  const existing = mergeFeature({ c: complex({ rank: 3 }), props: {}, layerId: 'L', projectId: 'P', now: 'N', newId: 'n' })
  const dropped = mergeFeature({ existing, c: complex({ rank: 25 }), props: {}, layerId: 'L', projectId: 'P', now: 'N2', newId: 'x' })
  assert.equal('icon' in dropped.properties, false)
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

test('jibunOf: 부번이 숫자가 아니면 빈 지번', () => {
  assert.equal(jibunOf('484', '가'), '')
  assert.equal(jibunOf('484', '0'), '484')
  assert.equal(jibunOf('484', ''), '484')
})

test('regionPrefix: 시도를 떼고 공백으로 끝난다', () => {
  assert.equal(regionPrefix({ code: '1154500000', name: '서울 금천구' }), '금천구 ')
  assert.equal(regionPrefix({ code: '4111300000', name: '경기 수원시 권선구' }), '수원시 권선구 ')
})

test('retireRows: 수집한 지역에서 순위에 없는 단지를 순위 밖 레이어로 옮기고 ★ 만 뗀다', () => {
  const row = (id: string, region: string, icon?: string, layer = 'L'): FeatureRow => ({
    id: 'f' + id, project_id: 'P', layer_id: layer, parent_id: null,
    geometry: { type: 'Point', coordinates: [0, 0] }, title: id,
    properties: { kbComplexId: id, region, ...(icon ? { icon } : {}), memo: 'm' },
    blocks: [], derived_from: null, created_at: 'C', updated_at: 'U',
  })
  const drawn = { ...row('x', '금천구 독산동'), properties: { region: '금천구 독산동' } } // 사용자가 그린 도형 → 그대로
  const existing = [
    row('1', '금천구 독산동', 'star'),     // 수집 지역, 순위 밖, ★ → 옮기고 뗀다
    row('2', '금천구 시흥동', 'star'),     // 수집 지역, 순위 안 → 그대로
    row('3', '구로구 신도림동', 'star'),   // 수집 안 한 지역 → 그대로
    row('4', '금천구 가산동', 'home'),     // 사용자 아이콘 → 옮기되 아이콘 유지
    row('5', '화성시 동탄구 청계동', 'star'), // 화성시 수집, 순위 밖 → 옮기고 뗀다
    row('6', '금천구 독산동', undefined, 'OUT'), // 이미 순위 밖 → 그대로
    drawn,
  ]
  const out = retireRows(existing, new Set(['2']), [
    { code: '1154500000', name: '서울 금천구' }, { code: '4159000000', name: '경기 화성시' },
  ], 'OUT', 'NOW')
  assert.deepEqual(out.map((f) => f.id), ['f1', 'f4', 'f5'])
  assert.ok(out.every((f) => f.layer_id === 'OUT'))
  assert.equal('icon' in out[0].properties, false)
  assert.equal(out[1].properties.icon, 'home')
  assert.equal(out[0].properties.memo, 'm')
  assert.equal(out[0].updated_at, 'NOW')
  assert.equal(out[0].created_at, 'C')
})

test('bandOf: 10 위 단위 구간, 50 을 넘으면 실패', () => {
  assert.equal(bandOf(1), 0)
  assert.equal(bandOf(10), 0)
  assert.equal(bandOf(11), 1)
  assert.equal(bandOf(50), 4)
  assert.equal(BAND_LAYERS.length, 5)
  assert.throws(() => bandOf(51))
  assert.throws(() => bandOf(0))
})

test('topRows: 최신 기준월의 1~9 위만, 우리 속성·거래 블록만 복사하고 순위 핀을 단다', () => {
  const row = (id: string, rank: number, baseMonth: string, extra: Partial<FeatureRow> = {}): FeatureRow => ({
    id: 'f' + id, project_id: 'P', layer_id: 'L', parent_id: null,
    geometry: { type: 'Point', coordinates: [127, 37] }, title: 'T' + id,
    properties: { kbComplexId: id, rank, baseMonth, icon: 'star', memo: 'm' },
    blocks: [{ id: TRADES_BLOCK_ID, type: 'text', text: '거래' }, { id: 'b_user', type: 'text', text: '메모' }],
    derived_from: null, created_at: 'C', updated_at: 'U', ...extra,
  })
  const out = topRows([
    row('1', 1, '202609'),
    row('9', 9, '202609'),
    row('10', 10, '202609'),               // 10 위 → 뺀다
    row('old', 2, '202608'),               // 옛 기준월 (순위에서 빠진 단지) → 뺀다
    row('ring', 3, '202609', { parent_id: 'f1', derived_from: { op: 'ring', sourceIds: ['f1'], params: {} } }), // 링 → 뺀다
  ], 'LT', 'NOW')
  assert.deepEqual(out.map((f) => f.id), ['ftr_t9_1', 'ftr_t9_9'])
  assert.deepEqual(out[0].properties, { kbComplexId: '1', rank: 1, baseMonth: '202609', icon: 'n1' })
  assert.equal(out[1].properties.icon, 'n9')
  assert.deepEqual(out[0].blocks.map((b) => b.id), [TRADES_BLOCK_ID])
  assert.equal(out[0].layer_id, 'LT')
  assert.equal(out[0].title, 'T1')
  assert.equal(out[0].updated_at, 'NOW')
})

test('entryTradeLine: 평형별 최신 거래 중 가장 싼 것', () => {
  const g = summarizeTrades([
    t({ area: 59.9, price: 72000, ymd: '2026-08-02', floor: '12' }),
    t({ area: 59.9, price: 60000, ymd: '2026-01-02' }),            // 옛 거래 — 최신만 본다
    t({ area: 84.6, price: 95000 }),
  ], '2025-10-01')
  assert.equal(entryTradeLine(g), '60㎡ 7억 2,000 · 26.08.02 · 12층')
  assert.equal(entryTradeLine([]), undefined)
})

test('parsePrice: formatPrice 의 역', () => {
  for (const v of [3500, 9500, 10000, 72000, 171000, 790000]) assert.equal(parsePrice(formatPrice(v)), v)
  assert.ok(Number.isNaN(parsePrice('')))
  assert.ok(Number.isNaN(parsePrice('가격')))
})

test('parseTradesBlock: tradesBlock 을 되살린다', () => {
  const groups = summarizeTrades([t({ area: 59.9, price: 70000, floor: '3' }), t({ area: 84.6, price: 171000, floor: '-1' }), t({ area: 84.6, ymd: '2026-02-01' })], '2025-10-01')
  const back = parseTradesBlock(tradesBlock(groups)!.text!)
  assert.deepEqual(back.map((g) => [g.area, g.count, g.latest.price, g.latest.ymd, g.latest.floor]),
    groups.map((g) => [g.area, g.count, g.latest.price, g.latest.ymd, g.latest.floor]))
  assert.deepEqual(parseTradesBlock('매매 실거래 (최근 12개월)\n엉뚱한 줄'), [])
})

test('priceBandOf: 3 / 5 / 6.5 / 8 / 12억 경계는 위 구간', () => {
  assert.deepEqual([29999, 30000, 49999, 50000, 64999, 65000, 79999, 80000, 119999, 120000, 790000].map(priceBandOf), [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
  assert.equal(PRICE_LAYERS.length, 6)
  assert.equal(new Set(PRICE_LAYERS.map((l) => l.color)).size, 6)
})

test('priceRows: 원본에 진입가, 사본은 단지당 하나·구간 레이어·거래 블록만', () => {
  const block = tradesBlock(summarizeTrades([t({ area: 59.9, price: 72000 }), t({ area: 84.6, price: 95000 })], '2025-10-01'))!
  const f: FeatureRow = {
    id: 'ftr_a', project_id: 'p', layer_id: 'lyr_band', parent_id: null, geometry: { type: 'Point', coordinates: [127, 37] },
    title: '단지', properties: { kbComplexId: '1', memo: 'x' }, blocks: [block, { id: 'blk_user', type: 'gallery', refs: [] }],
    derived_from: null, created_at: 'c', updated_at: 'u',
  }
  const noTrade: FeatureRow = { ...f, id: 'ftr_b', blocks: [] }
  const drawn: FeatureRow = { ...f, id: 'ftr_c', properties: {} }
  const layerIds = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5']
  const { originals, copies } = priceRows([f, noTrade, drawn], layerIds, 'now')
  assert.equal(originals.length, 1)
  assert.equal(originals[0].properties.entryTrade, '60㎡ 7억 2,000 · 26.08.01 · 10층')
  assert.equal(originals[0].updated_at, 'now')
  assert.equal(copies[0].id, 'ftr_a__price')
  assert.equal(copies[0].layer_id, 'L3')                      // 7.2억 → 6.5~8억
  assert.equal(copies[0].properties.memo, 'x')
  assert.deepEqual(copies[0].blocks.map((b) => b.id), [TRADES_BLOCK_ID])
  // 이미 같은 진입가면 원본은 그대로 (updated_at 유지)
  const again = priceRows([originals[0]], layerIds, 'later')
  assert.equal(again.originals[0].updated_at, 'now')
})

