/**
 * 월간선도50 수집 스크립트의 순수 함수. I/O 없음 — tests/lead50.test.ts 가 직접 돌린다.
 * src/ 에서는 import type 만 한다 (Node 타입 제거 실행).
 * 스펙: docs/superpowers/specs/2026-09-27-lead50-layer-design.md
 */
import type { FeatureRow } from '../../src/db/mappers.ts'
import type { Block, Properties, PropertySchemaField } from '../../src/types.ts'

export interface LayerDef { name: string; color: string; visible: boolean; sizeField?: string }

/** 포인트 크기 기준 (앱의 레이어 style.sizeField). 총세대수에 면적이 비례한다 (사용자 요청 2026-09-29). */
export const SIZE_FIELD = 'households'

/**
 * 순위 구간 레이어. 원본 한 레이어를 나눈 것이지 사본이 아니다 — 단지마다 도형은 하나이고,
 * 순위가 바뀌면 같은 도형이 다른 구간으로 옮겨 가서 메모·블록이 따라간다 (사용자 결정 2026-09-29, D5 대체).
 * visible 은 레이어를 처음 만들 때만 쓴다. 이후 켜고 끈 상태는 덮지 않는다.
 */
export const BAND_SIZE = 10
export const BAND_LAYERS: LayerDef[] = [
  { name: '월간선도50 TOP1~10 (시세총액)', color: '#b91c1c', visible: true, sizeField: SIZE_FIELD },
  { name: '월간선도50 TOP11~20 (시세총액)', color: '#c2410c', visible: false, sizeField: SIZE_FIELD },
  { name: '월간선도50 TOP21~30 (시세총액)', color: '#b45309', visible: false, sizeField: SIZE_FIELD },
  { name: '월간선도50 TOP31~40 (시세총액)', color: '#4d7c0f', visible: false, sizeField: SIZE_FIELD },
  { name: '월간선도50 TOP41~50 (시세총액)', color: '#0369a1', visible: false, sizeField: SIZE_FIELD },
]
/** 이번 순위에서 빠진 단지 (D6 — 지우지 않는다). */
export const OUT_LAYER: LayerDef = { name: '월간선도50 순위 밖 (시세총액)', color: '#6b7280', visible: false, sizeField: SIZE_FIELD }

/** 순위 → BAND_LAYERS 의 칸. KB 는 지역당 최대 50 이라 넘으면 응답이 바뀐 것이다. */
export function bandOf(rank: number): number {
  const i = Math.ceil(rank / BAND_SIZE) - 1
  if (!Number.isInteger(rank) || i < 0 || i >= BAND_LAYERS.length) throw new Error(`구간 밖 순위: ${rank}`)
  return i
}

/** 순위 1~TOP_RANK 사본 레이어. 스크립트가 통째로 소유한다 (계획 2026-09-29 T2). */
export const TOP_LAYER_NAME = '월간선도50 TOP9 (시세총액)'
export const TOP_RANK = 9
export const TRADES_BLOCK_ID = 'blk_lead50_trades'

/** 지역 순위가 이 값 이하인 단지에 ★ 를 붙인다 (사용자 결정 2026-09-27). */
export const STAR_RANK = 10
const STAR_ICON = 'star'

/**
 * 면적 구간별 진입가 — 그 구간 평형의 최신 거래 중 최저 (사용자 결정 2026-10-04: "40㎡ 이상 집을 얼마부터 사나").
 * 경계는 정수 ㎡(summarizeTrades 가 반올림) [lo, hi). 거래가 몰린 59·60㎡, 84·85㎡ 가 구간 시작이 되게 잘랐다.
 */
export const AREA_BANDS = [
  { key: 'entryPriceUnder40', label: '진입가 ~40㎡', lo: 0, hi: 40 },
  { key: 'entryPrice40', label: '진입가 40~59㎡', lo: 40, hi: 59 },
  { key: 'entryPrice59', label: '진입가 59~84㎡', lo: 59, hi: 84 },
  { key: 'entryPrice84', label: '진입가 84㎡~', lo: 84, hi: Infinity },
] as const

/** 구간에 평형이 없으면 키가 없다. */
export function areaEntryPrices(groups: AreaGroup[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const b of AREA_BANDS) {
    const v = entryPriceOf(entryGroup(groups.filter((g) => g.area >= b.lo && g.area < b.hi)))
    if (v !== undefined) out[b.key] = v
  }
  return out
}

