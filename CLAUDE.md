# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 이 저장소의 성격

한 디렉터리에 두 가지가 같이 있다.

1. **Phase 1 앱** (루트) — Vite + React 19 + TS strict + Tailwind v4. `docs/prompts/02-Phase1-...` 의 완료 기준 10개를 충족한다.
2. **프롬프트 세트와 문서** (`docs/`) — 이 제품을 단계적으로 만들기 위한 프롬프트, PRD, 디자인 참조 목업.

`docs/prd-view.html` 은 `PRD.md` 를 **상대경로로 fetch** 한다. 둘을 떼어놓으면 뷰어가 깨진다.

- **git 저장소가 아직 없다.** 커밋을 요청받으면 `git init` 부터 해야 한다.
- Phase 2 를 요청받으면 `docs/prompts/03-Phase2-...` 를 따르되, 이제는 **기존 코드를 확장**하는 것이지
  빈 디렉터리에서 새로 시작하는 것이 아니다.

## 명령

```bash
npm run dev         # Vite dev 서버 (기본 5173). 검색·지오코딩 프록시는 여기서만 동작한다
npm run build       # tsc -b && vite build
npm run typecheck   # tsc -b --noEmit
```

**테스트 러너가 없다.** 단일 테스트를 돌리는 명령도 없다. Phase 1 검증은 Playwright MCP 로 브라우저를 직접
몰아서 했고(완료 기준 10개), 결과 스크린샷이 `docs/screenshots/` 에 있다. 동작을 바꿨으면 같은 방식으로
직접 확인해라 — "타입이 통과하니 된다"로 끝내지 마라. 이 프로젝트에서 실제로 난 버그는 대부분 타입을 통과했다.

**저장 게이트 자체 점검** (불변 규칙 1이 아직 살아 있는지 확인하는 사실상의 테스트):

```bash
cat > src/__gate.ts <<'EOF'
import { fromProvider } from './persist/persistable'
import { geocoder } from './providers/geocoding'
export const x = fromProvider(geocoder, { a: 1 })
EOF
npx tsc -b --force        # TS2345 가 나야 정상 ('false' is not assignable to type 'true')
rm src/__gate.ts
```

## 구현 아키텍처 — 여러 파일을 읽어야 보이는 것

### 저장 게이트 (불변 규칙 1이 타입으로 강제되는 경로)

`persist/persistable.ts` → `providers/geocoding.ts` → `db/repo.ts` 세 파일을 같이 봐야 보인다.

- `repo.ts` 의 모든 저장 함수는 `Persistable<T>` 만 받는다.
- `Persistable<T>` 를 만드는 길은 둘뿐이다: `userInput()` (사용자가 직접 입력·클릭한 값) 과
  `fromProvider(p, v)` — 이때 `p` 는 `ProviderPersistence<true>` 여야 한다.
- `geocoder` 는 `GeocodingProvider<false>` 로 **타입에 박혀** 있다. 저장 경로에 끼우면 컴파일이 깨진다.
- 그래서 검색 결과로 만드는 Feature 는 **좌표만** 저장되고, 주소·장소명은 `displayOnly()` 로 화면에만 쓴다
  (`ui/SearchBox.tsx`, 표시는 `ui/InfoPage.tsx` 의 `address-hint`).

약관에서 저장 허용이 확인되면 `geocoding.ts` 의 `canPersistResults` 한 줄만 `true` 로 바꾸면
`SearchBox` 의 이미 존재하는 분기가 살아나 제목·주소가 함께 저장된다.

### 지오메트리 소유권 — Terra Draw 와 스토어가 나눠 갖는다

가장 헷갈리는 부분이다. `map/MapView.tsx` 와 `store/useStore.ts` 를 같이 읽어야 한다.

- **사용자가 그린 도형**은 Terra Draw 가 소유한다. `idStrategy` 로 TD 의 id 를 우리 `Feature.id` 와
  **같은 값**으로 맞춰 둬서 두 쪽을 id 로 대응시킨다.
