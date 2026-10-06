/**
 * 삼성·SK 수도권 주요 사업장 (웹 조사 2026-10-04, 사용자 요청). 도메인 값은 여기에만 둔다 (불변 규칙 6).
 * 주소·회사명은 회사 공식 페이지·공시에서 옮긴 것이다 — 지오코더 응답에서 저장하는 것은 좌표뿐이다 (불변 규칙 1).
 * 도로명주소를 찾지 못한 SK하이닉스 용인 반도체 클러스터(처인구 원삼면 일원, 건설 중)는 넣지 않았다.
 */
export interface Site {
  /** 지도 라벨. 한 건물에 여러 회사가 있으면 대표 이름 */
  title: string
  company: string
  siteType: '본사' | '캠퍼스' | '공장' | '연구소' | '사무소' | '본사(등기)'
  address: string
  /** 도로명 지오코딩이 실패하는 곳만 — 지번으로 다시 찾는다 */
  parcel?: string
  source: string
  note?: string
}

export interface SiteGroup { layer: string; color: string; idPrefix: string; sites: Site[] }

const SAMSUNG: Site[] = [
  { title: '삼성전자 수원 디지털시티', company: '삼성전자', siteType: '본사', address: '경기도 수원시 영통구 삼성로 129', source: 'https://www.samsung.com/sec/aboutsamsung/company/divisions/' },
  { title: '삼성 기흥캠퍼스', company: '삼성전자, 삼성디스플레이', siteType: '캠퍼스', address: '경기도 용인시 기흥구 삼성로 1', source: 'https://semiconductor.samsung.com/kr/about-us/locations/', note: '삼성디스플레이 본사. 삼성2로 95 로 적은 자료도 있다' },
  { title: '삼성전자 화성캠퍼스', company: '삼성전자', siteType: '캠퍼스', address: '경기도 화성시 삼성전자로 1', source: 'https://semiconductor.samsung.com/kr/about-us/locations/', note: 'DSR 반도체연구소 포함' },
  { title: '삼성전자 평택캠퍼스', company: '삼성전자', siteType: '캠퍼스', address: '경기도 평택시 삼성로 114', source: 'https://semiconductor.samsung.com/kr/about-us/locations/', note: '공식 페이지는 고덕면 — 지금은 고덕동' },
  { title: '삼성종합기술원', company: '삼성전자, 삼성SDI', siteType: '연구소', address: '경기도 수원시 영통구 삼성로 130', source: 'https://www.samsungsdi.co.kr/about-sdi/global-network.html', note: '삼성SDI 연구소·전자재료 같은 주소' },
  { title: '삼성 서초사옥', company: '삼성전자, 삼성생명, 삼성증권, 삼성전기', siteType: '사무소', address: '서울특별시 서초구 서초대로74길 11', source: 'https://www.samsungpop.com/customer/counsel/overview.pop', note: '삼성생명·삼성증권 본사, 삼성전기 서울사무소' },
  { title: '삼성전자 서울 R&D캠퍼스', company: '삼성전자', siteType: '연구소', address: '서울특별시 서초구 성촌길 56', source: 'https://research.samsung.com/contact', note: '성촌길 33 으로 적은 자료도 있다' },
  { title: '삼성SDI 본사', company: '삼성SDI', siteType: '본사', address: '경기도 용인시 기흥구 공세로 150-20', source: 'https://www.samsungsdi.co.kr/about-sdi/global-network.html' },
  { title: '삼성SDI 동탄', company: '삼성SDI', siteType: '공장', address: '경기도 화성시 동탄오산로 29', source: 'https://www.samsungsdi.co.kr/about-sdi/global-network.html', note: '공식 페이지 영문 표기를 옮김' },
  { title: '삼성전기 본사', company: '삼성전기', siteType: '본사', address: '경기도 수원시 영통구 매영로 150', source: 'https://samsungsem.com/kr/about-us/company/location.do' },
  { title: '삼성SDS 잠실 서관', company: '삼성SDS', siteType: '본사', address: '서울특별시 송파구 올림픽로35길 125', source: 'https://www.samsungsds.com/us/global_offices/about_global_offices.html' },
  { title: '삼성SDS 잠실 동관', company: '삼성SDS', siteType: '사무소', address: '서울특별시 송파구 올림픽로35길 123', source: 'https://www.samsungsds.com/us/global_offices/about_global_offices.html' },
  { title: '삼성SDS 판교 IT캠퍼스', company: '삼성SDS', siteType: '사무소', address: '경기도 성남시 수정구 창업로 17', source: 'https://www.samsungsds.com/us/global_offices/about_global_offices.html', note: '공식 페이지 영문 표기를 옮김' },
  { title: '삼성SDS 판교 물류캠퍼스', company: '삼성SDS', siteType: '사무소', address: '경기도 성남시 분당구 대왕판교로606번길 10', source: 'https://www.samsungsds.com/us/global_offices/about_global_offices.html', note: '공식 페이지 영문 표기를 옮김' },
  { title: '삼성바이오로직스', company: '삼성바이오로직스', siteType: '본사', address: '인천광역시 연수구 송도바이오대로 300', source: 'https://samsungbiologics.com/contact-us', note: '제2 바이오캠퍼스는 주소 미확인으로 뺐다' },
  { title: '삼성바이오에피스', company: '삼성바이오에피스', siteType: '본사', address: '인천광역시 연수구 송도교육로 76', source: 'https://www.samsungbioepis.com/kr/about/about06.do' },
  { title: '삼성 글로벌엔지니어링센터', company: '삼성물산(건설), 삼성E&A', siteType: '본사', address: '서울특별시 강동구 상일로6길 26', source: 'https://www.samsungcnt.com/about-us/contact-info/location.do' },
  { title: '삼성본관', company: '삼성물산(상사), 삼성카드', siteType: '본사', address: '서울특별시 중구 세종대로 67', source: 'https://www.samsungcnt.com/about-us/contact-info/location.do', note: '상사부문은 2023년 11월 잠실에서 옮겨 왔다' },
  { title: '삼성물산 패션부문', company: '삼성물산(패션)', siteType: '본사', address: '서울특별시 강남구 남부순환로 2806', source: 'https://www.samsungcnt.com/about-us/contact-info/location.do' },
  { title: '에버랜드', company: '삼성물산(리조트)', siteType: '사무소', address: '경기도 용인시 처인구 포곡읍 에버랜드로 199', source: 'https://www.samsungcnt.com/about-us/contact-info/location.do' },
  { title: '삼성화재 본사', company: '삼성화재', siteType: '본사', address: '서울특별시 서초구 서초대로74길 14', source: 'https://www.samsungfire.com/v2/html/company/01/M_010_010_001.html', note: '2024년 건물 매각 보도' },
  { title: '삼성중공업 판교 R&D센터', company: '삼성중공업', siteType: '본사', address: '경기도 성남시 분당구 판교로227번길 23', source: 'https://www.samsungcareers.com/subsid/detail/D60', note: '2024년 12월 세일앤리스백' },
  { title: '제일기획', company: '제일기획', siteType: '본사', address: '서울특별시 용산구 이태원로 222', source: 'http://www.cheil.com/kr/contact/' },
  { title: '에스원', company: '에스원', siteType: '본사', address: '서울특별시 중구 세종대로7길 25', source: 'https://www.s1.co.kr/company/introduction/introduction' },
  { title: '삼성웰스토리', company: '삼성웰스토리', siteType: '본사', address: '경기도 성남시 분당구 구미로 8', source: 'http://samsungwelstory.com/footer/location.do' },
  { title: '호텔신라', company: '호텔신라', siteType: '본사', address: '서울특별시 중구 동호로 249', source: 'https://www.hotelshilla.net/' },
]

