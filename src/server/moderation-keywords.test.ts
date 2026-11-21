import { test } from 'node:test'
import assert from 'node:assert/strict'
import { customGroupAdKeywords, effectiveGroupAdKeywords, recommendedGroupAdKeywords } from './moderation-keywords'

test('group keyword sources follow each saved auto-upload and auto-sync switch', () => {
  assert.deepEqual(effectiveGroupAdKeywords('custom term', 'shared term', false, false), ['custom term'])
  assert.deepEqual(effectiveGroupAdKeywords('custom term', 'shared term', true, false), ['custom term', ...recommendedGroupAdKeywords])
  assert.deepEqual(effectiveGroupAdKeywords('custom term', 'shared term', false, true), ['custom term', 'shared term'])
  assert.deepEqual(effectiveGroupAdKeywords('custom term', 'shared term', true, true), ['custom term', ...recommendedGroupAdKeywords, 'shared term'])
})

test('unset legacy switches default to enabled and old materialized sources are separated from group keywords', () => {
  assert.deepEqual(effectiveGroupAdKeywords('local, 博彩, shared term', 'shared term', null, undefined), [
    'local',
    ...recommendedGroupAdKeywords,
    'shared term',
  ])
  assert.deepEqual(customGroupAdKeywords('local, 博彩, shared term', 'shared term'), ['local'])
})

test('keyword matching is case-insensitive for deduplication', () => {
  assert.deepEqual(effectiveGroupAdKeywords('Local,local', 'SHARED,shared', false, true), ['Local', 'SHARED'])
})
