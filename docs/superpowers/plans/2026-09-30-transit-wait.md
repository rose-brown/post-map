# 지하철 대기시간 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선릉·여의도·시청 소요시간에 07~09시 배차간격 기반 대기시간(첫 탑승·환승마다)을 넣고, 교통 레이어 7개와 원본 단지 속성을 다시 계산한다.

**Architecture:** 역 그래프를 정류장(`P:`)·열차 위(`R:a>b`) 두 종류 정점으로 나눈다. 탑승 간선에만 대기가 붙고, 같은 운행이 이어지는 구간은 `R→R` 간선이라 대기가 없다.
다익스트라(`secondsTo`)·도보·반올림·레이어 쓰기는 그대로다.

**Tech Stack:** Node 22+ `node --test` · KTDB GTFS 2025-03 (`scripts/transit/gtfs.ts`) · Supabase REST (`scripts/lead50/sb.ts`)

**Spec:** `docs/superpowers/specs/2026-09-30-transit-wait-design.md` (W1~W9). 원래 계산 규칙은 `docs/superpowers/specs/2026-09-29-transit-layers-design.md` 4절.

## Global Constraints

- 대기 = 방향별 07:00 ≤ 도착 < 09:00 운행 수 n 으로 `7200 ÷ n ÷ 2` 초. 창 안 0 이면 05:00~24:00(68,400초) 폴백, 그것도 0 이면 탑승 없음.
- 승차 시간 = 구간별 도착시각 차 중앙값 (지금 그대로). 도보 = 직선 × 1.3 ÷ 72m/분, 2km 안 역, 분 반올림 (그대로).
- `scripts/transit/build.ts` 는 테스트가 직접 돌리므로 확장자 없는 런타임 import 금지.
- 레이어·속성 이름, 사본 규칙(지하철 스펙 D6~D8) 은 바꾸지 않는다. 실데이터 쓰기 전 항상 `--dry-run`.
- GTFS 경로: `대중교통GTFS(2025년 기준)/202503_GTFS_DataSet` (커밋하지 않는다).
- Windows 테스트: `node --test tests/*.test.ts`.
- push 하지 않는다 (사용자에게 묻는다).

## Review Focus

1. **정점 키에 `>` 를 쓰는 것** — stop id 에 `>` 가 있으면 `split('>')` 가 깨진다. KTDB stop id 는 `RS_ACC1_S-1-0220` 형식이라 없지만, Task 2 에서 GTFS 의 모든 served stop id 에 `>` 가 없는지 run.ts 가 검사하고 있으면 실패하게 한다.
2. **도착시각이 같은 연속 정차(dt ≤ 0)** — 승차 간선에서 빠지므로 그 구간의 탑승·계속 간선도 없어야 한다(끊긴 운행). → Task 2 테스트.
3. **24시 넘는 도착(`25:10:00`)** — 창·폴백 모두 밖이다. 심야에만 다니는 구간은 탑승 없음이 된다. 리포트의 `waits.edges` 와 승차 구간 수 차이로 드러난다 → Task 3 리포트.
4. **다익스트라 시간** — 정점이 ~3배. 3 기준역 합계가 몇 초 안이어야 한다. → Task 3 리포트 `routingMs`.
5. **before/after 비교가 서버 값 기준** — before 는 이번 계산 전 서버 원본 단지 속성으로 센다. 이미 한 번 새 값으로 쓴 뒤 다시 돌리면 before=after 가 정상이다. → Task 3 에서 명시.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `scripts/transit/build.ts` | `boardWaits`, `buildWaitGraph`, `stationSecondsTo` 추가, `buildReverseGraph` 삭제 |
| `tests/transit.test.ts` | 새 함수 테스트, `buildReverseGraph` 테스트 교체 |
| `scripts/transit/run.ts` | 새 그래프 사용, 리포트 before/after·waits·routingMs, `>` 검사 |
| `docs/superpowers/specs/2026-09-29-transit-layers-design.md` | 4절에 대기 규칙 링크 |
| `CLAUDE.md`, `docs/HANDOFF.md`, `docs/log/2026-09-30.md` | "대기시간 미포함" 문구 갱신, 결과 기록 |

---

### Task 1: 방향별 대기시간

