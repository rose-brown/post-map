/**
 * 국토부 아파트 매매 실거래가 (data.go.kr). 엔드포인트·필드명은 스펙 3.1 (Task 1 실측).
 * 응답은 평면 XML 이라 정규식으로 읽는다 — 파서 의존성을 들이지 않는다.
 * 캐시는 (시군구, 년월) 파일. 최근 2개월은 늦은 신고 때문에 매번 다시 받는다 (refresh).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { Trade } from './build.ts'

const CACHE = new URL('./.cache/', import.meta.url)
const URL_BASE = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade'
const PAGE = 1000

const tag = (s: string, name: string) => s.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim() ?? ''

export function parseMolitXml(xml: string): { resultCode: string; totalCount: number; trades: Trade[] } {
  const trades = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => ({
    dong: tag(it, 'umdNm'),
    aptName: tag(it, 'aptNm'),
    area: Number(tag(it, 'excluUseAr')),
    price: Number(tag(it, 'dealAmount').replace(/,/g, '')),
    ymd: `${tag(it, 'dealYear')}-${tag(it, 'dealMonth').padStart(2, '0')}-${tag(it, 'dealDay').padStart(2, '0')}`,
    floor: tag(it, 'floor'),
    cancelled: tag(it, 'cdealType') === 'O',
  }))
  return { resultCode: tag(xml, 'resultCode'), totalCount: Number(tag(xml, 'totalCount') || 0), trades }
}

export function recentMonths(now: Date, n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}

export async function fetchTrades(sgg: string, ym: string, key: string, refresh: boolean): Promise<Trade[]> {
  mkdirSync(CACHE, { recursive: true })
  const file = new URL(`molit-${sgg}-${ym}.json`, CACHE)
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Trade[]
  const all: Trade[] = []
  for (let page = 1; ; page++) {
    const u = `${URL_BASE}?${new URLSearchParams({ serviceKey: decodeURIComponent(key), LAWD_CD: sgg, DEAL_YMD: ym, numOfRows: String(PAGE), pageNo: String(page) })}`
    const r = await fetch(u)
    const xml = await r.text()
    const p = parseMolitXml(xml)
    // 정상 코드는 Task 1 실측값. 한도 초과·키 오류는 여기서 멈춘다 (스펙 5절).
    if (r.status !== 200 || !['00', '000'].includes(p.resultCode)) {
      throw new Error(`MOLIT ${r.status} resultCode=${p.resultCode || '?'} sgg=${sgg} ym=${ym}`)
    }
    all.push(...p.trades)
    if (all.length >= p.totalCount || p.trades.length < PAGE) break
  }
  writeFileSync(file, JSON.stringify(all))
  return all
}
