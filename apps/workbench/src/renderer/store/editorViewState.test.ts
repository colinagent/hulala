import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EditorViewStateMemento,
  type EditorViewStateIdentity,
} from './editorViewState.ts';

const markdownState = {
  kind: 'markdown' as const,
  selectionAnchor: 820,
  selectionHead: 840,
  scrollTop: 1200,
  scrollLeft: 0,
  scrollAnchorPos: 760,
  scrollAnchorOffsetTop: 18,
};

function identity(tabId: string, filePath: string): EditorViewStateIdentity {
  return {
    tabId,
    uri: `file://${filePath}`,
    filePath,
  };
}

test('view state survives editor-type replacement because the memento owns it', () => {
  const memento = new EditorViewStateMemento();
  const markdown = identity('tab-markdown', '/workspace/three-kingdoms.md');

  memento.save(markdown, markdownState);
  assert.deepEqual(memento.load(markdown, 'markdown'), markdownState);
  assert.equal(memento.load(identity('tab-book', '/workspace/moat.epub'), 'epub'), null);
  assert.deepEqual(memento.load(markdown, 'markdown'), markdownState);
});

test('closing and reopening a resource in the same run restores by canonical identity', () => {
  const memento = new EditorViewStateMemento();
  const original = identity('tab-original', '/workspace/three-kingdoms.md');
  memento.save(original, markdownState);
  memento.forgetTab(original.tabId);

  const reopened = identity('tab-reopened', '/workspace/three-kingdoms.md');
  assert.deepEqual(memento.load(reopened, 'markdown'), markdownState);
});

test('tab identity wins while a tab resource is retargeted', () => {
  const memento = new EditorViewStateMemento();
  memento.save(identity('tab-chat', '/workspace/old.md'), markdownState);

  assert.deepEqual(
    memento.load(identity('tab-chat', '/workspace/new.md'), 'markdown'),
    markdownState,
  );
});

test('editor kinds never reuse incompatible state', () => {
  const memento = new EditorViewStateMemento();
  const target = identity('tab-a', '/workspace/a.md');
  memento.save(target, markdownState);

  assert.equal(memento.load(target, 'text'), null);
  assert.equal(memento.load(target, 'pdf'), null);
});

test('resource entries are bounded and least-recently-used', () => {
  const memento = new EditorViewStateMemento(2);
  const first = identity('tab-1', '/workspace/1.md');
  const second = identity('tab-2', '/workspace/2.md');
  const third = identity('tab-3', '/workspace/3.md');
  memento.save(first, markdownState);
  memento.save(second, { ...markdownState, scrollTop: 2 });
  memento.forgetTab(first.tabId);
  assert.ok(memento.load(first, 'markdown'));
  memento.forgetTab(first.tabId);
  memento.save(third, { ...markdownState, scrollTop: 3 });
  memento.forgetTab(second.tabId);

  assert.equal(memento.load(second, 'markdown'), null);
  assert.ok(memento.load(first, 'markdown'));
  assert.ok(memento.load(third, 'markdown'));
});

test('clearing a workspace drops all runtime-only state', () => {
  const memento = new EditorViewStateMemento();
  const target = identity('tab-a', '/workspace/a.md');
  memento.save(target, markdownState);
  memento.clear();

  assert.equal(memento.load(target, 'markdown'), null);
});

test('restores reading position across page and Host recreation without storing document text', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const original = new EditorViewStateMemento(200, storage, 'workspace-a');
  original.save({ tabId: 'old', uri: 'file://old-host/book.pdf', filePath: '/workspace/book.pdf' }, { kind: 'pdf', page: 7, customZoom: 125, displayMode: 'custom', scrollTop: 300, scrollLeft: 0 });
  const recreated = new EditorViewStateMemento(200, storage, 'workspace-a');
  assert.equal((recreated.load({ tabId: 'new', uri: 'file://new-host/book.pdf', filePath: '/workspace/book.pdf' }, 'pdf') as { page: number }).page, 7);
  assert.equal(new EditorViewStateMemento(200, storage, 'workspace-b').load(identity('new', '/workspace/book.pdf'), 'pdf'), null);
  values.set('broken', '[ ["path:/workspace/book.pdf", {"kind":"pdf","page":"bad"}] ]');
  assert.equal(new EditorViewStateMemento(200, storage, 'broken').load(identity('new', '/workspace/book.pdf'), 'pdf'), null);
  original.save(identity('word-old', '/workspace/document.docx'), { kind: 'word', page: 2, scrollTop: 900, zoom: 1.1 });
  assert.deepEqual(new EditorViewStateMemento(200, storage, 'workspace-a').load(identity('word-new', '/workspace/document.docx'), 'word'), { kind: 'word', page: 2, scrollTop: 900, zoom: 1.1 });
});
