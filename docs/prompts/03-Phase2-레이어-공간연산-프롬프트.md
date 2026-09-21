# 03 — Phase 2: 레이어 시스템, 공간연산, 경로

> 넣는 곳: Claude Code (Phase 1 리포지토리에서 이어서).
> `00-공통-컨텍스트.md` 전문을 앞에 붙이고, 아래를 이어서 넣으세요.

---

Phase 1이 완료된 리포지토리에서 **Phase 2**를 구현해줘. 여전히 백엔드는 없고 데이터는 브라우저에 있다.

## 완료 기준

1. GeoJSON / KML / SHP(zip) / CSV 파일을 드래그앤드롭하면 레이어로 올라온다
2. 좌표계가 EPSG:5179·5186·5174 인 SHP 도 올바른 위치에 뜬다
3. 선택한 polygon 이나 line 에 거리 버퍼를 걸어 새 도형을 만든다 (음수 입력 시 축소)
4. 두 polygon 을 골라 합집합·교차·차집합을 실행하고 결과를 새 피처로 저장한다
5. 도형의 면적(㎡·평·㎢)과 길이(m·km)가 정보 페이지에 자동 표시된다
6. 배경지도를 VWorld 외 다른 타일·WMS 로 바꾸거나 겹칠 수 있다
7. 지도에서 두 지점을 찍으면 경로와 소요시간·거리가 표시된다 (자동차·도보)
8. 레이어를 테이블 뷰로 보고, 속성으로 필터·정렬하고, 행을 클릭하면 지도에서 해당 도형이 선택된다

## 구현 범위

### 1. 파일 업로드 레이어

지원 포맷과 파서:

| 포맷 | 파서 | 주의 |
|---|---|---|
| GeoJSON / JSON | 내장 | FeatureCollection·Feature·GeometryCollection 모두 수용 |
| KML / KMZ | `@tmcw/togeojson` (KMZ는 unzip 선행) | |
| SHP (zip) | `shpjs` 또는 `shapefile` | .dbf 인코딩이 CP949인 경우가 많다 |
| CSV | `papaparse` | 위경도 컬럼 자동 탐지 + 수동 지정 UI |

- **좌표계 처리**: `.prj` 가 있으면 읽어서 proj4 로 변환. 없으면 사용자에게 선택 UI 를 띄운다
  (WGS84 4326 / 중부원점 5186 / UTM-K 5179 / 구 중부원점 5174). 좌표값 범위로 추정해서 기본값을 제안해라
- **DBF 인코딩**: UTF-8 로 읽어 깨지면 CP949(EUC-KR)로 재시도. 사용자가 수동 전환할 수 있게 해라
- 업로드 후: 속성 컬럼을 스캔해서 **스키마를 자동 생성**(타입 추론: 숫자/날짜/문자). 사용자가 수정 가능
- 파일 크기 상한을 두고(예: 50MB) 초과 시 안내. 파싱은 Web Worker 에서 해서 UI 가 멈추지 않게
- 피처 수가 많으면(임계값 예: 5,000) 자동으로 클러스터링 또는 심볼 단순화로 전환

### 2. 공간 연산

`src/lib/geo/` 에 순수 함수로 모으고, UI 는 이 함수들만 호출한다.

- `buffer(feature, distanceMeters)` — Turf `buffer`. 음수 지원. **폴리곤 축소 시 결과가 비는 경우를 처리**해라
- `union / intersect / difference(a, b)` — 결과가 null 일 수 있다. 사용자에게 "겹치는 영역이 없습니다"로 알려라
- `area(feature)` — ㎡ 기본, 평(÷3.3058)·㎢ 병기
- `length(feature)` — m / km
- `concentricRings(center, radii[])` — Phase 1 것을 여기로 이동
- 모든 연산은 **결과를 새 피처로 만들고 원본은 보존**한다. 정보 페이지에 `생성 방식` 메타를 남겨라 (예: `buffer(F-12, 300m)`)
- 연산 UI: 도형 선택 → 우클릭 메뉴 또는 도구 패널에서 연산 선택 → 미리보기 → 확정
- 되돌리기(Undo/Redo) 스택을 여기서 도입해라. 작도·편집·연산 모두 대상

### 3. 배경지도·타일 레이어

- `BasemapProvider` 인터페이스로 배경지도 목록 관리
- 기본 제공: VWorld 일반/위성/하이브리드, OSM 표준 타일
- **사용자 정의 타일 추가**: XYZ URL 템플릿 입력 → 래스터 레이어로 추가
- **WMS 레이어 추가**: GetCapabilities URL 을 입력받아 레이어 목록을 파싱하고 고를 수 있게. MapLibre 는 WMS 를 `raster` 소스의 `GetMap` URL 로 붙인다
- 타일 레이어도 레이어 패널에서 순서·투명도 조절 가능

