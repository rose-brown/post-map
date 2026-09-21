import { useEffect, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { MapView } from './map/MapView'
import { TopBar } from './ui/TopBar'
import { Toolbar } from './ui/Toolbar'
import { LayerPanel } from './ui/LayerPanel'
import { InfoPage } from './ui/InfoPage'
import { FeatureList } from './ui/FeatureList'
import { BottomSheet, type Snap } from './ui/BottomSheet'
import { useStore } from './store/useStore'
import { vworldBasemap } from './providers/basemap'

function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const on = (e: MediaQueryListEvent) => setMobile(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return mobile
}

export function App() {
  const [map, setMap] = useState<MapLibreMap | null>(null)
  const [layersOpen, setLayersOpen] = useState(true)
  const [sheet, setSheet] = useState<'layers' | 'list' | 'info' | null>(null)
  const [snap, setSnap] = useState<Snap>('half')

  const isMobile = useIsMobile()
  const init = useStore((s) => s.init)
  const ready = useStore((s) => s.ready)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const basemapId = useStore((s) => s.basemapId)
  const setBasemap = useStore((s) => s.setBasemap)

  useEffect(() => {
    void init()
  }, [init])

  // 도형을 선택하면 정보 페이지가 열린다. 모바일은 바텀시트로.
  useEffect(() => {
    if (!selectedId) {
      setSheet((s) => (s === 'info' ? null : s))
      return
    }
    setSheet('info')
    setSnap('half')
  }, [selectedId])

  if (!ready) {
    return (
      <div className="grid h-full place-items-center text-sm text-ink-mut">
        불러오는 중…
      </div>
    )
  }

  /* ---------------- 모바일: 지도 전체화면 + 하단 도구 바 + 바텀시트 ---------------- */
  if (isMobile) {
    return (
      <div className="flex h-full flex-col">
        <TopBar map={map} />

        <div className="relative min-h-0 flex-1">
          <MapView onMapReady={setMap} />

          <div className="absolute left-2 top-2 z-10 flex gap-1 rounded-lg bg-surface/95 p-0.5 shadow-md backdrop-blur">
            {vworldBasemap.list().map((o) => (
              <button
                key={o.id}
                onClick={() => setBasemap(o.id)}
                aria-pressed={basemapId === o.id}
                data-testid={`basemap-m-${o.id}`}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                  basemapId === o.id ? 'bg-brand text-white' : 'text-ink-mut'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {sheet && (
            <BottomSheet
              snap={snap}
              onSnapChange={setSnap}
              title={sheet === 'layers' ? '레이어' : sheet === 'list' ? '기록' : '정보 페이지'}
              onClose={() => {
                // 정보 페이지를 닫으면 목록으로 돌아간다 (PC 의 '← 목록' 과 같은 동작).
                if (sheet === 'info') {
                  select(null)
                  setSheet('list')
                } else {
                  setSheet(null)
                }
              }}
            >
              {sheet === 'layers' && <LayerPanel />}
              {sheet === 'list' && <FeatureList map={map} embedded />}
              {sheet === 'info' && (
                <InfoPage
                  embedded
                  onClose={() => {
                    select(null)
                    setSheet('list')
                  }}
                />
              )}
            </BottomSheet>
          )}
        </div>

        <div className="z-20 flex flex-none items-stretch bg-surface">
          <button
            onClick={() => {
              setSheet(sheet === 'layers' ? null : 'layers')
              setSnap('half')
            }}
            className="touch-target shrink-0 border-t border-line px-3 text-[12px] font-medium text-ink-mut"
            data-testid="open-layers-sheet"
          >
            ☰
          </button>
          <button
            onClick={() => {
              select(null)
              setSheet(sheet === 'list' ? null : 'list')
              setSnap('half')
            }}
            className="touch-target shrink-0 border-t border-line px-3 text-[12px] font-medium text-ink-mut"
            data-testid="open-list-sheet"
          >
            목록
          </button>
          <Toolbar orientation="horizontal" />
        </div>
      </div>
    )
  }

  /* ---------------- PC: 좌 레이어 / 중앙 지도 / 우 정보 페이지 ---------------- */
  return (
    <div className="flex h-full flex-col">
      <TopBar map={map} />

      <div className="flex min-h-0 flex-1">
        <aside
          className={`flex-none border-r border-line transition-[width] duration-200 ${
            layersOpen ? 'w-[280px]' : 'w-0 overflow-hidden'
          }`}
        >
          <LayerPanel />
        </aside>

        <div className="relative min-w-0 flex-1">
          <MapView onMapReady={setMap} />

          <button
            onClick={() => setLayersOpen((v) => !v)}
            className="absolute left-2 top-2 z-10 rounded-lg border border-line bg-surface/95 px-2 py-1.5 text-[12px] shadow-md backdrop-blur"
            data-testid="toggle-layer-panel"
          >
            {layersOpen ? '◀ 패널' : '▶ 패널'}
          </button>

          <div className="absolute left-2 top-12 z-10">
            <Toolbar orientation="vertical" />
          </div>
        </div>

        <aside
          className="w-[360px] flex-none border-l border-line bg-surface"
          data-testid="info-panel"
        >
          {/* 목업의 "목록 ↔ 정보 페이지" 전환. 선택이 없으면 항상 목록이 보인다. */}
          {selectedId ? (
            <InfoPage onClose={() => select(null)} />
          ) : (
            <FeatureList map={map} />
          )}
        </aside>
      </div>
    </div>
  )
}
