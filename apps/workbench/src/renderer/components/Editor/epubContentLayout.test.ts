import assert from 'node:assert/strict';
import test from 'node:test';

import { hasMalformedEpubNonBreakingWhitespace } from './epubContentLayout.ts';

test('detects long EPUB text whose normal word gaps were replaced by NBSP', () => {
  const malformed = [
    '[18]',
    'Penafiel,',
    'K.,',
    'The',
    'Empire',
    'State',
    'Building:',
    'An',
    'Innovative',
    'Skyscraper,',
    'Empire',
    'State',
    'Building',
    'Fact',
    'Sheet.',
  ].join('\u00a0');
  assert.equal(hasMalformedEpubNonBreakingWhitespace(malformed), true);
});

test('preserves normal prose and isolated semantic NBSP uses', () => {
  assert.equal(
    hasMalformedEpubNonBreakingWhitespace(
      'A long ordinary paragraph can contain many words and still wrap normally because it uses regular spaces.',
    ),
    false,
  );
  assert.equal(
    hasMalformedEpubNonBreakingWhitespace(
      'The measured value was 1\u00a0500 units, which is a legitimate non-breaking numeric separator in this sentence.',
    ),
    false,
  );
});
