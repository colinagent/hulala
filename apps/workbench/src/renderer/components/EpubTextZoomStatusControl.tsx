import React, { useSyncExternalStore } from 'react';

import {
  DEFAULT_EPUB_READER_SETTINGS,
  MAX_EPUB_FONT_SCALE,
  MIN_EPUB_FONT_SCALE,
  formatEpubFontScalePercent,
  getEpubReaderSettings,
  resetEpubFontScale,
  stepEpubFontScale,
  subscribeEpubReaderSettings,
} from './Editor/epubReaderSettings';
import { ZoomStatusControl } from './ZoomStatusControl';

export function EpubTextZoomStatusControl() {
  const settings = useSyncExternalStore(
    subscribeEpubReaderSettings,
    getEpubReaderSettings,
    getEpubReaderSettings,
  );
  const percent = formatEpubFontScalePercent(settings.fontScale);
  const defaultPercent = formatEpubFontScalePercent(DEFAULT_EPUB_READER_SETTINGS.fontScale);

  return (
    <ZoomStatusControl
      label="Text"
      percent={percent}
      title={`EPUB Text Zoom: ${percent}. Reset returns to ${defaultPercent}.`}
      canZoomOut={settings.fontScale > MIN_EPUB_FONT_SCALE}
      canZoomIn={settings.fontScale < MAX_EPUB_FONT_SCALE}
      onZoomOut={() => stepEpubFontScale(-1)}
      onZoomIn={() => stepEpubFontScale(1)}
      onReset={resetEpubFontScale}
    />
  );
}
