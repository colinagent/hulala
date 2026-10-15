import React, { useCallback, useSyncExternalStore } from 'react';

import {
  MAX_PDF_CUSTOM_ZOOM,
  MIN_PDF_CUSTOM_ZOOM,
  getPdfReadingSnapshot,
  requestPdfReaderCommand,
  subscribePdfReadingSnapshot,
} from './Editor/pdfReaderState';
import { ZoomStatusControl } from './ZoomStatusControl';

export function PdfZoomStatusControl({ tabId }: { tabId: string }) {
  const subscribe = useCallback(
    (listener: () => void) => subscribePdfReadingSnapshot(tabId, listener),
    [tabId],
  );
  const getSnapshot = useCallback(() => getPdfReadingSnapshot(tabId), [tabId]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => null);
  if (!snapshot) {
    return null;
  }
  const zoom = snapshot.displayMode === 'fit-page' ? snapshot.effectiveZoom : snapshot.customZoom;
  const percent = snapshot.displayMode === 'fit-page' ? 'Fit' : `${Math.round(zoom * 100)}%`;
  const effectivePercent = `${Math.round(snapshot.effectiveZoom * 100)}%`;
  return (
    <ZoomStatusControl
      label="Page"
      percent={percent}
      title={snapshot.displayMode === 'fit-page'
        ? `PDF Page Fit (${effectivePercent}). Reset fits the whole page.`
        : `PDF Page Zoom: ${percent}. Reset fits the whole page.`}
      canZoomOut={zoom > MIN_PDF_CUSTOM_ZOOM}
      canZoomIn={zoom < MAX_PDF_CUSTOM_ZOOM}
      onZoomOut={() => requestPdfReaderCommand(tabId, 'zoom-out')}
      onZoomIn={() => requestPdfReaderCommand(tabId, 'zoom-in')}
      onReset={() => requestPdfReaderCommand(tabId, 'fit-page')}
    />
  );
}
