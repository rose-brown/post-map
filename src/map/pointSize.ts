/**
 * 레이어 스타일 `sizeField` 로 포인트 크기를 정한다. 순수 함수 — tests/pointSize.test.ts 가 직접 돌리므로
 * 런타임 import 를 들이지 않는다 (`import type` 만).
 *
 * **로그 비례**로 최솟값 → 0, 최댓값 → 1 에 놓는다. 면적 비례(제곱근)는 최댓값 하나가 크면 나머지가 몰린다 —
 * 세대수로 해 보니 80% 가 4.8~7.6px 에 몰려 구분이 안 됐다 (2026-09-29, 사용자가 로그를 골랐다).
 * 범위는 같은 필드를 쓰는 모든 레이어의 도형으로 잰다 — 레이어마다 따로 재면 레이어끼리 크기를 비교할 수 없다. 숨긴 레이어도 기준에 넣어서
 * 켜고 끌 때 다른 도형 크기가 바뀌지 않게 한다 (바뀌면 Terra Draw 에 도형마다 알려야 해서 느리다).
 */
import type { Feature, Layer } from '../types'

/** 크기 비율 t ∈ [0, 1]. 값이 없거나 양수가 아니면 map 에 넣지 않는다 (= 기본 크기). 값이 모두 같으면 1. */
export function pointSizeRatios(features: Feature[], layers: Layer[]): Map<string, number> {
  const fieldOf = new Map<string, string>()
  for (const l of layers) if (l.style.sizeField) fieldOf.set(l.id, l.style.sizeField)
  const valueOf = (f: Feature): number | undefined => {
    const key = fieldOf.get(f.layerId)
    if (!key || f.geometry.type !== 'Point' || f.derivedFrom) return undefined
    const v = Number(f.properties[key])
    return Number.isFinite(v) && v > 0 ? v : undefined
  }
  const range = new Map<string, { min: number; max: number }>()
  for (const f of features) {
    const v = valueOf(f)
    if (v === undefined) continue
    const key = fieldOf.get(f.layerId)!
    const r = range.get(key)
    range.set(key, r ? { min: Math.min(r.min, v), max: Math.max(r.max, v) } : { min: v, max: v })
  }
  const out = new Map<string, number>()
  for (const f of features) {
    const v = valueOf(f)
    if (v === undefined) continue
    const { min, max } = range.get(fieldOf.get(f.layerId)!)!
    out.set(f.id, max === min ? 1 : Math.log(v / min) / Math.log(max / min))
  }
  return out
}

/** 기본 점 반지름(px)과 비율 → 반지름. 가장 작은 값도 눈에 보이도록 바닥을 둔다. */
export const DOT_RADIUS = 6
export const dotRadius = (t: number | undefined) => (t === undefined ? DOT_RADIUS : Math.round((3 + 11 * t) * 10) / 10)
/** 핀 배율. 숫자가 읽히도록 0.7 아래로는 줄이지 않는다. */
export const pinScale = (t: number | undefined) => (t === undefined ? 1 : Math.round((0.7 + 0.8 * t) * 100) / 100)
