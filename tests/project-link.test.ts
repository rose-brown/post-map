import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideProjectId } from '../src/db/project-link.ts'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

test('URL 이 있으면 URL 이 이긴다', () => {
  assert.equal(decideProjectId({ url: A, stored: B }), A)
})

test('URL 이 없으면 저장된 값을 쓴다', () => {
  assert.equal(decideProjectId({ url: null, stored: B }), B)
})

test('둘 다 없으면 null', () => {
  assert.equal(decideProjectId({ url: null, stored: null }), null)
})

test('uuid 형태가 아닌 URL 값은 무시하고 저장값으로 내려간다', () => {
  assert.equal(decideProjectId({ url: 'proj_abc123', stored: B }), B)
})

test('uuid 형태가 아닌 저장값도 무시한다', () => {
  assert.equal(decideProjectId({ url: null, stored: 'garbage' }), null)
})