/** 스펙 4.2. 순서 = 정보 카드 표시 순서 (D9: 실거래가 맨 위). */
export const SCHEMA: PropertySchemaField[] = [
  { key: 'recentTrade', label: '최근 매매', type: 'text' },
  { key: 'entryTrade', label: '진입가', type: 'text' },
  { key: 'entryPrice', label: '진입가 금액', type: 'number', unit: '억' },
  ...AREA_BANDS.map((b): PropertySchemaField => ({ key: b.key, label: b.label, type: 'number', unit: '억' })),
  { key: 'rank', label: '순위', type: 'number' },
  { key: 'households', label: '총세대수', type: 'number', unit: '세대' },
  { key: 'generalHouseholds', label: '일반세대수', type: 'number', unit: '세대' },
  { key: 'completion', label: '준공', type: 'text' },
  { key: 'ageYears', label: '입주년차', type: 'number', unit: '년차' },
  { key: 'pricePerPyeong', label: '평당시세', type: 'number', unit: '만원' },
  { key: 'marketCap', label: '시세총액', type: 'text' },
  { key: 'exclusiveArea', label: '전용면적', type: 'text' },
  { key: 'region', label: '지역', type: 'text' },
  { key: 'baseMonth', label: '기준년월', type: 'text' },
  { key: 'kbComplexId', label: 'KB단지ID', type: 'text' },
]
const SCHEMA_KEYS = new Set(SCHEMA.map((f) => f.key))

/**
 * KB 지역 순위가 500 을 내는 신설 구 → 대신 받을 상위 시 (스펙 D4, 2026-09-27 실측).
 * KB 가 고치면 이 항목을 지운다.
 */
const KB_BROKEN_CHILDREN: Record<string, string[]> = {
  '4159000000': ['4159100000', '4159300000', '4159500000', '4159700000'],
}

/** 국토부 LAWD_CD 가 법정동코드 앞 5자리와 다른 지역. 화성시는 2026 신설 구 코드로만 거래가 나온다 (스펙 3.1, 41590 은 0건). */
export const SGG_CODES_OVERRIDE: Record<string, string[]> = {
  '4159000000': ['41591', '41593', '41595', '41597'],
}

export interface Region { code: string; name: string }
export interface KbAreaRow { 법정동코드: string; 시군구명: string; 하위시군구존재여부: string }
export interface KbRankItem {
  rank: number
  kbComplexId: string
  aptName: string
  generalHouseholds?: number
  completion?: string
  pricePerPyeong?: number
  marketCap?: string
  baseMonth: string
}
export interface KbComplex {
  lat: number
  lng: number
  households?: number
  sigungu: string
  dong: string
  /** 부번 0 이면 본번만 ("484"), 아니면 "본번-부번" ("1053-3"). 국토부 jibun 과 같은 표기. */
  jibun: string
  minArea?: string
  maxArea?: string
}
/** price 는 만원. ymd 는 YYYY-MM-DD. */
export interface Trade { dong: string; jibun: string; aptName: string; area: number; price: number; ymd: string; floor: string; cancelled: boolean }
export interface Complex { region: Region; item: KbRankItem; detail: KbComplex }
export interface AreaGroup { area: number; count: number; latest: Trade }

/** 시도 한 번 조회한 평면 목록에서 말단만 고른다. 시 코드로 다시 내려가면 시도 전체가 또 온다 (스펙 3.1). */
export function leafRegions(sido: string, rows: KbAreaRow[]): Region[] {
  const broken = new Set(Object.values(KB_BROKEN_CHILDREN).flat())
  const out: Region[] = []
  for (const r of rows) {
    if (r.하위시군구존재여부 === '0' && !broken.has(r.법정동코드)) out.push({ code: r.법정동코드, name: `${sido} ${r.시군구명}` })
    if (r.법정동코드 in KB_BROKEN_CHILDREN) out.push({ code: r.법정동코드, name: `${sido} ${r.시군구명}` })
  }
  return out
}

export function sggCodesFor(region: Region): string[] {
  return SGG_CODES_OVERRIDE[region.code] ?? [region.code.slice(0, 5)]
}