const SK: Site[] = [
  { title: 'SK하이닉스 이천캠퍼스', company: 'SK하이닉스', siteType: '캠퍼스', address: '경기도 이천시 부발읍 경충대로 2091', source: 'https://www.skhynix.com/company/UI-FR-CP06/' },
  { title: 'SK하이닉스 분당캠퍼스', company: 'SK하이닉스, SK AX', siteType: '사무소', address: '경기도 성남시 분당구 성남대로343번길 9', source: 'https://www.skhynix.com/company/UI-FR-CP06/', note: 'SK u-타워' },
  { title: 'SK하이닉스 서울사무소', company: 'SK하이닉스', siteType: '사무소', address: '서울특별시 중구 을지로5길 26', source: 'https://www.skhynix.com/company/UI-FR-CP06/', note: '공식 페이지 영문 표기를 옮김' },
  { title: 'SK서린빌딩', company: 'SK㈜, SK이노베이션, SK이노베이션 E&S, SK에너지, SK AX', siteType: '본사', address: '서울특별시 종로구 종로 26', source: 'https://www.sk.co.kr/ko/about/about.jsp' },
  { title: 'SK 판교캠퍼스', company: 'SK㈜, SK AX', siteType: '사무소', address: '경기도 성남시 분당구 판교로255번길 38', source: 'https://www.skax.co.kr/company/office' },
  { title: 'SK온 종로타워', company: 'SK온', siteType: '본사', address: '서울특별시 종로구 종로 51', source: 'http://www.sk-on.com/company/local.asp', note: '출처 약함 — 공시로 교차 확인' },
  { title: 'SK T-타워', company: 'SK텔레콤, SK스퀘어', siteType: '본사', address: '서울특별시 중구 을지로 65', source: 'https://news.sktelecom.com/135329' },
  { title: 'SK텔레콤 분당사옥', company: 'SK텔레콤', siteType: '사무소', address: '경기도 성남시 분당구 황새울로258번길 6', source: 'https://www.114.co.kr/', note: '출처 약함 — 전화번호부·구인공고' },
  { title: 'SK브로드밴드', company: 'SK브로드밴드', siteType: '본사', address: '서울특별시 중구 퇴계로 24', source: 'https://www.skbroadband.com/m/kor/Page.do?menu_id=G01010400' },
  { title: 'SK네트웍스 서울', company: 'SK네트웍스', siteType: '사무소', address: '서울특별시 종로구 청계천로 85', source: 'https://www.sknetworks.com/company/global-network' },
  { title: 'SK네트웍스 본점', company: 'SK네트웍스', siteType: '본사(등기)', address: '경기도 수원시 장안구 경수대로976번길 19', source: 'https://kind.krx.co.kr/', note: '등기 본점. 근무 인원은 서울 오피스가 많을 것' },
  { title: 'SKC 본사', company: 'SKC', siteType: '본사', address: '서울특별시 중구 충무로 15', source: 'http://www.skc.co.kr/kor/corporation/intro/global.do', note: '본사를 수원으로 적은 자료도 있다' },
  { title: 'SKC 수원', company: 'SKC', siteType: '공장', address: '경기도 수원시 장안구 장안로309번길 84', source: 'http://www.skc.co.kr/kor/corporation/intro/global.do' },
  { title: 'SKC 연구소', company: 'SKC', siteType: '연구소', address: '경기도 수원시 장안구 정자로 102', source: 'http://www.skc.co.kr/kor/corporation/intro/global.do', note: '공식 페이지 영문 표기를 옮김' },
  { title: 'SK케미칼', company: 'SK케미칼', siteType: '본사', address: '경기도 성남시 분당구 판교로 310', source: 'https://www.skchemicals.com/support/location_map.aspx' },
  { title: 'SK가스·SK디스커버리', company: 'SK가스, SK디스커버리', siteType: '본사', address: '경기도 성남시 분당구 판교로 332', source: 'https://skgas.co.kr/Company/network_01.html' },
  { title: 'SK가스 평택기지', company: 'SK가스', siteType: '공장', address: '경기도 평택시 포승읍 남양만로 138', parcel: '경기도 평택시 포승읍 원정리 1346', source: 'https://skgas.co.kr/Company/network_01.html' },
  { title: 'SK바이오사이언스', company: 'SK바이오사이언스', siteType: '본사', address: '인천광역시 연수구 연구단지로 38', source: 'https://www.skbioscience.com/kr/ir/info_01', note: '2026년 1월 판교에서 옮겼다' },
  { title: 'SK바이오팜', company: 'SK바이오팜', siteType: '본사', address: '경기도 성남시 분당구 판교역로 221', source: 'https://www.skbp.com/kor/company/network.do' },
  { title: 'SK실트론 서울사무소', company: 'SK실트론', siteType: '사무소', address: '서울특별시 종로구 종로 33', source: 'https://www.skcareersjournal.com/1959', note: '출처 약함 — 그룹 채용 블로그' },
  { title: 'SK에코플랜트', company: 'SK에코플랜트', siteType: '본사', address: '서울특별시 종로구 율곡로2길 19', source: 'https://www.skecoplant.com/contents/contents?menuCode=M7100' },
  { title: 'SK플래닛', company: 'SK플래닛', siteType: '본사', address: '경기도 성남시 분당구 판교로 264', source: 'https://www.skplanet.com/etc/map' },
  { title: 'SK인천석유화학', company: 'SK인천석유화학', siteType: '공장', address: '인천광역시 서해구 봉수대로 415', source: 'https://www.skinnovation.com/company/local.asp', note: '공식 페이지는 서구 — 지금은 서해구' },
]

export const GROUPS: SiteGroup[] = [
  { layer: '삼성 사업장', color: '#1d4ed8', idPrefix: 'ss', sites: SAMSUNG },
  { layer: 'SK 사업장', color: '#ea580c', idPrefix: 'sk', sites: SK },
]
