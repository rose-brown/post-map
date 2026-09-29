/**
 * KTDB GTFS 에서 수도권 도시철도만 읽는다 (스펙 3절). stop_times.txt 가 1.4GB 라 한 줄씩 흘려 읽고
 * 접두사가 맞는 줄만 남긴다.
 */
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { ROUTE_PREFIX, STOP_PREFIX, parseTime, splitCsv } from './build.ts'
import type { Route, Stop, StopTime, Transfer } from './build.ts'

async function* rows(dir: string, file: string, prefix: string): AsyncGenerator<string[]> {
  const rl = createInterface({ input: createReadStream(join(dir, file), 'utf8'), crlfDelay: Infinity })
  let first = true
  for await (const raw of rl) {
    const line = first ? raw.replace(/^﻿/, '') : raw
    first = false
    if (line.startsWith(prefix)) yield splitCsv(line)
  }
}

/** 헤더가 스펙 3절에서 확인한 순서인지 본다 — 배포판이 바뀌면 조용히 틀린 열을 읽지 않게. */
async function checkHeader(dir: string, file: string, expected: string): Promise<void> {
  const rl = createInterface({ input: createReadStream(join(dir, file), 'utf8'), crlfDelay: Infinity })
  for await (const raw of rl) {
    rl.close()
    const got = raw.replace(/^﻿/, '').trim()
    if (got !== expected) throw new Error(`${file} 헤더가 다르다: ${got}`)
    return
  }
}

export interface Gtfs { stops: Stop[]; routes: Route[]; stopTimes: StopTime[]; transfers: Transfer[] }

export async function readGtfs(dir: string): Promise<Gtfs> {
  await checkHeader(dir, 'stops.txt', 'stop_id,stop_name,stop_lat,stop_lon')
  await checkHeader(dir, 'routes.txt', 'route_id,agency_id,route_short_name,route_long_name,route_type')
  await checkHeader(dir, 'stop_times.txt', 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type,timepoint')
  await checkHeader(dir, 'transfers.txt', 'from_stop_id,to_stop_id,transfer_type,min_transfer_time')

  const stops: Stop[] = []
  for await (const [id, name, lat, lng] of rows(dir, 'stops.txt', STOP_PREFIX)) stops.push({ id, name, lat: Number(lat), lng: Number(lng) })
  const routes: Route[] = []
  for await (const [id, , shortName, longName] of rows(dir, 'routes.txt', ROUTE_PREFIX)) routes.push({ id, shortName, longName })
  const stopTimes: StopTime[] = []
  for await (const [tripId, arrival, , stopId, seq] of rows(dir, 'stop_times.txt', ROUTE_PREFIX)) {
    stopTimes.push({ tripId, arrival: parseTime(arrival), stopId, seq: Number(seq) })
  }
  const transfers: Transfer[] = []
  for await (const [from, to, , s] of rows(dir, 'transfers.txt', STOP_PREFIX)) {
    if (to.startsWith(STOP_PREFIX)) transfers.push({ from, to, seconds: Number(s) })
  }
  return { stops, routes, stopTimes, transfers }
}
