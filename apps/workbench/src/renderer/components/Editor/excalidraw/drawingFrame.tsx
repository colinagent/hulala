import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import { loadDrawingRuntime, restoreDrawing } from './drawingRuntime';
import type { DrawingFrameOptions, DrawingFramePresentation } from './drawingFrameContract';
import '@excalidraw/excalidraw/index.css';
import './drawingFrame.css';

const root = createRoot(document.getElementById('root')!);
let options: DrawingFrameOptions;
let presentation: DrawingFramePresentation;
let sdk: Awaited<ReturnType<typeof loadDrawingRuntime>>;
let initial: ExcalidrawInitialDataState;
let api: ExcalidrawImperativeAPI | null = null;
let ready = false;
let fingerprint: string | null = null;
let lastFocus: HTMLElement | null = null;
let documentBackgroundColor = '#ffffff';

const focus = () => {
  if (!presentation?.active) return;
  const modal = document.querySelector<HTMLElement>('.excalidraw-modal-container [role="dialog"]');
  const previous = lastFocus?.isConnected && lastFocus.getClientRects().length ? lastFocus : null;
  const target = (modal && (!previous || !modal.contains(previous)))
    ? modal.querySelector<HTMLElement>('button:not(:disabled), [tabindex="0"], input')
    : previous;
  (target ?? document.querySelector<HTMLElement>('.excalidraw-container'))?.focus({ preventScroll: true });
};

document.addEventListener('focusin', (event) => {
  if (event.target instanceof HTMLElement && event.target !== document.body) lastFocus = event.target;
});
document.addEventListener('keydown', (event) => {
  if (!presentation?.active) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault(); event.stopImmediatePropagation(); options.onSave();
  }
}, true);

function render() {
  document.documentElement.style.backgroundColor = presentation.editorBackground || '#ffffff';
  for (const [name, value] of Object.entries(presentation.staticGlass || {})) {
    document.documentElement.style.setProperty(name, value);
  }
  if (!sdk || !initial) return;
  const Excalidraw = sdk.Excalidraw;
  root.render(<Excalidraw initialData={initial}
    excalidrawAPI={(value) => { api = value; }}
    onChange={(elements, appState) => {
      if (appState.isLoading) return;
      // Canvas background is a theme surface, not a document edit. ClearCanvas
      // can reset it, so restore transparency without adding an undo entry.
      if (appState.viewBackgroundColor !== 'transparent') {
        api?.updateScene({ appState: { viewBackgroundColor: 'transparent' }, captureUpdate: sdk.CaptureUpdateAction.NEVER });
      }
      const next = String(sdk.getSceneVersion(elements));
      if (fingerprint !== null && next !== fingerprint) options.onDirty();
      fingerprint = next;
      if (!ready && api) {
        ready = true;
        options.onReady();
        if (presentation.autoFocus !== false) requestAnimationFrame(focus);
      }
    }}
    langCode={presentation.langCode}
    theme={presentation.theme || 'light'}
    handleKeyboardGlobally={false}
    autoFocus={false}
    viewModeEnabled={presentation.saving}
    validateEmbeddable={false}
    onLinkOpen={(_element, event) => event.preventDefault()}
    UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, changeViewBackgroundColor: false, toggleTheme: false } }}
  >
    <sdk.MainMenu>
      <sdk.MainMenu.DefaultItems.ClearCanvas />
    </sdk.MainMenu>
  </Excalidraw>);
}

window.hulalaDrawingFrame = {
  async initialize(value) {
    options = value;
    presentation = value;
    try {
      sdk = await loadDrawingRuntime();
      const scene = value.content === null ? null : await restoreDrawing(value.content);
      documentBackgroundColor = scene?.appState?.viewBackgroundColor || '#ffffff';
      initial = {
        ...scene,
        elements: scene?.elements || [],
        appState: { ...scene?.appState, viewBackgroundColor: 'transparent' },
        scrollToContent: true,
      };
      render();
    } catch (error) { options.onError(error instanceof Error ? error.message : 'loadFailed'); }
  },
  present(value) {
    const becameActive = value.active && !presentation?.active;
    presentation = value;
    render();
    if (becameActive && value.autoFocus !== false) requestAnimationFrame(focus);
  },
  serialize(commitText = true) {
    if (!api || !sdk) throw new Error('saveFailed');
    // Commit an in-progress text edit before collecting the scene.
    const text = document.querySelector<HTMLTextAreaElement>('.excalidraw-wysiwyg');
    if (commitText && text) { flushSync(() => { text.blur(); }); focus(); }
    return sdk.serializeAsJSON(api.getSceneElementsIncludingDeleted(), {
      ...api.getAppState(), viewBackgroundColor: documentBackgroundColor,
    }, api.getFiles(), 'local');
  },
  focus,
};
