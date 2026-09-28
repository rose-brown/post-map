/**
 * 월간선도50 수집 스크립트의 순수 함수. I/O 없음 — tests/lead50.test.ts 가 직접 돌린다.
 * src/ 에서는 import type 만 한다 (Node 타입 제거 실행).
 * 스펙: docs/superpowers/specs/2026-09-27-lead50-layer-design.md
 */
import type { FeatureRow } from '../../src/db/mappers.ts'
import type { Block, Properties, PropertySchemaField } from '../../src/types.ts'

export const LAYER_NAME = '월간선도50'
export const TRADES_BLOCK_ID = 'blk_lead50_trades'

/** 지역 순위가 이 값 이하인 단지에 ★ 를 붙인다 (사용자 결정 2026-09-27). */
export const STAR_RANK = 10
const STAR_ICON = 'star'

/** 스펙 4.2. 순서 = 정보 카드 표시 순서 (D9: 실거래가 맨 위). */
export const SCHEMA: PropertySchemaField[] = [
  { key: 'recentTrade', label: '최근 매매', type: 'text' },
  { key: 'rank', label: '순위', type: 'number' },
  { key: 'households', label: '총세대수', type: 'number', unit: '세대' },
  { key: 'generalHouseholds', label: '일반세대수', type: 'number', unit: '세대' },
  { key: 'completion', label: '준공', type: 'text' },
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

export function recentTradeLine(groups: AreaGroup[]): string | undefined {
  const top = [...groups].sort((a, b) => b.count - a.count || a.area - b.area)[0]
  if (!top) return undefined
  const l = top.latest
  return `${top.area}㎡ ${formatPrice(l.price)} · ${shortDate(l.ymd)} · ${l.floor}층`
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
    rank: item.rank,
    households: detail.households,
    generalHouseholds: item.generalHouseholds,
    completion: item.completion,
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
 * 이번 실행에서 수집한 지역(`regions`)에 속하는데 이번 순위에 없는(`seenIds` 밖) 기존 도형 중
 * 아이콘이 ★ 인 것 — ★ 만 뗀 행을 돌려준다. 다른 속성·블록·시각은 그대로 (updated_at 만 now).
 */
export function dropStars(existing: FeatureRow[], seenIds: Set<string>, regions: Region[], now: string): FeatureRow[] {
  const prefixes = regions.map(regionPrefix)
  return existing
    .filter((f) => f.properties.icon === STAR_ICON)
    .filter((f) => !seenIds.has(String(f.properties.kbComplexId ?? '')))
    .filter((f) => prefixes.some((p) => String(f.properties.region ?? '').startsWith(p)))
    .map((f) => {
      const properties = { ...f.properties }
      delete properties.icon
      return { ...f, properties, updated_at: now }
    })
}