**Files:**
- Modify: `scripts/transit/build.ts` (`/* ---------- 소요시간 (스펙 4절) ---------- */` 절, `median` 아래)
- Test: `tests/transit.test.ts`

**Interfaces:**
- Produces: `PEAK_WINDOW: [number, number]` (= `[25200, 32400]`), `boardWaits(trips: Map<string, StopTime[]>, window?: [number, number]): { waits: Map<string, number>; fallback: string[] }` — 키 `${a}>${b}`, 값 초.

- [ ] **Step 1: 실패하는 테스트** — `tests/transit.test.ts` import 목록에 `boardWaits` 추가, 파일 끝에:

```ts
const H7 = 7 * 3600

test('boardWaits: 방향별, 07~09시만, 급행은 다른 키, 창 밖이면 하루 폴백', () => {
  const trips = tripSequences([
    st('L_Ord001', 'A', 1, H7), st('L_Ord001', 'B', 2, H7 + 120),
    st('L_Ord002', 'A', 1, H7 + 600), st('L_Ord002', 'B', 2, H7 + 720),
    st('L_Ord003', 'A', 1, H7 + 1200), st('L_Ord003', 'B', 2, H7 + 1320),
    st('L_Ord004', 'A', 1, H7 + 1800), st('L_Ord004', 'B', 2, H7 + 1920),
    st('L_Ord005', 'A', 1, 10 * 3600), st('L_Ord005', 'B', 2, 10 * 3600 + 120),   // 창 밖 — 안 센다
    st('R_Ord001', 'B', 1, H7), st('R_Ord001', 'A', 2, H7 + 120),                  // 반대 방향 1회
    st('E_Ord001', 'A', 1, H7 + 100), st('E_Ord001', 'C', 2, H7 + 400),            // 급행 A→C
    st('N_Ord001', 'D', 1, 12 * 3600), st('N_Ord001', 'E', 2, 12 * 3600 + 60),     // 낮에만 2회
    st('N_Ord002', 'D', 1, 13 * 3600), st('N_Ord002', 'E', 2, 13 * 3600 + 60),
    st('M_Ord001', 'F', 1, 25 * 3600), st('M_Ord001', 'G', 2, 25 * 3600 + 60),     // 24시 넘어서만
  ])
  const { waits, fallback } = boardWaits(trips)
  assert.equal(waits.get('A>B'), 7200 / 4 / 2)
  assert.equal(waits.get('B>A'), 7200 / 1 / 2)
  assert.equal(waits.get('A>C'), 3600)
  assert.equal(waits.get('D>E'), 68400 / 2 / 2)
  assert.equal(waits.has('F>G'), false)
  assert.deepEqual(fallback, ['D>E'])
})
```

- [ ] **Step 2: 실패 확인** — `node --test tests/transit.test.ts` → FAIL: `does not provide an export named 'boardWaits'`

- [ ] **Step 3: 구현** — `scripts/transit/build.ts` 의 `median` 함수 아래에:

```ts
/** 출근 시간 창 (스펙 transit-wait W2). 도착시각 기준, 끝은 제외. */
export const PEAK_WINDOW: [number, number] = [7 * 3600, 9 * 3600]
/** 창 안에 운행이 없을 때의 폴백 (W4). */
const DAY_WINDOW: [number, number] = [5 * 3600, 24 * 3600]

/**
 * 구간 a→b 로 출발하는 열차를 탈 때의 평균 대기 = 배차간격 ÷ 2 (W1·W3).
 * 방향별로 센다 — 양방향을 합치면 대기가 절반으로 준다. 급행(다음 정차가 다름)은 다른 키다.
 */
export function boardWaits(
  trips: Map<string, StopTime[]>,
  window: [number, number] = PEAK_WINDOW,
): { waits: Map<string, number>; fallback: string[] } {
  const inWindow = new Map<string, number>()
  const inDay = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  for (const seq of trips.values()) {
    for (let i = 0; i + 1 < seq.length; i++) {
      const a = seq[i]
      const b = seq[i + 1]
      if (a.stopId === b.stopId) continue
      const k = `${a.stopId}>${b.stopId}`
      if (a.arrival >= window[0] && a.arrival < window[1]) bump(inWindow, k)
      if (a.arrival >= DAY_WINDOW[0] && a.arrival < DAY_WINDOW[1]) bump(inDay, k)
    }
  }
  const waits = new Map<string, number>()
  const fallback: string[] = []
  for (const k of new Set([...inWindow.keys(), ...inDay.keys()])) {
    const n = inWindow.get(k)
    if (n) {
      waits.set(k, (window[1] - window[0]) / n / 2)
      continue
    }
    const d = inDay.get(k)
    if (d) {
      waits.set(k, (DAY_WINDOW[1] - DAY_WINDOW[0]) / d / 2)
      fallback.push(k)
    }
  }
  return { waits, fallback: fallback.sort() }
}
```

