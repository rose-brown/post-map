import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { uid, type PropertySchemaField } from '../types'
import {
  activeConds, condProblem, fieldFor, filterFields, hasManualConds, opsFor, presetFields, presetOn, shownPresetGroups, togglePreset,
  type FilterCond, type FilterOp,
} from '../filter'

/**
 * 목록 헤더 아래에 펼치는 조건 편집 영역 (스펙 docs/superpowers/specs/2026-09-30-list-filter-design.md 4절).
 * 필드 목록은 보이는 레이어 기준, 라벨은 전체 레이어 기준 — 레이어를 꺼서 판정에서 빠진 조건도
 * 제목을 그려야 한다 (D5·D6). 불변 규칙 6 — 도메인 용어 없음, 라벨은 스키마에서 온다.
 * 버튼 묶음(스펙 2026-09-30-filter-buttons E1~E11)은 스키마 presets 로 그린다 — 값은 데이터에만 있다.
 */

const OP_LABEL: Record<FilterOp, string> = { gte: '이상', lte: '이하', between: '사이', contains: '포함' }

const emptyValue = (op: FilterOp): FilterCond['value'] => (op === 'between' ? ['', ''] : '')

export function FilterPanel({ embedded }: { embedded: boolean }) {
  const layers = useStore((s) => s.layers)
  const filters = useStore((s) => s.filters)
  const setFilters = useStore((s) => s.setFilters)

  const visibleFields = useMemo(() => filterFields(layers, { visibleOnly: true }), [layers])
  const allFields = useMemo(() => filterFields(layers, { visibleOnly: false }), [layers])
  const visibleKeys = useMemo(() => new Set(visibleFields.map((f) => f.key)), [visibleFields])
  const active = useMemo(
    () => new Set(activeConds(filters, visibleFields).map((c) => c.id)),
    [filters, visibleFields],
  )
  const fieldOf = (key: string): PropertySchemaField | undefined => fieldFor(key, visibleFields, allFields)
  const groups = useMemo(() => presetFields(layers), [layers])
  const [more, setMore] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  // 버튼으로 보이지 않는 조건이 있으면 직접 입력을 펼쳐 둔다 — 숨으면 "왜 걸러지지?" 가 된다 (E11).
  const manualForced = useMemo(() => hasManualConds(filters, visibleFields), [filters, visibleFields])
  const showManual = manualOpen || manualForced || groups.length === 0
  const shownGroups = shownPresetGroups(groups, filters, more)
  const btn = embedded ? 'touch-target text-[14px]' : 'h-7 text-[12px]'

  // 모바일 바텀시트: 44px 는 레이아웃 조건으로 보장 (불변 규칙 7). iOS 는 16px 미만 입력칸에서 확대한다.
  const ctl = embedded ? 'touch-target text-[16px]' : 'h-8 text-[12px]'
  const input = `${ctl} min-w-0 rounded-lg border border-line bg-surface px-2`

  const update = (id: string, patch: Partial<FilterCond>) =>
    setFilters(filters.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  const changeField = (cond: FilterCond, key: string) => {
    const next = fieldOf(key)
    if (!next) return
    const ops = opsFor(next.type)
    // 타입이 바뀌어 지금 연산자가 안 맞으면 연산자·값을 초기화한다.
    if (ops.includes(cond.op)) update(cond.id, { key })
    else update(cond.id, { key, op: ops[0], value: emptyValue(ops[0]) })
  }

  const changeOp = (cond: FilterCond, op: FilterOp) => {
    const wasBetween = cond.op === 'between'
    update(cond.id, { op, value: wasBetween === (op === 'between') ? cond.value : emptyValue(op) })
  }

  const add = () => {
    const first = visibleFields[0]
    if (!first) return
    const op = opsFor(first.type)[0]
    setFilters([...filters, { id: uid('flt'), key: first.key, op, value: emptyValue(op) }])
  }

  return (
    <div className="flex flex-col gap-2 border-b border-line bg-surface-sub px-4 py-3" data-testid="filter-panel">
      {shownGroups.map((f) => (
        <div key={f.key} data-testid="preset-group" data-key={f.key}>
          <div className="text-[12px] font-semibold">{f.label}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {f.presets!.map((p) => {
              const on = presetOn(filters, f.key, p)
              return (
                <button
                  key={p.label}
                  onClick={() => setFilters(togglePreset(filters, f.key, p, uid('flt')))}
                  aria-pressed={on}
                  data-testid="preset-button"
                  className={`${btn} rounded-lg px-2.5 ${on ? 'bg-brand text-white' : 'border border-line bg-surface text-ink'}`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {groups.length > 0 && (
        <div className="flex items-center gap-3">
          {groups.length > 3 && (
            <button
              onClick={() => setMore((v) => !v)}
              className={`${embedded ? 'touch-target' : ''} text-[12px] font-medium text-brand`}
              data-testid="preset-more"
            >
              {more ? '▴ 접기' : `▾ 더보기 (${groups.length - 3})`}
            </button>
          )}
          <button
            onClick={() => setManualOpen((v) => !v)}
            disabled={manualForced}
            className={`${embedded ? 'touch-target' : ''} text-[12px] text-ink-mut disabled:opacity-60`}
            data-testid="manual-toggle"
          >
            직접 입력 {showManual ? '▴' : '›'}
          </button>
        </div>
      )}

      {showManual && filters.map((cond) => {
        const field = fieldOf(cond.key)
        const inScope = visibleKeys.has(cond.key)
        const problem = condProblem(cond, visibleFields)
        // 타입이 바뀌어 안 맞는 연산자도 목록에 남겨 둔다 — 없으면 select 가 다른 연산자를 보여 적용된 것처럼 보인다.
        const fieldOps = field ? opsFor(field.type) : []
        const ops = fieldOps.includes(cond.op) ? fieldOps : [cond.op, ...fieldOps]
        return (
          <div
            key={cond.id}
            className={`flex flex-wrap items-center gap-1.5 ${problem ? 'opacity-50' : ''}`}
            data-testid="filter-row"
            data-active={active.has(cond.id)}
          >
            <select
              value={cond.key}
              onChange={(e) => changeField(cond, e.target.value)}
              className={`${input} flex-1`}
              data-testid="filter-field"
            >
              {!inScope && <option value={cond.key}>{field?.label ?? cond.key}</option>}
              {visibleFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              value={cond.op}
              onChange={(e) => changeOp(cond, e.target.value as FilterOp)}
              className={input}
              data-testid="filter-op"
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {OP_LABEL[op]}
                </option>
              ))}
            </select>
            {cond.op === 'between' && Array.isArray(cond.value) ? (
              <>
                <input
                  value={cond.value[0]}
                  inputMode="decimal"
                  onChange={(e) => update(cond.id, { value: [e.target.value, (cond.value as [string, string])[1]] })}
                  className={`${input} w-20`}
                  data-testid="filter-value-min"
                />
                <span className="text-[11px] text-ink-mut">~</span>
                <input
                  value={cond.value[1]}
                  inputMode="decimal"
                  onChange={(e) => update(cond.id, { value: [(cond.value as [string, string])[0], e.target.value] })}
                  className={`${input} w-20`}
                  data-testid="filter-value-max"
                />
              </>
            ) : (
              <input
                value={typeof cond.value === 'string' ? cond.value : ''}
                inputMode={cond.op === 'contains' ? 'text' : 'decimal'}
                onChange={(e) => update(cond.id, { value: e.target.value })}
                className={`${input} w-24`}
                data-testid="filter-value"
              />
            )}
            {field?.unit && <span className="text-[11px] text-ink-mut">{field.unit}</span>}
            {problem && (
              <span className="text-[11px] text-ink-mut" data-testid="filter-inactive">
                적용 안 됨
              </span>
            )}
            <button
              onClick={() => setFilters(filters.filter((c) => c.id !== cond.id))}
              className={`${embedded ? 'touch-target' : 'h-8 w-8'} rounded-lg text-ink-mut hover:bg-surface`}
              title="조건 삭제"
              data-testid="filter-remove"
            >
              ✕
            </button>
          </div>
        )
      })}

      <div className="flex items-center">
        {showManual && (
          <button
            onClick={add}
            disabled={!visibleFields.length}
            className={`${embedded ? 'touch-target' : ''} text-[12px] font-medium text-brand disabled:text-ink-mut`}
            data-testid="filter-add"
          >
            + 조건 추가
          </button>
        )}
        <div className="flex-1" />
        {filters.length > 0 && (
          <button
            onClick={() => setFilters([])}
            className={`${embedded ? 'touch-target' : ''} text-[12px] text-ink-mut`}
            data-testid="filter-clear"
          >
            모두 지우기
          </button>
        )}
      </div>
    </div>
  )
}
