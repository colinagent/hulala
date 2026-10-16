import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getHeadingMarkerInfo,
  getListMarkerSourceClassName,
} from './livePreviewPlugin';

function createMockView(doc: string) {
  return {
    state: {
      sliceDoc(from: number, to: number) {
        return doc.slice(from, to);
      },
    },
  };
}

test('heading marker info keeps the whitespace after # outside the marker span', () => {
  const doc = '## heading';
  const info = getHeadingMarkerInfo(createMockView(doc), 0, doc.length);

  assert.deepEqual(info, {
    hashesTo: 2,
    contentFrom: 3,
  });
});

test('heading marker info supports multiple spaces and tabs before heading content', () => {
  const doc = '### \t heading';
  const info = getHeadingMarkerInfo(createMockView(doc), 0, doc.length);

  assert.deepEqual(info, {
    hashesTo: 3,
    contentFrom: 6,
  });
});

test('heading marker info returns null for non-heading text', () => {
  const doc = 'plain text';
  assert.equal(getHeadingMarkerInfo(createMockView(doc), 0, doc.length), null);
});

test('heading preview waits for content so typing hashes keeps stable text geometry', () => {
  for (const doc of ['#', '##', '######', '# ', '### \t ', '# #', '## ## ']) {
    assert.equal(getHeadingMarkerInfo(createMockView(doc), 0, doc.length), null);
  }
});

test('tag-shaped text is not treated as a heading', () => {
  for (const doc of ['#tag', '#标签', '##tag']) {
    assert.equal(getHeadingMarkerInfo(createMockView(doc), 0, doc.length), null);
  }
});

test('heading preview begins once marker, whitespace, and content are explicit', () => {
  const doc = '## 标题';
  assert.deepEqual(getHeadingMarkerInfo(createMockView(doc), 0, doc.length), {
    hashesTo: 2,
    contentFrom: 3,
  });
});

test('list marker source class is source-only when inactive', () => {
  assert.equal(getListMarkerSourceClassName(false), 'cm-md-list-marker-source');
});

test('list marker source class includes shared syntax-visible semantics when active', () => {
  assert.equal(
    getListMarkerSourceClassName(true),
    'cm-md-list-marker-source cm-md-list-marker-source-active cm-md-syntax-visible'
  );
});
