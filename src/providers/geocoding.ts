import type { ProviderPersistence } from '../persist/persistable'

/**
 * GeocodingProvider — 지오코딩·검색 제공자 어댑터 경계.
 * 인터페이스만 정의하고 구현체는 Phase 당 하나만 만든다. Phase 1 = VWorld.
 */
export interface GeocodeResult {
  id: string
  /** 장소명 또는 도로명주소 */
  name: string
  /** 지번주소 */
  address: string
  roadAddress?: string
  lng: number
  lat: number
  category?: string
  /** 어느 경로에서 나온 결과인지 화면에 표시하기 위한 구분 */
  origin: 'place' | 'address'
}

export interface GeocodingProvider<CanPersist extends boolean = boolean>
  extends ProviderPersistence<CanPersist> {
  searchAddress(query: string, signal?: AbortSignal): Promise<GeocodeResult[]>
  searchPlace(query: string, near?: [number, number], signal?: AbortSignal): Promise<GeocodeResult[]>
  reverse(lng: number, lat: number): Promise<GeocodeResult | null>
}

/* ------------------------------------------------------------------ *
 * VWorld 구현
 *
 * 엔드포인트·파라미터·응답 구조는 추측하지 않았다. 발급 키로 실제 호출해 확인한 것만 쓴다:
 *
 *  검색   GET /req/search   service=search request=search version=2.0 crs=EPSG:4326
 *                            query= type=place|address [category=road|parcel] size= page= format=json
 *         → response.status = "OK" | "NOT_FOUND" | ...
 *           response.result.items[] = { id, title?, category?, address:{road,parcel,...}, point:{x,y} }
 *           (type=address 인 항목에는 title 이 없고 address.road / address.parcel 만 온다)
 *
 *  지오코딩 GET /req/address  service=address request=getcoord version=2.0 crs=epsg:4326
 *                            address= type=road|parcel refine=true simple=false format=json
 *         → response.result.point {x,y}, response.refined.text
 *
 *  역지오코딩 GET /req/address service=address request=getaddress version=2.0 crs=epsg:4326
 *                            point="lng,lat" type=both format=json
 *         → response.result[] = { type:'parcel'|'road', text, zipcode, structure{...} }
 *
 * 호출은 모두 dev 프록시(/api/vworld/*)를 경유한다 — 키를 번들에 넣지 않기 위해서다 (불변 규칙 4).
 * ------------------------------------------------------------------ */

type VwPoint = { x: string; y: string }

interface VwSearchItem {
  id: string
  title?: string
  category?: string
  address?: { road?: string; parcel?: string; bldnm?: string; zipcode?: string }
  point: VwPoint
}

interface VwSearchResponse {
  response?: {
    status?: string
    result?: { items?: VwSearchItem[] }
  }
}

interface VwAddressResponse {
  response?: {
    status?: string
    refined?: { text?: string }
    result?: { point?: VwPoint } | Array<{ type?: string; text?: string; zipcode?: string }>
  }
}

const SEARCH_URL = '/api/vworld/search'
const ADDRESS_URL = '/api/vworld/address'

/**
 * 검색·지오코딩은 dev 프록시를 경유한다(불변 규칙 4). 정적 호스팅(GitHub Pages)에는
 * 그 프록시가 없어 호출이 전부 404 가 되므로, 있을 때만 켠다.
 * 직접 프록시를 세웠다면 VITE_SEARCH_PROXY=true 로 강제로 켤 수 있다.
 * Phase 3 에서 Supabase Edge Function 이 붙으면 이 플래그는 사라진다.
 */
export const searchAvailable =
  import.meta.env.DEV || import.meta.env.VITE_SEARCH_PROXY === 'true'