- **스토어가 진실의 원천**이다. TD 의 `finish` / `change(type==='update')` 이벤트를 받아 스토어에 반영하고,
  반대로 스토어에 있는데 TD 에 없는 도형(예: 검색으로 만든 point)은 동기화 이펙트가 `addFeatures` 로 채운다.
  이 동기화는 "한 번만 올린다"가 아니라 **매번 빠진 것을 채우는** 방식이어야 한다.
- **동심원 링은 Terra Draw 에 넣지 않는다.** 파생 도형이라 편집 대상이 아니고,
  `rings` / `ringLabels` 라는 별도 MapLibre GeoJSON 소스로 그린다. 그래서 TD 에 올릴 때는 항상
  `!f.derivedFrom` 으로 거른다.
- 링은 `parentId` 로 중심 point 를 참조한다. 중심을 지우면 `removeFeature` 가 cascade 로 같이 지우고,
  중심을 끌면 `change` 핸들러가 링을 다시 그린다.

### 저장 경로 (`db/repo.ts`)

쓰기는 **500ms 디바운스 배치**다. 매 키 입력마다 트랜잭션을 열지 않는다.
따라서 **IndexedDB 를 직접 읽기 직전에는 `flush()` 를 불러야 한다** — 내보내기가 그렇게 한다.
`onSaveState()` 구독이 상단바의 "저장됨 · 방금" 표시를 만든다.

### 지도 준비 시점

`MapView` 의 모든 이펙트는 `mapReady` 상태로 게이트한다. **`map.isStyleLoaded()` 를 게이트로 쓰지 마라** —
타일 로딩 중 false 로 흔들려서, 그걸로 막았더니 동심원이 영구히 렌더되지 않았다.

## 제품 아키텍처 (문서를 읽어야 보이는 부분)

**계층**: `Project → Layer → Feature`. Feature 는 GeoJSON geometry + `properties`(레이어 `PropertySchema` 필드)
+ `blocks`(노션형 자유 블록 배열). `Template` = 스키마 필드 묶음 + 블록 프리셋.
`properties` 는 스키마 필드와 스키마 밖 자유 필드를 **둘 다 허용**하되, 테이블 조회·필터·집계 대상은 스키마 필드뿐이다.
값이 없으면 **키를 아예 저장하지 않는다**(`null` 을 넣지 않는다).

**Phase 경계 = 저장소 경계**: Phase 1~2 는 IndexedDB 만, Phase 3 부터 Supabase + PostGIS.
그래서 지금도 `db/db.ts` 에 스키마 버전과 `db/migrations.ts` 의 순차 업그레이드 함수 자리를 둔다.

**어댑터 경계**: `GeocodingProvider` / `BasemapProvider` 인터페이스로 제공자를 갈아끼운다.
단, **인터페이스만 정의하고 구현체는 Phase당 하나씩만** 만든다 — 과설계 금지가 명시돼 있다.

## 불변 규칙 (어기면 설계가 깨진다)

1. **`canPersistResults`** — 가장 중요한 제약. 저장이 불허인 제공자의 응답이 IndexedDB 로 흘러가면
   **타입 수준에서 막혀야** 한다. 외부 API를 새로 붙일 때마다 저장 허용 여부를 먼저 확인한다.
2. 저장 좌표계는 **EPSG:4326 단일**. 변환은 업로드·표시 단계에서만, 원본 좌표계는 메타데이터로 보존.
3. 거리·면적은 **측지 계산**(`map/rings.ts` 의 `turf.circle`). 픽셀·단순 위경도 차 금지.
4. **API 키를 클라이언트 번들에 넣지 않는다.** Phase 1~2 는 `vite.config.ts` 의 dev 프록시,
   Phase 3 부터 Supabase Edge Function. 도메인 등록 방식 키(VWorld 타일)만 예외이고 그 이유를 주석에 남긴다.
5. 모든 지오메트리는 **GeoJSON** 으로 주고받는다. 내부 표현을 따로 만들지 않는다.
6. **도메인 용어를 코드에 박지 않는다.** 매물·단지·임장 같은 말은 `src/templates/*.ts` 데이터로만 존재하고,
   코드 분기로 도메인을 구분하지 않는다.
