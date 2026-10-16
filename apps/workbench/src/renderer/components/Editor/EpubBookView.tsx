import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book, Contents, Location, NavItem, Rendition } from 'epubjs';
import { useUiStore } from '../../store/uiStore';
import type { ParsedBookHighlightNote } from './bookNotes';
import {
  bindEpubFootnoteReferenceClicks,
  closeEpubFootnoteDialog,
  ensureEpubFootnoteStyles,
  loadEpubFootnoteSource,
  showEpubFootnoteDialog,
} from './epubFootnotes';
import { normalizeMalformedEpubNonBreakingWhitespace } from './epubContentLayout';
import { protectEpubDocument } from './epubContentSecurity';
import { applyEpubContentFont, applyEpubReaderFont } from './epubReaderFont';
import { resolveBookWheelMotion } from './bookWheelPagination';
import {
  createEpubSpineProgressIndex,
  resolveEpubReadingProgress,
  type EpubSpineProgressIndex,
} from './epubReadingProgress';
import type { EpubReaderSettings, EpubReaderTheme } from './epubReaderSettings';

export type EpubSelection = {
  text: string;
  cfiRange: string;
  locator: string;
  applyHighlight: () => void;
};

export type EpubHighlightContextAction =
  | { type: 'save'; selection: EpubSelection }
  | { type: 'remove'; cfi: string }
  | { type: 'edit-note'; cfi: string };

export type EpubOpenMode = 'epub' | 'directory' | 'opf';

export type EpubProgress = {
  locator: string;
  cfi: string;
  href: string;
  percentage: number | null;
};

export type EpubDisplayRequest = {
  target: string;
  seq: number;
};

export type EpubHighlightRequest = {
  cfi: string;
  seq: number;
};

type EpubFactory = typeof import('epubjs').default;
type EpubViewWithPane = {
  pane?: {
    render?: () => void;
  };
};
type EpubViewsWithPane = {
  forEach?: (callback: (view: EpubViewWithPane) => void) => void;
};
type RenditionWithAnnotationInternals = {
  getContents?: () => Contents[] | Contents | null;
  views?: () => EpubViewsWithPane | EpubViewWithPane[];
  manager?: unknown;
};
type EpubArchiveEntryLike = {
  _data?: {
    uncompressedSize?: number;
  };
};
type EpubBookWithArchiveInternals = Book & {
  archive?: {
    zip?: {
      file?: (path: string) => EpubArchiveEntryLike | null;
    };
  };
};
type HighlightRegistryLike = {
  delete: (name: string) => boolean;
  set: (name: string, highlight: unknown) => void;
};
type HighlightWindowLike = {
  CSS?: { highlights?: HighlightRegistryLike };
  Highlight?: new (...ranges: Range[]) => unknown;
};
type PendingDisplay = {
  target: string;
  after?: (rendition: Rendition) => void;
};

/** CFIs encode their section in the base path (epubcfi(/6/20[chap]!/...)).
 *  Cheap string check so foreign-section CFIs never hit contents.range(),
 *  which parses the CFI and throws — expensive inside per-section hooks on
 *  books with many saved highlights. */
function cfiMatchesContents(cfi: string, contents: Contents): boolean {
  const cfiBase = (contents as { cfiBase?: string }).cfiBase || '';
  if (!cfiBase) {
    return true;
  }
  return cfi.startsWith(`epubcfi(${cfiBase}!`);
}

const WHEEL_PAGE_THRESHOLD = 80;
const WHEEL_PAGE_COOLDOWN_MS = 650;
const WHEEL_LISTENER_OPTIONS: AddEventListenerOptions = { passive: false };
// epub.js cannot run next()/display() concurrently: overlapping calls leave the
// view manager showing a detached (blank) view. Page turns are serialized
// through a small queue; rapid key repeats are capped instead of piling up.
const NAV_QUEUE_LIMIT = 3;
const SAVED_TEXT_HIGHLIGHT_NAME = 'op-book-saved-text';
const SAVED_TEXT_NOTED_UNDERLINE_NAME = 'op-book-saved-text-noted-underline';
const SAVED_TEXT_STYLE_ID = 'op-book-saved-text-style';
const NOTE_MARKER_LAYER_ID = 'op-book-note-marker-layer';
const NOTE_MARKER_SIZE = 14;
const HIGHLIGHT_COLOR = '#f0d878';
// Invisible SVG mark: keeps epub.js annotation plumbing; paint comes from CSS ::highlight.
const BOOK_SAVED_SVG_MARK = {
  fill: '#f6d75f',
  'fill-opacity': '0',
  'mix-blend-mode': 'normal',
} as const;

let epubFactoryPromise: Promise<EpubFactory> | null = null;

async function loadEpubFactory(): Promise<EpubFactory> {
  if (!epubFactoryPromise) {
    epubFactoryPromise = import('epubjs').then((module) => module.default);
  }
  return epubFactoryPromise;
}

type EpubBookViewProps = {
  url: string;
  openMode: EpubOpenMode;
  refreshKey: number;
  initialCfi?: string | null;
  displayRequest?: EpubDisplayRequest | null;
  highlightRequest?: EpubHighlightRequest | null;
  highlightNotes?: ParsedBookHighlightNote[];
  readerSettings: EpubReaderSettings;
  appFontFamily: string;
  onHighlightContextAction?: (action: EpubHighlightContextAction) => void;
  onProgressChange: (progress: EpubProgress) => void;
  onTocChange: (toc: NavItem[]) => void;
  onError: (message: string) => void;
};

