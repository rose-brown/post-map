import type { FeatureCollection, Feature as GjFeature } from 'geojson'
import type { Feature, Layer } from '../types'

/**
 * 불변 규칙 5 — 모든 지오메트리는 GeoJSON 으로 주고받는다. 내부 표현을 따로 만들지 않는다.
 * 불변 규칙 2 — 저장 좌표계는 EPSG:4326 단일이므로 변환 없이 그대로 내보낸다.
 *
 * 속성은 properties 에 평탄화하고, 블록은 `_blocks` 키에 JSON 으로 넣되 옵션으로 제외할 수 있다.
 */
export interface ExportOptions {
  includeBlocks: boolean
}

export function toFeatureCollection(
  features: Feature[],
  layers: Layer[],
  { includeBlocks }: ExportOptions,
): FeatureCollection {
  const layerName = new Map(layers.map((l) => [l.id, l.name]))

  return {
    type: 'FeatureCollection',
    features: features.map<GjFeature>((f) => ({
      type: 'Feature',
      id: f.id,
      geometry: f.geometry,
      properties: {
        ...f.properties,
        _id: f.id,
        _layer: layerName.get(f.layerId) ?? f.layerId,
        _title: f.title,
        ...(f.parentId ? { _parentId: f.parentId } : {}),
        ...(f.derivedFrom ? { _derivedFrom: f.derivedFrom } : {}),
        ...(includeBlocks ? { _blocks: JSON.stringify(f.blocks) } : {}),
      },
    })),
  }
}

export function download(filename: string, collection: FeatureCollection): void {
  const blob = new Blob([JSON.stringify(collection, null, 2)], {
    type: 'application/geo+json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // revoke 를 다음 틱으로 미룬다 — 즉시 해제하면 일부 브라우저에서 저장이 취소된다.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
