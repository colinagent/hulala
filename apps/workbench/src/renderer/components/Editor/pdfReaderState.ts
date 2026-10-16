import { localStore } from "../../../platform/storage";
export type PdfDisplayMode = 'fit-page' | 'custom';

export type PdfBookViewState = {
  page: number;
  displayMode: PdfDisplayMode;
  customZoom: number;
  scrollTop: number;
  scrollLeft: number;
};

export type PdfReadingSnapshot = PdfBookViewState & {
  pageCount: number;
  effectiveZoom: number;
};

export type PdfReaderCommand = 'zoom-in' | 'zoom-out' | 'fit-page';

export const MIN_PDF_CUSTOM_ZOOM = 0.6;
export const MAX_PDF_CUSTOM_ZOOM = 2.4;
export const PDF_CUSTOM_ZOOM_STEP = 0.15;

const PDF_VIEW_STATE_KEY_PREFIX = 'hulala.pdf.view-state.v1:';
const DEFAULT_PDF_VIEW_STATE: PdfBookViewState = {
  page: 1,
  displayMode: 'fit-page',
  customZoom: 1,
  scrollTop: 0,
  scrollLeft: 0,
};

const snapshots = new Map<string, PdfReadingSnapshot>();
const snapshotListeners = new Map<string, Set<() => void>>();
const commandListeners = new Map<string, Set<(command: PdfReaderCommand) => void>>();

function normalizedTabId(tabId: string): string {
  return tabId.trim();
}

function normalizeResourcePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/');
  if (!normalized) {
    return '';
  }
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function clampPdfCustomZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PDF_VIEW_STATE.customZoom;
  }
  return Math.min(MAX_PDF_CUSTOM_ZOOM, Math.max(MIN_PDF_CUSTOM_ZOOM, value));
}

export function calculatePdfFitZoom(input: {
  pageWidth: number;
  pageHeight: number;
  containerWidth: number;
  containerHeight: number;
  horizontalPadding?: number;
  verticalPadding?: number;
  bottomSafeArea?: number;
}): number {
  const pageWidth = finiteNonNegative(input.pageWidth, 0);
  const pageHeight = finiteNonNegative(input.pageHeight, 0);
  if (pageWidth <= 0 || pageHeight <= 0) {
    return 1;
  }
  const availableWidth = Math.max(
    1,
    finiteNonNegative(input.containerWidth, 0) - finiteNonNegative(input.horizontalPadding, 0),
  );
  const availableHeight = Math.max(
    1,
    finiteNonNegative(input.containerHeight, 0)
      - finiteNonNegative(input.verticalPadding, 0)
      - finiteNonNegative(input.bottomSafeArea, 0),
  );
  return Math.max(0.05, Math.min(availableWidth / pageWidth, availableHeight / pageHeight));
}

export function defaultPdfBookViewState(): PdfBookViewState {
  return { ...DEFAULT_PDF_VIEW_STATE };
}

export function parsePdfBookViewState(raw: string | null | undefined): PdfBookViewState {
  if (!raw) {
    return defaultPdfBookViewState();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PdfBookViewState> | null;
    if (!parsed || typeof parsed !== 'object') {
      return defaultPdfBookViewState();
    }
    return {
      page: typeof parsed.page === 'number' && Number.isFinite(parsed.page) && parsed.page >= 1
        ? Math.floor(parsed.page)
        : 1,
      displayMode: parsed.displayMode === 'custom' ? 'custom' : 'fit-page',
      customZoom: clampPdfCustomZoom(
        typeof parsed.customZoom === 'number' ? parsed.customZoom : DEFAULT_PDF_VIEW_STATE.customZoom,
      ),
      scrollTop: finiteNonNegative(parsed.scrollTop, 0),
      scrollLeft: finiteNonNegative(parsed.scrollLeft, 0),
    };
  } catch {
    return defaultPdfBookViewState();
  }
}

