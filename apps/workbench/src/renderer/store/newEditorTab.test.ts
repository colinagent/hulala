import assert from 'node:assert/strict';
import test from 'node:test';

import { NEW_TAB_TITLE, isBlankNewTab, retargetActiveBlankNewTab } from './newEditorTab';

type TestTab = {
  id: string;
  title: string;
  filePath?: string;
  editorId: string;
  content: string;
};

test('isBlankNewTab matches only empty markdown New Tab tabs', () => {
  assert.equal(isBlankNewTab({
    id: 't1',
    title: NEW_TAB_TITLE,
    editorId: 'markdown',
    content: '',
  }), true);

  assert.equal(isBlankNewTab({
    id: 't2',
    title: 'README.md',
    filePath: '/tmp/README.md',
    editorId: 'markdown',
    content: '',
  }), false);

  assert.equal(isBlankNewTab({
    id: 't3',
    title: NEW_TAB_TITLE,
    editorId: 'markdown',
    content: 'hello',
  }), false);
});

test('retargetActiveBlankNewTab retargets the active blank New Tab in place', () => {
  const tabs: TestTab[] = [
    { id: 'doc-1', title: 'README.md', filePath: '/tmp/README.md', editorId: 'markdown', content: '# readme' },
    { id: 'new-1', title: NEW_TAB_TITLE, editorId: 'markdown', content: '' },
  ];

  const result = retargetActiveBlankNewTab(tabs, 'new-1', (tab) => ({
    ...tab,
    title: 'hello',
    filePath: '/tmp/.agent/chat/hello.md',
    content: '',
  }));

  assert.equal(result.retargeted, true);
  assert.equal(result.tab?.id, 'new-1');
  assert.equal(result.tab?.filePath, '/tmp/.agent/chat/hello.md');
  assert.deepEqual(result.tabs.map((tab) => tab.title), ['README.md', 'hello']);
});

test('retargetActiveBlankNewTab does nothing when active tab is not a blank New Tab', () => {
  const tabs: TestTab[] = [
    { id: 'new-1', title: NEW_TAB_TITLE, editorId: 'markdown', content: 'draft' },
  ];

  const result = retargetActiveBlankNewTab(tabs, 'new-1', (tab) => ({
    ...tab,
    title: 'hello',
    filePath: '/tmp/.agent/chat/hello.md',
  }));

  assert.equal(result.retargeted, false);
  assert.equal(result.tab, null);
  assert.deepEqual(result.tabs, tabs);
});
