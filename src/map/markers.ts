/**
 * 포인트 표시 아이콘.
 *
 * 구글 지도처럼 좌표 위에 핀을 세우고 그 안에 글리프를 넣는다.
 * 아이콘 정의는 **이 데이터 파일 안에만** 존재한다. 코드는 id 로만 다루고 분기하지 않는다(불변 규칙 6).
 * 집·빌딩·학교 같은 말은 특정 업무 도메인이 아니라 지도 POI 범주라 여기 둬도 된다.
 * 새 아이콘은 이 배열에 항목을 더하면 되고, 지도·목록·선택 UI 가 모두 자동으로 따라온다.
 *
 * `paths` 는 24×24 viewBox 기준 SVG path 의 `d` 값이다. 글자로 충분한 것은 `text` 를 쓴다.
 */
export interface MarkerIcon {
  id: string
  label: string
  paths?: string[]
  text?: string
}

/** 아이콘 없음 = Terra Draw 가 그리는 기본 원점을 그대로 쓴다. */
export const DEFAULT_MARKER = 'dot'

export const MARKER_ICONS: MarkerIcon[] = [
  { id: DEFAULT_MARKER, label: '기본' },
  { id: 'home', label: '집', paths: ['M12 3 2 11.5h3V21h5v-6h4v6h5v-9.5h3z'] },
  {
    id: 'building',
    label: '빌딩',
    paths: [
      'M3 21.5V6.5h8.5v15z',
      'M11.5 21.5V11h9.5v10.5z',
      'M5 9h2v2H5zM8 9h2v2H8zM5 13h2v2H5zM8 13h2v2H8zM14 14h2v2h-2zM18 14h2v2h-2z',
    ],
  },
  {
    id: 'store',
    label: '상점',
    paths: ['M2.5 4.5h19v4h-19z', 'M4.5 9.5h15V21H14v-6h-4v6H4.5z'],
  },
  {
    id: 'school',
    label: '학교',
    paths: ['M12 3.5 1.5 9 12 14.5 22.5 9z', 'M5.5 11.5v4c0 1.9 2.9 3.4 6.5 3.4s6.5-1.5 6.5-3.4v-4L12 15.2z'],
  },
  { id: 'hospital', label: '병원', paths: ['M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z'] },
  { id: 'factory', label: '공장', paths: ['M3 21.5V11l5 3V11l5 3V11l5 3V5.5h3.5v16z'] },
  { id: 'parking', label: '주차', text: 'P' },
  {
    id: 'star',
    label: '관심',
    paths: ['M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.5L12 17.5 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9z'],
  },
  { id: 'flag', label: '깃발', paths: ['M6 2.5h1.7v19H6z', 'M9 3.5h10.5l-2.5 4 2.5 4H9z'] },
]

export const markerById = (id: string | undefined): MarkerIcon | undefined =>
  MARKER_ICONS.find((m) => m.id === id)

export const hasMarker = (id: unknown): id is string =>
  typeof id === 'string' && id !== DEFAULT_MARKER && MARKER_ICONS.some((m) => m.id === id)

/** 핀 하나의 SVG. 48×60 으로 그려서 pixelRatio 2 로 등록하면 화면에서 24×30 이 된다. */
export function pinSvg(icon: MarkerIcon, color: string): string {
  const glyph = icon.text
    ? `<text x="24" y="27" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="16" font-weight="700" fill="${color}">${icon.text}</text>`
    : `<g transform="translate(12 9)" fill="${color}">${(icon.paths ?? [])
        .map((d) => `<path d="${d}"/>`)
        .join('')}</g>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="60" viewBox="0 0 48 60">
<path d="M24 2C13.8 2 5.5 10.3 5.5 20.5c0 12.6 18.5 36 18.5 36s18.5-23.4 18.5-36C42.5 10.3 34.2 2 24 2z" fill="${color}" stroke="#ffffff" stroke-width="2.6" stroke-linejoin="round"/>
<circle cx="24" cy="20.5" r="11.2" fill="#ffffff"/>
${glyph}
</svg>`
}

/** 지도에 등록할 이미지 id. 아이콘과 색 조합마다 하나씩 만든다. */
export const markerImageId = (iconId: string, color: string) =>
  `mk-${iconId}-${color.replace('#', '')}`