7. 모바일 우선. 좁아지면 지도가 줄어드는 게 아니라 패널이 바텀시트가 된다(3단 스냅).
   터치 타깃 44px 은 `pointer: coarse` 미디어쿼리가 아니라 레이아웃 조건으로 보장한다.

## 이미 물린 함정

Phase 1 구현 중 실제로 시간을 잡아먹은 것들이다. 같은 것을 다시 밟지 마라.

- **`optimizeDeps.exclude: ['maplibre-gl']` 를 지우지 마라.** Vite 사전 번들링이 MapLibre 워커 경로를 깨서
  `maplibre-gl-worker.mjs` 가 404 가 된다. 그러면 **벡터 레이어만** 렌더되지 않는다 —
  래스터 배경지도는 멀쩡해서 원인이 안 보인다.
- **Terra Draw 는 소수점 9자리를 넘는 좌표를 조용히 거부한다** (`excessive precision`). VWorld 는 14자리를 준다.
  외부 좌표는 제공자 경계에서 절삭한다. `addFeatures()` 의 반환값(검증 결과)을 버리지 마라.
- **zustand 셀렉터 안에서 파생 배열·객체를 만들지 마라.** 매 렌더마다 새 참조가 나와 무한 루프가 난다.
  스토어에서는 안정적인 배열만 받고 `useMemo` 로 파생해라.
- **`maplibre-gl` v6 에는 default export 가 없다.** `import { Map as MapLibreMap, NavigationControl, ... }`.
- **사각형·원 도구는 드래그가 아니라 클릭 → 이동 → 클릭** 이다. 하단 힌트 알약이 이걸 안내한다.
- **Terra Draw select 모드의 `flags` 는 모드 이름으로 키를 잡는다** (`polygon`, `linestring`, …).
  꼭짓점 편집은 `flags[mode].feature.coordinates.draggable`.
- **HTML5 drag-and-drop 을 쓰지 마라** — 터치에서 동작하지 않는다. 블록 순서 변경은 포인터 이벤트로 구현돼 있다.
- **스토어에서 도형을 지울 때 Terra Draw 에도 알려야 한다.** 스토어·IndexedDB 만 고치면
  도형이 지도에 계속 그려져서 "삭제가 안 된다"로 보인다. 지금은 동기화 이펙트가 양방향이라
  (`syncedIds` 기준으로 고아 제거) 정보 페이지 삭제·레이어 삭제·cascade 가 모두 덮인다.
  새 삭제 경로를 만들 때 이 이펙트를 우회하지 마라.
- **비동기 초기화는 직렬화해야 한다.** `useStore.init()` 은 `initPromise` 로 묶여 있다. 이 가드가 없으면
  StrictMode 이중 마운트가 프로젝트를 두 개 만들고, 도형이 들어간 프로젝트와 화면이 로드한 프로젝트가 갈린다.
- **Playwright 로 지도를 클릭할 때**: 정보 패널이 열리면 지도가 리사이즈되므로 화면 좌표를 **매번 다시** 계산해라.
  패널 폭 전환 애니메이션 중에 측정하면 잘못된 값을 읽는다.

## 확인된 VWorld API 사실 (추측이 아니라 실호출로 확인)

발급 키 하나가 **타일·검색·지오코딩에 모두** 동작한다. 아래는 다시 조사하지 않아도 된다.

- 타일 `https://api.vworld.kr/req/wmts/1.0.0/{key}/{layer}/{z}/{y}/{x}.{ext}` — **z/y/x 순서**,
  GoogleMapsCompatible(EPSG:3857), 최대 줌 19. Base·midnight·white·Hybrid=png, Satellite=jpeg.
  위성에는 지명이 없어 Hybrid 를 겹쳐야 한다.
- 검색 `/req/search` (`type=place` | `type=address` + `category=road|parcel`), 지오코딩 `/req/address`
  (`request=getcoord`), 역지오코딩 (`request=getaddress`, `type=both`). 응답 구조는
  `src/providers/geocoding.ts` 상단 주석에 실측 그대로 적어 뒀다.
- 레이어명·줌 범위의 1차 출처는 `.../WMTSCapabilities.xml` 이다.

