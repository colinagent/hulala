import React, { useEffect, useState } from 'react';

import {
  DEFAULT_EDITOR_FONT_SIZE,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  formatEditorFontSizePercent,
  getCurrentEditorFontSize,
  resetCurrentEditorFontSize,
  stepCurrentEditorFontSize,
  subscribeEditorFontSize,
} from './Editor/codemirror/editorMouseWheelZoom';
import { ZoomStatusControl } from './ZoomStatusControl';

export function EditorTextZoomStatusControl() {
  const [fontSize, setFontSize] = useState(() => getCurrentEditorFontSize());

  useEffect(() => subscribeEditorFontSize(setFontSize), []);

  const percent = formatEditorFontSizePercent(fontSize);
  const title = `Markdown Text Zoom: ${percent}. Reset returns to ${formatEditorFontSizePercent(DEFAULT_EDITOR_FONT_SIZE)}.`;

  return (
    <ZoomStatusControl
      label="Text"
      percent={percent}
      title={title}
      canZoomOut={fontSize > EDITOR_FONT_SIZE_MIN}
      canZoomIn={fontSize < EDITOR_FONT_SIZE_MAX}
      onZoomOut={() => stepCurrentEditorFontSize(-1)}
      onZoomIn={() => stepCurrentEditorFontSize(1)}
      onReset={resetCurrentEditorFontSize}
    />
  );
}
