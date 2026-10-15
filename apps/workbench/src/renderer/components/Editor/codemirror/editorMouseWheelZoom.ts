import { type Extension, Prec } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

export const EDITOR_FONT_SIZE_MIN = 8;
export const EDITOR_FONT_SIZE_MAX = 40;
export const DEFAULT_EDITOR_FONT_SIZE = 16;
export const EDITOR_FONT_SIZE_PERCENT_STEP = 10;

const GESTURE_RESET_MS = 50;
const TRACKPAD_DELTA_TO_FONT_SIZE = 5;
const PHYSICAL_WHEEL_DELTA_THRESHOLD = 50;

export type EditorWheelZoomEvent = Pick<WheelEvent,
  'altKey' | 'ctrlKey' | 'deltaMode' | 'deltaY' | 'metaKey' | 'shiftKey'
>;

export type EditorFontSizeListener = (fontSize: number) => void;

let currentEditorFontSize: number | null = null;
let previousWheelTime = 0;
let gestureStartFontSize = DEFAULT_EDITOR_FONT_SIZE;
let gestureHasZoomModifiers = false;
let gestureAccumulatedDeltaY = 0;
const editorFontSizeListeners = new Set<EditorFontSizeListener>();
const editorFontSizeViews = new Set<EditorView>();

function notifyEditorFontSizeListeners() {
  for (const listener of editorFontSizeListeners) {
    listener(getCurrentEditorFontSize());
  }
}

function requestEditorFontSizeMeasure() {
  for (const view of editorFontSizeViews) {
    view.requestMeasure();
  }
}

function isMacPlatform(platform: NodeJS.Platform | string | undefined): boolean {
  if (platform) {
    return platform === 'darwin';
  }
  const navigatorPlatform = typeof navigator !== 'undefined' ? navigator.platform.toLowerCase() : '';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  return navigatorPlatform.includes('mac') || userAgent.includes('mac os');
}

export function clampEditorFontSize(fontSize: number): number {
  if (!Number.isFinite(fontSize)) {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
  return Math.min(EDITOR_FONT_SIZE_MAX, Math.max(EDITOR_FONT_SIZE_MIN, Math.round(fontSize * 10) / 10));
}

function editorFontSizeToPercent(fontSize: number): number {
  return (clampEditorFontSize(fontSize) / DEFAULT_EDITOR_FONT_SIZE) * 100;
}

function clampEditorFontSizePercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 100;
  }
  const minPercent = (EDITOR_FONT_SIZE_MIN / DEFAULT_EDITOR_FONT_SIZE) * 100;
  const maxPercent = (EDITOR_FONT_SIZE_MAX / DEFAULT_EDITOR_FONT_SIZE) * 100;
  return Math.min(maxPercent, Math.max(minPercent, percent));
}

function roundEditorFontSizePercent(percent: number): number {
  return Math.round(percent * 1000) / 1000;
}

function snapEditorFontSizeToPercentStep(fontSize: number): number {
  const snappedPercent = Math.round(editorFontSizeToPercent(fontSize) / EDITOR_FONT_SIZE_PERCENT_STEP)
    * EDITOR_FONT_SIZE_PERCENT_STEP;
  return clampEditorFontSize((clampEditorFontSizePercent(snappedPercent) / 100) * DEFAULT_EDITOR_FONT_SIZE);
}

export function formatEditorFontSizePercent(fontSize: number): string {
  const percent = Math.round(editorFontSizeToPercent(fontSize) / EDITOR_FONT_SIZE_PERCENT_STEP)
    * EDITOR_FONT_SIZE_PERCENT_STEP;
  return `${Math.round(clampEditorFontSizePercent(percent))}%`;
}

export function hasEditorMouseWheelZoomModifiers(
  event: EditorWheelZoomEvent,
  platform?: NodeJS.Platform | string,
): boolean {
  if (event.shiftKey || event.altKey) {
    return false;
  }
  if (isMacPlatform(platform)) {
    // VS Code supports Cmd + two-finger scroll (`metaKey`) and macOS pinch (`ctrlKey`).
    return event.metaKey || event.ctrlKey;
  }
  return event.ctrlKey && !event.metaKey;
}

export function isLikelyPhysicalMouseWheel(event: Pick<EditorWheelZoomEvent, 'deltaMode' | 'deltaY'>): boolean {
  return event.deltaMode !== 0 || Math.abs(event.deltaY) >= PHYSICAL_WHEEL_DELTA_THRESHOLD;
}

