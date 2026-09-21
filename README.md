# 지도 편집 플랫폼 — 개발 프롬프트 세트

범용 지도 편집 플랫폼(벡터 작도 + 공간연산 + 속성 페이지)을 단계적으로 만들기 위한 프롬프트 모음입니다.
`docs/mockup/임장 지도 프로토타입.dc.html`의 "핀 + 노션형 페이지" 개념을 범용 플랫폼으로 확장한 것이 출발점입니다.

## 사용 순서

| 순서 | 파일 | 무엇을 하는 프롬프트인가 | 넣는 곳 |
|---|---|---|---|
| 0 | `docs/prompts/00-공통-컨텍스트.md` | 프롬프트가 아니라 **컨텍스트 블록**. 아래 모든 프롬프트 앞에 그대로 붙입니다. | — |
| 1 | `docs/prompts/01-PRD-생성-프롬프트.md` | PRD(제품 요구사항 문서)를 만들게 함 | Claude (대화) |
| 2 | `docs/prompts/02-Phase1-프로토타입-프롬프트.md` | 실제 지도 위 작도 + 주소검색 + 속성 페이지, 로컬 저장 | Claude Code |
| 3 | `docs/prompts/03-Phase2-레이어-공간연산-프롬프트.md` | 레이어 시스템, 파일 업로드, 버퍼·공간연산, 경로 소요시간 | Claude Code |
| 4 | `docs/prompts/04-Phase3-백엔드-협업-프롬프트.md` *(미작성)* | Supabase + PostGIS, 인증, 팀 공유·권한 | Claude Code |
| 5 | `docs/prompts/05-Phase4-공공데이터-라우팅고도화-프롬프트.md` *(미작성)* | 공공데이터 연동, 등시선, 다대다 행렬 | Claude Code |

각 Phase 프롬프트는 **`docs/prompts/00-공통-컨텍스트.md` 전문 + 해당 Phase 파일 전문**을 이어 붙여서 한 번에 넣는 것을 전제로 씁니다.

## 시작 전에 발급해야 하는 키

| 용도 | 발급처 | 이용허락범위 | Phase |
|---|---|---|---|
| 배경지도 타일 (WMTS/WMS) | VWorld 오픈API (vworld.kr) — 도메인 등록 방식 | 발급 시 약관 확인 | 1 |
| 주소→좌표, 좌표→주소 | **공공데이터포털 — 국토교통부_지오코더 API** | **이용허락범위 제한 없음**, 일 40,000건 | 1 |
| 장소·지명 검색 | **공공데이터포털 — 국토교통부_검색 API** | **이용허락범위 제한 없음** | 1 |
| 경로·소요시간 | Phase 2에서 비교 후 결정 | — | 2 |
| 공공데이터 | data.go.kr, VWorld 데이터 API | 데이터별 상이 | 4 |

지오코딩·검색을 **공공데이터포털 경유로 발급**하는 것을 권합니다. 포털 상세 페이지에 "이용허락범위 제한 없음"이
명시되어 있어서, 응답을 저장·가공해도 되는지가 문서로 확인됩니다. vworld.kr에서 직접 발급받는 경로는
별도 약관이 적용될 수 있으니 그쪽을 쓸 거면 약관을 먼저 읽으세요.

> VWorld 배경지도는 등록한 도메인에서만 호출이 허용되는 방식이라 `localhost` 개발용 도메인을 따로 등록해야 합니다.

### ⚠️ 왜 카카오 로컬 API를 쓰지 않는가

카카오 데브톡의 공식 답변 기준으로, 카카오 **로컬 API 결과는 "어떠한 형태로든 저장하여 사용할 수 없고
실시간 호출로만 이용"**할 수 있습니다. 타사 지도(MapLibre) 위에 표시하는 것 자체는 허용되지만,
검색으로 얻은 장소명·좌표를 기기나 서버에 저장하는 것은 불허입니다.

이 제품은 찍은 지점과 주소를 영구 저장하는 것이 본체이므로, 저장이 필요한 지오코딩은 이용허락범위가
"제한 없음"으로 명시된 공공데이터포털 API로 갑니다. 카카오 API는 쓰더라도 "조회해서 화면에 잠깐 보여주는"
용도에 한정해야 합니다. **경로·소요시간 API도 같은 제약을 받을 수 있으니 Phase 2에서 반드시 확인하세요.**

