import React, { useCallback, useSyncExternalStore } from 'react';

import {
  getPdfReadingSnapshot,
  subscribePdfReadingSnapshot,
} from './Editor/pdfReaderState';

export function PdfReadingProgressStatusControl({ tabId }: { tabId: string }) {
  const subscribe = useCallback(
    (listener: () => void) => subscribePdfReadingSnapshot(tabId, listener),
    [tabId],
  );
  const getSnapshot = useCallback(() => getPdfReadingSnapshot(tabId), [tabId]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => null);
  if (!snapshot || snapshot.pageCount <= 0) {
    return null;
  }
  const percent = Math.min(100, Math.max(0, Math.round((snapshot.page / snapshot.pageCount) * 100)));
  const title = `PDF reading progress: page ${snapshot.page} of ${snapshot.pageCount}`;
  return (
    <span className="whitespace-nowrap tabular-nums" title={title} aria-label={title}>
      Reading {percent}%
    </span>
  );
}