async function getJson<T>(url: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${url}?${qs}`, { signal })
  if (!res.ok) throw new Error(`VWorld ${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

/**
 * VWorld 는 좌표를 소수점 14자리까지 준다. Terra Draw 는 9자리를 넘으면
 * "Feature has coordinates with excessive precision" 으로 피처를 **조용히 거부**한다.
 * 9자리면 약 0.1mm 라 실질적인 정밀도 손실이 없다.
 */
const PRECISION = 9
const trim = (n: number) => Number(n.toFixed(PRECISION))

function toResult(item: VwSearchItem, origin: 'place' | 'address'): GeocodeResult {
  const road = item.address?.road ?? ''
  const parcel = item.address?.parcel ?? ''
  return {
    id: item.id,
    name: item.title || road || parcel || '이름 없음',
    address: parcel,
    roadAddress: road || undefined,
    lng: trim(Number(item.point.x)),
    lat: trim(Number(item.point.y)),
    category: item.category,
    origin,
  }
}

/**
 * 역지오코딩 결과 좌표 기준 로컬 캐시.
 * 지오코더는 일 40,000건 제한이 있으므로 같은 지점을 반복 호출하지 않는다.
 * 소수점 5자리(약 1m)로 양자화해 키를 만든다.
 */
const reverseCache = new Map<string, GeocodeResult | null>()
const cacheKey = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`

class VWorldGeocoder implements GeocodingProvider<false> {
  readonly id = 'vworld'

  /**
   * 약관을 확인하지 못했으므로 false 다 — 불변 규칙 1.
   *
   * vworld.kr 이 크롤링을 막아 오픈API 이용약관 원문을 읽지 못했다 (PRD D-5, 부록 A).
   * "확인 못했으니 아마 될 것"으로 true 를 박으면 제품의 핵심 전제가 무너지므로 보수적으로 false 다.
   * 약관에서 저장 허용이 확인되면 이 값을 true 로 바꾸고 아래 컴파일 타임 검증의 주석을 풀면 된다.
   * 그 한 줄만으로 검색 결과의 주소·장소명이 저장 경로로 들어간다.
   */
  readonly canPersistResults = false as const

  async searchPlace(query: string, _near?: [number, number], signal?: AbortSignal): Promise<GeocodeResult[]> {
    if (!searchAvailable) return []
    const json = await getJson<VwSearchResponse>(
      SEARCH_URL,
      {
        service: 'search',
        request: 'search',
        version: '2.0',
        crs: 'EPSG:4326',
        size: '8',
        page: '1',
        query,
        type: 'place',
        format: 'json',
        errorformat: 'json',
      },
      signal,
    )
    if (json.response?.status !== 'OK') return []
    return (json.response.result?.items ?? []).map((i) => toResult(i, 'place'))
  }

  async searchAddress(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
    if (!searchAvailable) return []
    // 도로명과 지번은 요청 category 가 갈린다. 둘 다 시도해 합치고, 어느 쪽에서 나왔는지는
    // roadAddress 유무로 UI 에서 구분한다.
    const ask = (category: 'road' | 'parcel') =>
      getJson<VwSearchResponse>(
        SEARCH_URL,
        {
          service: 'search',
          request: 'search',
          version: '2.0',
          crs: 'EPSG:4326',
          size: '5',
          page: '1',
          query,
          type: 'address',
          category,
          format: 'json',
          errorformat: 'json',
        },
        signal,
      ).catch(() => ({}) as VwSearchResponse)

    const [road, parcel] = await Promise.all([ask('road'), ask('parcel')])
    const items = [
      ...(road.response?.status === 'OK' ? (road.response.result?.items ?? []) : []),
      ...(parcel.response?.status === 'OK' ? (parcel.response.result?.items ?? []) : []),
    ]

    const seen = new Set<string>()
    return items
      .map((i) => toResult(i, 'address'))
      .filter((r) => {
        const k = `${r.lng.toFixed(6)},${r.lat.toFixed(6)}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
  }

  async reverse(lng: number, lat: number): Promise<GeocodeResult | null> {
    if (!searchAvailable) return null
    const key = cacheKey(lng, lat)
    if (reverseCache.has(key)) return reverseCache.get(key) ?? null

    try {
      const json = await getJson<VwAddressResponse>(ADDRESS_URL, {
        service: 'address',
        request: 'getaddress',
        version: '2.0',
        crs: 'epsg:4326',
        point: `${lng},${lat}`,
        type: 'both',
        format: 'json',
        simple: 'false',
      })

      const rows = Array.isArray(json.response?.result) ? json.response.result : []
      if (json.response?.status !== 'OK' || !rows.length) {
        reverseCache.set(key, null)
        return null
      }

      const parcel = rows.find((r) => r.type === 'parcel')?.text ?? ''
      const road = rows.find((r) => r.type === 'road')?.text ?? ''
      const result: GeocodeResult = {
        id: `rev_${key}`,
        name: road || parcel,
        address: parcel,
        roadAddress: road || undefined,
        lng,
        lat,
        origin: 'address',
      }
      reverseCache.set(key, result)
      return result
    } catch {
      // 역지오코딩이 실패해도 작도는 성공해야 한다.
      reverseCache.set(key, null)
      return null
    }
  }
}

export const geocoder: GeocodingProvider<false> = new VWorldGeocoder()

/* ------------------------------------------------------------------ *
 * 컴파일 타임 검증 — 불변 규칙 1
 *
 * 아래 주석을 풀면 타입 에러가 난다:
 *
 *   import { fromProvider } from '../persist/persistable'
 *   fromProvider(geocoder, { title: '저장하면 안 되는 값' })
 *   //           ^^^^^^^^ Argument of type 'GeocodingProvider<false>' is not assignable to
 *   //                    parameter of type 'PersistingProvider'.
 *   //                    Types of property 'canPersistResults' are incompatible.
 *   //                    Type 'false' is not assignable to type 'true'.
 *
 * 즉 `canPersistResults: false` 인 제공자의 응답은 저장 경로(saveFeature 등)에 **넣을 수 없다**.
 * 검색 결과로 만드는 Feature 는 좌표(사용자가 고른 지점)만 userInput() 으로 저장하고,
 * 주소·장소명은 displayOnly() 로 화면에만 쓴다. src/ui/SearchBox.tsx 참조.
 * ------------------------------------------------------------------ */
