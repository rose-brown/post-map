import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 모바일 바텀시트 — 3단 스냅: 접힘 / 절반 / 전체.
 * 좁아지면 지도가 줄어드는 게 아니라 패널이 바텀시트가 된다 (불변 규칙 7).
 */
export type Snap = 'collapsed' | 'half' | 'full'

const HEIGHT: Record<Snap, string> = {
  collapsed: '88px',
  half: '50vh',
  full: '92vh',
}

const ORDER: Snap[] = ['collapsed', 'half', 'full']

export function BottomSheet({
  snap,
  onSnapChange,
  title,
  children,
  onClose,
}: {
  snap: Snap
  onSnapChange: (s: Snap) => void
  title: ReactNode
  children: ReactNode
  onClose?: () => void
}) {
  const startY = useRef<number | null>(null)
  const [dragDy, setDragDy] = useState(0)

  useEffect(() => setDragDy(0), [snap])

  const end = () => {
    if (startY.current === null) return
    const dy = dragDy
    startY.current = null
    setDragDy(0)
    if (Math.abs(dy) < 40) return
    const i = ORDER.indexOf(snap)
    // 아래로 끌면 접히고, 위로 끌면 펼쳐진다.
    const next = dy > 0 ? Math.max(0, i - 1) : Math.min(ORDER.length - 1, i + 1)
    onSnapChange(ORDER[next])
  }

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t border-line bg-surface shadow-[0_-8px_28px_rgba(0,0,0,.14)] transition-[height] duration-200"
      style={{ height: `calc(${HEIGHT[snap]} - ${dragDy}px)` }}
      data-testid="bottom-sheet"
      data-snap={snap}
    >
      <div
        className="flex flex-none cursor-grab touch-none flex-col items-center pt-2"
        onPointerDown={(e) => {
          startY.current = e.clientY
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (startY.current === null) return
          setDragDy(e.clientY - startY.current)
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="h-1 w-10 rounded-full bg-line" />
      </div>

      <div className="flex flex-none items-center gap-2 px-4 py-2">
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</div>
        <button
          className="touch-target rounded-lg px-2 py-1 text-xs text-ink-mut hover:bg-surface-sub"
          onClick={() => onSnapChange(snap === 'full' ? 'half' : 'full')}
        >
          {snap === 'full' ? '줄이기' : '펼치기'}
        </button>
        {onClose && (
          <button
            className="touch-target rounded-lg px-2 py-1 text-xs text-ink-mut hover:bg-surface-sub"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