export function nextEditorFontSizeForPhysicalWheel(current: number, deltaY: number): number {
  if (deltaY === 0) {
    return snapEditorFontSizeToPercentStep(current);
  }
  const currentPercent = roundEditorFontSizePercent(editorFontSizeToPercent(current));
  const nextPercent = deltaY > 0
    ? Math.ceil(currentPercent / EDITOR_FONT_SIZE_PERCENT_STEP) * EDITOR_FONT_SIZE_PERCENT_STEP
      - EDITOR_FONT_SIZE_PERCENT_STEP
    : Math.floor(currentPercent / EDITOR_FONT_SIZE_PERCENT_STEP) * EDITOR_FONT_SIZE_PERCENT_STEP
      + EDITOR_FONT_SIZE_PERCENT_STEP;
  return clampEditorFontSize((clampEditorFontSizePercent(nextPercent) / 100) * DEFAULT_EDITOR_FONT_SIZE);
}

export function nextEditorFontSizeForTrackpadGesture(start: number, accumulatedDeltaY: number): number {
  return snapEditorFontSizeToPercentStep(start - accumulatedDeltaY / TRACKPAD_DELTA_TO_FONT_SIZE);
}

function readRootEditorFontSize(): number {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--op-md-body-font-size')
    .trim();
  const parsed = Number.parseFloat(raw);
  return clampEditorFontSize(Number.isFinite(parsed) ? parsed : DEFAULT_EDITOR_FONT_SIZE);
}

export function getCurrentEditorFontSize(): number {
  if (currentEditorFontSize === null) {
    currentEditorFontSize = readRootEditorFontSize();
  }
  return currentEditorFontSize;
}

export function setCurrentEditorFontSize(fontSize: number): number {
  const nextFontSize = clampEditorFontSize(fontSize);
  if (currentEditorFontSize === nextFontSize) {
    return currentEditorFontSize;
  }
  currentEditorFontSize = nextFontSize;
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--op-md-body-font-size', `${currentEditorFontSize}px`);
  }
  notifyEditorFontSizeListeners();
  requestEditorFontSizeMeasure();
  return currentEditorFontSize;
}

export function subscribeEditorFontSize(listener: EditorFontSizeListener): () => void {
  editorFontSizeListeners.add(listener);
  return () => {
    editorFontSizeListeners.delete(listener);
  };
}

export function resetCurrentEditorFontSize(): number {
  return setCurrentEditorFontSize(DEFAULT_EDITOR_FONT_SIZE);
}

export function stepCurrentEditorFontSize(direction: 1 | -1): number {
  return setCurrentEditorFontSize(nextEditorFontSizeForPhysicalWheel(getCurrentEditorFontSize(), -direction));
}

export function handleEditorMouseWheelZoom(event: WheelEvent, view?: EditorView): boolean {
  // Browser page zoom and trackpad pinch belong to the browser. Content size
  // remains available through Hulala's editor controls.
  if (typeof window !== 'undefined' && window.hulala?.kind === 'browser') return false;
  if (event.deltaY === 0) {
    return false;
  }

  if (isLikelyPhysicalMouseWheel(event)) {
    const platform = typeof window !== 'undefined' ? window.hulala?.platform : undefined;
    if (!hasEditorMouseWheelZoomModifiers(event, platform)) {
      return false;
    }
    setCurrentEditorFontSize(nextEditorFontSizeForPhysicalWheel(getCurrentEditorFontSize(), event.deltaY));
    view?.requestMeasure();
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  const now = Date.now();
  if (now - previousWheelTime > GESTURE_RESET_MS) {
    gestureStartFontSize = getCurrentEditorFontSize();
    const platform = typeof window !== 'undefined' ? window.hulala?.platform : undefined;
    gestureHasZoomModifiers = hasEditorMouseWheelZoomModifiers(event, platform);
    gestureAccumulatedDeltaY = 0;
  }

  previousWheelTime = now;
  gestureAccumulatedDeltaY += event.deltaY;

  if (!gestureHasZoomModifiers) {
    return false;
  }

  setCurrentEditorFontSize(nextEditorFontSizeForTrackpadGesture(
    gestureStartFontSize,
    gestureAccumulatedDeltaY,
  ));
  view?.requestMeasure();
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export function editorMouseWheelZoom(): Extension {
  return [
    ViewPlugin.fromClass(class {
      constructor(readonly view: EditorView) {
        editorFontSizeViews.add(view);
      }

      destroy() {
        editorFontSizeViews.delete(this.view);
      }
    }),
    Prec.highest(EditorView.domEventHandlers({
      wheel: (event, view) => handleEditorMouseWheelZoom(event, view),
    })),
  ];
}
