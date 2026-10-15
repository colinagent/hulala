import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EPUB_SANS_FONT_FAMILY,
  EPUB_SERIF_FONT_FAMILY,
  applyEpubReaderFont,
} from './epubReaderFont.ts';

function createThemes() {
  const fonts: string[] = [];
  const removed: string[] = [];
  const overrides: Array<[string, string, boolean | undefined]> = [];
  return {
    fonts,
    removed,
    overrides,
    themes: {
      font: (value: string) => fonts.push(value),
      removeOverride: (name: string) => removed.push(name),
      override: (name: string, value: string, priority?: boolean) => {
        overrides.push([name, value, priority]);
      },
    },
  };
}

test('App font injects the computed Markdown document font', () => {
  const state = createThemes();
  applyEpubReaderFont(state.themes, 'app', 'Custom App Font, sans-serif');
  assert.deepEqual(state.fonts, ['Custom App Font, sans-serif']);
});

test('reader serif and sans presets use CJK-first stacks', () => {
  const state = createThemes();
  applyEpubReaderFont(state.themes, 'serif', 'unused');
  applyEpubReaderFont(state.themes, 'sans', 'unused');

  assert.equal(state.fonts[0], EPUB_SERIF_FONT_FAMILY);
  assert.equal(state.fonts[1], EPUB_SANS_FONT_FAMILY);
  assert.ok(EPUB_SERIF_FONT_FAMILY.startsWith('"Songti SC"'));
  assert.ok(EPUB_SANS_FONT_FAMILY.startsWith('"PingFang SC"'));
});

test('Original font removes an earlier reader font override', () => {
  const state = createThemes();
  applyEpubReaderFont(state.themes, 'serif', 'unused');
  applyEpubReaderFont(state.themes, 'publisher', 'unused');

  assert.deepEqual(state.removed, ['font-family']);
  assert.deepEqual(state.overrides, []);
});

test('Original font falls back to an empty override when removeOverride is unavailable', () => {
  const state = createThemes();
  const themesWithoutRemove = { ...state.themes, removeOverride: undefined };
  applyEpubReaderFont(themesWithoutRemove, 'publisher', 'unused');
  assert.deepEqual(state.overrides, [['font-family', '', true]]);
});
