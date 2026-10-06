/**
 * 필터 버튼 값 (스펙 docs/superpowers/specs/2026-09-30-filter-buttons-design.md 8절). 도메인 값은 여기에만 둔다 (불변 규칙 6).
 * 순수 — tests/presets.test.ts 가 직접 돌린다. 적용은 run.ts 의 syncPresets.
 */
import type { FilterPreset, PropertySchemaField } from '../../src/types.ts'

const le = (label: string, v: number): FilterPreset => ({ label, op: 'lte', value: String(v) })
const ge = (label: string, v: number): FilterPreset => ({ label, op: 'gte', value: String(v) })
/** 구간 [lo, hi) — between 은 양끝 포함이라 상한을 데이터 정밀도 한 칸 아래로 둔다 (진입가 억 둘째 자리, 세대 정수). */
const range = (label: string, lo: number, hiIncl: number): FilterPreset => ({ label, op: 'between', value: [String(lo), String(hiIncl)] })
const ENTRY_PRICE = [le('~3억', 2.99), range('3~5억', 3, 4.99), range('5~6.5억', 5, 6.49), range('6.5~8억', 6.5, 7.99), range('8~12억', 8, 11.99), ge('12억~', 12)]
const minutes = [le('20분', 20), le('30분', 30), le('45분', 45), le('1시간', 60)]

export const PRESETS: Record<string, FilterPreset[]> = {
  // 진입가 구간 레이어(lead50 D13)와 같은 경계. 사용자 요청 2026-09-30: 누적(이하) 대신 구간.
  entryPrice: ENTRY_PRICE,
  // 면적 구간 진입가(lead50 AREA_BANDS)도 같은 금액 구간 — 기존 진입가와 나란히 비교한다 (사용자 결정 2026-10-04).
  entryPriceUnder40: ENTRY_PRICE,
  entryPrice40: ENTRY_PRICE,
  entryPrice59: ENTRY_PRICE,
  entryPrice84: ENTRY_PRICE,
  households: [le('~300', 299), range('300~500', 300, 499), range('500~1000', 500, 999), range('1000~2000', 1000, 1999), range('2000~3000', 2000, 2999), ge('3000~', 3000)],
  ageYears: [le('~5년', 5), le('~10년', 10), le('~15년', 15), le('~20년', 20), ge('20년~', 20), ge('30년~', 30)],
  // 분포 2026-09-30: 중앙 2,357 · 상위25% 4,037 · 상위10% 6,010 (만원)
  pricePerPyeong: [le('~1천', 1000), le('~2천', 2000), le('~3천', 3000), le('~4천', 4000), le('~6천', 6000), ge('6천~', 6000)],
  stationDistance: [le('300m', 300), le('500m', 500), le('800m', 800), le('1km', 1000)],
  minSeolleung: minutes,
  minYeouido: minutes,
  minCityHall: minutes,
}

/** 표에 있는 number 필드에만 presets 를 덮어쓴다. label·unit 등 사용자가 고친 것은 그대로 (E5). */
export function withPresets(schema: PropertySchemaField[]): PropertySchemaField[] {
  return schema.map((f) => (f.type === 'number' && PRESETS[f.key] ? { ...f, presets: PRESETS[f.key] } : f))
}

/** 키 순서를 무시한 비교. jsonb 는 객체 키를 다시 정렬해 돌려줘서 JSON.stringify 비교가 늘 "바뀜" 이었다 (최종 검토 2026-09-30). */
export function schemaChanged(a: PropertySchemaField[], b: PropertySchemaField[]): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, canon(x)]))
      : v
  return JSON.stringify(canon(a)) !== JSON.stringify(canon(b))
}