카카오 정책의 근거는 카카오 데브톡의 담당자 답변 2건입니다. 공식 약관 문서가 아니라 포럼 답변이고
조사 시점은 2026년 9월이므로, 서비스 공개 전에 카카오에 직접 확인하는 편이 안전합니다.

## 이 세트에서 확정한 기술 선택

- **지도 렌더링**: `maplibre-gl` v6 (최신 6.10.0). v5는 2025년 12월, v6는 2026년 7월
- **작도**: `terra-draw` v1 + `terra-draw-maplibre-gl-adapter` v1 (MapLibre 공식 플러그인 목록 등재, peer `maplibre-gl >=4`)
- **공간연산**: `@turf/turf` v7 (프론트) → PostGIS (Phase 3 이후 서버)
- **배경지도·지오코딩·검색**: VWorld 오픈API
- **프레임워크**: Vite + React 19 + TypeScript
- **백엔드**: Supabase (PostgreSQL + PostGIS + Auth + RLS)

선택 근거와 대안 비교는 `docs/prompts/00-공통-컨텍스트.md`의 "기술 선택과 근거"에 있습니다.

---

# Phase 1 앱 실행

이 디렉터리는 이제 프롬프트 세트이면서 동시에 **Phase 1 Vite 프로젝트**입니다.
(프롬프트 세트와 PRD 는 `docs/` 로 옮겼고, dev 서버가 `/docs/prd-view.html` 로 같이 서빙합니다.)

## 1. 키 발급

1. [vworld.kr](https://www.vworld.kr/) 에서 오픈API 인증키를 발급합니다.
2. 사용할 도메인을 등록합니다. 개발용으로 `localhost` 를 반드시 등록하세요.
3. 같은 키가 **배경지도 타일 · 검색 API 2.0 · 지오코더 API 2.0** 에서 모두 동작하는 것을 확인했습니다
   (2026-09-21 실호출 기준).

## 2. 환경변수

```bash
cp .env.example .env
```

| 변수 | 번들 노출 | 용도 |
|---|---|---|
| `VITE_VWORLD_KEY` | **노출됨** | 배경지도 타일. 도메인 등록 방식이라 프록시로 숨길 수 없다 (불변 규칙 4의 명시적 예외) |
| `VWORLD_SEARCH_KEY` | 노출 안 됨 | 검색·지오코딩. `vite.config.ts` 의 dev 프록시가 서버 쪽에서 붙인다 |

> 두 변수에 **같은 키**를 넣으면 타일 쪽에서 이미 노출되므로 프록시가 키를 가려주지 못합니다.
> 운영에서는 타일용과 검색용 키를 따로 발급하세요.

## 3. 실행

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
```

## ⚠️ dev 프록시는 개발 전용입니다

`vite.config.ts` 의 `server.proxy` 는 `vite dev` 에서만 동작합니다.
`npm run build` 산출물에는 프록시가 없어 `/api/vworld/*` 호출이 404 가 됩니다.
**Phase 3 에서 Supabase Edge Function 프록시로 대체**하는 것이 계획입니다.

## 구조

```
map/
├ index.html                  앱 진입점
├ vite.config.ts              dev 프록시 (검색·지오코딩 키를 서버 쪽에서 주입)
├ .env / .env.example
├ src/
│  ├ types.ts                 도메인 모델 (PRD 4.2)
│  ├ persist/persistable.ts   저장 게이트 — 불변 규칙 1을 타입으로 강제
│  ├ db/                      Dexie(IndexedDB), 스키마 버전 + 마이그레이션 자리
│  ├ providers/               BasemapProvider / GeocodingProvider (Phase당 구현체 1개)
│  ├ templates/               도메인 용어는 여기 데이터로만 존재 (불변 규칙 6)
│  ├ map/                     MapLibre + Terra Draw + 측지 동심원
│  ├ ui/                      상단바·도구·레이어 패널·정보 페이지·바텀시트
│  └ export/geojson.ts        GeoJSON 내보내기
└ docs/
   ├ PRD.md                   제품 요구사항 문서
   ├ prd-view.html            PRD 뷰어 (dev 서버에서 /docs/prd-view.html)
   ├ prompts/                 00~03 프롬프트 세트
   ├ mockup/                  디자인 참조 목업 (.dc.html)
   └ screenshots/             Phase 1 검증 스크린샷
```

> `prd-view.html` 은 `PRD.md` 를 상대경로로 `fetch` 합니다. 둘은 같은 폴더에 두세요.