function locationLabel(location: Location | null | undefined): string {
  if (!location?.start) {
    return '';
  }
  const displayed = location.start.displayed;
  if (displayed?.page && displayed?.total) {
    return `Page ${displayed.page} of ${displayed.total}`;
  }
  if (typeof location.start.percentage === 'number' && Number.isFinite(location.start.percentage)) {
    return `${Math.round(location.start.percentage * 100)}%`;
  }
  return location.start.href || location.start.cfi || '';
}

function selectedTextFromContents(contents: Contents | null | undefined): string {
  const selection = contents?.window?.getSelection?.();
  return (selection?.toString() || '').replace(/\s+/g, ' ').trim();
}

function renditionContents(rendition: Rendition | null | undefined): Contents[] {
  const contents = (rendition as unknown as RenditionWithAnnotationInternals | null | undefined)?.getContents?.();
  if (!contents) {
    return [];
  }
  return Array.isArray(contents) ? contents : [contents];
}

function archiveSpineItemWeight(book: Book, href: string): number | null {
  const zip = (book as EpubBookWithArchiveInternals).archive?.zip;
  if (!zip?.file || !href) {
    return null;
  }
  try {
    const resolved = book.resolve(href) || href;
    const archivePath = decodeURIComponent(resolved).replace(/^\/+/, '');
    const entry = zip.file(archivePath);
    // JSZip already read this value from the central directory. It gives us a
    // useful content weight without inflating/parsing every XHTML resource.
    // The guarded fallback keeps directory EPUBs and future JSZip shapes safe.
    const size = entry?._data?.uncompressedSize;
    return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null;
  } catch {
    return null;
  }
}

function clearRenditionSelections(rendition: Rendition | null | undefined) {
  window.getSelection()?.removeAllRanges();
  for (const contents of renditionContents(rendition)) {
    contents.window?.getSelection?.()?.removeAllRanges();
  }
}

function syncSavedTextHighlights(
  contents: Contents,
  cfis: Iterable<string>,
  textColor: string,
  notedCfis: ReadonlySet<string> = new Set(),
  onEditNote?: (cfi: string) => void,
) {
  // epub.js awaits content hooks inside View.render(); a highlight-sync
  // failure here must never break section rendering.
  try {
    syncSavedTextHighlightsCore(contents, cfis, textColor, notedCfis, onEditNote);
  } catch {
    // Best-effort paint only.
  }
}

function syncSavedTextHighlightsCore(
  contents: Contents,
  cfis: Iterable<string>,
  textColor: string,
  notedCfis: ReadonlySet<string>,
  onEditNote?: (cfi: string) => void,
) {
  const doc = contents.document;
  const contentWindow = contents.window as unknown as HighlightWindowLike;
  const registry = contentWindow?.CSS?.highlights;
  const HighlightConstructor = contentWindow?.Highlight;
  if (!doc || !registry || !HighlightConstructor) {
    return;
  }

  // Same mechanism as ::selection: paint under glyphs, keep ink solid.
  // Slightly softer yellow than drag-select so active selection still reads stronger.
  let style = doc.getElementById(SAVED_TEXT_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = SAVED_TEXT_STYLE_ID;
    (doc.head || doc.documentElement).appendChild(style);
  }
  style.textContent = `
    ::highlight(${SAVED_TEXT_HIGHLIGHT_NAME}) {
      background-color: ${HIGHLIGHT_COLOR};
      color: ${textColor};
    }
    ::highlight(${SAVED_TEXT_NOTED_UNDERLINE_NAME}) {
      text-decoration-line: underline;
      text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
      text-decoration-thickness: 0.75px;
      text-underline-offset: 0.12em;
    }
    #${NOTE_MARKER_LAYER_ID} {
      /* A full inset box feeds epub.js column width back into scrollWidth and
         creates thousands of phantom pages. Keep this as a zero-size anchor. */
      position: absolute;
      left: 0;
      top: 0;
      width: 0;
      height: 0;
      overflow: visible;
      pointer-events: none;
      z-index: 6;
    }
    .op-book-note-marker {
      position: absolute;
      width: ${NOTE_MARKER_SIZE}px;
      height: ${NOTE_MARKER_SIZE}px;
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      box-shadow: none;
      outline: none;
      appearance: none;
      -webkit-appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      cursor: pointer;
      color: ${HIGHLIGHT_COLOR};
    }
    .op-book-note-marker:focus-visible svg {
      filter: drop-shadow(0 0 1px currentColor);
      transform: scale(1.08);
    }
    .op-book-note-marker svg {
      display: block;
      width: 12px;
      height: 12px;
    }
  `;

  const cfiList = Array.from(new Set(
    Array.from(cfis)
      .map((cfi) => cfi.trim())
      .filter((cfi) => Boolean(cfi) && cfiMatchesContents(cfi, contents)),
  ));
  const ranges: Range[] = [];
  const notedRanges: Range[] = [];
  for (const cfi of cfiList) {
    try {
      const range = contents.range(cfi);
      if (!range.collapsed && range.startContainer.ownerDocument === doc) {
        ranges.push(range);
        if (notedCfis.has(cfi)) {
          notedRanges.push(range);
        }
      }
    } catch {
      // The CFI belongs to another section or is stale.
    }
  }
  if (ranges.length === 0) {
    registry.delete(SAVED_TEXT_HIGHLIGHT_NAME);
  } else {
    registry.set(SAVED_TEXT_HIGHLIGHT_NAME, new HighlightConstructor(...ranges));
  }
  if (notedRanges.length === 0) {
    registry.delete(SAVED_TEXT_NOTED_UNDERLINE_NAME);
  } else {
    // CSS Highlights decorates every client rect in each Range, so wrapped
    // selections receive an underline on every line rather than only the end.
    registry.set(SAVED_TEXT_NOTED_UNDERLINE_NAME, new HighlightConstructor(...notedRanges));
  }

  syncNoteMarkers(contents, notedCfis, onEditNote);
}

