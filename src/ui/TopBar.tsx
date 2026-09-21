import { useEffect, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { SearchBox } from './SearchBox'
import { useStore } from '../store/useStore'
import { vworldBasemap } from '../providers/basemap'
import { onSaveState, flush } from '../db/repo'
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

  const basemapId = useStore((s) => s.basemapId)
  const setBasemap = useStore((s) => s.setBasemap)
  const features = useStore((s) => s.features)
  const layers = useStore((s) => s.layers)
  const activeLayerId = useStore((s) => s.activeLayerId)

  useEffect(() => onSaveState(setSaveState), [])

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

      <span className="hidden shrink-0 text-[11px] text-ink-mut lg:inline" data-testid="save-state">
        {SAVE_LABEL[saveState] ?? saveState}
      </span>

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