**여전히 미확인**: 이용약관 원문·상업적 이용 가능 여부·쿼터 (vworld.kr 크롤링 차단).

## 프롬프트 합성 규칙 (`docs/prompts/` 세트의 핵심 구조)

`00-공통-컨텍스트.md` 는 프롬프트가 아니라 **모든 Phase 프롬프트 앞에 전문이 그대로 붙는 컨텍스트 블록**이다.
실제 투입 단위는 항상 `00 전문 + NN 전문` 이다. 따라서:

- 스택·불변 규칙·데이터 모델처럼 **모든 Phase에 걸리는 내용은 `00`에만** 둔다. Phase 파일에서 재서술하면 중복으로 들어간다.
- Phase 파일은 `완료 기준` → `구현 범위` → `하지 말 것` → `결과 보고` 구조를 지킨다. `하지 말 것`이 Phase 경계를 강제하는 장치다.
- `01`은 대화용(Claude), `02` 이후는 Claude Code 투입용이다.

## 작업 규칙 (`docs/prompts/00-공통-컨텍스트.md`에 명시된 것)

- 요청한 범위만 구현한다. "있으면 좋을 것 같아서" 추가하지 않는다.
- 요청이 잘못됐다고 판단되면 **한 문장으로 말하고 요청한 대로 계속 진행**한다. 임의로 범위를 좁히거나 넓히지 않는다.
- 스텁·`TODO`·플레이스홀더를 남기지 않는다. 해당 Phase 의 완료 기준을 전부 충족시킨다.
- **외부 API 응답 형식을 추측하지 않는다.** 공식 문서를 확인하고, 확인 불가하면 그 지점을 코드 주석과 최종 보고에 명시한다.
- 문서는 필요한 만큼만. 커밋은 기능 단위로 쪼갠다.

## `docs/mockup/임장 지도 프로토타입.dc.html`

Design Compiler 목업(`<x-dc>` + `text/x-dc` 스크립트)이다. **실행 가능한 소스가 아니고, 로컬에서 렌더되지도 않는다** —
참조하는 `./support.js` 와 `_ds/wanted-design-system-.../` 가 이 디렉터리에 없다.
임장(부동산) 도메인에 하드코딩돼 있고(`PROP_PRESETS`, `TEMPLATES`, `SEED`), 지도는 좌표가 아니라 `x`/`y` 퍼센트 가짜 지도다.

**계승하는 것은 UI 구조뿐이다**: 핀 선택 → 정보 페이지 → 속성 목록 + 노션형 블록 편집, 템플릿 1클릭 적용, 하단 힌트 알약.
도메인 하드코딩은 스키마·템플릿 데이터로 치환한다.
(갤러리를 `readAsDataURL` 로 다루는 것도 목업 한정이다. 실제 구현은 Blob + `URL.createObjectURL` 이고,
`data:` URL 로 저장하면 IndexedDB 용량이 부푼다.)

## 알려진 불일치·미해결

- `README.md` 의 사용 순서 표가 `04-Phase3-...`·`05-Phase4-...` 를 가리키지만 두 파일은 아직 없다. 존재하는 것은 `00`~`03` 이다.
- `canPersistResults` 가 `false` 라 검색 결과의 주소·장소명이 저장되지 않는다 (위 "확인된 VWorld API 사실" 참조).
- `.env` 의 타일 키와 검색 키가 같은 값이면 타일 쪽에서 이미 노출되므로 dev 프록시가 키를 가려주지 못한다.
  운영 전에 별도 발급이 필요하다.
- 번들이 1.59MB(gzip 434KB)이고 코드 스플리팅을 하지 않았다.
- 레이어 숨김이 Terra Draw 가 그리는 도형에는 적용되지 않는다 (TD 에 레이어 개념이 없다).
- 목록은 `ui/FeatureList.tsx` 가 우측 패널(모바일은 바텀시트)에 상시 띄운다. 행을 누르면
  point 는 `flyTo`, 나머지는 bbox `fitBounds` 로 이동한 뒤 정보 페이지를 연다.
  정렬·필터가 붙는 **테이블 뷰**는 여전히 Phase 2 다.
