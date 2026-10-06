/**
 * 사업장 직원 수 (웹 조사 2026-10-06, 사용자 요청). 출처가 있는 곳만 넣었다 — 49곳 중 8곳.
 * 넣지 않은 것: 건물 수용 인원(서초사옥 1만·삼성중공업 1500), 기흥·화성 합계 4만(2019, 나눌 수 없음), 평택(건설 인력뿐),
 * 모델 추정치(Revelio), 전국에 흩어진 회사의 회사 전체 수치(에스원·웰스토리·호텔신라·SK케미칼 등).
 * '회사 전체(DART)' 는 국내 사업장이 사실상 그곳 하나인 회사만. 제일기획·SK바이오팜·삼성바이오로직스는 공시 원문과 대조하지 못했다.
 */
export interface Employees {
  employees: number
  basis: '사업장(공식)' | '사업장(뉴스)' | '회사 전체(DART)'
  asOf: string
  source: string
  note?: string
}

/** 키는 sites.ts 의 title. 없는 제목이면 run.ts 가 멈춘다. */
export const EMPLOYEES: Record<string, Employees> = {
  '삼성전자 수원 디지털시티': { employees: 34000, basis: '사업장(공식)', asOf: '2013', source: 'https://news.samsung.com/kr/%ED%88%AC%EB%AA%A8%EB%A1%9C%EC%9A%B0-%EA%B8%B0%ED%9A%8D-%EC%84%B1%EC%9E%A5-%EC%9E%88%EB%8A%94-%EA%B3%B3%EC%97%90-%EA%B3%A0%EC%9A%A9-%EC%9E%88%EB%8B%A4_%E2%91%A1-%EC%83%9D%EC%82%B0%EB%8B%A8%EC%A7%80', note: '약 3만4000명(2013년 말). 더 최근 수치 없음' },
  '삼성전자 서울 R&D캠퍼스': { employees: 5000, basis: '사업장(뉴스)', asOf: '2016', source: 'https://view.asiae.co.kr/article/2016022411092066364', note: '약 5000명 연구인력(입주 직후 보도)' },
  '삼성SDS 판교 IT캠퍼스': { employees: 2000, basis: '사업장(공식)', asOf: '2022-05', source: 'https://www.samsungsds.com/kr/news/220530SDS_pangyo.html', note: '2,000여 명 집결(회사 보도자료)' },
  '삼성바이오로직스': { employees: 5455, basis: '회사 전체(DART)', asOf: '2025-12', source: 'https://dailypharm.com/user/news/30054', note: '2025 사업보고서, 해외법인 제외. 기사 인용' },
  '제일기획': { employees: 1511, basis: '회사 전체(DART)', asOf: '2025-12', source: 'https://etfshopping.com/stock/030000/company', note: '2025 사업보고서(집계 사이트). 국민연금 기준 1,461(2026-07)' },
  'SK하이닉스 이천캠퍼스': { employees: 30000, basis: '사업장(뉴스)', asOf: '2026-05', source: 'https://www.fnnews.com/news/202605141929534224', note: '하루 평균 약 3만명 상주 — 협력사 포함일 수 있다' },
  'SK바이오사이언스': { employees: 500, basis: '사업장(뉴스)', asOf: '2025-12', source: 'https://www.heraldk.com/article/2025121702200057173', note: '"직원 500여명이 모두 송도로 이동". 안동 공장 제외' },
  'SK바이오팜': { employees: 272, basis: '회사 전체(DART)', asOf: '2025-12', source: 'https://etfshopping.com/stock/326030/company', note: '정규 249·계약 23(집계 사이트)' },
}
