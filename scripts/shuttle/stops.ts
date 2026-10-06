/**
 * 통근 셔틀 탑승지 (웹 조사 2026-10-06, 사용자 요청). 도메인 값은 여기에만 둔다 (불변 규칙 6).
 * **공식 노선도가 아니다** — 두 회사 모두 노선·정류장을 사내 시스템(하이닉스 앱, 삼성 사내망)에만 둔다.
 * 여기 있는 것은 공개 글에 "셔틀이 선다"고 나온 단지·역뿐이고, 정확한 정류장 위치·노선 경로는 모른다 (점은 단지·역 위치).
 * 좌표: `feature` 는 이 프로젝트에 이미 있는 같은 이름의 도형(월간선도50 단지, 지하철 역)에서, `address` 는 VWorld 지오코딩으로.
 */
export interface Stop {
  title: string
  /** 노선 이름. 하이닉스는 출처(스레드 글)의 권역 묶음, 수원은 지역 — 실제 노선 구분은 모른다 */
  route: string
  /** 소요시간(분). 범위로만 나오면 짧은 쪽 */
  minutes?: number
  source: string
  note?: string
  /** 좌표를 가져올 프로젝트 도형 제목. layerPrefix 를 주면 그 레이어에서만 찾는다 */
  feature?: string
  layerPrefix?: string
  address?: string
  /** 지오코더로 못 찾는 곳만 — 출처의 좌표 [lng, lat] */
  point?: [number, number]
}

export interface StopGroup { layer: string; color: string; idPrefix: string; campus: string; stops: Stop[] }

const THREADS = 'https://www.threads.com/@insight_bts/post/DXJNoMbDqUM'
const CREDIT = 'https://www.creditnews.kr/news/articleView.html?idxno=2745'
const CLIEN = 'https://www.clien.net/service/board/kin/679697'

const HYNIX: Stop[] = [
  { title: '잠실엘스', route: '서울·판교', feature: '잠실엘스', minutes: 55, source: THREADS, note: '스레드 글(2026-04-15) "잠실 엘스·리센츠·트리지움 55분"' },
  { title: '리센츠', route: '서울·판교', feature: '리센츠', minutes: 55, source: THREADS },
  { title: '트리지움', route: '서울·판교', feature: '트리지움', minutes: 55, source: THREADS },
  { title: '헬리오시티', route: '서울·판교', feature: '헬리오시티', minutes: 55, source: THREADS },
  { title: '판교푸르지오그랑블', route: '서울·판교', feature: '판교푸르지오그랑블', minutes: 53, source: THREADS, note: '글에는 "판교 백현8단지 / 푸르지오그랑블" — 백현8단지는 위치를 확정하지 못해 뺐다' },
  { title: '위례센트럴자이', route: '서울·판교', feature: '위례센트럴자이', minutes: 50, source: THREADS },
  { title: '양지마을(1단지금호)', route: '서울·판교', feature: '양지마을(1단지금호)', minutes: 48, source: THREADS, note: '글에는 "분당 수내 양지마을" — 단지는 특정되지 않아 1단지에 찍었다' },
  { title: '산성역포레스티아', route: '서울·판교', feature: '산성역포레스티아', minutes: 35, source: THREADS },
  { title: '고덕그라시움', route: '강동·미사', feature: '고덕그라시움', minutes: 40, source: THREADS },
  { title: '고덕아르테온', route: '강동·미사', feature: '고덕아르테온', minutes: 40, source: THREADS },
  { title: '래미안솔베뉴', route: '강동·미사', feature: '래미안솔베뉴', minutes: 43, source: THREADS },
  { title: '삼익그린맨션(2차)', route: '강동·미사', feature: '삼익그린맨션(2차)', minutes: 42, source: THREADS, note: '명일 삼익 3곳 42~45분' },
  { title: '삼익맨션', route: '강동·미사', feature: '삼익맨션', minutes: 42, source: THREADS, note: '명일 삼익 3곳 42~45분' },
  { title: '삼익파크맨션', route: '강동·미사', feature: '삼익파크맨션', minutes: 42, source: THREADS, note: '명일 삼익 3곳 42~45분' },
  { title: '올림픽파크포레온', route: '강동·미사', address: '서울특별시 강동구 양재대로 1300', minutes: 46, source: THREADS },
  { title: '미사강변푸르지오', route: '강동·미사', feature: '미사강변푸르지오', minutes: 46, source: THREADS, note: '글에는 "하남 미사 푸르지오" — 같은 이름 단지가 여럿일 수 있다' },
  { title: '광교중흥S-클래스', route: '경기남부', feature: '광교중흥S-클래스', minutes: 42, source: THREADS },
  { title: '성복역롯데캐슬골드타운', route: '경기남부', feature: '성복역롯데캐슬골드타운', minutes: 44, source: THREADS, note: '기사(2026-04-20): 삼성전자·하이닉스 셔틀이 모두 정차' },
  { title: '미사강변센트럴자이', route: '강동·미사', feature: '미사강변센트럴자이', source: CREDIT, note: '기사(2026-04-20), 소요시간 없음' },
  { title: '동탄역반도유보라아이비파크5.0', route: '경기남부', address: '경기도 화성시 동탄구 동탄기흥로 393-15', source: CREDIT, note: '기사(2026-04-20): 하이닉스 이천·삼성 화성·수원 셔틀 3개 노선이 교차' },
  { title: '동탄역센트럴푸르지오', route: '경기남부', address: '경기도 화성시 동탄구 동탄순환대로21길 54', source: CREDIT, note: '기사에는 "센트럴푸르지오"(동탄) — 동탄역센트럴푸르지오로 보았다' },
]