- [ ] **Step 4: 통과 확인** — `node --test tests/transit.test.ts` → 전부 pass. `npm run typecheck` → 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add scripts/transit/build.ts tests/transit.test.ts
git commit -m "feat(transit): 방향별 07~09시 배차간격으로 탑승 대기시간"
```

---

### Task 2: 정류장·열차 위 그래프

**Files:**
- Modify: `scripts/transit/build.ts` (`buildReverseGraph` 를 `buildWaitGraph` 로 교체, `secondsTo` 아래 `stationSecondsTo` 추가)
- Test: `tests/transit.test.ts` (`buildReverseGraph + secondsTo` 테스트 교체)

**Interfaces:**
- Consumes: Task 1 `boardWaits`
- Produces: `buildWaitGraph(trips: Map<string, StopTime[]>, transfers: Transfer[], waits: Map<string, number>): ReverseGraph`, `stationSecondsTo(g: ReverseGraph, targetStopIds: string[]): Map<string, number>` (키 = stop id). `buildReverseGraph` 는 없어진다.

- [ ] **Step 1: 실패하는 테스트** — import 목록에서 `buildReverseGraph` 를 빼고 `buildWaitGraph, stationSecondsTo` 를 넣는다. 기존 `test('buildReverseGraph + secondsTo: …')` 블록 전체를 아래로 바꾼다:

```ts
test('buildWaitGraph + stationSecondsTo: 탈 때마다 대기, 같은 열차 중간역은 대기 없음, 중앙값 승차', () => {
  const L = (n: number, t: number, dtAB = 120) => [st(`L_Ord00${n}`, 'A', 1, t), st(`L_Ord00${n}`, 'B', 2, t + dtAB), st(`L_Ord00${n}`, 'C', 3, t + dtAB + 180)]
  const trips = tripSequences([
    ...L(1, H7), ...L(2, H7 + 1800), ...L(3, H7 + 3600, 900), ...L(4, H7 + 5400),   // 4회 → 대기 900, A→B 중앙값 120 (이상값 900 흡수)
    st('Q_Ord001', 'X', 1, H7), st('Q_Ord001', 'Y', 2, H7 + 60),                    // 1회 → 대기 3600
  ])
  const { waits } = boardWaits(trips)
  const g = buildWaitGraph(trips, [{ from: 'C', to: 'X', seconds: 90 }], waits)
  const d = stationSecondsTo(g, ['Y'])
  assert.equal(d.get('Y'), 0)
  assert.equal(d.get('X'), 3600 + 60)
  assert.equal(d.get('A'), 900 + 120 + 180 + 90 + 3600 + 60)   // 대기는 A 에서 한 번, 환승 뒤 한 번
  assert.equal(d.get('B'), 900 + 180 + 90 + 3600 + 60)
  assert.equal(stationSecondsTo(g, ['A']).get('C'), undefined)  // 역방향 운행 없음
})

test('buildWaitGraph: 운행에 a,b,c 가 이어서 없으면 b 에서 내려 다시 탄다 (대기 두 번)', () => {
  const trips = tripSequences([
    st('S_Ord001', 'A', 1, H7), st('S_Ord001', 'B', 2, H7 + 100),     // A→B 로 끝나는 운행
    st('T_Ord001', 'B', 1, H7 + 200), st('T_Ord001', 'C', 2, H7 + 300), // B 에서 출발하는 다른 운행
  ])
  const { waits } = boardWaits(trips)
  const d = stationSecondsTo(buildWaitGraph(trips, [], waits), ['C'])
  assert.equal(d.get('A'), 3600 + 100 + 3600 + 100)
})

