import circle from '@turf/circle'
import destination from '@turf/destination'
import type { Polygon, Point } from 'geojson'

/**
 * 불변 규칙 3 — 거리·면적은 측지 계산. 픽셀이나 단순 위경도 차를 쓰지 않는다.
 * turf.circle 은 지구 반지름 기준으로 실제 거리를 재서 정점을 놓는다.
 */

export interface Ring {
  radius: number
  label: string
  geometry: Polygon
}

export const radiusLabel = (m: number): string =>
  m >= 1000 ? `${+(m / 1000).toFixed(2)}km` : `${m}m`

export function buildRings(center: [number, number], radii: number[]): Ring[] {
  return [...radii]
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b)
    .map((radius) => ({
      radius,
      label: radiusLabel(radius),
      geometry: circle(center, radius, { units: 'meters', steps: 64 }).geometry,
    }))
}

/** 링마다 반경 라벨을 놓을 지점 — 중심에서 정북으로 radius 만큼. */
export function ringLabelPoints(
  center: [number, number],
  radii: number[],
): Array<{ geometry: Point; label: string }> {
  return [...radii]
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b)
    .map((radius) => ({
      geometry: destination(center, radius, 0, { units: 'meters' }).geometry,
      label: radiusLabel(radius),
    }))
}
