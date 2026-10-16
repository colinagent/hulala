import React, { useCallback, useSyncExternalStore } from 'react';

import {
  formatEpubReadingProgress,
  getEpubReadingProgress,
  subscribeEpubReadingProgress,
} from './Editor/epubReadingProgress';

export function EpubReadingProgressStatusControl({ filePath }: { filePath: string }) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeEpubReadingProgress(filePath, listener),
    [filePath],
  );
  const getSnapshot = useCallback(() => getEpubReadingProgress(filePath), [filePath]);
  const progress = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const percent = formatEpubReadingProgress(progress);
  const title = `EPUB reading progress: ${percent}`;

  return (
    <span className="whitespace-nowrap tabular-nums" title={title} aria-label={title}>
      Reading {percent}
    </span>
  );
}