test('buildWaitGraph: 도착시각이 같은 연속 정차는 승차·탑승 간선이 없다', () => {
  const trips = tripSequences([st('Z_Ord001', 'A', 1, H7), st('Z_Ord001', 'B', 2, H7)])
  const { waits } = boardWaits(trips)
  assert.equal(stationSecondsTo(buildWaitGraph(trips, [], waits), ['B']).get('A'), undefined)
})

test('buildWaitGraph: 대기가 긴 직행보다 대기가 짧은 환승이 빠르면 환승', () => {
  const trips = tripSequences([
    st('D_Ord001', 'A', 1, H7), st('D_Ord001', 'Y', 2, H7 + 600),          // 직행 1회: 3600 + 600
    ...[0, 1, 2, 3, 4, 5].flatMap((i) => [st(`F_Ord00${i}`, 'A', 1, H7 + i * 1200), st(`F_Ord00${i}`, 'M', 2, H7 + i * 1200 + 300)]), // 6회 → 600
    ...[0, 1, 2, 3, 4, 5].flatMap((i) => [st(`G_Ord00${i}`, 'N', 1, H7 + i * 1200), st(`G_Ord00${i}`, 'Y', 2, H7 + i * 1200 + 300)]),
  ])
  const { waits } = boardWaits(trips)
  const d = stationSecondsTo(buildWaitGraph(trips, [{ from: 'M', to: 'N', seconds: 120 }], waits), ['Y'])
  assert.equal(d.get('A'), 600 + 300 + 120 + 600 + 300)   // 1920 < 4200
})
```

- [ ] **Step 2: 실패 확인** — `node --test tests/transit.test.ts` → FAIL: `does not provide an export named 'buildWaitGraph'`

- [ ] **Step 3: 구현** — `scripts/transit/build.ts`

`/** 연속 정차 간 도착시각 차의 중앙값(방향별) + 환승 간선. */` 부터 `buildReverseGraph` 함수 끝까지를 지우고 아래로 바꾼다:

```ts
/**
 * 정류장 P:<stop> 과 열차 위 R:<a>><b> 로 나눈 역방향 그래프 (스펙 transit-wait W5·W6).
 *   탑승 P(a)→R(a>b) = 대기(a>b) + 승차(a>b)   — 대기가 붙는 유일한 간선
 *   계속 R(a>b)→R(b>c) = 승차(b>c)               — 실제 운행에 a,b,c 가 이어서 있을 때만 (급행·완행을 섞지 않는다)
 *   하차 R(a>b)→P(b) = 0,  환승 P(a)→P(b) = transfers.txt 초
 * 승차 = 연속 정차 간 도착시각 차의 중앙값(방향별). dt ≤ 0 인 구간은 끊긴 것으로 본다.
 */