/** ★ 는 스크립트가 관리하되, 사용자가 고른 다른 아이콘은 건드리지 않는다. undefined = 키 없음. */
export function rankIcon(current: unknown, rank: number): string | undefined {
  const mine = current === undefined || current === 'dot' || current === STAR_ICON
  if (rank <= STAR_RANK) return mine ? STAR_ICON : String(current)
  if (current === STAR_ICON) return undefined
  return current === undefined ? undefined : String(current)
}

/** KB 본번·부번 → 국토부 jibun 표기. 본번이 없으면 '' (매칭되지 않는다). 부번이 있는데 숫자가 아니면 '' (이웃 필지 오매칭 방지). */
export function jibunOf(bon: string | undefined, bu: string | undefined): string {
  const b = Number(bon)
  if (!bon || !Number.isFinite(b) || b <= 0) return ''
  if (bu === undefined || bu === '') return String(b)
  const s = Number(bu)
  if (!Number.isFinite(s)) return ''
  return s > 0 ? `${b}-${s}` : String(b)
}

/**
 * 국토부 umdNm 표기의 법정동명. 동 지역은 "석수동", 읍·면 지역은 "가평읍 대곡리" (리까지).
 * KB 구주소("경기도 가평군 가평읍 대곡리 695")에서 읍면동명 토큰부터 지번 앞까지를 잇는다.
 * 구주소가 없거나 읍면동명을 못 찾으면 fallback.
 */
export function dongOf(oldAddress: string | undefined, eupmyeondong: string | undefined, fallback: string): string {
  if (!oldAddress || !eupmyeondong) return fallback
  const tokens = oldAddress.trim().split(/\s+/)
  const i = tokens.indexOf(eupmyeondong)
  if (i < 0) return fallback
  const rest = tokens.slice(i, -1)   // 마지막 토큰 = 지번
  return rest.length ? rest.join(' ') : fallback
}

/** 같은 법정동 + 같은 지번의 거래. 이름은 보지 않는다 (스펙 D12 — 이름 매칭은 오매칭을 냈다). */
export function matchTrades(c: Complex, trades: Trade[]): Trade[] {
  if (!c.detail.jibun) return []
  return trades.filter((x) => x.dong === c.detail.dong && x.jibun === c.detail.jibun)
}

/** 해제 거래와 since 이전을 빼고 정수 ㎡ 로 묶어 평형별 최신 1건. 면적 오름차순. */
export function summarizeTrades(trades: Trade[], since: string): AreaGroup[] {
  const groups = new Map<number, AreaGroup>()
  for (const x of trades) {
    if (x.cancelled || x.ymd < since) continue
    const area = Math.round(x.area)
    const g = groups.get(area)
    if (!g) groups.set(area, { area, count: 1, latest: x })
    else {
      g.count++
      if (x.ymd > g.latest.ymd) g.latest = x
    }
  }
  return [...groups.values()].sort((a, b) => a.area - b.area)
}

export function formatPrice(manwon: number): string {
  if (manwon < 10000) return `${manwon.toLocaleString('ko-KR')}만`
  const eok = Math.floor(manwon / 10000)
  const rest = manwon % 10000
  return rest ? `${eok}억 ${rest.toLocaleString('ko-KR')}` : `${eok}억`
}

const shortDate = (ymd: string) => ymd.slice(2).replaceAll('-', '.')

const tradeLine = (g: AreaGroup) => `${g.area}㎡ ${formatPrice(g.latest.price)} · ${shortDate(g.latest.ymd)} · ${g.latest.floor}층`

export function recentTradeLine(groups: AreaGroup[]): string | undefined {
  const top = [...groups].sort((a, b) => b.count - a.count || a.area - b.area)[0]
  return top && tradeLine(top)
}

/** 진입가 = 평형별 최신 거래 중 가장 싼 것 (사용자 결정 2026-09-29). 같으면 작은 평형. */
export function entryGroup(groups: AreaGroup[]): AreaGroup | undefined {
  return [...groups].sort((a, b) => a.latest.price - b.latest.price || a.area - b.area)[0]
}

export function entryTradeLine(groups: AreaGroup[]): string | undefined {
  const g = entryGroup(groups)
  return g && tradeLine(g)
}

/**
 * 진입가를 억 단위 숫자로 — 필터 버튼용 (스펙 filter-buttons E7). 소수 둘째 자리 **내림**: 6억 4,999만 → 6.49.
 * 반올림이면 11억 9,950만이 12 가 돼 진입가 구간 레이어([하한, 상한))와 다른 구간 버튼에 걸렸다.
 */
