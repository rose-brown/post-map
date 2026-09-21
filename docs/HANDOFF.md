# 인수인계 — 2026-09-21

다른 세션에서 이어서 작업하기 위한 기록. **먼저 `CLAUDE.md` 를 읽어라.**
이 문서는 "지금 어디까지 했고 다음에 뭘 해야 하는가"만 담는다.

---

## 지금 상태 한 줄

Phase 1 앱은 **완성·검증 완료**. GitHub 저장소는 만들어졌고 코드는 push 됐지만,
**CI 워크플로 커밋이 아직 push 되지 않았고 Pages 도 켜지지 않았다.**

---

## 1. 막혀 있는 것 — 여기서부터 시작하면 된다

### 1-1. `workflow` 스코프가 없어 CI 커밋을 push 하지 못함

`gh auth login` 으로 받은 토큰 스코프가 `gist, read:org, repo` 라
`.github/workflows/deploy.yml` 을 밀 수 없다. 에러:

```
! [remote rejected] HEAD -> main
  (refusing to allow an OAuth App to create or update workflow
   `.github/workflows/deploy.yml` without `workflow` scope)
```

**해결 — 사용자가 직접 실행해야 한다 (브라우저 인증):**

```
! "C:\Program Files\GitHub CLI\gh.exe" auth refresh -h github.com -s workflow
```

그 다음 이어서:

```bash
GH="/c/Program Files/GitHub CLI/gh.exe"
cd "C:/Users/Metanet/Desktop/Hyeran/1_AI자동화/map"

git push -u origin main                      # ci 커밋까지 올린다

# 타일 키를 CI 시크릿으로 (.env 의 VITE_VWORLD_KEY 값)
"$GH" secret set VITE_VWORLD_KEY --body "B29A6DC8-CA01-46CC-B1BB-8B191EB50AF2"

# Pages 를 Actions 소스로 활성화
"$GH" api repos/rose-brown/post-map/pages -X POST -f build_type=workflow

# 배포 확인
"$GH" run list --limit 3
```

배포 주소: **https://rose-brown.github.io/post-map/**

### 1-2. VWorld 에 도메인 등록이 필요하다 (사용자 작업)

VWorld 타일 키는 **도메인 등록 방식**이다. vworld.kr 의 키 관리에서
**`rose-brown.github.io`** 를 등록하지 않으면 **배포본에서 배경지도가 비어 보인다.**
(로컬 `localhost` 는 이미 동작 확인됨.)

---

## 2. 저장소 정보

| 항목 | 값 |
|---|---|
| 계정 | `rose-brown` (Hye Ran Keum) |
| 저장소 | https://github.com/rose-brown/post-map (Public) |
| 기본 브랜치 | `main` |
| 배포 예정 주소 | https://rose-brown.github.io/post-map/ |
| gh CLI | `C:\Program Files\GitHub CLI\gh.exe` (2.101.0, winget 설치) |

**커밋 3개** (`.env` 는 `.gitignore` 로 제외 확인함)

```
9acbe21  ci: GitHub Pages 배포 워크플로          ← 아직 push 안 됨 (workflow 스코프 필요)
7332260  feat: Phase 1 지도 편집 앱              ← push 됨
f8218dd  docs: 프롬프트 세트·PRD·디자인 목업     ← push 됨
```

초기 임포트라 "각 커밋이 독립적으로 빌드되는" 단위로 3개만 나눴다.

---

## 3. 이번 세션에서 한 일

### 3-1. Phase 1 구현 (완료 기준 10개 전부 Playwright 로 검증)

VWorld 배경지도 3종 · 5종 작도 · 꼭짓점 편집 · 측지 동심원 · 검색 · 정보 페이지 ·
템플릿 · IndexedDB 영속 · 모바일 바텀시트 · GeoJSON 내보내기.
검증 스크린샷은 `docs/screenshots/`.

### 3-2. 그 뒤 추가한 것

- **기록 목록 패널** (`src/ui/FeatureList.tsx`) — 우측에 상시 표시, 목록 ↔ 정보 페이지 전환.
  행을 누르면 point 는 `flyTo`, 나머지는 bbox `fitBounds`. 모바일은 하단 `목록` 버튼 → 바텀시트.
- **포인트 표시 아이콘** (`src/map/markers.ts`, `src/ui/MarkerPicker.tsx`) — 집·빌딩·상점·학교·
  병원·공장·주차·관심·깃발 + 기본, 총 10종. 구글 지도식 핀을 SVG 로 만들어
  `map.addImage` 로 등록하고 `point-icons` 심볼 레이어로 그린다.
  아이콘이 붙은 점은 Terra Draw 의 기본 원을 `pointOpacity: 0` 으로 감춘다.