export function buildWaitGraph(trips: Map<string, StopTime[]>, transfers: Transfer[], waits: Map<string, number>): ReverseGraph {
  const samples = new Map<string, number[]>()
  const continues = new Set<string>()
  for (const seq of trips.values()) {
    let prevKey: string | undefined
    for (let i = 1; i < seq.length; i++) {
      const dt = seq[i].arrival - seq[i - 1].arrival
      if (dt <= 0 || seq[i].stopId === seq[i - 1].stopId) {
        prevKey = undefined
        continue
      }
      const k = `${seq[i - 1].stopId}>${seq[i].stopId}`
      const list = samples.get(k)
      if (list) list.push(dt)
      else samples.set(k, [dt])
      if (prevKey) continues.add(`${prevKey}|${k}`)
      prevKey = k
    }
  }
  const g: ReverseGraph = new Map()
  const add = (from: string, to: string, s: number) => {
    const list = g.get(to)
    if (list) list.push([from, s])
    else g.set(to, [[from, s]])
  }
  const ride = new Map([...samples].map(([k, xs]) => [k, median(xs)]))
  for (const [k, r] of ride) {
    const [a, b] = k.split('>')
    const w = waits.get(k)
    if (w !== undefined) add(`P:${a}`, `R:${k}`, w + r)
    add(`R:${k}`, `P:${b}`, 0)
  }
  for (const c of continues) {
    const [k1, k2] = c.split('|')
    add(`R:${k1}`, `R:${k2}`, ride.get(k2)!)
  }
  for (const t of transfers) add(`P:${t.from}`, `P:${t.to}`, t.seconds)
  return g
}
```

`secondsTo` 함수 아래에:

```ts
/** 역(stop id) 에서 기준역까지의 초 — 정류장 정점만 골라 키를 stop id 로 되돌린다. */
export function stationSecondsTo(g: ReverseGraph, targetStopIds: string[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const [node, s] of secondsTo(g, targetStopIds.map((t) => `P:${t}`))) if (node.startsWith('P:')) out.set(node.slice(2), s)
  return out
}
```

- [ ] **Step 4: 통과 확인** — `node --test tests/transit.test.ts` → 전부 pass (`minutesVia`·`transitProps`·`copyRow` 등 기존 포함). `node --test tests/*.test.ts`. `npm run typecheck` → `run.ts` 가 `buildReverseGraph` 를 import 해서 **오류가 난다 — Task 3 에서 고친다.** 이 Task 의 커밋은 Task 3 과 함께 한다(타입 검사가 깨진 커밋을 남기지 않는다).

---

### Task 3: 실행 스크립트와 dry-run 리포트

**Files:**
- Modify: `scripts/transit/run.ts` (import, `/* 1. GTFS → 그래프 */` 절, `report`)

**Interfaces:**
- Consumes: Task 1·2 `boardWaits`, `buildWaitGraph`, `stationSecondsTo`

- [ ] **Step 1: import** — `buildReverseGraph` 와 `secondsTo` 를 빼고 `boardWaits, buildWaitGraph, stationSecondsTo` 를 넣는다.

- [ ] **Step 2: 그래프** — 기존

```ts
const graph = buildReverseGraph(trips, gtfs.transfers)
const toTargets = TARGETS.map((t) => secondsTo(graph, targetStops(gtfs.stops, t.name)))
```

를 교체:

```ts
// 정점 키를 '>' 와 '|' 로 이어 붙인다 (build.ts buildWaitGraph) — stop id 에 있으면 키가 깨진다.
const badIds = gtfs.stops.filter((s) => /[>|]/.test(s.id)).map((s) => s.id)
if (badIds.length) throw new Error(`stop id 에 '>' 또는 '|' 가 있다: ${badIds.slice(0, 5).join(', ')}`)
// 대기시간 (스펙 2026-09-30-transit-wait): 07~09시 방향별 배차간격 ÷ 2, 탈 때마다.
const { waits, fallback } = boardWaits(trips)
const graph = buildWaitGraph(trips, gtfs.transfers, waits)
const routingStart = Date.now()
const toTargets = TARGETS.map((t) => stationSecondsTo(graph, targetStops(gtfs.stops, t.name)))
const routingMs = Date.now() - routingStart
```

- [ ] **Step 3: 리포트** — `const report = {` 의 `stops: …` 줄 앞에 before 를 계산한다 (이 시점의 `originals` 는 서버 값):

```ts
const waitList = [...waits.values()].sort((a, b) => a - b)
// 이번 계산 전 서버 값으로 센 수 — 한 번 새 값으로 쓴 뒤 다시 돌리면 before = after 가 정상이다.
const before = Object.fromEntries(FILTER_LAYERS.map((d) => [d.name, originals.filter((f) => d.pick(f.properties)).length]))
```

`report` 객체의 `dryRun,` 줄 앞에:

```ts
  before,
  waits: {
    edges: waitList.length,
    medianMin: Number((waitList[waitList.length >> 1] / 60).toFixed(1)),
    maxMin: Number((waitList[waitList.length - 1] / 60).toFixed(1)),
    fallback: fallback.length,
  },
  routingMs,
```

`sanity` 는 그대로 둔다 — 값이 이제 대기 포함이다(강남→선릉 이 4분에서 대기만큼 늘어야 한다).
파일 머리 주석의 `스펙: …transit-layers-design.md` 뒤에 `, 대기시간 docs/superpowers/specs/2026-09-30-transit-wait-design.md` 를 붙인다.

- [ ] **Step 4: 정적 확인** — `npm run typecheck` 오류 없음, `node --test tests/*.test.ts` 전부 pass.

- [ ] **Step 5: 커밋 (Task 2 와 함께)**

```bash
git add scripts/transit/build.ts scripts/transit/run.ts tests/transit.test.ts
git commit -m "feat(transit): 정류장·열차 위 그래프로 환승마다 대기 — 소요시간에 대기 포함"
```

- [ ] **Step 6: 실데이터 dry-run** —

```bash
node scripts/transit/run.ts 92e81c2e-4607-4449-aa37-3dd8ed38bf46 "대중교통GTFS(2025년 기준)/202503_GTFS_DataSet" --dry-run
```

Expected (확인 기준 — 숫자가 벗어나면 멈추고 원인을 본다):
- `before` = 9/29 값 (역 500m 1,078 · 선릉 30분 444 / 1시간 1,885 · 여의도 550 / 2,016 · 시청 480 / 1,895).
- `filters`(after): 역 500m 은 **그대로 1,078**(대기와 무관). 30분·1시간 레이어는 **모두 줄어든다**. 늘면 버그.
- `sanity.gangnamToSeolleungMin` 5~6 (4 + 2호선 출근 대기 1~2분), `cityHall2ToYeouidoMin` 이 14 보다 크다.
- `waits.medianMin` 2호선급 1~3분대, `maxMin` 는 드문 노선(경춘·경강) 10분 이상일 수 있다. `fallback` 이 수십 개를 넘으면 원인을 본다.
- `routingMs` 몇 초 이내.
- `deleted` = before − after 의 합과 맞는지 (사본 레이어에서 빠지는 단지가 지워진다).
결과 JSON 을 로그용으로 저장해 둔다 (samples 제외).

---

### Task 4: 실데이터 반영과 기록

**Files:** `docs/superpowers/specs/2026-09-29-transit-layers-design.md`, `CLAUDE.md`, `docs/HANDOFF.md`, `docs/log/2026-09-30.md`

- [ ] **Step 1: 실행** — Task 3 Step 6 명령에서 `--dry-run` 을 빼고 실행. 이어서 `node scripts/presets/run.ts 92e81c2e-4607-4449-aa37-3dd8ed38bf46 --dry-run` → `changed: []` (스키마 변화 없음) 확인.
- [ ] **Step 2: 검산** — 스크래치 `scripts/__check.ts`(끝나면 지운다)로: 교통 레이어 7개 도형 수 = after, 원본 단지 `minSeolleung` 분포(이전 대비 증가량 중앙값), 선릉 30분 이내 가장 먼 단지 5곳의 직선거리·시간 (이전 13.9km 보다 가까워졌는지).
- [ ] **Step 3: 브라우저** — 배포본(코드 변경은 스크립트뿐이라 배포 필요 없음)에서 `선릉 30분 이내` 레이어를 켜고 필터 `선릉까지 30분` 버튼 개수가 레이어 수와 같은지. 확인 뒤 레이어 표시를 원래대로.
- [ ] **Step 4: 문서**
  - 지하철 스펙 4절 `- **환승**: … 열차 대기시간은 넣지 않는다.` 를 `- **환승**: transfers.txt 의 간선. 대기는 **2026-09-30 부터 포함** — 스펙 2026-09-30-transit-wait-design.md.` 로.
  - `docs/HANDOFF.md` 의 `(평일 1일, 대기시간 미포함)` 을 `(평일 1일, 07~09시 배차 기반 대기 포함 — 2026-09-30)` 으로.
  - `CLAUDE.md` 의 확인된 KTDB GTFS 사실 절 끝에 한 줄: `- 대기시간 = 방향별 07~09시 배차간격 ÷ 2, 탈 때마다 (정류장·열차 위 그래프, 스펙 2026-09-30-transit-wait). 그래프 정점 키에 \`>\`·\`|\` 를 쓴다.`
  - `docs/log/2026-09-30.md` 에 "### 지하철 대기시간" 절: 사용자 질문과 거리 검증 결과(최대 13.9km, 시속 24~31km), 결정(B·A), before/after 표, sanity, waits 통계.
- [ ] **Step 5: 커밋**

```bash
git add docs/superpowers/specs/2026-09-29-transit-layers-design.md CLAUDE.md docs/HANDOFF.md docs/log/2026-09-30.md
git commit -m "docs: 지하철 소요시간 대기시간 포함 기록"
```

push 는 사용자에게 묻는다.
