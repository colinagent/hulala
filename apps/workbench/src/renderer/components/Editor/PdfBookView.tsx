import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
// Keep the legacy worker because it carries PDF.js compatibility polyfills and
// remains stable across packaged Chromium updates.
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import type { ParsedBookHighlightNote } from './bookNotes';
import { resolveBookWheelMotion } from './bookWheelPagination';
import {
  calculatePdfFitZoom,
  type PdfBookViewState,
  type PdfDisplayMode,
} from './pdfReaderState';
import {
  buildPdfOutlineNodes,
  type PdfOutlineNode,
  type PdfOutlineSourceItem,
} from './outline/pdfOutline';

export type { PdfBookViewState, PdfDisplayMode } from './pdfReaderState';

type PdfHighlightRect = {
  /** True when this rect belongs to a highlight that has a reader reflection. */
  hasNote?: boolean;
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
};

export type PdfHighlightTargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type PdfSelection = {
  text: string;
  locator: string;
  page: number;
  rects: PdfHighlightTargetRect[];
  applyHighlight: () => void;
};

export type PdfHighlightContextAction =
  | { type: 'save'; selection: PdfSelection }
  | { type: 'remove'; page: number; rects: PdfHighlightTargetRect[] }
  | { type: 'edit-note'; page: number; rects: PdfHighlightTargetRect[] };

export type PdfHighlightRequest = {
  page: number;
  rects: PdfHighlightTargetRect[];
  seq: number;
};

type PdfPageSize = {
  page: number;
  width: number;
  height: number;
};

type PdfBookViewProps = {
  url: string;
  refreshKey: number;
  page: number;
  displayMode: PdfDisplayMode;
  customZoom: number;
  initialViewState?: PdfBookViewState | null;
  highlightRequest?: PdfHighlightRequest | null;
  highlightNotes?: ParsedBookHighlightNote[];
  onPageChange: (page: number) => void;
  onPageCountChange: (pageCount: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onEffectiveZoomChange?: (zoom: number) => void;
  onOutlineChange?: (nodes: PdfOutlineNode[]) => void;
  onViewStateChange?: (state: PdfBookViewState) => void;
  onHighlightContextAction?: (action: PdfHighlightContextAction) => void;
  onError: (message: string) => void;
};

const WHEEL_PAGE_THRESHOLD = 80;
const WHEEL_PAGE_COOLDOWN_MS = 650;
const PDF_HORIZONTAL_PADDING = 96;
const PDF_VERTICAL_PADDING = 32;

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfJsPromise: Promise<PdfJsModule> | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsPromise) {
    pdfJsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((module) => {
      module.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return module;
    });
  }
  return pdfJsPromise;
}

function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, page), Math.max(1, pageCount));
}

function readBottomSafeArea(element: HTMLElement): number {
  const raw = window.getComputedStyle(element).getPropertyValue('--op-editor-bottom-safe-area').trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function findBottomSafeAreaOwner(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.style.getPropertyValue('--op-editor-bottom-safe-area').trim()) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function isPdfRenderCancelled(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const name = 'name' in error ? String(error.name) : '';
  const message = 'message' in error ? String(error.message) : '';
  return name === 'RenderingCancelledException'
    || message.includes('Rendering cancelled')
    || message.includes('multiple render() operations');
}

function rectsFromSelection(selection: Selection, layer: HTMLElement): PdfHighlightRect[] {
  const layerBounds = layer.getBoundingClientRect();
  const rects: PdfHighlightRect[] = [];
  let index = 0;
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width < 1 || rect.height < 1) {
        continue;
      }
      rects.push({
        id: `${Date.now()}-${index}`,
        top: rect.top - layerBounds.top,
        left: rect.left - layerBounds.left,
        width: rect.width,
        height: rect.height,
      });
      index += 1;
    }
  }
  return rects;
}

function normalizeRects(rects: PdfHighlightRect[], size: PdfPageSize | null): PdfHighlightTargetRect[] {
  if (!size || size.width <= 0 || size.height <= 0) {
    return [];
  }
  return rects.map((rect) => ({
    top: rect.top / size.height,
    left: rect.left / size.width,
    width: rect.width / size.width,
    height: rect.height / size.height,
  }));
}