function notedCfisFromNotes(notes: readonly ParsedBookHighlightNote[]): Set<string> {
  const noted = new Set<string>();
  for (const note of notes) {
    const cfi = (note.cfi || '').trim();
    if (cfi && note.note.trim()) {
      noted.add(cfi);
    }
  }
  return noted;
}

function createNoteMarkerIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  // Sticky-note style glyph.
  path.setAttribute('d', 'M3.5 2.5h7.2L12.5 4.3V13.5H3.5V2.5zM10.5 2.5v2h2M5.5 7h5M5.5 9.5h5M5.5 12h3');
  svg.append(path);
  return svg;
}

/**
 * A bare line icon below highlights that already have a reflection.
 * Highlights without a note have no marker; clicking the highlight opens the editor.
 */
function syncNoteMarkers(
  contents: Contents,
  notedCfis: ReadonlySet<string>,
  onEditNote?: (cfi: string) => void,
) {
  const doc = contents.document;
  const win = contents.window;
  if (!doc || !win) {
    return;
  }
  const host = doc.body || doc.documentElement;
  if (!host) {
    return;
  }
  let layer = doc.getElementById(NOTE_MARKER_LAYER_ID) as HTMLDivElement | null;
  if (!layer) {
    layer = doc.createElement('div');
    layer.id = NOTE_MARKER_LAYER_ID;
    host.appendChild(layer);
  }
  layer.replaceChildren();
  if (notedCfis.size === 0) {
    return;
  }

  const scrollX = win.scrollX || doc.documentElement.scrollLeft || 0;
  const scrollY = win.scrollY || doc.documentElement.scrollTop || 0;
  for (const cfi of notedCfis) {
    if (!cfiMatchesContents(cfi, contents)) {
      continue;
    }
    try {
      const range = contents.range(cfi);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
      const last = rects[rects.length - 1];
      if (!last) {
        continue;
      }
      const marker = doc.createElement('button');
      marker.type = 'button';
      marker.className = 'op-book-note-marker';
      marker.title = 'Edit note';
      marker.setAttribute('aria-label', 'Edit note');
      marker.dataset.cfi = cfi;
      // Hang the bare icon below the range and keep it inside the range's
      // horizontal footprint so it cannot cover following inline text.
      marker.style.left = `${Math.max(0, last.right + scrollX - NOTE_MARKER_SIZE)}px`;
      marker.style.top = `${Math.max(0, last.bottom + scrollY)}px`;
      marker.append(createNoteMarkerIcon(doc));
      marker.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      marker.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onEditNote?.(cfi);
      });
      layer.appendChild(marker);
    } catch {
      // Stale CFI for this section.
    }
  }
}

function rectContainsPoint(rect: DOMRect, clientX: number, clientY: number): boolean {
  const tolerance = 2;
  return clientX >= rect.left - tolerance
    && clientX <= rect.right + tolerance
    && clientY >= rect.top - tolerance
    && clientY <= rect.bottom + tolerance;
}

function renderAnnotationPanes(rendition: Rendition | null | undefined) {
  const views = (rendition as unknown as RenditionWithAnnotationInternals | null | undefined)?.views?.();
  views?.forEach?.((view) => {
    view.pane?.render?.();
  });
}

function renditionCanResize(rendition: Rendition | null | undefined): rendition is Rendition {
  return Boolean((rendition as unknown as RenditionWithAnnotationInternals | null | undefined)?.manager);
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => Element | null } | null;
  return Boolean(element?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

type EpubReaderPalette = {
  body: string;
  text: string;
  link: string;
  highlightText: string;
};

function readAppThemeColor(variable: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return fallback;
  }
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback;
}

function resolveReaderPalette(
  theme: EpubReaderTheme,
  appScheme: 'dark' | 'light',
): EpubReaderPalette {
  switch (theme) {
    case 'night':
      return {
        body: '#151515',
        text: '#e8e2d8',
        link: '#8fb7ff',
        highlightText: '#ffffff',
      };
    case 'sepia':
      return {
        body: '#f4ecd8',
        text: '#31291f',
        link: '#245f9d',
        highlightText: '#000000',
      };
    default:
      return {
        body: readAppThemeColor('--color-editor-bg', appScheme === 'dark' ? '#101816' : '#f4f9f7'),
        text: readAppThemeColor('--color-editor-fg', appScheme === 'dark' ? '#ffffff' : '#000000'),
        link: readAppThemeColor('--color-link-text', appScheme === 'dark' ? '#ffffff' : '#000000'),
        highlightText: appScheme === 'dark' ? '#ffffff' : '#000000',
      };
  }
}