### 4. 경로·소요시간

- `RoutingProvider` 인터페이스 정의 후 구현체 **하나만** 만든다

```ts
interface RoutingProvider {
  readonly id: string
  readonly canPersistResults: boolean   // 응답을 저장해도 되는 제공자인가
  route(opts: {
    origin: [number, number]
    destination: [number, number]
    waypoints?: [number, number][]
    mode: 'driving' | 'walking' | 'transit' | 'cycling'
    departAt?: Date
  }): Promise<RouteResult>
}
interface RouteResult {
  geometry: GeoJSON.LineString
  distanceMeters: number
  durationSeconds: number
  mode: string
  steps?: { instruction: string; distanceMeters: number }[]
  provider: string
  fetchedAt: string
}
```

**제공자 선택은 구현 전에 확인하고 보고해라. 비교 항목의 1순위는 요금이 아니라 "응답 결과를 저장해도 되는가"다.**

카카오는 로컬 API에 대해 "결과값은 어떠한 형태로든 저장하여 사용할 수 없고 실시간 호출로만 이용할 수 있다"는
입장을 공식 답변으로 밝힌 바 있고, 경로 API의 소요시간을 가공해 저장하는 것도 불허로 답변한 사례가 있다.
이 제약이 경로 제공자에도 그대로 적용되는지 각 사에 확인해라.

비교표 항목: **응답 저장 허용 여부** → 무료 제공량 → 경유지 수 → 지원 이동수단 → 응답 좌표계 → 폐쇄망 대응.
(참고: 2026년 7월 21일부터 카카오맵 API 무료 쿼터 정책이 바뀌었고, 대중교통·도보·자전거 경로 API가
각 1,000건/일 무료, 초과 시 건당 10원 기준으로 공지된 바 있다. 실제 적용 시점의 문서를 다시 확인해라.)

저장 가능 여부에 따라 동작이 갈린다:
- **저장 허용 제공자** → 경로를 레이어 피처로 저장하고, 정보 페이지에 소요시간·거리·조회 시각·제공자를 기록
- **저장 불가 제공자** → 경로를 저장하지 않고 세션 메모리에만 두며, 화면을 떠나면 사라진다. 대신 출발·도착
  지점(내 피처)만 저장해두고 필요할 때 재조회한다. UI에 "이 값은 저장되지 않습니다"를 명시해라

`canPersistResults` 값에 따라 위 두 경로가 갈리도록 구현하고, 저장 불가 제공자의 응답이 IndexedDB 로
흘러가지 않는지 확인해라.

- API 키는 Vite dev 프록시 경유. 프로덕션 대응은 Phase 3

### 5. 테이블 뷰

- 레이어를 표로 표시. 컬럼 = 스키마 필드. 가상 스크롤(TanStack Virtual)
- 필터: 타입별 연산자 (숫자 `> < = between`, 텍스트 `포함 일치`, 날짜 `기간`, select `in`)
- 정렬, 컬럼 표시/숨김
- **지도 ↔ 테이블 양방향 선택 연동**. 지도에서 고르면 행이 하이라이트되고 스크롤되며, 반대도 성립
- 지도 화면 영역(bbox) 내 피처만 보기 토글
- 선택한 행들만 CSV / GeoJSON 으로 내보내기
- 모바일에서는 테이블 뷰를 전체화면 모달로

### 6. Phase 1 부채 정리

- Undo/Redo 도입에 맞춰 상태 갱신 경로를 정리
- IndexedDB 스키마 버전 올리고 마이그레이션 함수 실제로 작성
- 피처 수 증가에 대비해 MapLibre 소스 갱신을 **전체 교체가 아닌 변경분 갱신**으로 바꿔라

## 하지 말 것

- 로그인·백엔드·공유
- 등시선, 다대다 행렬, 출발시각 기준 도착시각
- 공공데이터 API 연동 (Phase 4)
- PostGIS·벡터타일 서빙

## 결과 보고

- 완료 기준 8개 각각의 확인 결과
- 경로 API 제공자 비교표(응답 저장 허용 여부 포함)와 최종 선택 근거
- 저장 불가 제공자를 골랐다면, 저장 경로가 실제로 차단되는지 확인한 방법
- 좌표계 변환을 실제 SHP 파일로 검증했는지, 어떤 EPSG 로 검증했는지
- 피처 수 몇 개까지 부드럽게 동작하는지 측정값
