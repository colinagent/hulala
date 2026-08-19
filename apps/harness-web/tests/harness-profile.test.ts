import assert from 'node:assert/strict'
import test from 'node:test'

import { createHarnessPatch } from '../scripts/harness-profile.ts'

test('builds a portable Harness patch from the checkout location', () => {
  const serialized = JSON.stringify(createHarnessPatch('/tmp/a checkout/Hulala'))
  assert.match(serialized, /file:\/\/\/tmp\/a%20checkout\/Hulala\/packages\/agent-loop-pi\/lib\/index\.js/)
  assert.match(serialized, /@deepseek-ai\/dsh-agent-loop/)
  assert.doesNotMatch(serialized, /Users\/colin|\.\.\/\.\./)
})
