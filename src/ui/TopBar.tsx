import { useEffect, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { SearchBox } from './SearchBox'
import { useStore } from '../store/useStore'
import { vworldBasemap } from '../providers/basemap'
import { onSaveState, flush, retryFlush, hasUnsaved, lastSaveError } from '../db/repo'
import { download, toFeatureCollection } from '../export/geojson'

const SAVE_LABEL: Record<string, string> = {
  idle: '자동 저장',
  pending: '저장 중…',
  saved: '저장됨 · 방금',
  error: '저장 실패',
}

export function TopBar({ map }: { map: MapLibreMap | null }) {
  const [saveState, setSaveState] = useState('idle')
  const [exportOpen, setExportOpen] = useState(false)
  const [copied, setCopied] = useState<'' | 'ok' | 'fail'>('')

  // 링크가 곧 접근 권한이다 (스펙 D4). URL 에는 commitLink 가 항상 ?p= 를 남겨 둔다.
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
    setTimeout(() => setCopied(''), 1500)
  }

  const basemapId = useStore((s) => s.basemapId)
  const setBasemap = useStore((s) => s.setBasemap)
  const features = useStore((s) => s.features)
  const layers = useStore((s) => s.layers)
  const activeLayerId = useStore((s) => s.activeLayerId)

  useEffect(() => onSaveState(setSaveState), [])

  /**
   * 저장 안 된 변경이 남은 채 탭을 닫으려 하면 경고한다.
   * 온라인 우선이라 로컬에 받아둘 곳이 없다 — 여기서 막지 않으면 조용히 사라진다.
   */
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!hasUnsaved()) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [])

  const exportAll = async (includeBlocks: boolean, layerId?: string) => {
    await flush()
    const subset = layerId ? features.filter((f) => f.layerId === layerId) : features
    const name = layerId
      ? (layers.find((l) => l.id === layerId)?.name ?? 'layer')
      : 'project'
    download(`${name}.geojson`, toFeatureCollection(subset, layers, { includeBlocks }))
    setExportOpen(false)
  }

  return (
    <header className="flex flex-none items-center gap-2.5 border-b border-line bg-surface px-3 py-2 md:px-4">
      <div className="flex shrink-0 items-center gap-2">
        <span className="grid h-[22px] w-[22px] place-items-center rounded-[7px] bg-brand text-[12px] font-bold text-white">
          지
        </span>
        <span className="hidden text-[13px] font-bold sm:inline">지도 편집</span>
      </div>

      <SearchBox map={map} />

      <div className="hidden shrink-0 items-center gap-0.5 rounded-lg bg-surface-sub p-0.5 md:flex">
        {vworldBasemap.list().map((o) => (
          <button
            key={o.id}
            onClick={() => setBasemap(o.id)}
            aria-pressed={basemapId === o.id}
            data-testid={`basemap-${o.id}`}
            className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium ${
              basemapId === o.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-mut'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {saveState === 'error' ? (
        <span className="flex shrink-0 items-center gap-1.5" data-testid="save-state">
          <span className="text-[11px] font-medium text-danger" title={lastSaveError() ?? ''}>
            {SAVE_LABEL.error}
          </span>
          <button
            onClick={() => void retryFlush()}
            className="touch-target rounded-lg border border-danger px-2 text-[11px] font-medium text-danger"
            data-testid="save-retry"
          >
            다시 시도
          </button>
        </span>
      ) : (
        <span className="hidden shrink-0 text-[11px] text-ink-mut lg:inline" data-testid="save-state">
          {SAVE_LABEL[saveState] ?? saveState}
        </span>
      )}

      <button
        onClick={() => void copyLink()}
        title="이 링크를 아는 사람은 누구나 보고 고치고 지울 수 있습니다"
        className="touch-target shrink-0 rounded-lg bg-surface-sub px-2.5 py-1.5 text-[12px] font-medium hover:bg-line-soft"
        data-testid="copy-link"
      >
        {copied === 'ok' ? '복사됨' : copied === 'fail' ? '복사 실패' : '링크 복사'}
      </button>

      <div className="relative shrink-0">
        <button
          onClick={() => setExportOpen((v) => !v)}
          className="touch-target rounded-lg bg-surface-sub px-2.5 py-1.5 text-[12px] font-medium hover:bg-line-soft"
          data-testid="open-export"
        >
          내보내기
        </button>
        {exportOpen && (
          <div className="absolute right-0 top-10 z-40 w-60 rounded-xl border border-line bg-surface p-2 shadow-lg">
            <div className="px-2 pb-1 pt-1 text-[11px] text-ink-mut">GeoJSON 내보내기</div>
            <button
              onClick={() => exportAll(true)}
              className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-sub"
              data-testid="export-project"
            >
              프로젝트 전체 · 블록 포함
            </button>
            <button
              onClick={() => exportAll(false)}
              className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-sub"
              data-testid="export-project-noblocks"
            >
              프로젝트 전체 · 블록 제외
            </button>
            {activeLayerId && (
              <button
                onClick={() => exportAll(true, activeLayerId)}
                className="w-full rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-surface-sub"
                data-testid="export-layer"
              >
                현재 레이어만
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
