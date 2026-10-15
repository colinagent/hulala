import assert from 'node:assert/strict';
import test from 'node:test';

import { upsertSingletonEditorTab } from './singletonEditorTab';

type TestTab = {
  id: string;
  editorId: string;
  title: string;
};

test('upsertSingletonEditorTab removes welcome when inserting a new singleton tab', () => {
  const result = upsertSingletonEditorTab<TestTab>(
    [
      { id: 'welcome-1', editorId: 'welcome', title: 'Welcome' },
      { id: 'doc-1', editorId: 'markdown', title: 'README.md' },
    ],
    'dashboard',
    () => ({ id: 'dashboard-1', editorId: 'dashboard', title: 'Dashboard' }),
    { removeWelcome: true },
  );

  assert.equal(result.existed, false);
  assert.deepEqual(result.tabs.map((tab) => tab.editorId), ['markdown', 'dashboard']);
  assert.equal(result.tab.id, 'dashboard-1');
});

test('upsertSingletonEditorTab reuses an existing singleton tab without duplication', () => {
  const existingTabs: TestTab[] = [
    { id: 'doc-1', editorId: 'markdown', title: 'README.md' },
    { id: 'dashboard-1', editorId: 'dashboard', title: 'Dashboard' },
  ];

  const result = upsertSingletonEditorTab<TestTab>(
    existingTabs,
    'dashboard',
    () => ({ id: 'dashboard-2', editorId: 'dashboard', title: 'Dashboard' }),
    { removeWelcome: true },
  );

  assert.equal(result.existed, true);
  assert.equal(result.tab.id, 'dashboard-1');
  assert.deepEqual(result.tabs, existingTabs);
});
