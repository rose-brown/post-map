/**
 * KB 부동산 데이터허브 내부 API. 공개 문서 없음 — 스펙 3.1 의 실측이 유일한 근거다.
 * 한글 파라미터 키도 인코딩해야 한다 (URLSearchParams). 요청 사이 1초.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { leafRegions } from './build.ts'
import type { KbAreaRow, KbComplex, KbRankItem, Region } from './build.ts'

const CACHE = new URL('./.cache/', import.meta.url)
const HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://data.kbland.kr/' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class KbHttpError extends Error {
  status: number
  constructor(status: number, url: string) {
    super(`KB ${status} ${url}`)
    this.status = status
  }
}

async function get(url: string, params: Record<string, string>): Promise<unknown> {
  await sleep(1000)
  const full = `${url}?${new URLSearchParams(params)}`
  const r = await fetch(full, { headers: HEADERS })
  if (r.status !== 200) throw new KbHttpError(r.status, url)
  const body = (await r.json()) as { dataBody?: { data?: unknown } }
  return body.dataBody?.data
}

export async function fetchRegions(): Promise<Region[]> {
  const out: Region[] = []
  for (const [sido, code] of [['서울', '1100000000'], ['경기', '4100000000']]) {
    const rows = (await get('https://data-api.kbland.kr/bfmavm/map/siGunGuAreaNameList', { 법정동코드: code })) as KbAreaRow[]
    out.push(...leafRegions(sido, rows))
  }
  return out
}

interface RankRow {
  순위: number; 단지기본일련번호: number; 아파트명: string; 세대수값?: number; 준공년월?: string
  평당시세값?: number; 시세총액?: string; 기준년월: string
}

export async function fetchRanking(region: Region): Promise<KbRankItem[]> {
  const data = (await get('https://data-api.kbland.kr/bfmstat/kbleadapt50/areaIndxAndAptPrcIndxAndRankgList', {
    TOP코드: 'T30', TOP코드명: 'TOP30', 기간코드: '24', 기준조건코드: 'A01',
    법정동코드: region.code, 변동률여부: '0', 지역명: region.name,
  })) as { TOP아파트순위정보?: { 데이터리스트?: RankRow[] } }
  return (data.TOP아파트순위정보?.데이터리스트 ?? []).map((x) => ({
    rank: x.순위,
    kbComplexId: String(x.단지기본일련번호),
    aptName: x.아파트명,
    generalHouseholds: x.세대수값,
    completion: x.준공년월,
    pricePerPyeong: x.평당시세값,
    marketCap: x.시세총액,
    baseMonth: x.기준년월,
  }))
}

interface BrifRow {
  wgs84위도?: string; wgs84경도?: string; 총세대수?: number; 시군구명: string; 법정동명: string
  최소전용면적?: string; 최대전용면적?: string
}

/** 좌표는 바뀌지 않으므로 id 별 영구 캐시. 좌표가 없으면 null (캐시하지 않는다). */
export async function fetchComplex(kbComplexId: string): Promise<KbComplex | null> {
  mkdirSync(CACHE, { recursive: true })
  const file = new URL(`complex-${kbComplexId}.json`, CACHE)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as KbComplex
  const b = (await get('https://api.kbland.kr/land-complex/complex/brif', { 단지기본일련번호: kbComplexId })) as BrifRow | undefined
  if (!b?.wgs84위도 || !b.wgs84경도) return null
  const c: KbComplex = {
    lat: Number(b.wgs84위도), lng: Number(b.wgs84경도), households: b.총세대수,
    sigungu: b.시군구명, dong: b.법정동명, minArea: b.최소전용면적, maxArea: b.최대전용면적,
  }
  writeFileSync(file, JSON.stringify(c))
  return c
}
