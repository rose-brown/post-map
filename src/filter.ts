/**
 * 목록·지도 필터 (PRD F-71 의 일부 — 스펙 docs/superpowers/specs/2026-09-30-list-filter-design.md).
 * 순수 함수 — tests/filter.test.ts 가 직접 돌리므로 런타임 import 를 들이지 않는다 (`import type` 만).
 *
 * 조건 값은 입력칸 문자열 그대로 들고 있는다. 숫자로 바로 바꾸면 `1,` 같은 입력 중간 상태를 잃는다.
 * 해석이 안 되는 조건(빈 값·숫자 아님·사이의 반쪽)은 판정에서 뺀다 — 입력 도중 0건으로 깜빡이지 않게 (D4).
 * 불변 규칙 6 — 도메인 용어를 넣지 않는다. 필드 라벨은 레이어 스키마에서 온다.
 */
import type { Feature, FilterOp, FilterPreset, Layer, PropertySchemaField, PropertyType } from './types'

export type { FilterOp }

export interface FilterCond {
  id: string
  key: string
  op: FilterOp
  /** 입력칸 문자열. between 은 [최소, 최대] */
  value: string | [string, string]
  /** 버튼으로 만든 조건. 같은 key 의 버튼 조건끼리는 OR (여러 구간을 함께 켠다, 2026-09-30 사용자 요청) */
  preset?: true
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

/** 표시용 필드 정의: 보이는 레이어 정의가 먼저, 없으면 전체 레이어 정의 (D6). 판정과 같은 타입을 보여야 한다. */
export function fieldFor(
  key: string,
  visibleFields: PropertySchemaField[],
  allFields: PropertySchemaField[],
): PropertySchemaField | undefined {
  return visibleFields.find((f) => f.key === key) ?? allFields.find((f) => f.key === key)
}

/**
 * 조건이 판정에서 빠지는 이유 중 사용자에게 보여야 하는 것. 빈 값(입력 중)은 문제로 치지 않는다.
 * out-of-scope — 필드가 보이는 레이어에 없다 (D5). op-mismatch — 스키마에서 필드 타입이 바뀌어 연산자가 안 맞는다.
 */
export function condProblem(
  cond: FilterCond,
  visibleFields: PropertySchemaField[],
): 'out-of-scope' | 'op-mismatch' | null {
  const field = visibleFields.find((f) => f.key === cond.key)
  if (!field) return 'out-of-scope'
  return opsFor(field.type).includes(cond.op) ? null : 'op-mismatch'
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

/**
 * 직접 입력 조건은 모두 AND, 버튼 조건은 key 마다 OR 로 묶은 뒤 AND. conds 는 activeConds 를 거친 것이어야 한다.
 * 키가 없으면 false (D3).
 */
export function matches(feature: Feature, conds: FilterCond[]): boolean {
  const presetGroups = new Map<string, FilterCond[]>()
  for (const c of conds) {
    if (!c.preset) {
      if (!matchOne(feature, c)) return false
      continue
    }
    const g = presetGroups.get(c.key)
    if (g) g.push(c)
    else presetGroups.set(c.key, [c])
  }
  for (const g of presetGroups.values()) if (!g.some((c) => matchOne(feature, c))) return false
  return true
}

/** 버튼 묶음을 그릴 필드: 보이는 레이어의 presets 있는 number 필드 (filterFields 순서 = 스키마 순서, E10). */
export function presetFields(layers: Layer[]): PropertySchemaField[] {
  return filterFields(layers, { visibleOnly: true }).filter((f) => f.type === 'number' && !!f.presets?.length)
}

const sameValue = (a: FilterCond['value'], b: FilterCond['value']): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] : a === b

/** 버튼 켜짐 = 같은 key·op·value 조건이 있다 (E3). 직접 입력으로 같은 값을 넣어도 켜진다. */
export function presetOn(conds: FilterCond[], key: string, p: FilterPreset): boolean {
  return conds.some((c) => c.key === key && c.op === p.op && sameValue(c.value, p.value))
}

/**
 * 켜져 있으면 그 버튼 조건만 뺀다. 아니면 버튼 조건을 더한다 — 같은 key 의 다른 버튼은 두고(OR 로 넓어진다),
 * 같은 key 의 직접 입력 조건은 지운다 (AND 인 직접 입력과 OR 인 버튼이 섞이면 결과를 읽기 어렵다).
 */
export function togglePreset(conds: FilterCond[], key: string, p: FilterPreset, id: string): FilterCond[] {
  const same = (c: FilterCond) => c.key === key && c.op === p.op && sameValue(c.value, p.value)
  if (conds.some(same)) return conds.filter((c) => !same(c))
  const value: FilterCond['value'] = Array.isArray(p.value) ? [p.value[0], p.value[1]] : p.value
  return [...conds.filter((c) => c.key !== key || c.preset), { id, key, op: p.op, value, preset: true }]
}

/** E11. 버튼으로 보이지 않는 조건(프리셋 없는 필드·버튼과 다른 값·적용 안 됨·입력 중)이 있나 — 있으면 직접 입력을 펼쳐 둔다. */
export function hasManualConds(conds: FilterCond[], visibleFields: PropertySchemaField[]): boolean {
  return conds.some((c) => {
    if (condProblem(c, visibleFields)) return true
    const presets = visibleFields.find((f) => f.key === c.key)?.presets ?? []
    return !presets.some((p) => p.op === c.op && sameValue(c.value, p.value))
  })
}

/** E10 + E11: 처음 3묶음, 조건이 걸린 묶음은 더보기를 접어도 보인다 — 패널이 다시 열리면 more 가 초기화된다. */
export function shownPresetGroups(groups: PropertySchemaField[], conds: FilterCond[], more: boolean): PropertySchemaField[] {
  return groups.filter((g, i) => more || i < 3 || conds.some((c) => c.key === g.key))
}