const SUWON: Stop[] = [
  { title: '강남역', route: '서울', feature: '강남', layerPrefix: 'lyr_line_02', source: 'https://shuttle-go.com/page/gangnam-station-samsung-electronics-suwon-morning-shuttle/', note: '셔틀Go "강남역 2호선 → 삼성전자 수원 사업장 출근 버스". 정류장 위치는 역으로 갈음' },
  { title: '양재역', route: '서울', feature: '양재', layerPrefix: 'lyr_line_03', minutes: 30, source: CLIEN, note: '커뮤니티 글: 양재에서 30~40분. 지역만 알려져 역에 찍었다' },
  { title: '사당역', route: '서울', feature: '사당', layerPrefix: 'lyr_line_02', source: CLIEN, note: '커뮤니티 글에 탑승 지역으로만 나온다. 역에 찍었다' },
  { title: '동탄역반도유보라아이비파크5.0', route: '동탄', address: '경기도 화성시 동탄구 동탄기흥로 393-15', source: CREDIT, note: '기사(2026-04-20): 하이닉스 이천·삼성 화성·수원 셔틀 3개 노선이 교차' },
]

const PYEONGTAEK: Stop[] = [
  { title: '평택지제역', route: '지제', feature: '평택지제', layerPrefix: 'lyr_line_01', source: 'https://shuttle-go.com/page/pyeongtaek-jije-station-samsung-electronics-pyeongtaek-morning-shuttle/', note: '셔틀Go "평택지제역 → 삼성전자 평택 반도체 사업장 출근 버스". 정류장 위치는 역으로 갈음' },
  { title: '동탄역', route: '동탄', point: [127.095111, 37.201167], source: 'https://shuttle-go.com/page/samsung-electronics-pyeongtaek-dongtan-station-evening-shuttle/', note: '셔틀Go "평택 사업장 → 동탄역 퇴근 버스". 좌표는 위키백과 Dongtan station (VWorld 검색·지오코딩 실패)' },
]

export const GROUPS: StopGroup[] = [
  { layer: 'SK하이닉스 이천 셔틀 탑승지 (비공식)', color: '#ea580c', idPrefix: 'hx', campus: 'SK하이닉스 이천캠퍼스', stops: HYNIX },
  { layer: '삼성전자 수원 셔틀 탑승지 (비공식)', color: '#1d4ed8', idPrefix: 'sw', campus: '삼성전자 수원 디지털시티', stops: SUWON },
  { layer: '삼성전자 평택 셔틀 탑승지 (비공식)', color: '#0891b2', idPrefix: 'pt', campus: '삼성전자 평택캠퍼스', stops: PYEONGTAEK },
]
