# 인수인계 — 2026-09-27

다른 세션에서 이어서 작업하기 위한 기록. **먼저 `CLAUDE.md` 를 읽어라.**
이 문서는 "지금 어디까지 했고 다음에 뭘 해야 하는가"만 담는다.
이번 세션에서 한 일의 전체 기록은 **`docs/log/2026-09-27.md`** 에 있다.

---

## 지금 상태 한 줄

**Phase 3(다기기 동기화)는 완료됐다 — 서버 RLS·Storage 실측과 브라우저 다기기 확인까지 끝났다.**
Phase 2 는 계획만 있고 손대지 않았다.

**월간선도50 레이어 (2026-09-27, 2026-09-29 개편)** — 서울 25구 + 경기 44 지역의 KB 시세총액 상위 단지 3,288개가
프로젝트 `92e81c2e-…` 의 순위 구간 레이어 5개("월간선도50 TOP1~10 (시세총액)" … "TOP41~50")와 "순위 밖"에 나뉘어 있다
(실거래 매칭 97.6%, Top 10 ★). 순위 1~9 사본 레이어 "월간선도50 TOP9 (시세총액)" 은 핀에 숫자. 기록 `docs/superpowers/plans/2026-09-29-lead50-top9-layer.md`.
데이터는 **202608 기준**이다 — KB 는 202609 를 냈다. 이 PC 의 `.env` 에는 `MOLIT_KEY`·Supabase 키가 없다.
월 1회 `node scripts/lead50/run.ts <projectId> --dry-run` → 리포트 확인 → 옵션 없이 실행.
설계 `docs/superpowers/specs/2026-09-27-lead50-layer-design.md`, 계획 `docs/superpowers/plans/2026-09-27-lead50-layer.md`.

**지하철 레이어 (2026-09-29)** — 같은 프로젝트에 호선 레이어 24개(역 798, 노선색, 점 반지름 3 — 선은 배경지도와 어긋나 없앴다)와 필터 레이어 7개
("역 500m 이내", "선릉/여의도/시청 30분·1시간 이내", 모두 `(월간선도50)` 사본)가 있다. **교통 레이어는 전부 기본 숨김**(사용자 요청). 원본 단지에는
`nearestStation·stationDistance·minSeolleung·minYeouido·minCityHall` 속성이 붙었다 (2km 안에 역이 없는 434개는 키 없음).
출처는 KTDB GTFS 2025-03 (평일 1일, 대기시간 미포함). **월간선도50 을 갱신하면 `scripts/transit/run.ts` 도 다시 돌린다.**

**진입가 구간 레이어 (2026-09-29)** — "진입가 3억 미만 / 3~5억 / 5~6.5억 / 6.5~8억 / 8~12억 / 12억 이상 (월간선도50)" 6개 (468/634/444/329/523/810, 기본 숨김).
진입가 = 평형별 최근 거래 중 최저 (`entryTrade`). 거래 없는 80단지는 없다. lead50 스펙 D13, `scripts/lead50/price.ts`.
설계 `docs/superpowers/specs/2026-09-29-transit-layers-design.md`, 기록 `docs/log/2026-09-29.md`.

`npm test` 통과 · `npm run typecheck` 통과 · `npm run build` 통과.
`main` 은 원격과 같다.

---

## 1. 직전에 풀린 것 (자세한 기록은 `docs/log/2026-09-27.md` 9절)

- 새 프로젝트 INSERT 42501 → 원인은 정책 누락이 아니라 `RETURNING` 이 SELECT 정책에 걸린 것.
  uuid 를 클라이언트가 만들어 헤더에 먼저 박도록 고쳤고, 헤더 없는 INSERT 예외 정책을 없앴다.
- Storage 삭제 403 (이미지 달린 피처 삭제가 실패하던 버그) → 헤더 범위 SELECT 정책 추가.
  Storage 도 헤더를 받는 것이 실측돼 업로드·삭제 정책도 프로젝트 폴더로 조였다.
- **D9 판정: 헤더 없는 Storage 목록 열람은 `[]`** — 스펙 3절에 기록했다.
- 원격 DB 는 `supabase/schema.sql` 과 일치한다 (MCP `apply_migration` 3건). security advisors 경고 0건.
- 브라우저 확인(이관·F-81 로컬 보존·A↔B 동기화·오프라인 실패/재시도/beforeunload) 전부 통과.
  스크린샷 `docs/screenshots/p3-0*.png`.

## 2. 그다음 남은 일 (사람 판단이 필요한 것)

- 없음. Phase 3 는 닫혔다. 다음은 Phase 2 (`docs/prompts/03-Phase2-...`).

## 3. Phase 3 에서 무엇을 했는지 (짧게)

PRD 의 Phase 3 을 그대로 하지 않았다. **로그인(F-80)·사람 단위 공유·역할(F-82·F-83)을 뺐다.**

- **온라인 우선** — 서버가 진실의 원천. 신호가 없으면 새 입력이 막힌다 (알고 고른 트레이드오프).
- **비밀 링크** — 프로젝트 uuid 를 `?p=` URL 과 `x-project-id` 헤더로. 링크를 아는 사람이 곧 권한이고
  읽고 쓰고 **지운다**.
