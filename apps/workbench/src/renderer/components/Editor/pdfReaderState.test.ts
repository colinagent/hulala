import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculatePdfFitZoom,
  clampPdfBookViewStatePage,
  defaultPdfBookViewState,
  getPdfReadingSnapshot,
  parsePdfBookViewState,
  pdfViewStateStorageKey,
  publishPdfReadingSnapshot,
  requestPdfReaderCommand,
  subscribePdfReaderCommands,
} from './pdfReaderState.ts';

test('fit zoom uses both axes, padding, and the activity-panel safe area', () => {
  const zoom = calculatePdfFitZoom({
    pageWidth: 600,
    pageHeight: 800,
    containerWidth: 1000,
    containerHeight: 1000,
    horizontalPadding: 96,
    verticalPadding: 32,
    bottomSafeArea: 100,
  });
  assert.equal(zoom, 868 / 800);

  const landscape = calculatePdfFitZoom({
    pageWidth: 1200,
    pageHeight: 600,
    containerWidth: 900,
    containerHeight: 900,
    horizontalPadding: 96,
    verticalPadding: 32,
  });
  assert.equal(landscape, 804 / 1200);
});

test('fit zoom can go below the manual zoom floor for oversized pages', () => {
  assert.equal(calculatePdfFitZoom({
    pageWidth: 10_000,
    pageHeight: 10_000,
    containerWidth: 500,
    containerHeight: 500,
  }), 0.05);
});

test('persistent PDF state validates fields and defaults to whole-page fit', () => {
  assert.deepEqual(parsePdfBookViewState(null), defaultPdfBookViewState());
  assert.deepEqual(parsePdfBookViewState('not-json'), defaultPdfBookViewState());
  assert.deepEqual(parsePdfBookViewState(JSON.stringify({
    page: 12.8,
    displayMode: 'custom',
    customZoom: 9,
    scrollTop: 42,
    scrollLeft: -4,
  })), {
    page: 12,
    displayMode: 'custom',
    customZoom: 2.4,
    scrollTop: 42,
    scrollLeft: 0,
  });
  assert.equal(clampPdfBookViewStatePage({
    ...defaultPdfBookViewState(),
    page: 100,
  }, 14).page, 14);
});

test('persistent key prefers resource URI and normalizes fallback paths', () => {
  const uriKey = pdfViewStateStorageKey({ uri: 'hulala://workspace/file.pdf', filePath: '/ignored.pdf' });
  assert.match(uriKey, /uri%3Ahulala%3A%2F%2Fworkspace%2Ffile\.pdf$/);
  assert.equal(
    pdfViewStateStorageKey({ filePath: '\\workspace\\books\\demo.pdf\\' }),
    pdfViewStateStorageKey({ filePath: '/workspace/books/demo.pdf' }),
  );
});

test('per-tab PDF session publishes snapshots and dispatches commands', () => {
  const tabId = 'tab-pdf-test';
  const seen: string[] = [];
  const unsubscribe = subscribePdfReaderCommands(tabId, (command) => seen.push(command));
  publishPdfReadingSnapshot(tabId, {
    ...defaultPdfBookViewState(),
    page: 5,
    pageCount: 20,
    effectiveZoom: 0.8,
  });
  assert.equal(getPdfReadingSnapshot(tabId)?.page, 5);
  requestPdfReaderCommand(tabId, 'zoom-in');
  requestPdfReaderCommand(tabId, 'fit-page');
  unsubscribe();
  assert.deepEqual(seen, ['zoom-in', 'fit-page']);
});