function applyReaderTheme(
  rendition: Rendition,
  settings: EpubReaderSettings,
  palette: EpubReaderPalette,
  appFontFamily: string,
) {
  rendition.themes.default({
    html: {
      background: `${palette.body} !important`,
      color: `${palette.text} !important`,
      'overscroll-behavior': 'none !important',
      // EPUB content lives in its own iframe, so it does not inherit the app
      // root's text rasterization. Keep glyph weight consistent with Markdown.
      '-webkit-font-smoothing': 'antialiased !important',
      '-moz-osx-font-smoothing': 'grayscale !important',
    },
    body: {
      background: `${palette.body} !important`,
      color: `${palette.text} !important`,
      'overscroll-behavior': 'none !important',
      // Establish the same normal body weight as Markdown. Explicit publisher
      // weights on headings, strong text, or descendant classes still win.
      'font-weight': '400 !important',
      'font-size': `${Math.round(settings.fontScale * 100)}% !important`,
      'line-height': '1.62 !important',
      // Georgia/Cambria default to old-style figures; force lining nums as fallback.
      'font-variant-numeric': 'lining-nums !important',
    },
    p: {
      'line-height': '1.62 !important',
    },
    a: {
      color: `${palette.link} !important`,
    },
    ':target, *:target': {
      background: 'transparent !important',
      'background-color': 'transparent !important',
      outline: 'none !important',
      'box-shadow': 'none !important',
    },
    '::selection': {
      background: '#f6d75f',
    },
  });
  applyEpubReaderFont(rendition.themes, settings.font, appFontFamily);
  for (const contents of renditionContents(rendition)) {
    applyEpubContentFont(contents.document, settings.font, appFontFamily);
  }
}

/**
 * Keep one page per screen. epub.js start() copies package rendition:spread
 * over our options, and horizontal resize re-applies layout.settings.spread —
 * so both the public API and the layout settings object must stay on "none".
 */
function forceSinglePage(rendition: Rendition | null | undefined): void {
  if (!rendition) {
    return;
  }
  rendition.spread('none');
  const layout = (rendition as unknown as { _layout?: { settings?: { spread?: unknown } } })._layout;
  if (layout?.settings) {
    layout.settings.spread = 'none';
  }
}