export function entryPriceOf(g: AreaGroup | undefined): number | undefined {
  return g && Math.floor(g.latest.price / 100) / 100
}

/** KB 준공 문자열 "03년 08월 (24년차)" 의 년차 (E8). 형식이 아니면 undefined. */
export function ageYearsOf(completion: unknown): number | undefined {
  const m = typeof completion === 'string' ? /\((\d+)년차\)/.exec(completion) : null
  return m ? Number(m[1]) : undefined
}

/** formatPrice 의 역. "17억 1,000" · "17억" · "9,500만" → 만원. 형식이 아니면 NaN. */
export function parsePrice(s: string): number {
  const m = /^(?:(\d+)억)?\s*(?:([\d,]+)만?)?$/.exec(s.trim())
  if (!m || (!m[1] && !m[2])) return NaN
  return Number(m[1] ?? 0) * 10000 + Number((m[2] ?? '0').replaceAll(',', ''))
}

/**
 * tradesBlock 의 역 — 서버에 이미 있는 거래 블록에서 평형별 최신 거래를 되살린다 (국토부를 다시 부르지 않고 진입가를 채우기 위해).
 * 동·지번·단지명은 블록에 없어서 빈 값이다. 형식이 맞지 않는 줄은 버린다.
 */
export function parseTradesBlock(text: string): AreaGroup[] {
  const out: AreaGroup[] = []
  for (const line of text.split('\n').slice(1)) {
    const m = /^(\d+)㎡ {2}(.+?) {2}(\d{2})\.(\d{2})\.(\d{2}) {2}(\S+)층 {2}\((\d+)건\)$/.exec(line)
    if (!m) continue
    const price = parsePrice(m[2])
    if (!Number.isFinite(price)) continue
    out.push({
      area: Number(m[1]), count: Number(m[7]),
      latest: { dong: '', jibun: '', aptName: '', area: Number(m[1]), price, ymd: `20${m[3]}-${m[4]}-${m[5]}`, floor: m[6], cancelled: false },
    })
  }
  return out
}

export function tradesBlock(groups: AreaGroup[]): Block | undefined {
  if (!groups.length) return undefined
  const lines = groups.map((g) => `${g.area}㎡  ${formatPrice(g.latest.price)}  ${shortDate(g.latest.ymd)}  ${g.latest.floor}층  (${g.count}건)`)
  return { id: TRADES_BLOCK_ID, type: 'text', text: ['매매 실거래 (최근 12개월)', ...lines].join('\n') }
}

export function buildProperties(c: Complex, groups: AreaGroup[]): Properties {
  const { item, detail } = c
  const p: Record<string, string | number | undefined> = {
    recentTrade: recentTradeLine(groups),
    entryTrade: entryTradeLine(groups),
    entryPrice: entryPriceOf(entryGroup(groups)),
    ...areaEntryPrices(groups),
    rank: item.rank,
    households: detail.households,
    generalHouseholds: item.generalHouseholds,
    completion: item.completion,
    ageYears: ageYearsOf(item.completion),
    pricePerPyeong: item.pricePerPyeong,
    marketCap: item.marketCap,
    exclusiveArea: detail.minArea && detail.maxArea ? `${detail.minArea}~${detail.maxArea}㎡` : undefined,
    region: `${detail.sigungu} ${detail.dong}`,
    baseMonth: item.baseMonth,
    kbComplexId: item.kbComplexId,
  }
  const out: Properties = {}
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) continue
    out[k] = v
  }
  return out
}

/**
 * D7: 우리 필드를 스펙 순서로 앞에 — 우리 키의 필드는 기존 필드 객체를 통째로 유지 (사용자가 고친 라벨·단위 등),
 * 사용자 필드는 뒤에 그대로. 그 결과 SCHEMA 의 단위·타입을 바꿔도 기존 레이어에는 반영되지 않는다.
 */
export function mergeSchema(existing: PropertySchemaField[]): PropertySchemaField[] {
  return [
    ...SCHEMA.map((f) => existing.find((e) => e.key === f.key) ?? f),
    ...existing.filter((e) => !SCHEMA_KEYS.has(e.key)),
  ]
}

