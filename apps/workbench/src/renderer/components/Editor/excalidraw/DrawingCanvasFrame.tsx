import React, { useLayoutEffect, useRef } from 'react';
import type { DrawingFrameController, DrawingFrameOptions } from './drawingFrameContract';

type Props = DrawingFrameOptions & {
  title: string;
  controllerRef: React.MutableRefObject<DrawingFrameController | null>;
};

export function DrawingCanvasFrame({ title, controllerRef, ...options }: Props) {
  const latest = useRef(options);
  latest.current = options;
  useLayoutEffect(() => {
    controllerRef.current?.present(options);
    if (options.active && options.autoFocus !== false) controllerRef.current?.focus();
  }, [controllerRef, options.active, options.saving, options.langCode, options.autoFocus, options.editorBackground, options.theme, options.staticGlass]);
  useLayoutEffect(() => () => { controllerRef.current = null; }, [controllerRef]);
  return <iframe className="hulala-drawing-frame" title={title}
    src={new URL('/drawing.html', window.location.origin).href}
    onLoad={(event) => {
      const controller = event.currentTarget.contentWindow?.hulalaDrawingFrame;
      if (!controller) { latest.current.onError('loadFailed'); return; }
      controllerRef.current = controller;
      void controller.initialize({ ...latest.current,
        onReady: () => latest.current.onReady(),
        onDirty: () => latest.current.onDirty(),
        onError: (message) => latest.current.onError(message),
        onSave: () => latest.current.onSave(),
        onWorkspaceShortcut: (index) => latest.current.onWorkspaceShortcut(index),
      });
    }} />;
}