function denormalizeRects(
  rects: PdfHighlightTargetRect[],
  size: PdfPageSize | null,
  keyPrefix: string,
  hasNote = false,
): PdfHighlightRect[] {
  if (!size || size.width <= 0 || size.height <= 0) {
    return [];
  }
  return rects
    .map((rect, index) => ({
      id: `${keyPrefix}-${index}`,
      top: rect.top * size.height,
      left: rect.left * size.width,
      width: rect.width * size.width,
      height: rect.height * size.height,
      hasNote,
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

function rectContainsPoint(rect: PdfHighlightRect, left: number, top: number): boolean {
  const tolerance = 2;
  return left >= rect.left - tolerance
    && left <= rect.left + rect.width + tolerance
    && top >= rect.top - tolerance
    && top <= rect.top + rect.height + tolerance;
}

export const PdfBookView: React.FC<PdfBookViewProps> = ({
  url,
  refreshKey,
  page,
  displayMode,
  customZoom,
  initialViewState = null,
  highlightRequest = null,
  highlightNotes = [],
  onPageChange,
  onPageCountChange,
  onZoomIn,
  onZoomOut,
  onEffectiveZoomChange,
  onOutlineChange,
  onViewStateChange,
  onHighlightContextAction,
  onError,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const pdfJsRef = useRef<PdfJsModule | null>(null);
  const pageRef = useRef(page);
  const pageCountRef = useRef(0);
  const wheelDeltaRef = useRef(0);
  const lastWheelTurnRef = useRef(0);
  const initialScrollAppliedRef = useRef(false);
  const viewStateFrameRef = useRef(0);
  const [pageCount, setPageCount] = useState(0);
  const [pageSize, setPageSize] = useState<PdfPageSize | null>(null);
  const [loading, setLoading] = useState(false);
  const [layoutRevision, setLayoutRevision] = useState(0);

  pageRef.current = page;
  pageCountRef.current = pageCount;

  useEffect(() => {
    // Do not publish the scroller's default (0, 0) position while a remembered
    // position is still waiting for the PDF page to finish laying out. The
    // parent deliberately keeps the remembered snapshot until this flips.
    initialScrollAppliedRef.current = !initialViewState;
  }, [initialViewState, refreshKey, url]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    let frame = 0;
    let lastWidth = -1;
    let lastHeight = -1;
    let lastSafeArea = -1;
    const measure = () => {
      frame = 0;
      const width = Math.round(root.clientWidth);
      const height = Math.round(root.clientHeight);
      const safeArea = Math.round(readBottomSafeArea(root));
      if (width === lastWidth && height === lastHeight && safeArea === lastSafeArea) {
        return;
      }
      lastWidth = width;
      lastHeight = height;
      lastSafeArea = safeArea;
      setLayoutRevision((value) => value + 1);
    };
    const scheduleMeasure = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(measure);
      }
    };
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(root);
    const safeAreaOwner = findBottomSafeAreaOwner(root);
    const mutationObserver = safeAreaOwner && typeof MutationObserver !== 'undefined'
      ? new MutationObserver(scheduleMeasure)
      : null;
    if (safeAreaOwner) {
      mutationObserver?.observe(safeAreaOwner, { attributes: true, attributeFilter: ['style'] });
    }
    scheduleMeasure();
    return () => {
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setLoading(true);
    setPageSize(null);
    onOutlineChange?.([]);

    loadPdfJs()
      .then((pdfJs) => {
        if (cancelled) {
          return null;
        }
        pdfJsRef.current = pdfJs;
        loadingTask = pdfJs.getDocument({ url, cMapUrl: new URL('/pdfjs/cmaps/', location.href).href, cMapPacked: true, standardFontDataUrl: new URL('/pdfjs/standard_fonts/', location.href).href, wasmUrl: new URL('/pdfjs/wasm/', location.href).href });
        return loadingTask.promise;
      })
      .then((pdf) => {
        if (!pdf) {
          return;
        }
        if (cancelled) {
          loadingTask?.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        onPageCountChange(pdf.numPages);
        onPageChange(clampPage(pageRef.current, pdf.numPages));
        void pdf.getOutline()
          .then((outline) => buildPdfOutlineNodes(pdf, (outline || []) as PdfOutlineSourceItem[]))
          .then((nodes) => {
            if (!cancelled) {
              onOutlineChange?.(nodes);
            }
          })
          .catch(() => {
            if (!cancelled) {
              onOutlineChange?.([]);
            }
          });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : 'Unable to open PDF');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      pdfRef.current = null;
      loadingTask?.destroy();
    };
  }, [onError, onOutlineChange, onPageChange, onPageCountChange, refreshKey, url]);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    const textLayerNode = textLayerRef.current;
    if (!pdf || !canvas || !textLayerNode || pageCount <= 0) {
      return undefined;
    }

    let cancelled = false;
    let pageProxy: PDFPageProxy | null = null;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let textLayer: { cancel: () => void; render: () => Promise<unknown> } | null = null;
    const targetPage = clampPage(page, pageCount);
    if (targetPage !== page) {
      onPageChange(targetPage);
      return undefined;
    }

    setLoading(true);
    textLayerNode.replaceChildren();

    pdf.getPage(targetPage)
      .then(async (nextPage) => {
        if (cancelled) {
          nextPage.cleanup();
          return;
        }
        pageProxy = nextPage;
        const baseViewport = nextPage.getViewport({ scale: 1 });
        const root = rootRef.current;
        const nextZoom = displayMode === 'fit-page' && root
          ? calculatePdfFitZoom({
              pageWidth: baseViewport.width,
              pageHeight: baseViewport.height,
              containerWidth: root.clientWidth,
              containerHeight: root.clientHeight,
              horizontalPadding: PDF_HORIZONTAL_PADDING,
              verticalPadding: PDF_VERTICAL_PADDING,
              bottomSafeArea: readBottomSafeArea(root),
            })
          : customZoom;
        onEffectiveZoomChange?.(nextZoom);
        const viewport = nextPage.getViewport({ scale: nextZoom });
        const outputScale = window.devicePixelRatio || 1;
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('Canvas is unavailable');
        }

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        setPageSize({ page: targetPage, width: viewport.width, height: viewport.height });

        // Cancel any in-flight paint before starting another on this canvas.
        renderTask = nextPage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        });
        try {
          await renderTask.promise;
        } catch (error) {
          if (cancelled || isPdfRenderCancelled(error)) {
            return;
          }
          throw error;
        }

        if (cancelled) {
          return;
        }
        const pdfJs = pdfJsRef.current || await loadPdfJs();
        textLayer = new pdfJs.TextLayer({
          textContentSource: await nextPage.getTextContent(),
          container: textLayerNode,
          viewport,
        });
        await textLayer.render();
      })
      .catch((error: unknown) => {
        if (!cancelled && !isPdfRenderCancelled(error)) {
          onError(error instanceof Error ? error.message : 'Unable to render PDF page');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // pdf.js may throw if the task already finished.
      }
      textLayer?.cancel();
      pageProxy?.cleanup();
    };
  }, [customZoom, displayMode, layoutRevision, onEffectiveZoomChange, onError, onPageChange, page, pageCount]);

  const emitViewState = useCallback(() => {
    if (
      !onViewStateChange
      || (initialViewState && !initialScrollAppliedRef.current)
    ) {
      return;
    }
    const scroller = rootRef.current?.querySelector('[data-pdf-scroller="true"]');
    onViewStateChange({
      page: pageRef.current,
      displayMode,
      customZoom,
      scrollTop: scroller instanceof HTMLElement ? scroller.scrollTop : 0,
      scrollLeft: scroller instanceof HTMLElement ? scroller.scrollLeft : 0,
    });
  }, [customZoom, displayMode, initialViewState, onViewStateChange]);

  useEffect(() => {
    if (displayMode !== 'fit-page') {
      return;
    }
    const scroller = rootRef.current?.querySelector('[data-pdf-scroller="true"]');
    if (scroller instanceof HTMLElement) {
      scroller.scrollTop = 0;
      scroller.scrollLeft = 0;
    }
  }, [displayMode]);

  useEffect(() => {
    const scroller = rootRef.current?.querySelector('[data-pdf-scroller="true"]');
    if (!(scroller instanceof HTMLElement)) {
      return undefined;
    }
    const handleScroll = () => {
      if (viewStateFrameRef.current) {
        return;
      }
      viewStateFrameRef.current = window.requestAnimationFrame(() => {
        viewStateFrameRef.current = 0;
        emitViewState();
      });
    };
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    emitViewState();
    return () => {
      if (viewStateFrameRef.current) {
        window.cancelAnimationFrame(viewStateFrameRef.current);
        viewStateFrameRef.current = 0;
      }
      emitViewState();
      scroller.removeEventListener('scroll', handleScroll);
    };
  }, [emitViewState]);

  const previousPageRef = useRef(page);
  useEffect(() => {
    if (previousPageRef.current === page) {
      return;
    }
    previousPageRef.current = page;
    const scroller = rootRef.current?.querySelector('[data-pdf-scroller="true"]');
    if (scroller instanceof HTMLElement) {
      scroller.scrollTop = 0;
      scroller.scrollLeft = 0;
    }
  }, [page]);

  useEffect(() => {
    if (!initialViewState || initialScrollAppliedRef.current || pageCount <= 0) {
      return undefined;
    }
    const initialPage = clampPage(initialViewState.page, pageCount);
    if (page !== initialPage) {
      // An explicit navigation request or direct user navigation won before
      // restoration. It is now authoritative, so allow subsequent captures.
      initialScrollAppliedRef.current = true;
      emitViewState();
      return undefined;
    }
    if (pageSize?.page !== page) {
      return undefined;
    }
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const scroller = rootRef.current?.querySelector('[data-pdf-scroller="true"]');
        if (scroller instanceof HTMLElement) {
          scroller.scrollTop = Math.max(0, initialViewState.scrollTop);
          scroller.scrollLeft = Math.max(0, initialViewState.scrollLeft);
          initialScrollAppliedRef.current = true;
          emitViewState();
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [emitViewState, initialViewState, page, pageCount, pageSize]);

  useEffect(() => {
    emitViewState();
  }, [emitViewState, page, pageSize]);

  useEffect(() => {
    if (!highlightRequest || pageCount <= 0) {
      return;
    }
    const targetPage = clampPage(highlightRequest.page, pageCount);
    if (targetPage !== page) {
      onPageChange(targetPage);
      return;
    }
    if (pageSize?.page !== targetPage) {
      return;
    }
  }, [highlightRequest, onPageChange, page, pageCount, pageSize]);

  const highlights = useMemo(() => {
    if (!pageSize || pageSize.page !== page) {
      return [];
    }
    const rects: PdfHighlightRect[] = [];
    const seen = new Set<string>();
    const appendRects = (inputRects: PdfHighlightTargetRect[], keyPrefix: string, hasNote = false) => {
      const key = JSON.stringify(inputRects);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      rects.push(...denormalizeRects(inputRects, pageSize, keyPrefix, hasNote));
    };
    highlightNotes.forEach((note, index) => {
      if (note.format === 'pdf' && note.page === page && note.rects.length > 0) {
        appendRects(note.rects, `note-${index}`, Boolean(note.note.trim()));
      }
    });
    if (highlightRequest?.page === page && highlightRequest.rects.length > 0) {
      appendRects(highlightRequest.rects, `target-${highlightRequest.seq}`);
    }
    return rects;
  }, [highlightNotes, highlightRequest, page, pageSize]);

  /** One note icon per highlight, anchored at the end of its last rect. */
  const noteMarkers = useMemo(() => {
    if (!pageSize || pageSize.page !== page) {
      return [] as Array<{
        id: string;
        top: number;
        left: number;
        hasNote: boolean;
        note: ParsedBookHighlightNote;
      }>;
    }
    const markers: Array<{
      id: string;
      top: number;
      left: number;
      hasNote: boolean;
      note: ParsedBookHighlightNote;
    }> = [];
    highlightNotes.forEach((note, index) => {
      if (note.format !== 'pdf' || note.page !== page || note.rects.length === 0) {
        return;
      }
      const rects = denormalizeRects(note.rects, pageSize, `marker-${index}`);
      const last = rects[rects.length - 1];
      if (!last) {
        return;
      }
      markers.push({
        id: `note-marker-${index}`,
        top: Math.max(0, last.top + (last.height - 18) / 2),
        left: last.left + last.width + 2,
        hasNote: Boolean(note.note.trim()),
        note,
      });
    });
    return markers;
  }, [highlightNotes, page, pageSize]);

  const getSelectionSnapshot = useCallback((): PdfSelection | null => {
    const selection = window.getSelection();
    const textLayerNode = textLayerRef.current;
    const text = (selection?.toString() || '').replace(/\s+/g, ' ').trim();
    if (!selection || !textLayerNode || !text) {
      return null;
    }
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (
      (anchorNode && !textLayerNode.contains(anchorNode)) ||
      (focusNode && !textLayerNode.contains(focusNode))
    ) {
      return null;
    }
    const rects = rectsFromSelection(selection, textLayerNode);
    if (rects.length === 0) {
      return null;
    }
    return {
      text,
      locator: `Page ${page}`,
      page,
      rects: pageSize?.page === page ? normalizeRects(rects, pageSize) : [],
      applyHighlight: () => {
        selection.removeAllRanges();
      },
    };
  }, [page, pageSize]);

  const findHighlightAtPoint = useCallback((clientX: number, clientY: number): ParsedBookHighlightNote | null => {
    const pageNode = textLayerRef.current?.parentElement;
    if (!pageNode || !pageSize || pageSize.page !== page) {
      return null;
    }
    const bounds = pageNode.getBoundingClientRect();
    const left = clientX - bounds.left;
    const top = clientY - bounds.top;
    for (const note of highlightNotes) {
      if (note.format !== 'pdf' || note.page !== page || note.rects.length === 0) {
        continue;
      }
      const rects = denormalizeRects(note.rects, pageSize, 'hit');
      if (rects.some((rect) => rectContainsPoint(rect, left, top))) {
        return note;
      }
    }
    return null;
  }, [highlightNotes, page, pageSize]);

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const selectionSnapshot = getSelectionSnapshot();
    if (selectionSnapshot && selectionSnapshot.rects.length > 0) {
      event.preventDefault();
      onHighlightContextAction?.({ type: 'save', selection: selectionSnapshot });
      return;
    }

    // Right-click an existing highlight → add/view note (delete lives in the dialog).
    const note = findHighlightAtPoint(event.clientX, event.clientY);
    if (!note || note.page === null || note.rects.length === 0) {
      return;
    }
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    onHighlightContextAction?.({ type: 'edit-note', page: note.page, rects: note.rects });
  }, [findHighlightAtPoint, getSelectionSnapshot, onHighlightContextAction]);

  const handleHighlightClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const selected = (window.getSelection()?.toString() || '').replace(/\s+/g, ' ').trim();
    if (selected) {
      return;
    }
    const note = findHighlightAtPoint(event.clientX, event.clientY);
    if (!note || note.page === null || note.rects.length === 0) {
      return;
    }
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    onHighlightContextAction?.({ type: 'edit-note', page: note.page, rects: note.rects });
  }, [findHighlightAtPoint, onHighlightContextAction]);

  const goPrev = useCallback(() => {
    const count = pageCountRef.current;
    if (count <= 0) {
      return;
    }
    onPageChange(clampPage(pageRef.current - 1, count));
  }, [onPageChange]);

  const goNext = useCallback(() => {
    const count = pageCountRef.current;
    if (count <= 0) {
      return;
    }
    onPageChange(clampPage(pageRef.current + 1, count));
  }, [onPageChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !rootRef.current?.contains(event.target as Node)) return;
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      ) {
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp' || (displayMode === 'fit-page' && event.key === 'ArrowUp')) {
        event.preventDefault();
        goPrev();
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ' || (displayMode === 'fit-page' && event.key === 'ArrowDown')) {
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [displayMode, goNext, goPrev]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        return;
      }
      if (pageCountRef.current <= 0) {
        return;
      }
      const motion = resolveBookWheelMotion(event);
      if (!motion) {
        return;
      }
      // When the page fits, turn pages with the wheel like EPUB. If the
      // scroller can still move vertically, let native scroll win. Horizontal
      // trackpad gestures always paginate, matching a physical page swipe.
      const scroller = root.querySelector('[data-pdf-scroller="true"]');
      if (motion.axis === 'vertical' && scroller instanceof HTMLElement) {
        const canScrollUp = scroller.scrollTop > 0;
        const canScrollDown = scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1;
        if ((motion.delta < 0 && canScrollUp) || (motion.delta > 0 && canScrollDown)) {
          return;
        }
      }
      event.preventDefault();
      const now = Date.now();
      if (now - lastWheelTurnRef.current < WHEEL_PAGE_COOLDOWN_MS) {
        wheelDeltaRef.current = 0;
        return;
      }
      wheelDeltaRef.current += motion.delta;
      if (Math.abs(wheelDeltaRef.current) < WHEEL_PAGE_THRESHOLD) {
        return;
      }
      if (wheelDeltaRef.current > 0) {
        goNext();
      } else {
        goPrev();
      }
      wheelDeltaRef.current = 0;
      lastWheelTurnRef.current = now;
    };
    root.addEventListener('wheel', handleWheel, { passive: false });
    return () => root.removeEventListener('wheel', handleWheel);
  }, [goNext, goPrev]);

  const pageStyle = pageSize
    ? { width: `${pageSize.width}px`, height: `${pageSize.height}px` }
    : undefined;
  const canPaginate = pageCount > 0;
  const navButtonClass = 'absolute top-1/2 z-20 flex h-10 w-8 -translate-y-1/2 items-center justify-center rounded bg-editor-bg/80 text-secondary-text hover:bg-hover-bg hover:text-primary-text disabled:cursor-default disabled:opacity-40';

  return (
    <div ref={rootRef} tabIndex={0} onPointerDown={event => { if (!(event.target as HTMLElement).closest('button,input,select,textarea,a')) event.currentTarget.focus({ preventScroll: true }); }} className="relative flex h-full min-h-0 flex-col bg-editor-bg">
      <div
        data-pdf-scroller="true"
        className={`min-h-0 flex-1 px-12 py-4 ${displayMode === 'fit-page' ? 'flex items-center justify-center overflow-hidden' : 'overflow-auto'}`}
        style={{ paddingBottom: 'calc(1rem + var(--op-editor-bottom-safe-area, 0px))' }}
      >
        <div className={displayMode === 'fit-page' ? 'w-fit' : 'mx-auto w-fit'}>
          <div
            className="relative bg-white shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
            style={pageStyle}
            onClick={handleHighlightClick}
            onContextMenu={handleContextMenu}
          >
            {loading ? (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/80 text-sm text-secondary-text">
                Loading PDF...
              </div>
            ) : null}
            <canvas ref={canvasRef} className="block" />
            <div ref={textLayerRef} className="textLayer absolute inset-0" />
            <div className="pointer-events-none absolute inset-0">
              {highlights.map((rect) => (
                <span
                  key={rect.id}
                  className={`absolute rounded-[2px] mix-blend-multiply ${rect.hasNote ? 'bg-[#e8a93a]/55' : 'bg-[#f6d75f]/50'}`}
                  style={{
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                  }}
                />
              ))}
              {noteMarkers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  className={`pointer-events-auto absolute z-10 flex h-[18px] w-[18px] items-center justify-center rounded border bg-white/95 shadow-sm ${
                    marker.hasNote
                      ? 'border-orange-700/40 text-orange-700'
                      : 'border-border text-tertiary-text'
                  }`}
                  style={{ top: marker.top, left: marker.left }}
                  title={marker.hasNote ? 'Edit note' : 'Add note'}
                  aria-label={marker.hasNote ? 'Edit note' : 'Add note'}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (marker.note.page === null || marker.note.rects.length === 0) {
                      return;
                    }
                    onHighlightContextAction?.({
                      type: 'edit-note',
                      page: marker.note.page,
                      rects: marker.note.rects,
                    });
                  }}
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="12"
                    height="12"
                    fill="none"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M3.5 2.5h7.2L12.5 4.3V13.5H3.5V2.5zM10.5 2.5v2h2M5.5 7h5M5.5 9.5h5M5.5 12h3"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        className={`${navButtonClass} left-3`}
        onClick={goPrev}
        disabled={!canPaginate || page <= 1}
        title="Previous page"
        aria-label="Previous page"
      >
        <span className="rotate-180 text-lg leading-none">›</span>
      </button>
      <button
        type="button"
        className={`${navButtonClass} right-3`}
        onClick={goNext}
        disabled={!canPaginate || page >= pageCount}
        title="Next page"
        aria-label="Next page"
      >
        <span className="text-lg leading-none">›</span>
      </button>
    </div>
  );
};