- **파일 정리** — 프롬프트·PRD·목업·스크린샷을 `docs/` 아래로 이동, 문서 내 경로 참조 갱신.
- **`CLAUDE.md` 전면 개정** — 구현 아키텍처, 이미 물린 함정, 확인된 VWorld API 사실 추가.

### 3-3. 고친 버그 (전부 재현 → 수정 → 검증함)

| 버그 | 원인 |
|---|---|
| 벡터 레이어만 렌더 안 됨 | Vite 사전 번들링이 MapLibre 워커를 깨뜨림 → `optimizeDeps.exclude: ['maplibre-gl']` |
| 프로젝트가 2개 생성 | StrictMode 이중 `init()` → `initPromise` 로 직렬화 |
| 패널 무한 렌더 크래시 | zustand 셀렉터에서 파생 배열 생성 → `useMemo` |
| 검색 point 가 지도에 안 보임 | Terra Draw 가 소수점 9자리 초과 좌표를 조용히 거부 → 제공자에서 절삭 |
| 삭제 도구 무반응 | `getFeaturesAtPointerEvent` 가 선을 못 잡음 → `getFeaturesAtLngLat` |
| **정보 페이지 `삭제` 가 지도에 반영 안 됨** | 스토어만 지우고 Terra Draw 에 안 알림 → 동기화 이펙트를 **양방향**으로 (`syncedIds` 고아 제거) |
| **레이어 색 변경이 도형에 반영 안 됨** | `updateFeatureProperties` 는 값이 바뀌어야 restyle → `color` 를 속성에 밀어넣음 |
| 블록 드래그가 터치에서 불가 | HTML5 DnD → 포인터 이벤트로 교체 |
| 모바일 터치 타깃 34px | `pointer: coarse` 의존 → 레이아웃 조건으로 44px 보장 |

### 3-4. GitHub Pages 배포 준비

- `vite.config.ts` 에 `BASE_PATH` (CI 가 `/post-map/` 주입, dev 는 루트 유지)
- `.github/workflows/deploy.yml` — push·PR 에서 빌드(`tsc -b` 포함), main 에서만 배포
- `.gitattributes` — LF 통일
- **검색 자동 비활성화**: `searchAvailable = import.meta.env.DEV || VITE_SEARCH_PROXY === 'true'`

  GitHub Pages 에는 dev 프록시가 없어 `/api/vworld/*` 가 404 가 된다.
  사용자가 "검색만 비활성 + 안내 문구"를 선택했다(불변 규칙 4 유지).
  CI 동일 조건 빌드로 확인: 번들에 타일 키는 있고 `api/vworld/search` 는 **0건**(트리셰이킹됨).
  검색창은 "이 배포본에서는 검색을 쓸 수 없습니다" 로 대체된다.

---

## 4. 알아야 할 결정들

- **`canPersistResults: false`** — VWorld 약관을 못 읽어서(크롤링 차단) 보수적으로 false.
  검색 결과로 만든 피처는 **좌표만** 저장되고 주소·장소명은 화면에만 쓴다.
  약관 확인되면 `src/providers/geocoding.ts` 의 그 한 줄만 `true` 로 바꾸면 된다.
- **타일 키와 검색 키가 같은 값** — 타일 쪽에서 이미 노출되므로 프록시가 키를 못 가린다.
  운영 전 별도 발급 필요.
- **목록에 모든 도형을 넣었다** — 사용자는 "포인트 목록"이라 했지만, 다각형·선을 빼면
  지도 클릭으로만 찾을 수 있는 문제가 남아서. 점만 보이게 하려면 필터를 넣으면 된다.
- **정렬은 `최근순 / 이름순` 뿐** — 목업의 `가격순` 은 도메인 필드라 불변 규칙 6 위반.
  스키마 필드 기준 정렬은 테이블 뷰(Phase 2)에서 일반화할 것.

---

## 5. 남은 일 / 알려진 한계

**배포 마무리** (위 1번)

**기능**
- 번들 1.6MB(gzip 436KB), 코드 스플리팅 안 함
- 레이어 숨김이 Terra Draw 도형에는 적용되지 않음 (TD 에 레이어 개념이 없어 속성만 갱신)
- 핀 이미지가 (아이콘 × 색) 조합마다 누적 등록됨. 최대 10×6=60개로 제한되지만 해제는 안 한다
- `Ctrl+Z` 되돌리기는 구현했으나 검증 못 함
- 테스트 러너 없음. 검증은 Playwright MCP 로 직접 돌렸다

**문서**
- `README.md` 의 사용 순서 표가 `04-Phase3`·`05-Phase4` 를 가리키지만 두 파일은 없다

---

## 6. 로컬 실행

```bash
cd "C:/Users/Metanet/Desktop/Hyeran/1_AI자동화/map"
npm install
npm run dev     # http://localhost:5173
```

`.env` 는 이미 있다(커밋 안 됨). 앱은 `/`, PRD 뷰어는 `/docs/prd-view.html`.
