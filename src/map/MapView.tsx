import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  Map as MapLibreMap,
  NavigationControl,
  GeolocateControl,
  ScaleControl,
  AttributionControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
} from 'maplibre-gl'
// MapLibre 는 워커 경로를 런타임에 자기 자신의 형제 파일로 계산한다
// (`new URL('./maplibre-gl-worker.mjs', import.meta.url)`). 정적 분석이 안 되므로 번들러가
// 그 파일을 산출물에 넣지 않고, 배포본에서 assets/maplibre-gl-worker.mjs 가 404 가 된다.
// 워커가 죽으면 GeoJSON 소스를 타일링하지 못해 **벡터 레이어만** 사라진다
// (래스터 배경지도는 워커를 쓰지 않아 멀쩡해서 원인이 안 보인다 — dev 에서는 maplibre 가
// node_modules 에서 그대로 서빙돼 형제 파일이 있으므로 재현되지 않는다).
// ?worker&url 은 워커를 의존 청크(maplibre-gl-shared.mjs)까지 묶어 산출물로 내보내고 그 URL 을 준다.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import {
  TerraDraw,
  TerraDrawSelectMode,
  TerraDrawPointMode,
  TerraDrawLineStringMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawCircleMode,
  type GeoJSONStoreFeatures,
} from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'
import type { FeatureCollection } from 'geojson'
import { useStore, type DrawMode } from '../store/useStore'
import { vworldBasemap, hasBasemapKey } from '../providers/basemap'
import { geocoder } from '../providers/geocoding'
import { uid, type Feature } from '../types'
import { ringLabelPoints } from './rings'
import { hasMarker, markerById, markerImageId, pinSvg } from './markers'
import { DOT_RADIUS, dotRadius, pinScale, pointSizeRatios } from './pointSize'
import { activeFilter, matches } from '../filter'

setWorkerUrl(maplibreWorkerUrl)

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** 반경 라벨(symbol 레이어)은 글리프 없이는 렌더되지 않는다. */
const GLYPHS = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'

/** 목업(.dc.html)의 하단 힌트 알약을 계승한다. 도구마다 조작법이 다른데 알 길이 없다. */
const HINT: Record<DrawMode, string> = {
  select: '도형을 클릭해 정보 페이지를 열고, 꼭짓점을 끌어 모양을 바꾸세요',
  point: '지도를 클릭하면 점이 생기고 정보 페이지가 열립니다',
  linestring: '클릭으로 점을 잇고 Enter 로 마칩니다 · Esc 취소',
  polygon: '클릭으로 꼭짓점을 찍고 Enter 로 닫습니다 · Esc 취소',
  rectangle: '시작점을 클릭하고, 반대쪽 모서리에서 한 번 더 클릭합니다',
  circle: '중심을 클릭하고, 원하는 반지름에서 한 번 더 클릭합니다',
  delete: '지울 도형을 클릭하세요',
}

/** 모드 이름은 Terra Draw 쪽 문자열과 우리 DrawMode 를 1:1 로 맞춘다. */
const TD_MODE: Record<Exclude<DrawMode, 'delete'>, string> = {
  select: 'select',
  point: 'point',
  linestring: 'linestring',
  polygon: 'polygon',
  rectangle: 'rectangle',
  circle: 'circle',
}

/** SVG 문자열을 지도에 등록할 수 있는 이미지로 만든다. */
function loadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

type HexColor = `#${string}`

/**
 * 도형 색. 동기화 이펙트가 properties.color 에 넣어준 값을 먼저 본다.
 * 스토어만 보고 계산하면, 레이어 색을 바꿔도 Terra Draw 쪽 properties 가 그대로라
 * restyle 이 일어나지 않아 색이 안 바뀐다 (실제로 그랬다).
 */