/** D6·D7: 우리 키와 거래 블록만 교체하고 사용자 속성·블록·id·생성시각은 보존. */
export function mergeFeature(a: {
  existing?: FeatureRow
  c: Complex
  props: Properties
  block?: Block
  layerId: string
  projectId: string
  now: string
  newId: string
}): FeatureRow {
  const { existing, c } = a
  const kept: Properties = {}
  for (const [k, v] of Object.entries(existing?.properties ?? {})) if (!SCHEMA_KEYS.has(k)) kept[k] = v
  const userBlocks = (existing?.blocks ?? []).filter((b) => b.id !== TRADES_BLOCK_ID)
  const properties: Properties = { ...kept, ...a.props }
  const icon = rankIcon(kept.icon, c.item.rank)
  if (icon === undefined) delete properties.icon
  else properties.icon = icon
  return {
    id: existing?.id ?? a.newId,
    project_id: a.projectId,
    layer_id: a.layerId,
    parent_id: existing?.parent_id ?? null,
    geometry: { type: 'Point', coordinates: [Number(c.detail.lng.toFixed(7)), Number(c.detail.lat.toFixed(7))] },
    title: c.item.aptName,
    properties,
    blocks: a.block ? [a.block, ...userBlocks] : userBlocks,
    derived_from: existing?.derived_from ?? null,
    created_at: existing?.created_at ?? a.now,
    updated_at: a.now,
  }
}

export function duplicateIds(complexes: Complex[]): string[] {
  const seen = new Map<string, number>()
  for (const c of complexes) seen.set(c.item.kbComplexId, (seen.get(c.item.kbComplexId) ?? 0) + 1)
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id)
}

/**
 * "서울 금천구" → "금천구 ". 도형 region 속성("금천구 독산동", "화성시 동탄구 청계동")의 접두사.
 * 시도를 떼므로 서울·경기 안에서만 유일하다 — 범위를 넓히면(다른 시도의 "중구" 등) region 에 시도를 넣어야 한다.
 */
export function regionPrefix(region: Region): string {
  return region.name.split(' ').slice(1).join(' ') + ' '
}

/**
 * 이번 실행에서 수집한 지역(`regions`)에 속하는데 이번 순위에 없는(`seenIds` 밖) 기존 단지 —
 * 순위 밖 레이어로 옮기고 ★ 를 뗀 행을 돌려준다. 이미 옮겨졌고 ★ 도 없으면 건드리지 않는다.
 * 다른 속성·블록·시각은 그대로 (updated_at 만 now). 사용자가 그린 도형(kbComplexId 없음)은 대상이 아니다.
 */
export function retireRows(existing: FeatureRow[], seenIds: Set<string>, regions: Region[], outLayerId: string, now: string): FeatureRow[] {
  const prefixes = regions.map(regionPrefix)
  return existing
    .filter((f) => f.properties.kbComplexId !== undefined && !seenIds.has(String(f.properties.kbComplexId)))
    .filter((f) => prefixes.some((p) => String(f.properties.region ?? '').startsWith(p)))
    .filter((f) => f.layer_id !== outLayerId || f.properties.icon === STAR_ICON)
    .map((f) => {
      const properties = { ...f.properties }
      if (properties.icon === STAR_ICON) delete properties.icon
      return { ...f, layer_id: outLayerId, properties, updated_at: now }
    })
}

/**
 * 원본 레이어 행 → TOP 레이어 사본 (계획 2026-09-29 T3·T4).
 * 대상은 rank ≤ TOP_RANK 이고 baseMonth 가 원본의 최신 값인 도형 — D6 으로 남은 옛 순위를 뺀다.
 * 좌표·제목·우리 속성·거래 블록만 복사하고 핀에 순위 번호(markers.ts 의 n1~n9)를 단다.
 */
