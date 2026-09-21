import { useStore, type DrawMode } from '../store/useStore'

const TOOLS: Array<{ mode: DrawMode; label: string; icon: string }> = [
  { mode: 'select', label: '선택', icon: '↖' },
  { mode: 'point', label: '점', icon: '•' },
  { mode: 'linestring', label: '선', icon: '/' },
  { mode: 'polygon', label: '다각형', icon: '⬠' },
  { mode: 'rectangle', label: '사각형', icon: '▭' },
  { mode: 'circle', label: '원', icon: '○' },
  { mode: 'delete', label: '삭제', icon: '✕' },
]

/** 모바일에서는 하단 가로 스크롤 바, PC 에서는 지도 좌상단 팔레트. */
export function Toolbar({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  const drawMode = useStore((s) => s.drawMode)
  const setDrawMode = useStore((s) => s.setDrawMode)

  const horizontal = orientation === 'horizontal'

  return (
    <div
      className={
        horizontal
          ? 'flex w-full gap-1 overflow-x-auto border-t border-line bg-surface px-2 py-1.5'
          : 'flex flex-col gap-1 rounded-xl border border-line bg-surface/95 p-1.5 shadow-md backdrop-blur'
      }
      data-testid="toolbar"
    >
      {TOOLS.map((t) => (
        <button
          key={t.mode}
          onClick={() => setDrawMode(t.mode)}
          aria-pressed={drawMode === t.mode}
          title={t.label}
          data-testid={`tool-${t.mode}`}
          className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition-colors ${
            // 모바일 가로 바에서는 포인터 종류와 무관하게 44px 이상을 보장한다.
            // pointer:coarse 미디어쿼리에만 기대면 좁은 데스크톱 창에서 34px 로 줄어든다.
            horizontal ? 'min-h-[44px] min-w-[44px] py-2' : 'py-2'
          } ${
            drawMode === t.mode
              ? t.mode === 'delete'
                ? 'bg-danger text-white'
                : 'bg-brand text-white'
              : 'text-ink-mut hover:bg-surface-sub'
          }`}
        >
          <span aria-hidden>{t.icon}</span>
          <span className={horizontal ? '' : 'hidden'}>{t.label}</span>
        </button>
      ))}
    </div>
  )
}