function layerColor(feature: GeoJSONStoreFeatures): HexColor {
  const direct = feature.properties?.color
  if (typeof direct === 'string' && direct.startsWith('#')) return direct as HexColor
  const layer = useStore.getState().layers.find((l) => l.id === feature.properties?.layerId)
  const fallback = layer?.style.color
  return fallback?.startsWith('#') ? (fallback as HexColor) : '#2563eb'
}

export function MapView({ onMapReady }: { onMapReady?: (m: MapLibreMap) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const drawRef = useRef<TerraDraw | null>(null)
  /** 스토어에 올라간 적 있는 Terra Draw id. 작도 중인 미완성 도형과 구분하기 위한 것. */
  const syncedIds = useRef<Set<string>>(new Set())
  const [readout, setReadout] = useState('')
  // 소스·레이어·Terra Draw 가 모두 올라온 시점. isStyleLoaded() 는 타일 로딩 중 false 로 흔들려
  // 게이트로 쓸 수 없다 (그렇게 썼더니 동심원이 영구히 렌더되지 않았다).
  const [mapReady, setMapReady] = useState(false)

  const ready = useStore((s) => s.ready)
  const drawMode = useStore((s) => s.drawMode)
  const basemapId = useStore((s) => s.basemapId)
  const features = useStore((s) => s.features)
  const layers = useStore((s) => s.layers)
  const selectedId = useStore((s) => s.selectedId)
  // 레이어 sizeField 로 정한 포인트 크기 비율. 셀렉터 밖에서 파생한다 (CLAUDE.md 함정: 셀렉터 안 파생 금지).
  const sizeRatios = useMemo(() => pointSizeRatios(features, layers), [features, layers])
  // 목록과 같은 활성 조건. 셀렉터 밖에서 파생하고, 입력 반응을 막지 않게 늦춘 값을 쓴다 (FeatureList 와 같은 이유).
  const filters = useDeferredValue(useStore((s) => s.filters))
  const activeConditions = useMemo(() => activeFilter(filters, layers), [filters, layers])

  /* ---------------- 지도 생성 ---------------- */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: { version: 8, glyphs: GLYPHS, sources: {}, layers: [] },
      center: [126.978, 37.5665],
      zoom: 12,
      attributionControl: false,
    })
    mapRef.current = map

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new GeolocateControl({ trackUserLocation: false }), 'top-right')
    map.addControl(new ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')

    const update = () => {
      const c = map.getCenter()
      setReadout(`${c.lng.toFixed(5)}, ${c.lat.toFixed(5)}  z${map.getZoom().toFixed(1)}`)
    }
    map.on('move', update)

    map.on('load', () => {
      // 동심원은 파생 도형이라 Terra Draw 가 아니라 별도 소스로 그린다.
      map.addSource('rings', { type: 'geojson', data: EMPTY })
      map.addSource('ringLabels', { type: 'geojson', data: EMPTY })
      map.addSource('pointIcons', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'rings-fill',
        type: 'fill',
        source: 'rings',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.08 },
      })
      map.addLayer({
        id: 'rings-line',
        type: 'line',
        source: 'rings',
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 },
      })
      map.addLayer({
        id: 'ring-labels',
        type: 'symbol',
        source: 'ringLabels',
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, -0.6],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#1a1c1f', 'text-halo-color': '#fff', 'text-halo-width': 2 },
      })
      // 포인트 표시 아이콘. 좌표에 핀 끝이 닿도록 bottom 으로 붙인다.
      map.addLayer({
        id: 'point-icons',
        type: 'symbol',
        source: 'pointIcons',
        layout: {
          'icon-image': ['get', 'iconKey'],
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': ['coalesce', ['get', 'scale'], 1],
          // 겹치면 레이어 순서가 뒤인(패널 아래쪽) 레이어의 핀이 위에 온다. 낮은 키부터 그린다.
          'symbol-sort-key': ['coalesce', ['get', 'order'], 0],
        },
      })
      // 포인트 제목. 겹치면 MapLibre 가 솎아낸다 — 위에 그려지는 레이어(order 큰 쪽)의 이름을 먼저 둔다.
      map.addSource('pointLabels', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'point-labels',
        type: 'symbol',
        source: 'pointLabels',
        layout: {
          'text-field': ['get', 'title'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 0.6],
          'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'order'], 0]],
        },
        paint: { 'text-color': '#1a1c1f', 'text-halo-color': '#fff', 'text-halo-width': 2 },
      })

      update()
      onMapReady?.(map)
      setupDraw(map)
      setMapReady(true)
    })

    return () => {
      drawRef.current?.stop()
      drawRef.current = null
      map.remove()
      mapRef.current = null
    }
    // onMapReady 는 최초 1회만 쓰인다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- Terra Draw ---------------- */
  function setupDraw(map: MapLibreMap) {
    if (drawRef.current) return

    // 스타일 키는 모드마다 다르다 (terra-draw 각 mode.d.ts 의 *Styling 타입 확인).
    // 아이콘이 붙은 포인트는 핀으로 그리므로 Terra Draw 의 기본 원을 투명하게 둔다.
    // (도형 자체는 남아 있어서 선택·이동은 그대로 된다.)
    const iconed = (f: GeoJSONStoreFeatures) => hasMarker(f.properties?.icon)
    const pointStyles = {
      pointColor: layerColor,
      // 크기는 동기화 이펙트가 properties.size 에 넣어 둔다 (tdStyleProps).
      pointWidth: (f: GeoJSONStoreFeatures) => (typeof f.properties?.size === 'number' ? f.properties.size : DOT_RADIUS),
      pointOutlineColor: '#ffffff' as HexColor,
      pointOutlineWidth: 2,
      pointOpacity: (f: GeoJSONStoreFeatures) => (iconed(f) ? 0 : 1),
      pointOutlineOpacity: (f: GeoJSONStoreFeatures) => (iconed(f) ? 0 : 1),
    }
    const lineStyles = { lineStringColor: layerColor, lineStringWidth: 3 }
    const areaStyles = {
      fillColor: layerColor,
      fillOpacity: 0.2,
      outlineColor: layerColor,
      outlineWidth: 2,
    }

    const editFlags = {
      feature: {
        draggable: true,
        coordinates: {
          draggable: true,
          midpoints: true,
          deletable: true,
        },
      },
    }

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      // 우리 Feature.id 와 Terra Draw 의 id 를 같은 값으로 맞춘다.
      idStrategy: { getId: () => uid('ftr'), isValidId: (id) => typeof id === 'string' },
      modes: [
        new TerraDrawSelectMode({
          // 꼭짓점 핸들의 터치 타깃. 점 자체는 작게 그리되 잡히는 범위를 44px 로 둔다.
          pointerDistance: 44,
          // 선택 모드에서 도형 이동과 꼭짓점 편집을 켠다 (완료 기준 2·3).
          flags: {
            point: { feature: { draggable: true } },
            linestring: editFlags,
            polygon: editFlags,
            rectangle: editFlags,
            circle: editFlags,
          },
        }),
        new TerraDrawPointMode({ editable: true, styles: pointStyles }),
        new TerraDrawLineStringMode({
          editable: true,
          keyEvents: { cancel: 'Escape', finish: 'Enter' },
          styles: lineStyles,
        }),
        new TerraDrawPolygonMode({
          editable: true,
          keyEvents: { cancel: 'Escape', finish: 'Enter' },
          styles: areaStyles,
        }),
        new TerraDrawRectangleMode({
          keyEvents: { cancel: 'Escape', finish: 'Enter' },
          styles: areaStyles,
        }),
        new TerraDrawCircleMode({
          keyEvents: { cancel: 'Escape', finish: 'Enter' },
          styles: areaStyles,
        }),
      ],
    })

    draw.start()
    draw.setMode('select')
    drawRef.current = draw

    draw.on('finish', (id) => {
      const state = useStore.getState()
      if (state.features.some((f) => f.id === id)) return
      const snapshot = draw.getSnapshotFeature(id)
      if (!snapshot) return

      const layerId = state.activeLayerId
      if (!layerId) return
      draw.updateFeatureProperties(id, { layerId })

      const created = state.addFeatureFromGeometryWithId(String(id), snapshot.geometry, layerId)
      if (!created) return
      syncedIds.current.add(String(id))
      state.select(String(id))

      // point 는 역지오코딩으로 주소를 채운다. 실패해도 작도는 이미 성공한 상태다.
      if (snapshot.geometry.type === 'Point') {
        const [lng, lat] = snapshot.geometry.coordinates as [number, number]
        geocoder.reverse(lng, lat).then((r) => {
          if (r) useStore.getState().setAddressHint(String(id), r.roadAddress || r.address)
        })
      }
    })

    draw.on('change', (ids, type) => {
      if (type !== 'update') return
      const state = useStore.getState()
      ids.forEach((id) => {
        const snapshot = draw.getSnapshotFeature(id)
        if (!snapshot) return
        const existing = state.features.find((f) => f.id === id)
        if (!existing) return
        if (JSON.stringify(existing.geometry) === JSON.stringify(snapshot.geometry)) return
        state.updateFeature(String(id), { geometry: snapshot.geometry })
        // 중심점이 움직이면 동심원도 따라 움직인다.
        if (snapshot.geometry.type === 'Point') {
          const radii = state.ringRadii(String(id))
          if (radii.length) state.setRings(String(id), radii)
        }
      })
    })

    draw.on('select', (id) => useStore.getState().select(String(id)))
    draw.on('deselect', () => useStore.getState().select(null))

    // 삭제 모드: 클릭한 도형을 지운다.
    // getFeaturesAtPointerEvent 는 이 조합에서 선을 잡아내지 못했다. lngLat 조회를 쓴다.
    map.on('click', (e: MapMouseEvent) => {
      if (useStore.getState().drawMode !== 'delete') return
      const hits = draw.getFeaturesAtLngLat(
        { lng: e.lngLat.lng, lat: e.lngLat.lat },
        { pointerDistance: 30, ignoreSelectFeatures: true, ignoreCoordinatePoints: true },
      )
      const hit = hits.find((f) => typeof f.id === 'string')
      if (!hit?.id) return
      // 서버에서 바로 지워지고 되돌리기가 없다 — 확인을 받고, 지운 뒤에는 선택 도구로 돌아간다 (실수 삭제, 2026-10-04).
      const state = useStore.getState()
      const title = state.features.find((f) => f.id === hit.id)?.title
      if (!window.confirm(`${title ? `"${title}"을(를)` : '이 도형을'} 삭제할까요?`)) return
      draw.removeFeatures([hit.id])
      state.removeFeature(String(hit.id))
      state.setDrawMode('select')
    })

    // 마지막 점 되돌리기
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (draw.canUndo()) draw.undo()
      }
    }
    window.addEventListener('keydown', onKey)
  }

  /* ---------------- 스토어 ↔ Terra Draw 동기화 ----------------
     스토어가 진실의 원천이고, Terra Draw 는 그 투영이다. 양방향을 다 맞춰야 한다:

     - 추가: 최초 하이드레이션과, 검색 결과처럼 지도 밖에서 만들어진 도형.
       "한 번만 올린다"로 짰더니 검색으로 만든 point 가 스토어에만 있고 화면에는 없었다.
     - 제거: 정보 페이지의 '삭제', 레이어 삭제처럼 **지도를 거치지 않는 삭제 경로**.
       이게 빠져 있어서 스토어·IndexedDB 에서는 지워졌는데 도형이 지도에 계속 그려졌다.

     미완성(작도 중) 도형을 지우지 않으려고, 한 번이라도 스토어에 올라갔던 id 만 제거 대상으로 본다.
     작도 중인 도형은 아직 스토어에 없으므로 syncedIds 에도 없다.

     숨긴 레이어의 도형은 Terra Draw 에 올리지 않는다(켜면 다시 채운다). 투명하게만 두면 점이 남고
     클릭도 잡혔다. 추가·제거는 배치 한 번이라 3,950 도형에서도 빠르다 — 도형마다
     updateFeatureProperties 를 부르면 호출마다 전체를 다시 그려 13초가 걸렸다 (2026-09-29 실측).
     필터(src/filter.ts)도 같은 추가·제거 경로를 쓴다 — 선택이 바뀔 때마다 이 이펙트가 돈다. */
  useEffect(() => {
    const draw = drawRef.current
    if (!mapReady || !draw || !ready) return

    const hidden = new Set(layers.filter((l) => !l.visible).map((l) => l.id))
    // 필터에 걸린 도형은 숨긴 레이어와 같은 경로로 빠진다. 선택된 도형은 필터만 건너뛴다 (스펙 D7) —
    // 없으면 필터 중 새로 찍은 점이 finish → select 직후 이 이펙트에 지워진다. 레이어 숨김은 건너뛰지 않는다.
    const drawable = features.filter(
      (f) =>
        !f.derivedFrom &&
        !hidden.has(f.layerId) &&
        (f.id === selectedId || matches(f, activeConditions)),
    )
    const storeIds = new Set(drawable.map((f) => f.id))
    const colorOf = new Map(layers.map((l) => [l.id, l.style.color]))
    const radiusOf = new Map(layers.map((l) => [l.id, l.style.pointRadius]))

    const missing = drawable.filter((f) => !draw.hasFeature(f.id))
    if (missing.length) {
      const results = draw.addFeatures(
        missing.map((f) => ({
          type: 'Feature' as const,
          id: f.id,
          geometry: f.geometry,
          properties: { mode: modeForGeometry(f.geometry.type), ...tdStyleProps(f, colorOf, radiusOf, sizeRatios) },
        })) as GeoJSONStoreFeatures[],
      )
      // addFeatures 는 거부된 피처를 예외 없이 되돌려준다. 조용히 사라지면 원인을 찾기 어렵다.
      results.forEach((r) => {
        if (r.valid) syncedIds.current.add(String(r.id))
        else console.warn('[map] 도형을 지도에 올리지 못했다', r.id, r.reason)
      })
    }

    const orphans = [...syncedIds.current].filter((id) => !storeIds.has(id))
    if (orphans.length) {
      const present = orphans.filter((id) => draw.hasFeature(id))
      if (present.length) draw.removeFeatures(present)
      orphans.forEach((id) => syncedIds.current.delete(id))
    }
  }, [mapReady, ready, features, layers, sizeRatios, activeConditions, selectedId])

  /* ---------------- 배경지도 ---------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      const option = vworldBasemap.list().find((o) => o.id === basemapId)
      if (!option) return

      // 기존 배경지도 레이어 제거
      map.getStyle().layers.forEach((l: { id: string }) => {
        if (l.id.startsWith('basemap-')) {
          if (map.getLayer(l.id)) map.removeLayer(l.id)
          if (map.getSource(l.id)) map.removeSource(l.id)
        }
      })

      const below = map.getLayer('rings-fill') ? 'rings-fill' : undefined
      option.tileUrls.forEach((url, i) => {
        const id = `basemap-${i}`
        map.addSource(id, {
          type: 'raster',
          tiles: [url],
          tileSize: 256,
          maxzoom: vworldBasemap.maxZoom,
          attribution: vworldBasemap.attribution,
        })
        map.addLayer({ id, type: 'raster', source: id }, below)
      })
    }

    if (mapReady) apply()
    else map.once('load', apply)
  }, [basemapId, mapReady])

  /* ---------------- 작도 모드 ---------------- */
  useEffect(() => {
    const draw = drawRef.current
    if (!mapReady || !draw) return
    draw.setMode(drawMode === 'delete' ? 'select' : TD_MODE[drawMode])
    const map = mapRef.current
    if (map) {
      map.getCanvas().style.cursor =
        drawMode === 'select' ? '' : drawMode === 'delete' ? 'not-allowed' : 'crosshair'
    }
  }, [drawMode, mapReady])

  /* ---------------- 동심원 렌더 ---------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const ringSource = map.getSource('rings') as GeoJSONSource | undefined
    const labelSource = map.getSource('ringLabels') as GeoJSONSource | undefined
    if (!ringSource || !labelSource) return

    const rings = features.filter((f) => f.derivedFrom?.op === 'ring')
    const colorOf = (layerId: string) =>
      layers.find((l) => l.id === layerId)?.style.color ?? '#2563eb'

    ringSource.setData({
      type: 'FeatureCollection',
      features: rings.map((r) => ({
        type: 'Feature',
        geometry: r.geometry,
        properties: { color: colorOf(r.layerId), label: String(r.properties.label ?? '') },
      })),
    })

    const labels = features
      .filter((f) => f.geometry.type === 'Point')
      .flatMap((center) => {
        const radii = rings
          .filter((r) => r.parentId === center.id)
          .map((r) => Number(r.properties.radius))
        if (!radii.length) return []
        if (center.geometry.type !== 'Point') return []
        const coords = center.geometry.coordinates as [number, number]
        return ringLabelPoints(coords, radii).map((p) => ({
          type: 'Feature' as const,
          geometry: p.geometry,
          properties: { label: p.label },
        }))
      })

    labelSource.setData({ type: 'FeatureCollection', features: labels })
  }, [features, layers, mapReady])

  /* ---------------- 포인트 표시 아이콘 ---------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource('pointIcons') as GeoJSONSource | undefined
    if (!source) return

    let cancelled = false
    const layerOf = (id: string) => layers.find((l) => l.id === id)
    const colorOf = (id: string) => layerOf(id)?.style.color ?? '#2563eb'

    const wanted = features.filter(
      (f) =>
        f.geometry.type === 'Point' &&
        !f.derivedFrom &&
        hasMarker(f.properties.icon) &&
        layerOf(f.layerId)?.visible !== false &&
        (f.id === selectedId || matches(f, activeConditions)),
    )

    const run = async () => {
      // 아이콘×색 조합마다 이미지를 한 번만 등록한다.
      const pairs = [...new Set(wanted.map((f) => `${f.properties.icon}|${colorOf(f.layerId)}`))]
      await Promise.all(
        pairs.map(async (pair) => {
          const [iconId, color] = pair.split('|')
          const key = markerImageId(iconId, color)
          if (map.hasImage(key)) return
          const icon = markerById(iconId)
          if (!icon) return
          const image = await loadSvg(pinSvg(icon, color))
          if (cancelled || map.hasImage(key)) return
          map.addImage(key, image, { pixelRatio: 2 })
        }),
      )
      if (cancelled) return
      source.setData({
        type: 'FeatureCollection',
        features: wanted.map((f) => ({
          type: 'Feature' as const,
          geometry: f.geometry,
          properties: {
            iconKey: markerImageId(String(f.properties.icon), colorOf(f.layerId)),
            scale: pinScale(sizeRatios.get(f.id)),
            order: layerOf(f.layerId)?.order ?? 0,
          },
        })),
      })
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [features, layers, mapReady, sizeRatios, activeConditions, selectedId])

  /* ---------------- 포인트 제목 ---------------- */
  // 아이콘 유무와 관계없이 보이는 점에 붙인다. 거르는 조건은 아이콘 소스와 같다.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource('pointLabels') as GeoJSONSource | undefined
    if (!source) return
    const layerOf = (id: string) => layers.find((l) => l.id === id)
    source.setData({
      type: 'FeatureCollection',
      features: features
        .filter(
          (f) =>
            f.geometry.type === 'Point' &&
            !f.derivedFrom &&
            !!f.title &&
            layerOf(f.layerId)?.visible !== false &&
            (f.id === selectedId || matches(f, activeConditions)),
        )
        .map((f) => ({
          type: 'Feature' as const,
          geometry: f.geometry,
          properties: { title: f.title, order: layerOf(f.layerId)?.order ?? 0 },
        })),
    })
  }, [features, layers, mapReady, activeConditions, selectedId])

  /* ---------------- 아이콘·색 반영 ---------------- */
  // 스타일 콜백은 Terra Draw 가 들고 있는 properties 를 본다. 스토어만 고치면 다시 칠해지지 않는다.
  // 올릴 때 이미 넣었으므로(동기화 이펙트) 여기서는 바뀐 도형만 알린다 — 호출마다 전체를 다시 그린다.
  useEffect(() => {
    const draw = drawRef.current
    if (!mapReady || !draw) return
    const colorOf = new Map(layers.map((l) => [l.id, l.style.color]))
    const radiusOf = new Map(layers.map((l) => [l.id, l.style.pointRadius]))
    features.forEach((f) => {
      if (f.derivedFrom || !draw.hasFeature(f.id)) return
      const want = tdStyleProps(f, colorOf, radiusOf, sizeRatios)
      const have = draw.getSnapshotFeature(f.id)?.properties
      if (have && have.layerId === want.layerId && have.icon === want.icon && have.color === want.color && have.size === want.size) return
      draw.updateFeatureProperties(f.id, want)
    })
  }, [layers, features, mapReady, sizeRatios])

  /* ---------------- 선택 동기화 ---------------- */
  useEffect(() => {
    const draw = drawRef.current
    if (!draw || draw.getMode() !== 'select') return
    // 스토어 선택이 풀리면(정보 페이지 '목록으로' 등) Terra Draw 선택도 푼다. 안 풀면 TD 는 그 도형을
    // 선택된 채로 들고 있어서, 같은 점을 다시 눌러도 select 이벤트가 오지 않아 정보 페이지가 열리지 않았다.
    const stale = draw.getSnapshot().filter((f) => f.properties.selected && f.id !== selectedId)
    stale.forEach((f) => draw.deselectFeature(f.id as string))
    if (!selectedId) return
    if (draw.hasFeature(selectedId)) {
      try {
        draw.selectFeature(selectedId)
      } catch {
        /* 이미 선택된 경우 무시 */
      }
    }
  }, [selectedId])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" data-testid="map" />
      {!hasBasemapKey && (
        <div className="absolute left-3 top-3 z-10 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          VITE_VWORLD_KEY 가 없어 배경지도가 비어 있습니다. <code>.env</code> 를 확인하세요.
        </div>
      )}
      <div
        className="pointer-events-none absolute bottom-12 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-[12px] text-white backdrop-blur"
        data-testid="map-hint"
      >
        {HINT[drawMode]}
      </div>
      <div
        className="pointer-events-none absolute bottom-2 right-2 z-10 rounded bg-white/85 px-2 py-1 font-mono text-[11px] text-slate-600"
        data-testid="readout"
      >
        {readout}
      </div>
    </div>
  )
}

function modeForGeometry(type: string): string {
  if (type === 'Point') return 'point'
  if (type === 'LineString') return 'linestring'
  return 'polygon'
}

/** Terra Draw 쪽에 들고 있어야 하는 스타일 입력. 스타일 콜백(iconed·layerColor·pointWidth)이 이것을 읽는다. */
function tdStyleProps(f: Feature, colorOf: Map<string, string>, radiusOf: Map<string, number>, sizeRatios: Map<string, number>) {
  const icon = f.properties.icon
  return {
    layerId: f.layerId,
    icon: typeof icon === 'string' ? icon : null,
    color: colorOf.get(f.layerId) ?? null,
    size: f.geometry.type === 'Point' ? dotRadius(sizeRatios.get(f.id), radiusOf.get(f.layerId)) : null,
  }
}
