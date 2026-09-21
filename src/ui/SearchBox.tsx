import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { geocoder, searchAvailable, type GeocodeResult } from '../providers/geocoding'
import { useStore } from '../store/useStore'
import { displayOnly } from '../persist/persistable'

/**
 * 검색 → flyTo → 그 좌표에 point 생성 → 정보 페이지 자동 열림 (완료 기준 5).
 *
 * 불변 규칙 1 이 여기서 눈에 보인다. `geocoder.canPersistResults` 가 false 이므로
 * 제공자가 준 **주소·장소명은 저장하지 않는다**. 저장되는 것은 사용자가 고른 **좌표**뿐이고,
 * 주소는 displayOnly() 로 감싸 화면에만 쓴다.
 *
 * 약관에서 저장 허용이 확인되면 geocoding.ts 의 canPersistResults 를 true 로 바꾸고
 * 아래 `if (geocoder.canPersistResults)` 가지가 살아나 제목·주소가 함께 저장된다.
 */
export function SearchBox({ map }: { map: MapLibreMap | null }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const addFeature = useStore((s) => s.addFeatureFromGeometry)
  const updateFeature = useStore((s) => s.updateFeature)
  const setAddressHint = useStore((s) => s.setAddressHint)
  const select = useStore((s) => s.select)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setOpen(false)
      return
    }

    // 디바운스 300ms
    const t = setTimeout(async () => {
      abort.current?.abort()
      const ctrl = new AbortController()
      abort.current = ctrl
      setBusy(true)
      try {
        const [places, addresses] = await Promise.all([
          geocoder.searchPlace(q, undefined, ctrl.signal).catch(() => []),
          geocoder.searchAddress(q, ctrl.signal).catch(() => []),
        ])
        setResults([...addresses, ...places])
        setCursor(0)
        setOpen(true)
      } finally {
        setBusy(false)
      }
    }, 300)

    return () => clearTimeout(t)
  }, [query])

  const choose = (r: GeocodeResult) => {
    setOpen(false)
    setQuery(r.name)

    map?.flyTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 16) })

    const id = addFeature({ type: 'Point', coordinates: [r.lng, r.lat] })
    if (!id) return

    if (geocoder.canPersistResults) {
      // 저장이 허용된 제공자라면 제목·주소를 그대로 저장한다.
      // 지금 제공자는 canPersistResults: false 라 이 가지는 실행되지 않는다.
      updateFeature(id, { title: r.name, properties: { address: r.address } })
    } else {
      // 저장 금지 제공자 — 좌표만 남기고 주소는 화면 전용으로 보관한다.
      const hint = displayOnly(r.roadAddress || r.address || r.name)
      setAddressHint(id, hint)
    }

    select(id)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || !results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => (c + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => (c - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[cursor])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const addressResults = results.filter((r) => r.origin === 'address')
  const placeResults = results.filter((r) => r.origin === 'place')

  const row = (r: GeocodeResult) => {
    const i = results.indexOf(r)
    return (
      <button
        key={`${r.origin}-${r.id}-${i}`}
        className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left ${
          i === cursor ? 'bg-brand-soft' : 'hover:bg-surface-sub'
        }`}
        onMouseEnter={() => setCursor(i)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => choose(r)}
        data-testid="search-result"
      >
        <span className="text-[13px] font-medium text-ink">{r.name}</span>
        <span className="text-[11px] text-ink-mut">
          {r.roadAddress || r.address}
          {r.category ? ` · ${r.category}` : ''}
        </span>
      </button>
    )
  }

  if (!searchAvailable) {
    // 정적 빌드에는 dev 프록시가 없다. 조용히 실패하는 대신 이유를 밝힌다.
    return (
      <div className="relative min-w-0 flex-1 md:max-w-md" data-testid="search-disabled">
        <div
          className="flex h-9 items-center gap-2 rounded-xl bg-surface-sub px-3 opacity-60"
          title="검색은 개발 서버의 프록시를 경유합니다. 정적 배포본에서는 쓸 수 없습니다."
        >
          <span className="text-sm text-ink-mut">⌕</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-mut">
            이 배포본에서는 검색을 쓸 수 없습니다
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-w-0 flex-1 md:max-w-md">
      <div className="flex h-9 items-center gap-2 rounded-xl bg-surface-sub px-3">
        <span className="text-sm text-ink-mut">⌕</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-[13px]"
          placeholder="주소·장소명으로 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          data-testid="search-input"
        />
        {busy && <span className="text-[11px] text-ink-mut">…</span>}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-11 z-40 max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          {!results.length && (
            <div className="px-3 py-3 text-[12px] text-ink-mut">결과가 없습니다.</div>
          )}

          {addressResults.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold text-ink-mut">주소</div>
              {addressResults.map(row)}
            </>
          )}
          {placeResults.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold text-ink-mut">장소</div>
              {placeResults.map(row)}
            </>
          )}

          {!geocoder.canPersistResults && results.length > 0 && (
            <div className="mt-1 rounded-lg bg-warn-soft px-3 py-2 text-[11px] leading-relaxed text-warn">
              이 제공자는 <code>canPersistResults: false</code> 입니다. 고르면 <b>좌표만</b> 저장되고
              주소·장소명은 저장하지 않습니다 (불변 규칙 1).
            </div>
          )}
        </div>
      )}
    </div>
  )
}
