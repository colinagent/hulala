import { describe, expect, test } from 'bun:test';
import { movePaneDocument } from './editorPaneState';

const documents = [
  { id: 'a', filePath: '/a.md', pane: 'main' as const },
  { id: 'b', filePath: '/b.md', pane: 'main' as const },
  { id: 'c', filePath: '/c.pdf', pane: 'right' as const },
];

describe('editor pane movement', () => {
  test('moves one unique file tab and selects the adjacent source fallback', () => {
    const result = movePaneDocument(documents, 'a', 'right');
    expect(result?.documents.filter((tab) => tab.id === 'a')).toHaveLength(1);
    expect(result?.moved.pane).toBe('right');
    expect(result?.sourceFallbackId).toBe('b');
  });

  test('moves a right tab back to main without cloning it', () => {
    const result = movePaneDocument(documents, 'c', 'main');
    expect(result?.documents.filter((tab) => tab.id === 'c')).toHaveLength(1);
    expect(result?.moved.pane).toBe('main');
    expect(result?.sourceFallbackId).toBeUndefined();
  });

  test('rejects Welcome and other non-file tabs', () => {
    expect(movePaneDocument([{ id: 'welcome', pane: 'main' }], 'welcome', 'right')).toBeNull();
  });
});
