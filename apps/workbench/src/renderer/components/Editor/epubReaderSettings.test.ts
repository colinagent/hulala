import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_EPUB_READER_SETTINGS,
  EPUB_READER_SETTINGS_KEY,
  MAX_EPUB_FONT_SCALE,
  MIN_EPUB_FONT_SCALE,
  clampEpubFontScale,
  formatEpubFontScalePercent,
  getEpubReaderSettings,
  isEpubFilePath,
  parseEpubReaderSettings,
  resetEpubFontScale,
  setEpubReaderFont,
  setEpubReaderSettings,
  stepEpubFontScale,
  subscribeEpubReaderSettings,
} from './epubReaderSettings.ts';

test('EPUB reader settings migrate legacy paper to auto and preserve valid preferences', () => {
  assert.deepEqual(parseEpubReaderSettings('{"fontScale":1.24,"theme":"paper"}'), {
    fontScale: 1.24,
    theme: 'auto',
    font: 'app',
  });
  assert.deepEqual(parseEpubReaderSettings('{"fontScale":1.16,"theme":"sepia","font":"serif"}'), {
    fontScale: 1.16,
    theme: 'sepia',
    font: 'serif',
  });
  assert.deepEqual(parseEpubReaderSettings('{"fontScale":0.9,"theme":"night","font":"sans"}'), {
    fontScale: 0.9,
    theme: 'night',
    font: 'sans',
  });
  assert.equal(parseEpubReaderSettings('{"font":"publisher"}').font, 'publisher');
  assert.equal(parseEpubReaderSettings('{"font":"invalid"}').font, 'app');
  assert.deepEqual(parseEpubReaderSettings('not-json'), DEFAULT_EPUB_READER_SETTINGS);
});

test('EPUB font scale clamps, steps, resets, and notifies subscribers', () => {
  setEpubReaderSettings(DEFAULT_EPUB_READER_SETTINGS);
  const seen: string[] = [];
  const unsubscribe = subscribeEpubReaderSettings(() => {
    seen.push(formatEpubFontScalePercent(getEpubReaderSettings().fontScale));
  });

  assert.equal(formatEpubFontScalePercent(stepEpubFontScale(1).fontScale), '108%');
  assert.equal(formatEpubFontScalePercent(stepEpubFontScale(-1).fontScale), '100%');
  assert.equal(formatEpubFontScalePercent(resetEpubFontScale().fontScale), '100%');
  unsubscribe();

  assert.deepEqual(seen, ['108%', '100%']);
  assert.equal(clampEpubFontScale(0), MIN_EPUB_FONT_SCALE);
  assert.equal(clampEpubFontScale(10), MAX_EPUB_FONT_SCALE);
});

test('EPUB font preset updates globally and notifies subscribers', () => {
  setEpubReaderSettings(DEFAULT_EPUB_READER_SETTINGS);
  const seen: string[] = [];
  const unsubscribe = subscribeEpubReaderSettings(() => {
    seen.push(getEpubReaderSettings().font);
  });

  assert.equal(setEpubReaderFont('serif').font, 'serif');
  assert.equal(setEpubReaderFont('sans').font, 'sans');
  assert.equal(setEpubReaderFont('publisher').font, 'publisher');
  assert.equal(setEpubReaderFont('app').font, 'app');
  unsubscribe();

  assert.deepEqual(seen, ['serif', 'sans', 'publisher', 'app']);
});

test('EPUB font preset persists with the existing reader settings key', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    },
  });

  try {
    setEpubReaderSettings({ fontScale: 1.16, theme: 'night', font: 'sans' });
    assert.deepEqual(JSON.parse(storage.get(EPUB_READER_SETTINGS_KEY) || '{}'), {
      fontScale: 1.16,
      theme: 'night',
      font: 'sans',
    });
  } finally {
    setEpubReaderSettings(DEFAULT_EPUB_READER_SETTINGS);
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
});

test('EPUB file detection is case-insensitive and excludes PDF', () => {
  assert.equal(isEpubFilePath('/books/Example.EPUB'), true);
  assert.equal(isEpubFilePath('/books/Example.pdf'), false);
  assert.equal(isEpubFilePath(null), false);
});
