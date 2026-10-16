import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendPlanReference,
  buildPlanReferenceBlock,
  buildRelativePlanLink,
  hasPlanReference,
} from './planReference';

test('buildRelativePlanLink computes plan path relative to chat file', () => {
  assert.equal(
    buildRelativePlanLink('/workspace/.agent/chat/demo.md', '/workspace/.agent/context/release-plan.md'),
    '../context/release-plan.md'
  );
});

test('buildPlanReferenceBlock renders a quoted markdown link', () => {
  assert.equal(
    buildPlanReferenceBlock('Release Plan', '../context/release-plan.md'),
    '> Plan: [Release Plan](../context/release-plan.md)'
  );
});

test('hasPlanReference detects an existing plan link', () => {
  const content = [
    '# Chat',
    '',
    '> Plan: [Release Plan](../context/release-plan.md)',
    '',
  ].join('\n');
  assert.equal(hasPlanReference(content, '../context/release-plan.md'), true);
  assert.equal(hasPlanReference(content, '../context/other.md'), false);
});

test('appendPlanReference appends with a blank-line separator', () => {
  const content = [
    '# Chat',
    '',
    'Assistant response',
  ].join('\n');
  assert.equal(
    appendPlanReference(content, '> Plan: [Release Plan](../context/release-plan.md)'),
    [
      '# Chat',
      '',
      'Assistant response',
      '',
      '> Plan: [Release Plan](../context/release-plan.md)',
      '',
    ].join('\n')
  );
});
