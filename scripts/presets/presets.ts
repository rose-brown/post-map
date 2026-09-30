/**
 * 필터 버튼 값 (스펙 docs/superpowers/specs/2026-09-30-filter-buttons-design.md 8절). 도메인 값은 여기에만 둔다 (불변 규칙 6).
 * 순수 — tests/presets.test.ts 가 직접 돌린다. 적용은 run.ts 의 syncPresets.
 */
import type { FilterPreset, PropertySchemaField } from '../../src/types.ts'

const le = (label: string, v: number): FilterPreset => ({ label, op: 'lte', value: String(v) })
const ge = (label: string, v: number): FilterPreset => ({ label, op: 'gte', value: String(v) })
const minutes = [le('20분', 20), le('30분', 30), le('45분', 45), le('1시간', 60)]

export const PRESETS: Record<string, FilterPreset[]> = {
  entryPrice: [le('3억 이하', 3), le('5억 이하', 5), le('6.5억 이하', 6.5), le('8억 이하', 8), le('12억 이하', 12), ge('12억~', 12)],
  households: [ge('300~', 300), ge('500~', 500), ge('1000~', 1000), ge('2000~', 2000), ge('3000~', 3000)],
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