- **PostGIS 안 씀** — `geometry` 는 jsonb. PRD 4.4 와 어긋나는 유일한 지점이고 이유는 스펙 D6 에 있다.
- `repo.ts` 공개 함수 14개 시그니처 유지. 스토어·UI·지도는 거의 그대로.

설계는 `docs/superpowers/specs/2026-09-27-phase3-multidevice-sync-design.md`.

### 계획 문서의 오류 두 개 (읽을 때 주의)

- **`unwrap()` 은 존재하지 않는다.** `Persistable<T>` 는 브랜드 타입이라 구조적으로 이미 `T` 다.
  만들면 저장 게이트를 우회하는 경로가 된다.
- **`SaveState` 는 문자열 유니온**이고 이미 `'error'` 가 있었다. 객체로 바꾸면 시그니처가 깨진다.

## 4. 저장소 정보

| 항목 | 값 |
|---|---|
| 계정 | `rose-brown` (gh 활성 계정) |
| 저장소 | https://github.com/rose-brown/post-map (Public) |
| 기본 브랜치 | `main` |
| 배포 주소 | https://rose-brown.github.io/post-map/ (`main` push 시 Actions 가 배포) |
| Supabase | `ckwgtniqpynibyjebdia` (리전 서울) |
| 로컬 경로 | `/Volumes/nut/rs/map` |

git 작성자는 이 저장소에서만 `rose-brown <h.keum.123@gmail.com>` 로 고정했다
(전역은 `jisu_you` 로 남아 있다 — 다른 프로젝트 영향을 피했다).

## 5. CI 배포 — 동작한다 (2026-09-27 전환)

`main` push → `CI · Deploy to Pages` 가 빌드하고 Pages 에 올린다. **이제 `gh-pages` 브랜치에 수동으로 올리지 마라** —
Pages 소스가 `build_type=workflow` 라 그 브랜치는 서비스되지 않는다 (옛 배포본 보관용으로만 남아 있다).

- Actions 시크릿: `VITE_VWORLD_KEY`(`.env` 의 `03125282-…`), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Supabase 시크릿이 비면 빌드 단계에서 `exit 1` 로 멈춘다 (앱이 시작 화면 오류가 되는 빌드로 덮어쓰지 않게)
- `github-pages` 환경 허용 브랜치: `gh-pages`, `main`
- 키 교체: `printf '%s' '새키' | gh secret set VITE_VWORLD_KEY -R rose-brown/post-map` (TTY 가 아니면 `--body "$K"`)
  → `gh workflow run "CI · Deploy to Pages" -R rose-brown/post-map --ref main`

참고: `actions/checkout@v4`·`setup-node@v4`·`upload-artifact@v4` 가 Node 20 지원 종료 경고를 낸다. 급하지 않다.

## 6. VWorld 키 — 노출된 키를 그대로 쓰기로 했다 (2026-09-27 사용자 결정)

두 키가 공개 저장소에 노출돼 있다 (git 히스토리·배포 번들). **재발급하지 않고 유지한다.**
감수한 것: 제3자가 키를 가져가 쿼터를 소진하거나 다른 도메인에서 쓸 수 있다. 증상이 보이면(배경지도·검색 실패)
그때 재발급하고 5번의 명령으로 시크릿을 교체한다. 다시 권하지 마라.

| 키 | 남아 있는 위치 |
|---|---|
| `03125282-…` (타일) | `.env.example` 과거 커밋, `docs/prd-view.html` |
| `B29A6DC8-…` (검색) | `docs/HANDOFF.md` 과거 커밋, `docs/prd-view.html` |

지금 `.env` 는 두 값이 **같다**(`03125282-…`). `vite.config.ts` 주석의 경고가 그대로 적용된다 —
같은 값이면 타일 URL 에서 이미 노출되므로 dev 프록시가 검색 키를 가려주지 못한다.

VWorld 신청은 **2건으로 나눈다.** 타일용은 `WMTS/TMS API` 만, 검색용은 `검색 API` + `지오코더 API`.
발급 후 **타일용 키에 `rose-brown.github.io` 도메인 등록**이 필요하다 — 안 하면 배포본 배경지도가 빈 화면이다.

## 7. 로컬 실행

```bash
cd /Volumes/nut/rs/map
npm install          # fresh clone 이면 필요하다
npm run dev          # http://localhost:5173
npm test             # node --test 'tests/**/*.test.ts' — 순수 함수만
npm run typecheck
```

`.env` 는 있다(커밋 안 됨). `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY` 가 채워져 있다.
앱은 `/`, PRD 뷰어는 `/docs/prd-view.html`.

**Node 22.23.0 실측**: `.ts` 를 타입 제거로 실행한다. 단 `node --test tests/`(디렉터리 인자)는
`MODULE_NOT_FOUND` 로 실패하므로 glob 을 따옴표로 감싸야 한다.

## 8. Supabase MCP

연결돼 있다 (`/mcp` 에서 Authenticate 완료). `execute_sql` 로 대시보드 없이 SQL 을 돌리고,
DDL 은 `apply_migration` 으로 넣은 뒤 `supabase/schema.sql` 에도 반영한다.
