import type { PropertySchemaField, PropertyValue } from '../types'

/** 타입별 입력 UI. 숫자는 천단위 구분과 단위 접미사를 보여준다 (PRD 4.3). */
export function PropertyRow({
  field,
  value,
  onChange,
  onRemove,
}: {
  field: PropertySchemaField
  value: PropertyValue | undefined
  onChange: (v: PropertyValue | undefined) => void
  onRemove?: () => void
}) {
  return (
    <div
      className="group flex items-center gap-2.5 rounded-md px-2 py-1 hover:bg-surface-sub"
      data-testid="property-row"
      data-key={field.key}
    >
      <span className="w-24 shrink-0 truncate text-[12px] text-ink-mut" title={field.label}>
        {field.label}
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Input field={field} value={value} onChange={onChange} />
      </div>

      {onRemove && (
        <button
          onClick={onRemove}
          className="shrink-0 text-[11px] text-ink-mut opacity-0 group-hover:opacity-100"
          aria-label="속성 삭제"
        >
          ✕
        </button>
      )}
    </div>
  )
}

function Input({
  field,
  value,
  onChange,
}: {
  field: PropertySchemaField
  value: PropertyValue | undefined
  onChange: (v: PropertyValue | undefined) => void
}) {
  const base = 'min-w-0 flex-1 bg-transparent text-[13px]'

  switch (field.type) {
    case 'number': {
      const num = typeof value === 'number' ? value : undefined
      return (
        <>
          <input
            type="number"
            inputMode="decimal"
            value={num ?? ''}
            placeholder="비어 있음"
            onChange={(e) =>
              onChange(e.target.value === '' ? undefined : Number(e.target.value))
            }
            className={base}
            data-testid="prop-input"
          />
          {num !== undefined && (
            <span className="shrink-0 text-[11px] text-ink-mut">
              {num.toLocaleString('ko-KR')}
              {field.unit ?? ''}
            </span>
          )}
        </>
      )
    }

    case 'date':
      return (
        <input
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={base}
          data-testid="prop-input"
        />
      )

    case 'boolean':
      return (
        <button
          onClick={() => onChange(value === true ? undefined : true)}
          aria-pressed={value === true}
          className={`h-5 w-9 shrink-0 rounded-full transition-colors ${
            value === true ? 'bg-brand' : 'bg-line'
          }`}
          data-testid="prop-input"
        >
          <span
            className={`block h-4 w-4 rounded-full bg-white transition-transform ${
              value === true ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      )

    case 'select':
      return (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={base}
          data-testid="prop-input"
        >
          <option value="">비어 있음</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )

    case 'multiselect': {
      const picked = Array.isArray(value) ? value : []
      return (
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {(field.options ?? []).map((o) => {
            const on = picked.includes(o)
            return (
              <button
                key={o}
                onClick={() =>
                  onChange(on ? picked.filter((p) => p !== o) : [...picked, o])
                }
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  on ? 'bg-brand text-white' : 'bg-surface-sub text-ink-mut'
                }`}
              >
                {o}
              </button>
            )
          })}
        </div>
      )
    }

    case 'url':
      return (
        <>
          <input
            type="url"
            value={typeof value === 'string' ? value : ''}
            placeholder="https://"
            onChange={(e) => onChange(e.target.value || undefined)}
            className={base}
            data-testid="prop-input"
          />
          {typeof value === 'string' && value && (
            <a
              href={value}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[11px] text-brand"
            >
              열기
            </a>
          )}
        </>
      )

    case 'phone':
      return (
        <>
          <input
            type="tel"
            value={typeof value === 'string' ? value : ''}
            placeholder="비어 있음"
            onChange={(e) => onChange(e.target.value || undefined)}
            className={base}
            data-testid="prop-input"
          />
          {typeof value === 'string' && value && (
            <a href={`tel:${value}`} className="shrink-0 text-[11px] text-brand">
              통화
            </a>
          )}
        </>
      )

    case 'text':
    default:
      return (
        <input
          value={typeof value === 'string' ? value : ''}
          placeholder="비어 있음"
          onChange={(e) => onChange(e.target.value || undefined)}
          className={base}
          data-testid="prop-input"
        />
      )
  }
}
