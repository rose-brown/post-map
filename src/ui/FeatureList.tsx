import { useMemo, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import bbox from '@turf/bbox'
import { useStore } from '../store/useStore'
import type { Feature, Layer } from '../types'
import { useBlobUrl } from './Blocks'
import { MarkerGlyph } from './MarkerPicker'
import { hasMarker, markerById } from '../map/markers'

/**
 * 우측 패널의 기본 화면. 목업(.dc.html)의 "목록 ↔ 정보 페이지" 전환 구조를 계승한다.
 *
 * 지도 클릭으로만 도형을 고를 수 있으면 화면 밖으로 나간 도형은 찾아갈 방법이 없다.
 * 행을 누르면 그 도형으로 지도를 옮기고(point 는 flyTo, 나머지는 fitBounds) 정보 페이지를 연다.
 *
 * 불변 규칙 6 — 여기에 도메인 용어를 넣지 않는다. 정렬 기준도 `가격순` 같은 도메인 필드가 아니라
 * 스키마와 무관한 `최근순 / 이름순` 뿐이다.
 */

type Sort = 'recent' | 'title'

const GEOMETRY_ICON: Record<string, string> = {
  Point: '•',
  LineString: '/',
  Polygon: '▱',
  MultiPolygon: '▱',
  MultiLineString: '/',
  MultiPoint: '•',
}

/** 채워진 스키마 속성 최대 3개 → 없으면 블록 수 → 그것도 없으면 도형 종류. */
function metaOf(feature: Feature, layer: Layer | undefined): string {
  const filled = (layer?.schema ?? [])
    .map((f) => {
      const v = feature.properties[f.key]
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return null
      const shown = typeof v === 'number' ? v.toLocaleString('ko-KR') : String(v)
      return `${shown}${f.unit ?? ''}`
    })
    .filter((v): v is string => v !== null)

  if (filled.length) return filled.slice(0, 3).join(' · ')
  if (feature.blocks.length) return `${feature.blocks.length}개 블록`
  return feature.geometry.type
}

const dateOf = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
}

export function FeatureList({
  map,
  /** 바텀시트 안에서는 시트가 이미 제목을 그리므로 라벨을 생략한다. */
  embedded = false,
}: {
  map: MapLibreMap | null
  embedded?: boolean
}) {
  const features = useStore((s) => s.features)
  const layers = useStore((s) => s.layers)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const setDrawMode = useStore((s) => s.setDrawMode)
  const [sort, setSort] = useState<Sort>('recent')

  const layerById = useMemo(() => new Map(layers.map((l) => [l.id, l])), [layers])

  const rows = useMemo(() => {
    // 동심원 링은 파생 도형이라 목록에 넣지 않는다. 숨긴 레이어의 도형도 뺀다.
    const visible = new Set(layers.filter((l) => l.visible).map((l) => l.id))
    const list = features.filter((f) => !f.derivedFrom && visible.has(f.layerId))
    return [...list].sort((a, b) =>
      sort === 'title'
        ? (a.title || '제목 없음').localeCompare(b.title || '제목 없음', 'ko')
        : b.createdAt.localeCompare(a.createdAt),
    )
  }, [features, layers, sort])

  const goTo = (feature: Feature) => {
    select(feature.id)
    // 목록에서 골랐는데 작도 모드면 다음 클릭에 새 도형이 찍힌다. 선택 모드로 되돌린다.
    setDrawMode('select')
    if (!map) return
    if (feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates as [number, number]
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16) })
    } else {
      const [minX, minY, maxX, maxY] = bbox(feature.geometry)
      map.fitBounds(
        [
          [minX, minY],
          [maxX, maxY],
        ],
        { padding: 64, maxZoom: 17 },
      )
    }
  }

  let lastDate = ''

  return (
    <div className="flex h-full flex-col" data-testid="feature-list">
      <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
        {!embedded && <span className="text-sm font-semibold">기록</span>}
        <span className="text-xs font-medium text-brand" data-testid="feature-count">
          {rows.length}
        </span>
        <div className="flex-1" />
        {(
          [
            ['recent', '최근순'],
            ['title', '이름순'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSort(key)}
            aria-pressed={sort === key}
            data-testid={`sort-${key}`}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              sort === key ? 'bg-brand text-white' : 'border border-line text-ink-mut'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!rows.length && (
          <div className="flex flex-col gap-1.5 py-6">
            <span className="text-[14px] font-semibold">아직 기록이 없습니다</span>
            <span className="text-[12px] leading-relaxed text-ink-mut">
              왼쪽 도구에서 점·선·다각형을 고르고 지도를 클릭하면 빈 정보 페이지가 만들어집니다.
            </span>
          </div>
        )}

        {rows.map((feature) => {
          const layer = layerById.get(feature.layerId)
          const date = dateOf(feature.createdAt)
          const showDate = sort === 'recent' && date !== lastDate
          if (showDate) lastDate = date
          return (
            <div key={feature.id}>
              {showDate && (
                <div className="mb-1.5 mt-2 text-[11px] text-ink-mut">{date}</div>
              )}
              <Row
                feature={feature}
                layer={layer}
                selected={feature.id === selectedId}
                onSelect={() => goTo(feature)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Row({
  feature,
  layer,
  selected,
  onSelect,
}: {
  feature: Feature
  layer: Layer | undefined
  selected: boolean
  onSelect: () => void
}) {
  const firstPhoto = feature.blocks.find((b) => b.type === 'gallery' && b.refs?.length)?.refs?.[0]
  const thumb = useBlobUrl(firstPhoto?.id)
  const marker = hasMarker(feature.properties.icon)
    ? markerById(String(feature.properties.icon))
    : undefined

  return (
    <button
      onClick={onSelect}
      data-testid="feature-row"
      data-feature-id={feature.id}
      className={`mb-1.5 flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors ${
        selected ? 'bg-brand-soft ring-1 ring-brand/30' : 'hover:bg-surface-sub'
      }`}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-sub bg-cover bg-center text-[13px]"
        style={{
          ...(thumb ? { backgroundImage: `url(${thumb})` } : {}),
          color: layer?.style.color ?? undefined,
        }}
        aria-hidden
      >
        {thumb ? '' : marker ? (
          <MarkerGlyph icon={marker} size={18} />
        ) : (
          (GEOMETRY_ICON[feature.geometry.type] ?? '•')
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium">
          {feature.title || '제목 없음'}
        </span>
        <span className="truncate text-[11px] text-ink-mut">{metaOf(feature, layer)}</span>
      </span>

      <span className="shrink-0 text-[11px] text-ink-mut">›</span>
    </button>
  )
}