export function topRows(source: FeatureRow[], layerId: string, now: string): FeatureRow[] {
  const points = source.filter((f) => !f.derived_from && !f.parent_id && f.properties.kbComplexId)
  const latest = points.reduce((m, f) => (String(f.properties.baseMonth ?? '') > m ? String(f.properties.baseMonth) : m), '')
  return points
    .filter((f) => String(f.properties.baseMonth ?? '') === latest)
    .filter((f) => Number.isInteger(f.properties.rank) && Number(f.properties.rank) >= 1 && Number(f.properties.rank) <= TOP_RANK)
    .map((f) => {
      const properties: Properties = {}
      for (const [k, v] of Object.entries(f.properties)) if (SCHEMA_KEYS.has(k)) properties[k] = v
      properties.icon = `n${f.properties.rank}`
      return {
        id: `ftr_t9_${f.properties.kbComplexId}`,
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
    })
}

/* ---------- 진입가 구간 레이어 (사용자 결정 2026-09-29) ---------- */

/**
 * 진입가(만원) 경계. 3 / 5 / 6.5 / 8 / 12억 — 소형이 몰리는 8억 아래를 촘촘하게, 8억을 경계로.
 * 색은 농도가 아니라 색상으로 구분한다 (사용자: 진하기 차이는 눈에 안 띈다). 8억 미만 넷은 원색, 그 위는 보라·회색.
 */
export const PRICE_CUTS = [30000, 50000, 65000, 80000, 120000]
export const PRICE_LAYERS: LayerDef[] = [
  { name: '진입가 3억 미만 (월간선도50)', color: '#2563eb', visible: false, sizeField: SIZE_FIELD },
  { name: '진입가 3~5억 (월간선도50)', color: '#16a34a', visible: false, sizeField: SIZE_FIELD },
  { name: '진입가 5~6.5억 (월간선도50)', color: '#f59e0b', visible: false, sizeField: SIZE_FIELD },
  { name: '진입가 6.5~8억 (월간선도50)', color: '#dc2626', visible: false, sizeField: SIZE_FIELD },
  { name: '진입가 8~12억 (월간선도50)', color: '#7c3aed', visible: false, sizeField: SIZE_FIELD },
  { name: '진입가 12억 이상 (월간선도50)', color: '#4b5563', visible: false, sizeField: SIZE_FIELD },
]

export const priceBandOf = (manwon: number): number => PRICE_CUTS.filter((c) => manwon >= c).length

/** priceRows 가 쓰는 원본 키 — 이것만 비교해 바뀌었는지 본다. */
const OWN_PRICE_KEYS = ['entryTrade', 'entryPrice', 'ageYears', ...AREA_BANDS.map((b) => b.key)]

function setOrDelete(p: Properties, key: string, v: number | undefined): void {
  if (v === undefined) delete p[key]
  else p[key] = v
}

/**
 * 원본 단지 → (진입가·진입가 금액·입주년차를 채운 원본, 가격 구간 사본). 거래 블록이 없는 단지는 둘 다 없다.
 * 사본 id 는 단지당 하나라 구간이 바뀌면 같은 도형이 레이어를 옮긴다. 속성은 전부, 블록은 거래 블록만 복사한다
 * (이미지 블록을 두 도형이 공유하지 않게 — TOP9 와 같은 이유).
 */
export function priceRows(source: FeatureRow[], layerIds: string[], now: string): { originals: FeatureRow[]; copies: FeatureRow[] } {
  const originals: FeatureRow[] = []
  const copies: FeatureRow[] = []
  for (const f of source) {
    if (f.derived_from || f.parent_id || !f.properties.kbComplexId) continue
    const block = f.blocks.find((b) => b.id === TRADES_BLOCK_ID)
    const groups = parseTradesBlock(block?.text ?? '')
    const g = entryGroup(groups)
    const properties: Properties = { ...f.properties }
    setOrDelete(properties, 'ageYears', ageYearsOf(f.properties.completion))
    if (g) {
      properties.entryTrade = tradeLine(g)
      setOrDelete(properties, 'entryPrice', entryPriceOf(g))
      const byArea = areaEntryPrices(groups)
      for (const b of AREA_BANDS) setOrDelete(properties, b.key, byArea[b.key])
    }
    const same = OWN_PRICE_KEYS.every((k) => properties[k] === f.properties[k])
    const original = same ? f : { ...f, properties, updated_at: now }
    // 거래 없는 단지는 입주년차가 바뀐 경우에만 원본을 쓰고, 사본은 없다.
    if (!g) {
      if (!same) originals.push(original)
      continue
    }
    originals.push(original)
    copies.push({
      ...original,
      id: `${f.id}__price`,
      layer_id: layerIds[priceBandOf(g.latest.price)],
      parent_id: null,
      blocks: block ? [block] : [],
      derived_from: null,
      updated_at: now,
    })
  }
  return { originals, copies }
}
