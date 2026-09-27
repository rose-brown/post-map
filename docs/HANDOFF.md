# 인수인계 — 2026-09-27

다른 세션에서 이어서 작업하기 위한 기록. **먼저 `CLAUDE.md` 를 읽어라.**
이 문서는 "지금 어디까지 했고 다음에 뭘 해야 하는가"만 담는다.
이번 세션에서 한 일의 전체 기록은 **`docs/log/2026-09-27.md`** 에 있다.

---

## 지금 상태 한 줄

**Phase 3(다기기 동기화)는 완료됐다 — 서버 RLS·Storage 실측과 브라우저 다기기 확인까지 끝났다.**
Phase 2 는 계획만 있고 손대지 않았다.

`npm test` 12개 통과 · `npm run typecheck` 통과 · `npm run build` 통과.
커밋이 **로컬에만** 있다 (push 안 함 — 아래 2번).

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

- **push** — 커밋이 로컬에만 있다. push 하면 CI 가 돌고 `Pages 배포` 는 아래 5번 사유로 또 실패한다.
- **VWorld 키 재발급** (6번) — 시급.
- CI/Pages 전환 (5번) — 키 재발급 뒤에 순서대로.

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
| 배포 주소 | https://rose-brown.github.io/post-map/ (Phase 3 — `gh-pages` 의 2026-09-27 수동 배포본 `2fa17f2`) |
| Supabase | `ckwgtniqpynibyjebdia` (리전 서울) |
| 로컬 경로 | `/Volumes/nut/rs/map` |

git 작성자는 이 저장소에서만 `rose-brown <h.keum.123@gmail.com>` 로 고정했다
(전역은 `jisu_you` 로 남아 있다 — 다른 프로젝트 영향을 피했다).

## 5. CI 가 실패 중이다

빌드는 통과하고 `Pages 배포` 만 실패한다. 원인이 두 겹이다.

1. `github-pages` 환경의 브랜치 정책이 **`gh-pages` 만 허용**한다 (`main` 이 거부된다)
2. Pages 소스가 아직 **`legacy`**(gh-pages 브랜치)다 — `deploy.yml` 은 `build_type=workflow` 를 요구한다

그리고 `VITE_VWORLD_KEY` Actions 시크릿이 **빈 값으로 등록돼 있다.** TTY 가 아닌 곳에서
`gh secret set` 을 돌려 stdin 이 비었기 때문이다.

**순서를 지켜야 한다** — 시크릿을 먼저 넣지 않고 Pages 소스를 바꾸면 배경지도가 빈 배포본이
정상 동작하는 현재 라이브 사이트를 덮어쓴다.

```bash
# 1) 시크릿 먼저. 새로 발급한 타일용 키를 쓴다 (6번 참조)
printf '%s' '키' | gh secret set VITE_VWORLD_KEY -R rose-brown/post-map

# 2) Pages 소스 전환
gh api repos/rose-brown/post-map/pages -X PUT -f build_type=workflow

# 3) 전환 후에도 main 이 막혀 있으면
gh api repos/rose-brown/post-map/environments/github-pages/deployment-branch-policies \
  -X POST -f name=main -f type=branch

# 4) 재실행
gh workflow run "CI · Deploy to Pages" -R rose-brown/post-map --ref main
```

참고: `actions/checkout@v4`·`setup-node@v4`·`upload-artifact@v4` 가 Node 20 지원 종료 경고를 낸다.
지금은 Node 24 로 강제 실행돼 동작한다. 급하지 않지만 `@v5` 로 올리는 게 좋다.

## 6. 시급 — 공개 저장소에 VWorld 키 두 개가 노출돼 있다

**재발급이 필요하다. 파일 수정으로는 회수되지 않는다** (git 히스토리와 배포 번들에 남는다).

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
