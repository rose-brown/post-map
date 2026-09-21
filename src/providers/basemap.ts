/**
 * BasemapProvider — 배경지도 제공자 어댑터 경계.
 * 인터페이스만 정의하고 구현체는 Phase 당 하나만 만든다 (과설계 금지). Phase 1 = VWorld.
 */
export interface BasemapProvider {
  readonly id: string
  readonly attribution: string
  readonly maxZoom: number
  list(): BasemapOption[]
}

export interface BasemapOption {
  id: string
  label: string
  /** 아래에서 위로 겹치는 래스터 타일 URL 목록. 위성은 라벨이 없어 Hybrid 를 겹쳐야 한다. */
  tileUrls: string[]
}

/**
 * 불변 규칙 4 의 명시적 예외 — VWorld 배경지도 키는 도메인 등록 방식이라 프록시 뒤로 숨길 수 없고,
 * 타일 URL 에 실려 나가는 것이 정상 사용법이다. 검색·지오코딩 키는 이 예외에 해당하지 않으며
 * vite.config.ts 의 dev 프록시를 경유한다.
 *
 * 엔드포인트·레이어명·타일 순서·줌 범위는 추측하지 않았다. 발급 키로 받은
 * https://api.vworld.kr/req/wmts/1.0.0/{key}/WMTSCapabilities.xml 의 ResourceURL 에서 확인:
 *   템플릿  .../{layer}/{TileMatrix}/{TileRow}/{TileCol}.{ext}   → z/y/x 순서
 *   TileMatrixSet = GoogleMapsCompatible (EPSG:3857, 256px)
 *   최대 줌 19 (z20 은 ExceptionReport / InvalidParameter)
 *   Base·midnight·white·Hybrid = png, Satellite = jpeg
 *
 * (확인 필요) 이용약관·상업적 이용 가능 여부는 vworld.kr 원문을 읽지 못해 여전히 미확인이다 — PRD D-5.
 */
const KEY = import.meta.env.VITE_VWORLD_KEY as string | undefined

const tile = (layer: string, ext: string) =>
  `https://api.vworld.kr/req/wmts/1.0.0/${KEY ?? ''}/${layer}/{z}/{y}/{x}.${ext}`

export const vworldBasemap: BasemapProvider = {
  id: 'vworld',
  attribution:
    '&copy; <a href="https://www.vworld.kr/" target="_blank" rel="noreferrer">VWorld</a> 국토교통부',
  maxZoom: 19,
  list: () => [
    { id: 'Base', label: '일반', tileUrls: [tile('Base', 'png')] },
    {
      id: 'Satellite',
      label: '위성',
      tileUrls: [tile('Satellite', 'jpeg'), tile('Hybrid', 'png')],
    },
    { id: 'Hybrid', label: '하이브리드', tileUrls: [tile('Base', 'png'), tile('Hybrid', 'png')] },
  ],
}

export const hasBasemapKey = Boolean(KEY)
