import { DEFAULT_MARKER, MARKER_ICONS, markerById, type MarkerIcon } from '../map/markers'
import type { PropertyValue } from '../types'

/** 아이콘 정의를 화면에서 쓰기 위한 인라인 SVG. 지도 핀과 같은 데이터를 본다. */
export function MarkerGlyph({ icon, size = 16 }: { icon: MarkerIcon; size?: number }) {
  if (icon.text) {
    return (
      <span
        style={{ fontSize: size * 0.8, lineHeight: 1, fontWeight: 700 }}
        aria-hidden
      >
        {icon.text}
      </span>
    )
  }
  if (!icon.paths?.length) {
    return (
      <span
        style={{ width: size * 0.45, height: size * 0.45, borderRadius: '50%', background: 'currentColor' }}
        aria-hidden
      />
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {icon.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

export function MarkerPicker({
  value,
  onChange,
}: {
  value: PropertyValue | undefined
  onChange: (id: string | undefined) => void
}) {
  const current = typeof value === 'string' ? value : DEFAULT_MARKER

  return (
    <div className="mb-2 rounded-xl border border-line p-2.5" data-testid="marker-picker">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[12px] font-semibold">표시 아이콘</span>
        <span className="text-[11px] text-ink-mut">{markerById(current)?.label ?? '기본'}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {MARKER_ICONS.map((icon) => {
          const on = icon.id === current
          return (
            <button
              key={icon.id}
              title={icon.label}
              aria-label={icon.label}
              aria-pressed={on}
              data-testid={`marker-${icon.id}`}
              onClick={() => onChange(icon.id === DEFAULT_MARKER ? undefined : icon.id)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                on
                  ? 'border-brand bg-brand text-white'
                  : 'border-line text-ink-mut hover:bg-surface-sub'
              }`}
            >
              <MarkerGlyph icon={icon} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