export const EpubBookView: React.FC<EpubBookViewProps> = ({
  url,
  openMode,
  refreshKey,
  initialCfi = null,
  displayRequest = null,
  highlightRequest = null,
  highlightNotes = [],
  readerSettings,
  appFontFamily,
  onHighlightContextAction,
  onProgressChange,
  onTocChange,
  onError,
}) => {
  const appThemeId = useUiStore((state) => state.themeId);
  const appThemeScheme = useUiStore((state) => state.theme.scheme);
  const readerPalette = useMemo(
    () => resolveReaderPalette(readerSettings.theme, appThemeScheme),
    [appThemeId, appThemeScheme, readerSettings.theme],
  );
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const readerSettingsRef = useRef(readerSettings);
  const readerPaletteRef = useRef(readerPalette);
  const appFontFamilyRef = useRef(appFontFamily);
  const wheelDeltaRef = useRef(0);
  const lastWheelTurnRef = useRef(0);
  const appliedHighlightCfisRef = useRef<Set<string>>(new Set());
  const highlightNotesRef = useRef<ParsedBookHighlightNote[]>(highlightNotes);
  const annotationFrameIdsRef = useRef<number[]>([]);
  const navigationRef = useRef<{
    running: boolean;
    steps: number;
    pendingDisplay: PendingDisplay | null;
  }>({ running: false, steps: 0, pendingDisplay: null });
  // Keep parent callbacks outside the rendition lifecycle so interaction state
  // changes do not reopen the book.
  const callbacksRef = useRef({
    onHighlightContextAction,
    onProgressChange,
    onTocChange,
    onError,
  });
  callbacksRef.current = {
    onHighlightContextAction,
    onProgressChange,
    onTocChange,
    onError,
  };
  const [ready, setReady] = useState(false);

  const cancelScheduledAnnotationRefresh = useCallback(() => {
    for (const frameId of annotationFrameIdsRef.current) {
      window.cancelAnimationFrame(frameId);
    }
    annotationFrameIdsRef.current = [];
  }, []);

  const scheduleAnnotationRefresh = useCallback((rendition: Rendition | null | undefined = renditionRef.current) => {
    if (!rendition) {
      return;
    }
    cancelScheduledAnnotationRefresh();
    const refresh = (remainingFrames: number) => {
      const frameId = window.requestAnimationFrame(() => {
        annotationFrameIdsRef.current = annotationFrameIdsRef.current.filter((id) => id !== frameId);
        if (renditionRef.current !== rendition) {
          return;
        }
        renderAnnotationPanes(rendition);
        if (remainingFrames > 0) {
          refresh(remainingFrames - 1);
        }
      });
      annotationFrameIdsRef.current.push(frameId);
    };
    refresh(2);
  }, [cancelScheduledAnnotationRefresh]);

  const scheduleAnnotationRefreshRef = useRef(scheduleAnnotationRefresh);
  scheduleAnnotationRefreshRef.current = scheduleAnnotationRefresh;

  // Serial navigation queue: exactly one next()/prev()/display() in flight.
  // Concurrent calls corrupt epub.js view bookkeeping and render blank pages.
  const drainNavigationRef = useRef<() => void>();
  if (!drainNavigationRef.current) {
    drainNavigationRef.current = () => {
      const nav = navigationRef.current;
      const rendition = renditionRef.current;
      if (!nav || nav.running || !rendition) {
        return;
      }

      const jump = nav.pendingDisplay;
      if (!jump && nav.steps === 0) {
        return;
      }

      nav.running = true;
      const finish = () => {
        nav.running = false;
        if (renditionRef.current === rendition) {
          scheduleAnnotationRefreshRef.current(rendition);
          drainNavigationRef.current?.();
        }
      };

      if (jump) {
        nav.pendingDisplay = null;
        clearRenditionSelections(rendition);
        let request: Promise<unknown>;
        try {
          request = Promise.resolve(rendition.display(jump.target));
        } catch {
          request = Promise.resolve();
        }
        request.then(() => {
          try {
            if (renditionRef.current === rendition) {
              jump.after?.(rendition);
            }
          } catch {
            // A failed post-jump step must not wedge the navigation queue.
          }
          finish();
        });
        return;
      }

      const step = nav.steps > 0 ? 1 : -1;
      nav.steps -= step;
      clearRenditionSelections(rendition);
      let request: Promise<unknown>;
      try {
        request = Promise.resolve(step > 0 ? rendition.next() : rendition.prev());
      } catch {
        request = Promise.resolve();
      }
      request.then(finish);
    };
  }

  const queuePageTurn = useCallback((delta: number) => {
    const nav = navigationRef.current;
    nav.steps = Math.max(-NAV_QUEUE_LIMIT, Math.min(NAV_QUEUE_LIMIT, nav.steps + delta));
    drainNavigationRef.current?.();
  }, []);

  const queueDisplay = useCallback((target: string, after?: (rendition: Rendition) => void) => {
    const nav = navigationRef.current;
    // A jump supersedes queued turns; latest jump wins while one is running.
    nav.steps = 0;
    nav.pendingDisplay = { target, after };
    drainNavigationRef.current?.();
  }, []);

  useEffect(() => {
    readerSettingsRef.current = readerSettings;
  }, [readerSettings]);

  useEffect(() => {
    readerPaletteRef.current = readerPalette;
  }, [readerPalette]);

  useEffect(() => {
    appFontFamilyRef.current = appFontFamily;
  }, [appFontFamily]);

  useEffect(() => {
    highlightNotesRef.current = highlightNotes;
  }, [highlightNotes]);

  const goPrev = useCallback(() => {
    queuePageTurn(-1);
  }, [queuePageTurn]);

  const goNext = useCallback(() => {
    queuePageTurn(1);
  }, [queuePageTurn]);

  const handlePageKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditableEventTarget(event.target)) {
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      goPrev();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault();
      goNext();
    }
  }, [goNext, goPrev]);

  const handleWheelPageTurn = useCallback((event: WheelEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || isEditableEventTarget(event.target)) {
      return;
    }
    const target = event.target as Element | null;
    if (target?.closest?.('dialog[open]')) return;

    // Both the reader and iframe document use non-passive listeners. Consume
    // the entire gesture, including small/diagonal deltas and cooldown momentum,
    // before Safari can chain it into viewport bounce or pull-to-refresh.
    if (event.cancelable) event.preventDefault();

    const motion = resolveBookWheelMotion(event);
    if (!motion) {
      return;
    }

    const now = performance.now();
    if (now - lastWheelTurnRef.current < WHEEL_PAGE_COOLDOWN_MS) {
      wheelDeltaRef.current = 0;
      return;
    }

    const nextDelta = wheelDeltaRef.current + motion.delta;
    if (Math.abs(nextDelta) < WHEEL_PAGE_THRESHOLD) {
      wheelDeltaRef.current = nextDelta;
      return;
    }

    wheelDeltaRef.current = 0;
    lastWheelTurnRef.current = now;
    if (nextDelta > 0) {
      goNext();
    } else {
      goPrev();
    }
  }, [goNext, goPrev]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }

    root.addEventListener('wheel', handleWheelPageTurn, WHEEL_LISTENER_OPTIONS);
    return () => root.removeEventListener('wheel', handleWheelPageTurn, WHEEL_LISTENER_OPTIONS);
  }, [handleWheelPageTurn]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !url) {
      return undefined;
    }

    let cancelled = false;
    setReady(false);
    appliedHighlightCfisRef.current.clear();
    navigationRef.current.running = false;
    navigationRef.current.steps = 0;
    navigationRef.current.pendingDisplay = null;
    callbacksRef.current.onTocChange([]);
    host.replaceChildren();

    let initialDisplayComplete = false;
    let rendition: Rendition | null = null;
    let book: Book | null = null;
    let spineProgressIndex: EpubSpineProgressIndex = createEpubSpineProgressIndex([]);
    // epub.js converts archive/request failures into this event instead of
    // rejecting rendition.display(), which would otherwise leave the UI
    // stuck at "Loading EPUB..." forever.
    const handleOpenFailed = (error: unknown) => {
      if (!cancelled) {
        callbacksRef.current.onError(error instanceof Error ? error.message : 'Unable to open EPUB');
      }
    };
    const handleRelocated = (location: Location) => {
      callbacksRef.current.onProgressChange({
        locator: locationLabel(location),
        cfi: location?.start?.cfi || '',
        href: location?.start?.href || '',
        percentage: resolveEpubReadingProgress(
          location,
          spineProgressIndex,
          (book?.locations.length() || 0) > 0,
        ),
      });
    };
    const applyEpubHighlight = (cfi: string) => {
      const trimmed = cfi.trim();
      if (!trimmed || appliedHighlightCfisRef.current.has(trimmed) || !rendition) {
        return;
      }
      rendition.annotations.highlight(
        trimmed,
        {},
        undefined,
        'op-book-epub-highlight',
        BOOK_SAVED_SVG_MARK,
      );
      appliedHighlightCfisRef.current.add(trimmed);
      const notedCfis = notedCfisFromNotes(highlightNotesRef.current);
      const onEditNote = (cfi: string) => {
        callbacksRef.current.onHighlightContextAction?.({ type: 'edit-note', cfi });
      };
      for (const contents of renditionContents(rendition)) {
        syncSavedTextHighlights(
          contents,
          appliedHighlightCfisRef.current,
          readerPaletteRef.current.highlightText,
          notedCfis,
          onEditNote,
        );
      }
      scheduleAnnotationRefresh(rendition);
    };
    const createSelection = (cfiRange: string, contents: Contents): EpubSelection | null => {
      const text = selectedTextFromContents(contents);
      if (!text) {
        return null;
      }
      const current = rendition?.currentLocation() as unknown as Location | null;
      return {
        text,
        cfiRange,
        locator: locationLabel(current) || cfiRange,
        applyHighlight: () => {
          applyEpubHighlight(cfiRange);
          contents.window.getSelection()?.removeAllRanges();
        },
      };
    };
    const findHighlightAtPoint = (contents: Contents, clientX: number, clientY: number): string | null => {
      for (const note of highlightNotesRef.current) {
        const cfi = (note.cfi || '').trim();
        if (!cfi || !cfiMatchesContents(cfi, contents)) {
          continue;
        }
        try {
          const range = contents.range(cfi);
          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width > 0 && rect.height > 0 && rectContainsPoint(rect, clientX, clientY)) {
              return cfi;
            }
          }
        } catch {
          // Ignore stale notes that do not map into the currently visible section.
        }
      }
      return null;
    };
    const handleContentContextMenu = (event: MouseEvent, contents: Contents) => {
      const selection = contents.window?.getSelection?.();
      const text = (selection?.toString() || '').replace(/\s+/g, ' ').trim();
      if (selection && selection.rangeCount > 0 && text) {
        const range = selection.getRangeAt(0);
        if (!range.collapsed) {
          const cfiRange = contents.cfiFromRange(range);
          const nextSelection = createSelection(cfiRange, contents);
          if (nextSelection) {
            event.preventDefault();
            // Already highlighted → open note editor; otherwise save and open note.
            if (highlightNotesRef.current.some((note) => note.cfi === cfiRange)) {
              callbacksRef.current.onHighlightContextAction?.({ type: 'edit-note', cfi: cfiRange });
            } else {
              callbacksRef.current.onHighlightContextAction?.({ type: 'save', selection: nextSelection });
            }
            return;
          }
        }
      }

      // Right-click an existing highlight → add/view note (delete lives in the dialog).
      const cfi = findHighlightAtPoint(contents, event.clientX, event.clientY);
      if (!cfi) {
        return;
      }
      event.preventDefault();
      contents.window?.getSelection?.()?.removeAllRanges();
      callbacksRef.current.onHighlightContextAction?.({ type: 'edit-note', cfi });
    };
    // Left-click a saved highlight to add/edit the reader reflection.
    const handleContentClick = (event: MouseEvent, contents: Contents) => {
      if (event.defaultPrevented || event.button !== 0) {
        return;
      }
      const selection = contents.window?.getSelection?.();
      const selected = (selection?.toString() || '').replace(/\s+/g, ' ').trim();
      if (selected) {
        return;
      }
      const cfi = findHighlightAtPoint(contents, event.clientX, event.clientY);
      if (!cfi) {
        return;
      }
      event.preventDefault();
      contents.window?.getSelection?.()?.removeAllRanges();
      callbacksRef.current.onHighlightContextAction?.({ type: 'edit-note', cfi });
    };
    const handleContentFootnoteClick = (
      event: MouseEvent,
      contents: Contents,
      anchor: HTMLAnchorElement,
    ) => {
      if (event.button !== 0 || !book) {
        return;
      }
      const currentBook = book;
      void loadEpubFootnoteSource(currentBook, contents, anchor)
        .then((source) => {
          if (!cancelled && anchor.isConnected && renditionRef.current === rendition) {
            showEpubFootnoteDialog(contents, anchor, source, readerPaletteRef.current);
          }
        })
        .catch(() => undefined);
    };
    const contentWheelCleanups = new Map<Document, () => void>();
    const attachContentInteractions = (contents: Contents) => {
      const doc = contents.document;
      if (!doc || contentWheelCleanups.has(doc)) {
        return;
      }

      applyEpubContentFont(doc, readerSettingsRef.current.font, appFontFamilyRef.current);
      const contextMenuListener = (event: MouseEvent) => handleContentContextMenu(event, contents);
      const clickListener = (event: MouseEvent) => handleContentClick(event, contents);
      normalizeMalformedEpubNonBreakingWhitespace(doc);
      ensureEpubFootnoteStyles(contents, readerPaletteRef.current);
      const removeFootnoteClickBindings = bindEpubFootnoteReferenceClicks(
        doc,
        (event, anchor) => handleContentFootnoteClick(event, contents, anchor),
      );
      doc.addEventListener('wheel', handleWheelPageTurn, WHEEL_LISTENER_OPTIONS);
      doc.addEventListener('contextmenu', contextMenuListener);
      doc.addEventListener('click', clickListener);
      syncSavedTextHighlights(
        contents,
        highlightNotesRef.current
          .map((note) => note.cfi)
          .filter((cfi): cfi is string => Boolean(cfi)),
        readerPaletteRef.current.highlightText,
        notedCfisFromNotes(highlightNotesRef.current),
        (cfi) => {
          callbacksRef.current.onHighlightContextAction?.({ type: 'edit-note', cfi });
        },
      );
      contentWheelCleanups.set(doc, () => {
        doc.removeEventListener('wheel', handleWheelPageTurn, WHEEL_LISTENER_OPTIONS);
        doc.removeEventListener('contextmenu', contextMenuListener);
        doc.removeEventListener('click', clickListener);
        removeFootnoteClickBindings();
        closeEpubFootnoteDialog(doc);
      });
    };

    const resyncVisibleHighlights = (rendition: Rendition | null | undefined) => {
      if (!rendition) {
        return;
      }
      const notedCfis = notedCfisFromNotes(highlightNotesRef.current);
      const onEditNote = (cfi: string) => {
        callbacksRef.current.onHighlightContextAction?.({ type: 'edit-note', cfi });
      };
      const allCfis = new Set<string>(appliedHighlightCfisRef.current);
      for (const note of highlightNotesRef.current) {
        const cfi = (note.cfi || '').trim();
        if (cfi) {
          allCfis.add(cfi);
        }
      }
      for (const contents of renditionContents(rendition)) {
        syncSavedTextHighlights(contents, allCfis, readerPaletteRef.current.highlightText, notedCfis, onEditNote);
      }
    };

    const handleResized = () => {
      const rendition = renditionRef.current;
      forceSinglePage(rendition);
      scheduleAnnotationRefresh(rendition);
      // Re-anchor note markers after the layout changed.
      resyncVisibleHighlights(rendition);
    };

    // epub.js only listens to window resize. TOC / activity-panel width changes
    // must resize the page explicitly or neighboring columns leak into view.
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        const width = Math.floor(entry.contentRect.width);
        const height = Math.floor(entry.contentRect.height);
        if (width <= 0 || height <= 0) {
          return;
        }
        const current = renditionRef.current;
        if (!current || !initialDisplayComplete || !renditionCanResize(current)) {
          return;
        }
        if (navigationRef.current.running) {
          // A page turn is mid-flight; resizing now would re-lay-out a view
          // that epub.js is still displaying. Retry once it settles.
          window.setTimeout(() => {
            const active = renditionRef.current;
            if (
              active === current
              && renditionCanResize(active)
              && !navigationRef.current.running
              && !cancelled
            ) {
              active.resize(width, height);
              handleResized();
            }
          }, 240);
          return;
        }
        current.resize(width, height);
        forceSinglePage(current);
        scheduleAnnotationRefresh(current);
      });
    resizeObserver?.observe(host);

    loadEpubFactory()
      .then((ePub) => {
        if (cancelled) {
          return null;
        }
        book = ePub(url, {
          openAs: openMode,
          replacements: openMode === 'epub' ? 'blobUrl' : 'none',
        });
        // Runs on the inert source document, before any iframe parses it.
        book.spine.hooks.content.register(protectEpubDocument);
        book.on('openFailed', handleOpenFailed);
        rendition = book.renderTo(host, {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          // Publication scripts remain forbidden by protectEpubDocument's CSP.
          // WebKit requires this sandbox flag for parent-owned wheel listeners.
          allowScriptedContent: true,
          // Default is always one page per screen. Multi-page spreads are opt-in
          // only; never inherit rendition:spread=both from the package.
          spread: 'none',
        });
        renditionRef.current = rendition;
        applyReaderTheme(
          rendition,
          readerSettingsRef.current,
          readerPaletteRef.current,
          appFontFamilyRef.current,
        );
        rendition.on('relocated', handleRelocated);
        rendition.on('resized', handleResized);
        rendition.on('keydown', handlePageKeyDown);
        rendition.hooks.content.register(attachContentInteractions);
        void book.loaded.spine
          .then(() => {
            const spineWeights: Array<number | null> = [];
            // epub.js 0.3's declaration says loaded.spine resolves to an array,
            // but runtime resolves the Spine object. Use its public iterator.
            book?.spine.each((item: { href?: string }) => {
              spineWeights.push(archiveSpineItemWeight(book as Book, item.href || ''));
            });
            spineProgressIndex = createEpubSpineProgressIndex(spineWeights);
            if (!cancelled && rendition?.location?.start) {
              handleRelocated(rendition.location);
            }
          })
          .catch(() => {
            spineProgressIndex = createEpubSpineProgressIndex([]);
          });
        void book.loaded.navigation
          .then((navigation) => {
            if (!cancelled) {
              callbacksRef.current.onTocChange(navigation.toc || []);
            }
          })
          .catch(() => {
            if (!cancelled) {
              callbacksRef.current.onTocChange([]);
            }
          });
        return rendition.display(initialCfi || undefined);
      })
      .then(() => {
        if (cancelled || !rendition) {
          return;
        }
        initialDisplayComplete = true;
        // epub.js start() overwrites options.spread from package metadata
        // (rendition:spread=both → dual page). Force single page after start.
        forceSinglePage(rendition);
        scheduleAnnotationRefresh(rendition);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          callbacksRef.current.onError(error instanceof Error ? error.message : 'Unable to open EPUB');
        }
      });

    return () => {
      cancelled = true;
      initialDisplayComplete = false;
      resizeObserver?.disconnect();
      callbacksRef.current.onTocChange([]);
      rendition?.off('relocated', handleRelocated);
      rendition?.off('resized', handleResized);
      rendition?.off('keydown', handlePageKeyDown);
      rendition?.hooks.content.deregister(attachContentInteractions);
      cancelScheduledAnnotationRefresh();
      contentWheelCleanups.forEach((cleanup) => cleanup());
      contentWheelCleanups.clear();
      rendition?.destroy();
      book?.off('openFailed', handleOpenFailed);
      book?.destroy();
      if (renditionRef.current === rendition) {
        renditionRef.current = null;
      }
    };
  }, [
    handlePageKeyDown,
    handleWheelPageTurn,
    initialCfi,
    cancelScheduledAnnotationRefresh,
    openMode,
    refreshKey,
    scheduleAnnotationRefresh,
    url,
  ]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) {
      return;
    }
    applyReaderTheme(rendition, readerSettings, readerPalette, appFontFamily);
    const notedCfis = notedCfisFromNotes(highlightNotesRef.current);
    const onEditNote = (cfi: string) => {
      callbacksRef.current.onHighlightContextAction?.({ type: 'edit-note', cfi });
    };
    for (const contents of renditionContents(rendition)) {
      ensureEpubFootnoteStyles(contents, readerPalette);
      syncSavedTextHighlights(
        contents,
        appliedHighlightCfisRef.current,
        readerPalette.highlightText,
        notedCfis,
        onEditNote,
      );
    }
    scheduleAnnotationRefresh(rendition);
  }, [appFontFamily, readerPalette, readerSettings, scheduleAnnotationRefresh]);

  useEffect(() => {
    const target = (displayRequest?.target || '').trim();
    if (!target || !ready) {
      return;
    }
    queueDisplay(target);
  }, [displayRequest, ready, queueDisplay]);

  useEffect(() => {
    const cfi = (highlightRequest?.cfi || '').trim();
    if (!cfi || !ready) {
      return;
    }
    queueDisplay(cfi, (rendition) => {
      if (!appliedHighlightCfisRef.current.has(cfi)) {
        rendition.annotations.highlight(
          cfi,
          {},
          undefined,
          'op-book-epub-highlight',
          BOOK_SAVED_SVG_MARK,
        );
        appliedHighlightCfisRef.current.add(cfi);
      }
    });
  }, [highlightRequest, ready, queueDisplay]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || !ready) {
      return;
    }
    const nextCfis = new Set(
      highlightNotes
        .map((note) => (note.cfi || '').trim())
        .filter(Boolean)
    );
    const requestedCfi = (highlightRequest?.cfi || '').trim();
    if (requestedCfi) {
      nextCfis.add(requestedCfi);
    }
    for (const cfi of Array.from(appliedHighlightCfisRef.current)) {
      if (!nextCfis.has(cfi)) {
        rendition.annotations.remove(cfi, 'highlight');
        appliedHighlightCfisRef.current.delete(cfi);
      }
    }
    for (const note of highlightNotes) {
      const cfi = (note.cfi || '').trim();
      if (!cfi || appliedHighlightCfisRef.current.has(cfi)) {
        continue;
      }
      rendition.annotations.highlight(
        cfi,
        {},
        undefined,
        'op-book-epub-highlight',
        BOOK_SAVED_SVG_MARK,
      );
      appliedHighlightCfisRef.current.add(cfi);
    }
    const notedCfis = notedCfisFromNotes(highlightNotes);
    const onEditNote = (cfi: string) => {
      callbacksRef.current.onHighlightContextAction?.({ type: 'edit-note', cfi });
    };
    for (const contents of renditionContents(rendition)) {
      syncSavedTextHighlights(contents, nextCfis, readerPaletteRef.current.highlightText, notedCfis, onEditNote);
    }
    scheduleAnnotationRefresh(rendition);
  }, [highlightNotes, highlightRequest, ready, scheduleAnnotationRefresh]);

  useEffect(() => {
    window.addEventListener('keydown', handlePageKeyDown);
    return () => window.removeEventListener('keydown', handlePageKeyDown);
  }, [handlePageKeyDown]);

  return (
    <div
      ref={rootRef}
      className="relative h-full min-h-0 overflow-hidden overscroll-none"
      style={{ backgroundColor: readerPalette.body, color: readerPalette.text }}
    >
      {!ready ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-secondary-text">
          Loading EPUB...
        </div>
      ) : null}
      <button
        type="button"
        className="absolute left-3 top-1/2 z-20 flex h-10 w-8 -translate-y-1/2 items-center justify-center rounded bg-editor-bg/80 text-secondary-text hover:bg-hover-bg hover:text-primary-text"
        onClick={goPrev}
        title="Previous page"
        aria-label="Previous page"
      >
        <span className="rotate-180 text-lg leading-none">›</span>
      </button>
      <div ref={hostRef} className="h-full min-h-0 overflow-hidden px-12 py-4" />
      <button
        type="button"
        className="absolute right-3 top-1/2 z-20 flex h-10 w-8 -translate-y-1/2 items-center justify-center rounded bg-editor-bg/80 text-secondary-text hover:bg-hover-bg hover:text-primary-text"
        onClick={goNext}
        title="Next page"
        aria-label="Next page"
      >
        <span className="text-lg leading-none">›</span>
      </button>
    </div>
  );
};
