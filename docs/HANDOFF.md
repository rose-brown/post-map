# 인수인계 — 2026-09-27

다른 세션에서 이어서 작업하기 위한 기록. **먼저 `CLAUDE.md` 를 읽어라.**
이 문서는 "지금 어디까지 했고 다음에 뭘 해야 하는가"만 담는다.
이번 세션에서 한 일의 전체 기록은 **`docs/log/2026-09-27.md`** 에 있다.

---

## 지금 상태 한 줄

**Phase 3(다기기 동기화) 코드는 전부 끝났고, 서버 RLS 정책 확인 한 지점에서 막혀 있다.**
Phase 2 는 계획만 있고 손대지 않았다.

`npm test` 12개 통과 · `npm run typecheck` 통과 · `npm run build` 통과 ·
저장 게이트 자체 점검 TS2345 확인. 커밋 7개가 **로컬에만** 있다 (push 안 함).

---

## 1. 막혀 있는 것 — 여기서부터 시작하면 된다

`supabase/schema.sql` 을 대시보드에서 실행해 **테이블은 생겼다.** 그런데:

```
헤더 없이 projects 조회   → []       기대대로 (목록 열람 차단)
헤더 없이 projects INSERT → 42501    ✗ "create new project" 정책이 안 먹는다
```

`[]` 는 판별 근거가 못 된다 — **정책이 하나도 없어도** RLS 는 전부 거부한다.

### 판별: 정책이 실제로 걸렸는지 본다

Supabase → SQL Editor (Editor 는 마지막 결과만 보여주므로 하나씩 실행):

```sql
select schemaname, tablename, policyname, cmd, roles::text
from pg_policies where schemaname in ('public','storage')
order by schemaname, tablename, policyname;
```

- **행이 비었거나 6개보다 적다** → `schema.sql` 을 두 번 이상 돌려 `create table … already exists`
  에서 멈춘 것이다. Supabase SQL Editor 는 한 트랜잭션이라 뒤의 `create policy` 가 전부 날아간다.
  → `schema.sql` 의 정책 부분만 다시 실행한다. 재실행이 안전하도록 각 `create policy` 앞에
  `drop policy if exists "<이름>" on <테이블>;` 을 붙여라.
- **6개가 다 있다** → 신형 키 `sb_publishable_…` 가 `anon` role 로 매핑되지 않는 것을 의심한다.
  정책이 전부 `to anon` 이라 role 이 다르면 적용되지 않는다.

### 그다음 RLS 5단 확인

계획 문서 `docs/superpowers/plans/2026-09-27-phase3-multidevice-sync.md` 의 **Task 1 Step 4** 에
curl 명령이 그대로 있다. `.env` 를 `source` 하지 말고 awk 로 파싱해라 — 4행에 `=` 뒤 공백이 있어
`source` 가 깨진다.

**(5) Storage 목록 열람 판정이 이 구현의 판정 지점이다.**
`POST /storage/v1/object/list/blobs` 가 객체를 나열하면 "링크를 아는 사람만 이미지 접근"이라는
전제(스펙 D9)가 깨진다. 그때는 버킷을 private 으로 돌리고 Storage 접근을 다시 설계해야 한다.
**판정 결과를 스펙 3절 "미확인 — Storage" 에 한 줄로 기록할 것.**

## 2. 그다음 남은 일

- `npm run dev` 로 다기기 동작 확인 (계획 Task 8 Step 3, Playwright MCP 프로필 2개).
  A 에서 작도 → `?p=<uuid>` 를 B 에서 열기 → 같은 도형 → B 수정 → A 새로고침 반영.
  **함정**: 정보 패널이 열리면 지도가 리사이즈되므로 화면 좌표를 매번 다시 계산해라.
- 이관 확인 — 복사 후 **로컬 IndexedDB 가 그대로 남아 있는지** (F-81).
- 저장 실패 경로 — DevTools Offline → 실패 표시·재시도·`beforeunload` 경고.
- stale 문서 정리: `CLAUDE.md` 의 "git 저장소가 없다"·"Phase 3 은 PostGIS"·"테스트 러너가 없다".
- push (커밋 7개가 로컬에만 있다).

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
| 배포 주소 | https://rose-brown.github.io/post-map/ (정상 — `gh-pages` 의 2026-09-22 수동 배포본) |
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

`.mcp.json` 에 추가했고 상태는 **승인 대기**다. `claude` 를 새로 시작하면 프로젝트 MCP 승인
프롬프트가 뜨고, 그다음 `/mcp` 에서 supabase 를 Authenticate 한다. 붙으면 대시보드를 거치지 않고
SQL 을 직접 실행할 수 있어 1번 판별이 훨씬 빨라진다.