export function clampPdfBookViewStatePage(state: PdfBookViewState, pageCount: number): PdfBookViewState {
  const maximum = Number.isFinite(pageCount) && pageCount > 0 ? Math.floor(pageCount) : 1;
  return {
    ...state,
    page: Math.min(maximum, Math.max(1, Math.floor(state.page))),
  };
}

export function isPdfFilePath(filePath: string | null | undefined): boolean {
  return (filePath || '').trim().toLowerCase().endsWith('.pdf');
}

export function pdfViewStateStorageKey(identity: {
  uri?: string | null;
  filePath?: string | null;
}): string {
  const uri = (identity.uri || '').trim();
  const resource = uri ? `uri:${uri}` : `path:${normalizeResourcePath(identity.filePath || '')}`;
  return resource === 'path:' ? '' : `${PDF_VIEW_STATE_KEY_PREFIX}${encodeURIComponent(resource)}`;
}

export function loadPdfBookViewState(identity: {
  uri?: string | null;
  filePath?: string | null;
}): PdfBookViewState {
  const key = pdfViewStateStorageKey(identity);
  if (!key || typeof window === 'undefined') {
    return defaultPdfBookViewState();
  }
  try {
    return parsePdfBookViewState(localStore.getItem(key));
  } catch {
    return defaultPdfBookViewState();
  }
}

export function savePdfBookViewState(
  identity: { uri?: string | null; filePath?: string | null },
  state: PdfBookViewState,
): void {
  const key = pdfViewStateStorageKey(identity);
  if (!key || typeof window === 'undefined') {
    return;
  }
  try {
    localStore.setItem(key, JSON.stringify(state));
  } catch {
    // Reading state is best-effort and must never block the reader.
  }
}

export function getPdfReadingSnapshot(tabId: string): PdfReadingSnapshot | null {
  return snapshots.get(normalizedTabId(tabId)) || null;
}

export function publishPdfReadingSnapshot(tabId: string, snapshot: PdfReadingSnapshot): void {
  const key = normalizedTabId(tabId);
  if (!key) {
    return;
  }
  const previous = snapshots.get(key);
  if (
    previous
    && previous.page === snapshot.page
    && previous.pageCount === snapshot.pageCount
    && previous.displayMode === snapshot.displayMode
    && previous.customZoom === snapshot.customZoom
    && previous.effectiveZoom === snapshot.effectiveZoom
    && previous.scrollTop === snapshot.scrollTop
    && previous.scrollLeft === snapshot.scrollLeft
  ) {
    return;
  }
  snapshots.set(key, { ...snapshot });
  snapshotListeners.get(key)?.forEach((listener) => listener());
}

export function clearPdfReadingSnapshot(tabId: string): void {
  const key = normalizedTabId(tabId);
  if (!key || !snapshots.delete(key)) {
    return;
  }
  snapshotListeners.get(key)?.forEach((listener) => listener());
}

export function subscribePdfReadingSnapshot(tabId: string, listener: () => void): () => void {
  const key = normalizedTabId(tabId);
  if (!key) {
    return () => undefined;
  }
  const listeners = snapshotListeners.get(key) || new Set<() => void>();
  listeners.add(listener);
  snapshotListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      snapshotListeners.delete(key);
    }
  };
}

export function requestPdfReaderCommand(tabId: string, command: PdfReaderCommand): void {
  commandListeners.get(normalizedTabId(tabId))?.forEach((listener) => listener(command));
}

export function subscribePdfReaderCommands(
  tabId: string,
  listener: (command: PdfReaderCommand) => void,
): () => void {
  const key = normalizedTabId(tabId);
  if (!key) {
    return () => undefined;
  }
  const listeners = commandListeners.get(key) || new Set<(command: PdfReaderCommand) => void>();
  listeners.add(listener);
  commandListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      commandListeners.delete(key);
    }
  };
}
