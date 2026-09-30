/**
 * 목록·지도 필터 (PRD F-71 의 일부 — 스펙 docs/superpowers/specs/2026-09-30-list-filter-design.md).
 * 순수 함수 — tests/filter.test.ts 가 직접 돌리므로 런타임 import 를 들이지 않는다 (`import type` 만).
 *
 * 조건 값은 입력칸 문자열 그대로 들고 있는다. 숫자로 바로 바꾸면 `1,` 같은 입력 중간 상태를 잃는다.
 * 해석이 안 되는 조건(빈 값·숫자 아님·사이의 반쪽)은 판정에서 뺀다 — 입력 도중 0건으로 깜빡이지 않게 (D4).
 * 불변 규칙 6 — 도메인 용어를 넣지 않는다. 필드 라벨은 레이어 스키마에서 온다.
 */
import type { Feature, Layer, PropertySchemaField, PropertyType } from './types'

export type FilterOp = 'gte' | 'lte' | 'between' | 'contains'

export interface FilterCond {
  id: string
  key: string
  op: FilterOp
  /** 입력칸 문자열. between 은 [최소, 최대] */
  value: string | [string, string]
}

export function opsFor(type: PropertyType): FilterOp[] {
  if (type === 'number') return ['gte', 'lte', 'between']
  if (type === 'text') return ['contains']
  return []
}

/** 쉼표·공백을 지운 뒤 숫자로. 해석이 안 되면 undefined. */
function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  const s = v.replace(/[,\s]/g, '')
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/** number·text 스키마 필드를 key 로 합친다. 같은 key 면 먼저 나온 레이어의 정의 (D2). */
export function filterFields(layers: Layer[], opts: { visibleOnly: boolean }): PropertySchemaField[] {
  const byKey = new Map<string, PropertySchemaField>()
  for (const l of layers) {
    if (opts.visibleOnly && !l.visible) continue
    for (const f of l.schema) {
      if (opsFor(f.type).length && !byKey.has(f.key)) byKey.set(f.key, f)
    }
  }
  return [...byKey.values()]
}

function parsable(c: FilterCond): boolean {
  if (c.op === 'between') {
    return Array.isArray(c.value) && toNumber(c.value[0]) !== undefined && toNumber(c.value[1]) !== undefined
  }
  if (typeof c.value !== 'string') return false
  return c.op === 'contains' ? c.value.trim() !== '' : toNumber(c.value) !== undefined
}

/** 판정에 쓸 조건만: 필드가 fields 에 있고(D5), 연산자가 필드 타입에 맞고, 값이 해석되는 것(D4). */
export function activeConds(conds: FilterCond[], fields: PropertySchemaField[]): FilterCond[] {
  const typeOf = new Map(fields.map((f) => [f.key, f.type]))
  return conds.filter((c) => {
    const type = typeOf.get(c.key)
    return type !== undefined && opsFor(type).includes(c.op) && parsable(c)
  })
}

/** 보이는 레이어 기준의 활성 조건. 목록과 지도가 같은 것을 쓴다. */
export function activeFilter(conds: FilterCond[], layers: Layer[]): FilterCond[] {
  return activeConds(conds, filterFields(layers, { visibleOnly: true }))
}

function matchOne(feature: Feature, c: FilterCond): boolean {
  const raw = feature.properties[c.key]
  if (raw === undefined) return false
  if (c.op === 'contains') {
    const hay = (Array.isArray(raw) ? raw.join(', ') : String(raw)).toLowerCase()
    return hay.includes(String(c.value).trim().toLowerCase())
  }
  const n = toNumber(raw)
  if (n === undefined) return false
  if (c.op === 'between') {
    const [a, b] = (c.value as [string, string]).map((v) => toNumber(v)!)
    return n >= Math.min(a, b) && n <= Math.max(a, b)
  }
  const t = toNumber(c.value)!
  return c.op === 'gte' ? n >= t : n <= t
}

/** 모든 조건 AND. conds 는 activeConds 를 거친 것이어야 한다. 키가 없으면 false (D3). */
export function matches(feature: Feature, conds: FilterCond[]): boolean {
  return conds.every((c) => matchOne(feature, c))
}
