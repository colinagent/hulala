import { localStore } from "../../../platform/storage";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { NavItem } from 'epubjs';
import { rendererI18n } from '../../../i18n/renderer';
import { getRenderHandleForPhysicalPath } from '../../services/resourceService';
import { writeClipboardText } from '../../services/clipboardService';
import { useAppStore, useWorkspaceStoreApi, useWorkspaceViewId } from '../../store/appStore';
import { useToastStore } from '../../store/toastStore';
import {
  CopyIcon,
  FileIcon,
  ListIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshIcon,
} from '../Icons';
import { IconButton } from '../IconButton';
import { PopupMenu, PopupMenuItem, PopupMenuSeparator } from '../PopupMenu';
import { OP_SG_CAPSULE, OP_SG_ON_EDITOR } from '../staticGlassCapsule';
import {
  appendBookHighlightNote,
  buildBookHighlightEntry,
  filterBookHighlightNotesForTarget,
  findOpenBookNoteDocument,
  getBookNotePath,
  hasHighlightText,
  parseBookHighlightNotes,
  parseBookHighlightNoteBlock,
  removeBookHighlightNote,
  updateBookHighlightNote,
  type BookHighlightFormat,
  type BookHighlightNoteRemovalTarget,
  type ParsedBookHighlightNote,
} from './bookNotes';
import {
  EpubBookView,
  type EpubDisplayRequest,
  type EpubHighlightRequest,
  type EpubHighlightContextAction,
  type EpubOpenMode,
  type EpubProgress,
  type EpubSelection,
} from './EpubBookView';
import {
  getEpubReaderSettings,
  setEpubReaderFont,
  setEpubReaderTheme,
  subscribeEpubReaderSettings,
  type EpubReaderFont,
  type EpubReaderTheme,
} from './epubReaderSettings';
import {
  normalizeEpubReadingProgress,
  setEpubReadingProgress,
} from './epubReadingProgress';
import {
  PdfBookView,
  type PdfBookViewState,
  type PdfHighlightContextAction,
  type PdfHighlightRequest,
  type PdfSelection,
} from './PdfBookView';
import {
  MAX_PDF_CUSTOM_ZOOM,
  MIN_PDF_CUSTOM_ZOOM,
  PDF_CUSTOM_ZOOM_STEP,
  clampPdfCustomZoom,
  clearPdfReadingSnapshot,
  defaultPdfBookViewState,
  loadPdfBookViewState,
  publishPdfReadingSnapshot,
  savePdfBookViewState,
  subscribePdfReaderCommands,
  type PdfDisplayMode,
} from './pdfReaderState';
import { OutlineTree } from './outline/OutlineTree';
import {
  buildEpubOutlineNodes,
  findActiveEpubOutlineId,
} from './outline/epubOutline';
import {
  findActivePdfOutlineId,
  type PdfOutlineNode,
} from './outline/pdfOutline';
import {
  buildOutlineNodeMap,
  getAncestorAutoExpandedIds,
} from './outline/outlineExpand';
import type { ResourceMeta, RenderHandle } from '../../core/resource/uri';
import { DocumentOutlineToggle } from './DocumentOutlineToggle';
import { OutlinePopover } from './outline/OutlinePopover';

type BookReaderEditorProps = {
  tabId?: string | null;
  outlineMode?: 'popover' | 'hidden';
  rightWorkspaceControl?: React.ReactNode;
};

type ReaderSelection = (EpubSelection | PdfSelection) & {
  text: string;
  locator: string;
};

type EditingHighlightNote = {
  format: BookHighlightFormat;
  text: string;
  note: string;
  cfi?: string | null;
  page?: number | null;
  rects?: ParsedBookHighlightNote['rects'];
};

const EPUB_LOCATION_KEY_PREFIX = 'hulala.epub.location.v1:';
const RECT_EPSILON = 0.00002;
const FALLBACK_APP_DOCUMENT_FONT_FAMILY = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const EPUB_FONT_OPTIONS: ReadonlyArray<{
  value: EpubReaderFont;
  label: string;
  title: string;
}> = [
  { value: 'app', label: 'App', title: 'Follow the app and Markdown font' },
  { value: 'serif', label: 'Serif', title: 'Use the reader serif font' },
  { value: 'sans', label: 'Sans', title: 'Use the reader sans-serif font' },
  { value: 'publisher', label: 'Original', title: "Use the book's original font" },
];

function readAppDocumentFontFamily(): string {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return FALLBACK_APP_DOCUMENT_FONT_FAMILY;
  }

  const host = document.body || document.documentElement;
  const probe = document.createElement('span');
  probe.style.cssText = [
    'position:fixed',
    'left:-10000px',
    'visibility:hidden',
    'pointer-events:none',
    'font-family:var(--op-markdown-document-font-family)',
  ].join(';');
  probe.textContent = 'Aa中1';
  host.appendChild(probe);
  const resolved = window.getComputedStyle(probe).fontFamily.trim();
  probe.remove();
  return resolved || FALLBACK_APP_DOCUMENT_FONT_FAMILY;
}

function bookErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load book';
}

function resolveBookFormat(path: string): BookHighlightFormat | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.epub')) {
    return 'epub';
  }
  if (lower.endsWith('.pdf')) {
    return 'pdf';
  }
  return null;
}

function locationStorageKey(filePath: string): string {
  return `${EPUB_LOCATION_KEY_PREFIX}${filePath}`;
}

function loadSavedEpubProgress(filePath: string): { cfi: string | null; percentage: number | null } {
  if (typeof window === 'undefined' || !filePath) {
    return { cfi: null, percentage: null };
  }
  try {
    const raw = localStore.getItem(locationStorageKey(filePath));
    const parsed = raw ? JSON.parse(raw) as { cfi?: unknown; percentage?: unknown } : null;
    return {
      cfi: typeof parsed?.cfi === 'string' && parsed.cfi.trim() ? parsed.cfi : null,
      percentage: normalizeEpubReadingProgress(parsed?.percentage),
    };
  } catch {
    return { cfi: null, percentage: null };
  }
}

function saveEpubProgress(filePath: string, progress: EpubProgress) {
  if (typeof window === 'undefined' || !filePath || !progress.cfi) {
    return;
  }
  localStore.setItem(locationStorageKey(filePath), JSON.stringify({
    cfi: progress.cfi,
    locator: progress.locator,
    percentage: progress.percentage,
    updatedAt: new Date().toISOString(),
  }));
}

function resolveEpubOpen(meta: ResourceMeta | null, handle: RenderHandle | null, url: string): { url: string; mode: EpubOpenMode } {
  if (meta?.entryType === 'directory' || handle?.entryType === 'directory') {
    const packagePath = (handle?.epubPackagePath || meta?.epubPackagePath || '').trim();
    if (packagePath) {
      return { url: new URL(packagePath, url).toString(), mode: 'opf' };
    }
    return { url, mode: 'directory' };
  }
  return { url, mode: 'epub' };
}

function isEpubSelection(selection: ReaderSelection): selection is EpubSelection & ReaderSelection {
  return 'cfiRange' in selection;
}

function isPdfSelection(selection: ReaderSelection): selection is PdfSelection & ReaderSelection {
  return 'page' in selection;
}

function sameHighlightRect(
  left: { top: number; left: number; width: number; height: number },
  right: { top: number; left: number; width: number; height: number }
): boolean {
  return Math.abs(left.top - right.top) <= RECT_EPSILON
    && Math.abs(left.left - right.left) <= RECT_EPSILON
    && Math.abs(left.width - right.width) <= RECT_EPSILON
    && Math.abs(left.height - right.height) <= RECT_EPSILON;
}

function sameHighlightRects(
  left: Array<{ top: number; left: number; width: number; height: number }>,
  right: Array<{ top: number; left: number; width: number; height: number }>
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((rect, index) => sameHighlightRect(rect, right[index]));
}

function selectionMatchesHighlightNote(selection: ReaderSelection, note: ParsedBookHighlightNote): boolean {
  if (isEpubSelection(selection)) {
    return note.format === 'epub' && note.cfi === selection.cfiRange;
  }
  if (isPdfSelection(selection)) {
    return note.format === 'pdf'
      && note.page === selection.page
      && sameHighlightRects(note.rects, selection.rects);
  }
  return false;
}

export const BookReaderEditor: React.FC<BookReaderEditorProps> = ({
  tabId = null,
  outlineMode = 'popover',
  rightWorkspaceControl,
}) => {
  const workspaceStore = useWorkspaceStoreApi();
  const readerLayoutRef = useRef<HTMLDivElement>(null);
  const documents = useAppStore((state) => state.documents);
  const workspaceViewId = useWorkspaceViewId();
  const activeTabId = useAppStore((state) => state.activeTabId);
  const openFile = useAppStore((state) => state.openFile);
  const readTextFile = useAppStore((state) => state.readTextFile);
  const statPath = useAppStore((state) => state.statPath);
  const writeTextFile = useAppStore((state) => state.writeTextFile);
  const setPendingBookTarget = useAppStore((state) => state.setPendingBookTarget);
  const saveEditorViewState = useAppStore((state) => state.saveEditorViewState);
  const loadEditorViewState = useAppStore((state) => state.loadEditorViewState);
  const pushToast = useToastStore((state) => state.pushToast);
  const [renderUrl, setRenderUrl] = useState('');
  const [renderFilePath, setRenderFilePath] = useState('');
  const [resourceMeta, setResourceMeta] = useState<ResourceMeta | null>(null);
  const [renderHandle, setRenderHandle] = useState<RenderHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [locator, setLocator] = useState('');
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pdfDisplayMode, setPdfDisplayMode] = useState<PdfDisplayMode>('fit-page');
  const [pdfCustomZoom, setPdfCustomZoom] = useState(1);
  const [pdfEffectiveZoom, setPdfEffectiveZoom] = useState(1);
  const [pdfOutline, setPdfOutline] = useState<PdfOutlineNode[]>([]);
  const [epubProgress, setEpubProgress] = useState<EpubProgress>({ locator: '', cfi: '', href: '', percentage: null });
  const [toc, setToc] = useState<NavItem[]>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [epubDisplayRequest, setEpubDisplayRequest] = useState<EpubDisplayRequest | null>(null);
  const [epubHighlightRequest, setEpubHighlightRequest] = useState<EpubHighlightRequest | null>(null);
  const [pdfHighlightRequest, setPdfHighlightRequest] = useState<PdfHighlightRequest | null>(null);
  const [highlightNotes, setHighlightNotes] = useState<ParsedBookHighlightNote[]>([]);
  const [editingHighlight, setEditingHighlight] = useState<EditingHighlightNote | null>(null);
  const epubReaderSettings = useSyncExternalStore(
    subscribeEpubReaderSettings,
    getEpubReaderSettings,
    getEpubReaderSettings,
  );
  const [appDocumentFontFamily, setAppDocumentFontFamily] = useState(readAppDocumentFontFamily);
  const [readerMenuOpen, setReaderMenuOpen] = useState(false);
  const readerMenuRef = React.useRef<HTMLDivElement | null>(null);
  const epubProgressRef = useRef<EpubProgress>({ locator: '', cfi: '', href: '', percentage: null });
  const pdfViewStateRef = useRef<PdfBookViewState>(defaultPdfBookViewState());

  const tab = useMemo(() => {
    const id = tabId || activeTabId || '';
    return documents.find((item) => item.id === id) || null;
  }, [activeTabId, documents, tabId]);

  const filePath = (tab?.filePath || '').trim();
  const resourceVersion = tab?.resourceVersion ?? 0;
  const missing = Boolean(tab?.missing);
  const format = resolveBookFormat(filePath);
  const notePath = filePath ? getBookNotePath(filePath) : '';
  const pendingBookTarget = tab?.pendingBookTarget || null;
  const editorViewStateIdentity = useMemo(() => {
    if (!tab?.id) {
      return null;
    }
    return {
      tabId: tab.id,
      uri: tab.uri || null,
      filePath: tab.filePath || null,
    };
  }, [filePath, tab?.id, tab?.uri]);
  const sessionBookViewState = useMemo(() => {
    if (!editorViewStateIdentity || !format) {
      return null;
    }
    return loadEditorViewState(editorViewStateIdentity, format);
  }, [editorViewStateIdentity, format, loadEditorViewState, refreshSeq, resourceVersion]);
  const initialPdfViewState = useMemo<PdfBookViewState | null>(() => {
    if (format !== 'pdf') {
      return null;
    }
    if (sessionBookViewState?.kind === 'pdf') {
      return {
        page: sessionBookViewState.page,
        displayMode: sessionBookViewState.displayMode,
        customZoom: sessionBookViewState.customZoom,
        scrollTop: sessionBookViewState.scrollTop,
        scrollLeft: sessionBookViewState.scrollLeft,
      };
    }
    return loadPdfBookViewState({ uri: tab?.uri || null, filePath });
  }, [filePath, format, sessionBookViewState, tab?.uri]);

  useEffect(() => {
    if (!editorViewStateIdentity || !format) {
      return undefined;
    }
    if (format === 'epub') {
      epubProgressRef.current = sessionBookViewState?.kind === 'epub'
        ? {
            locator: sessionBookViewState.locator,
            cfi: sessionBookViewState.cfi,
            href: sessionBookViewState.href,
            percentage: sessionBookViewState.percentage,
          }
        : { locator: '', cfi: '', href: '', percentage: null };
    } else {
      const restored = initialPdfViewState || defaultPdfBookViewState();
      pdfViewStateRef.current = restored;
      setPage(restored.page);
      setPdfDisplayMode(restored.displayMode);
      setPdfCustomZoom(restored.customZoom);
    }

    return () => {
      if (format === 'epub') {
        const progress = epubProgressRef.current;
        if (progress.cfi) {
          saveEditorViewState(editorViewStateIdentity, {
            kind: 'epub',
            ...progress,
          });
        }
        return;
      }
      saveEditorViewState(editorViewStateIdentity, {
        kind: 'pdf',
        ...pdfViewStateRef.current,
      });
      savePdfBookViewState(editorViewStateIdentity, pdfViewStateRef.current);
    };
  }, [editorViewStateIdentity, format, initialPdfViewState, saveEditorViewState, sessionBookViewState]);

  useEffect(() => {
    setTocOpen(false);
    setPdfOutline([]);
  }, [format, tab?.id]);

  const readCurrentNoteContent = useCallback(async (): Promise<{
    content: string | null;
    openTabId: string | null;
  }> => {
    const openDocument = findOpenBookNoteDocument(workspaceStore.getState().documents, notePath);
    if (openDocument) {
      return { content: openDocument.content, openTabId: openDocument.id };
    }
    return { content: await readTextFile(notePath), openTabId: null };
  }, [notePath, readTextFile]);

  const persistNoteContent = useCallback(async (
    content: string,
    preferredOpenTabId: string | null,
    baseline: string | null,
  ): Promise<boolean> => {
    const state = workspaceStore.getState();
    const openDocument = state.documents.find((document) => document.id === preferredOpenTabId)
      || findOpenBookNoteDocument(state.documents, notePath);
    if (!openDocument) {
      return writeTextFile(notePath, content, baseline);
    }
    state.setTabContent(openDocument.id, content);
    return state.saveTabByPath(notePath, openDocument.id);
  }, [notePath, writeTextFile]);

  useEffect(() => {
    let cancelled = false;
    setRenderUrl('');
    setRenderFilePath('');
    setResourceMeta(null);
    setRenderHandle(null);
    setError(null);
    const restoredEpubProgress = sessionBookViewState?.kind === 'epub'
      ? {
          locator: sessionBookViewState.locator,
          cfi: sessionBookViewState.cfi,
          href: sessionBookViewState.href,
          percentage: sessionBookViewState.percentage,
        }
      : { locator: '', cfi: '', href: '', percentage: null };
    setLocator(restoredEpubProgress.locator);
    setEpubProgress(restoredEpubProgress);
    setToc([]);
    setEpubDisplayRequest(null);
    setEpubHighlightRequest(null);
    setPdfHighlightRequest(null);
    setHighlightNotes([]);

    if (format === 'epub') {
      setEpubReadingProgress(
        filePath,
        restoredEpubProgress.percentage ?? loadSavedEpubProgress(filePath).percentage ?? 0,
      );
    }

    if (!filePath) {
      setLoading(false);
      setError('Book path is missing');
      return () => {
        cancelled = true;
      };
    }

    if (!format) {
      setLoading(false);
      setError('Unsupported book format');
      return () => {
        cancelled = true;
      };
    }

    if (missing) {
      setLoading(false);
      setError('File was deleted on disk');
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    getRenderHandleForPhysicalPath(filePath, workspaceViewId)
      .then(({ url, meta, handle }) => {
        if (cancelled) return;
        setRenderUrl(url);
        setRenderFilePath(filePath);
        setResourceMeta(meta);
        setRenderHandle(handle);
        setError(null);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(bookErrorMessage(nextError));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, format, missing, refreshSeq, resourceVersion, sessionBookViewState]);

  useEffect(() => {
    let cancelled = false;
    setHighlightNotes([]);

    if (!filePath || !format || !notePath || missing) {
      return () => {
        cancelled = true;
      };
    }

    readCurrentNoteContent()
      .then(async (snapshot) => {
        const content = snapshot.content;
        if (cancelled) {
          return;
        }
        if (content === null) {
          const stat = await statPath(notePath);
          if (!cancelled && stat.error && !/not found|no such file/i.test(stat.error)) {
            console.warn('Failed to read highlight notes:', stat.error);
          }
          return;
        }
        if (cancelled) {
          return;
        }
        setHighlightNotes(filterBookHighlightNotesForTarget(parseBookHighlightNotes(content), { sourcePath: filePath, format }));
      })
      .catch((nextError) => {
        if (!cancelled) {
          console.warn('Failed to load highlight notes:', nextError);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, format, missing, notePath, readCurrentNoteContent, refreshSeq, resourceVersion, statPath]);

  const handleHighlight = useCallback(async (
    targetSelection: ReaderSelection | null,
    options?: { openEditor?: boolean },
  ) => {
    if (!targetSelection || !format || !filePath || !hasHighlightText(targetSelection.text)) {
      pushToast('Select text to highlight');
      return;
    }

    try {
      const noteSnapshot = await readCurrentNoteContent();
      const existing = noteSnapshot.content;
      if (existing === null) {
        const stat = await statPath(notePath);
        if (stat.error && !/not found|no such file/i.test(stat.error)) {
          throw new Error(stat.error);
        }
        if (!stat.error) {
          throw new Error('Highlight notes file could not be read');
        }
      }
      const entryInput = {
        sourcePath: filePath,
        sourceTitle: tab?.title || null,
        format,
        text: targetSelection.text,
        locator: targetSelection.locator,
        cfi: isEpubSelection(targetSelection) ? targetSelection.cfiRange : null,
        page: isPdfSelection(targetSelection) ? targetSelection.page : null,
        rects: isPdfSelection(targetSelection) ? targetSelection.rects : null,
        createdAt: new Date(),
      };
      const entry = buildBookHighlightEntry(entryInput);
      const content = appendBookHighlightNote(existing || '', entryInput);
      const saved = await persistNoteContent(content, noteSnapshot.openTabId, noteSnapshot.content);
      if (!saved) {
        throw new Error('Failed to write highlight notes');
      }
      const parsed = parseBookHighlightNoteBlock(entry);
      if (parsed) {
        setHighlightNotes((current) => filterBookHighlightNotesForTarget([...current, parsed], { sourcePath: filePath, format }));
        if (options?.openEditor) {
          setEditingHighlight({
            format: parsed.format,
            text: parsed.text,
            note: parsed.note,
            cfi: parsed.cfi,
            page: parsed.page,
            rects: parsed.rects,
          });
        }
      }
      targetSelection.applyHighlight();
      pushToast(options?.openEditor ? 'Highlight saved — add a note' : 'Highlight saved');
    } catch (nextError) {
      pushToast(bookErrorMessage(nextError));
    }
  }, [filePath, format, notePath, persistNoteContent, pushToast, readCurrentNoteContent, statPath, tab?.title]);

  const handleRemoveHighlight = useCallback(async (target: BookHighlightNoteRemovalTarget): Promise<boolean> => {
    if (!format || !filePath || !notePath) {
      return false;
    }

    try {
      const noteSnapshot = await readCurrentNoteContent();
      const existing = noteSnapshot.content;
      if (existing === null) {
        const stat = await statPath(notePath);
        if (stat.error && !/not found|no such file/i.test(stat.error)) {
          throw new Error(stat.error);
        }
        pushToast('Highlight not found');
        return false;
      }

      const result = removeBookHighlightNote(existing, target);
      if (result.removed === 0) {
        pushToast('Highlight not found');
        return false;
      }

      const saved = await persistNoteContent(result.content, noteSnapshot.openTabId, noteSnapshot.content);
      if (!saved) {
        throw new Error('Failed to write highlight notes');
      }

      setHighlightNotes(filterBookHighlightNotesForTarget(parseBookHighlightNotes(result.content), { sourcePath: filePath, format }));
      pushToast('Highlight removed');
      return true;
    } catch (nextError) {
      pushToast(bookErrorMessage(nextError));
      return false;
    }
  }, [filePath, format, notePath, persistNoteContent, pushToast, readCurrentNoteContent, statPath]);

  const openHighlightNoteEditor = useCallback((note: ParsedBookHighlightNote) => {
    setEditingHighlight({
      format: note.format,
      text: note.text,
      note: note.note,
      cfi: note.cfi,
      page: note.page,
      rects: note.rects,
    });
  }, []);

  const handleSaveHighlightNote = useCallback(async () => {
    if (!editingHighlight || !format || !filePath) {
      return;
    }

    try {
      const noteSnapshot = await readCurrentNoteContent();
      const existing = noteSnapshot.content;
      if (existing === null) {
        pushToast('Highlight not found');
        return;
      }

      const result = updateBookHighlightNote(existing, {
        sourcePath: filePath,
        format: editingHighlight.format,
        cfi: editingHighlight.cfi,
        page: editingHighlight.page,
        rects: editingHighlight.rects,
        note: editingHighlight.note,
      });
      if (result.updated === 0) {
        pushToast('Highlight not found');
        return;
      }

      const saved = await persistNoteContent(result.content, noteSnapshot.openTabId, noteSnapshot.content);
      if (!saved) {
        throw new Error('Failed to write highlight notes');
      }

      setHighlightNotes(filterBookHighlightNotesForTarget(parseBookHighlightNotes(result.content), { sourcePath: filePath, format }));
      setEditingHighlight(null);
      pushToast(editingHighlight.note.trim() ? 'Note saved' : 'Note cleared');
    } catch (nextError) {
      pushToast(bookErrorMessage(nextError));
    }
  }, [editingHighlight, filePath, format, persistNoteContent, pushToast, readCurrentNoteContent]);

  const handleDeleteEditingHighlight = useCallback(async () => {
    if (!editingHighlight || !filePath) {
      return;
    }
    const removed = await handleRemoveHighlight({
      sourcePath: filePath,
      format: editingHighlight.format,
      cfi: editingHighlight.cfi,
      page: editingHighlight.page,
      rects: editingHighlight.rects,
    });
    if (removed) {
      setEditingHighlight(null);
    }
  }, [editingHighlight, filePath, handleRemoveHighlight]);

  const handleHighlightContextAction = useCallback((action: EpubHighlightContextAction | PdfHighlightContextAction) => {
    if (!filePath) {
      return;
    }

    if (action.type === 'save') {
      // Save only; add/edit note via the icon at the end of the highlight.
      void handleHighlight(action.selection, { openEditor: false });
      return;
    }

    if (action.type === 'edit-note') {
      const match = 'cfi' in action
        ? highlightNotes.find((note) => note.format === 'epub' && note.cfi === action.cfi)
        : highlightNotes.find((note) => (
          note.format === 'pdf'
          && note.page === action.page
          && note.rects.length === action.rects.length
          && note.rects.every((rect, index) => (
            Math.abs(rect.top - action.rects[index].top) <= RECT_EPSILON
            && Math.abs(rect.left - action.rects[index].left) <= RECT_EPSILON
            && Math.abs(rect.width - action.rects[index].width) <= RECT_EPSILON
            && Math.abs(rect.height - action.rects[index].height) <= RECT_EPSILON
          ))
        ));
      if (match) {
        openHighlightNoteEditor(match);
      }
      return;
    }

    if ('cfi' in action) {
      void handleRemoveHighlight({ sourcePath: filePath, format: 'epub', cfi: action.cfi });
      return;
    }

    void handleRemoveHighlight({ sourcePath: filePath, format: 'pdf', page: action.page, rects: action.rects });
  }, [filePath, handleHighlight, handleRemoveHighlight, highlightNotes, openHighlightNoteEditor]);

  const handleOpenNotes = useCallback(() => {
    if (notePath) {
      void openFile(notePath);
    }
    setReaderMenuOpen(false);
  }, [notePath, openFile]);

  const handleCopyPath = useCallback(async () => {
    if (!filePath) {
      return;
    }
    try {
      await writeClipboardText(filePath);
      pushToast('Path copied');
    } catch (nextError) {
      pushToast(bookErrorMessage(nextError));
    }
    setReaderMenuOpen(false);
  }, [filePath, pushToast]);

  const handleRefresh = useCallback(() => {
    setRefreshSeq((current) => current + 1);
    setReaderMenuOpen(false);
  }, []);

  const handleError = useCallback((message: string) => {
    setError(message);
  }, []);

  const handlePdfPageChange = useCallback((nextPage: number) => {
    pdfViewStateRef.current = {
      ...pdfViewStateRef.current,
      page: nextPage,
    };
    setPage(nextPage);
  }, []);

  const handleZoomOut = useCallback(() => {
    const baseZoom = pdfViewStateRef.current.displayMode === 'fit-page'
      ? pdfEffectiveZoom
      : pdfViewStateRef.current.customZoom;
    if (baseZoom <= MIN_PDF_CUSTOM_ZOOM) {
      return;
    }
    const nextZoom = clampPdfCustomZoom(baseZoom - PDF_CUSTOM_ZOOM_STEP);
    pdfViewStateRef.current = {
      ...pdfViewStateRef.current,
      displayMode: 'custom',
      customZoom: nextZoom,
    };
    setPdfDisplayMode('custom');
    setPdfCustomZoom(nextZoom);
  }, [pdfEffectiveZoom]);

  const handleZoomIn = useCallback(() => {
    const baseZoom = pdfViewStateRef.current.displayMode === 'fit-page'
      ? pdfEffectiveZoom
      : pdfViewStateRef.current.customZoom;
    if (baseZoom >= MAX_PDF_CUSTOM_ZOOM) {
      return;
    }
    const nextZoom = clampPdfCustomZoom(baseZoom + PDF_CUSTOM_ZOOM_STEP);
    pdfViewStateRef.current = {
      ...pdfViewStateRef.current,
      displayMode: 'custom',
      customZoom: nextZoom,
    };
    setPdfDisplayMode('custom');
    setPdfCustomZoom(nextZoom);
  }, [pdfEffectiveZoom]);

  const handlePdfFitPage = useCallback(() => {
    pdfViewStateRef.current = {
      ...pdfViewStateRef.current,
      displayMode: 'fit-page',
      scrollTop: 0,
      scrollLeft: 0,
    };
    setPdfDisplayMode('fit-page');
  }, []);

  const handleEpubProgressChange = useCallback((progress: EpubProgress) => {
    epubProgressRef.current = progress;
    if (editorViewStateIdentity) {
      saveEditorViewState(editorViewStateIdentity, {
        kind: 'epub',
        ...progress,
      });
    }
    setEpubProgress(progress);
    setLocator(progress.locator);
    saveEpubProgress(filePath, progress);
    setEpubReadingProgress(filePath, progress.percentage);
  }, [editorViewStateIdentity, filePath, saveEditorViewState]);

  const handlePdfViewStateChange = useCallback((viewState: PdfBookViewState) => {
    pdfViewStateRef.current = viewState;
    if (editorViewStateIdentity) {
      saveEditorViewState(editorViewStateIdentity, {
        kind: 'pdf',
        ...viewState,
      });
      savePdfBookViewState(editorViewStateIdentity, viewState);
    }
  }, [editorViewStateIdentity, saveEditorViewState]);

  const handlePdfOutlineChange = useCallback((nodes: PdfOutlineNode[]) => {
    setPdfOutline(nodes);
  }, []);

  useEffect(() => {
    if (!tab?.id || format !== 'pdf') {
      return undefined;
    }
    return subscribePdfReaderCommands(tab.id, (command) => {
      if (command === 'zoom-in') {
        handleZoomIn();
      } else if (command === 'zoom-out') {
        handleZoomOut();
      } else {
        handlePdfFitPage();
      }
    });
  }, [format, handlePdfFitPage, handleZoomIn, handleZoomOut, tab?.id]);

  useEffect(() => {
    if (!tab?.id || format !== 'pdf') {
      return;
    }
    publishPdfReadingSnapshot(tab.id, {
      ...pdfViewStateRef.current,
      page,
      pageCount,
      displayMode: pdfDisplayMode,
      customZoom: pdfCustomZoom,
      effectiveZoom: pdfEffectiveZoom,
    });
  }, [format, page, pageCount, pdfCustomZoom, pdfDisplayMode, pdfEffectiveZoom, tab?.id]);

  useEffect(() => {
    if (!tab?.id || format !== 'pdf') {
      return undefined;
    }
    const currentTabId = tab.id;
    return () => clearPdfReadingSnapshot(currentTabId);
  }, [format, tab?.id]);

  const handleEpubTheme = useCallback((theme: EpubReaderTheme) => {
    setEpubReaderTheme(theme);
  }, []);

  const handleEpubFont = useCallback((font: EpubReaderFont) => {
    setEpubReaderFont(font);
  }, []);

  const handleTocNavigate = useCallback((target: string) => {
    const trimmed = target.trim();
    if (!trimmed) {
      return;
    }
    setEpubDisplayRequest((current) => ({
      target: trimmed,
      seq: (current?.seq ?? 0) + 1,
    }));
  }, []);

  useEffect(() => {
    const settingsApi = window.hulala?.settings;
    let frameId: number | null = null;
    let disposed = false;
    const syncFontFamily = () => {
      if (disposed) {
        return;
      }
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        if (!disposed) {
          setAppDocumentFontFamily(readAppDocumentFontFamily());
        }
      });
    };

    syncFontFamily();
    void settingsApi?.get?.().then(syncFontFamily).catch(() => undefined);
    const disposeSettingsChanged = settingsApi?.onChanged?.(syncFontFamily);
    return () => {
      disposed = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      disposeSettingsChanged?.();
    };
  }, []);

  useEffect(() => {
    if (!pendingBookTarget || !format || pendingBookTarget.format !== format) {
      return;
    }
    if (pendingBookTarget.format === 'epub') {
      const cfi = pendingBookTarget.cfi.trim();
      if (cfi) {
        setEpubHighlightRequest((current) => ({ cfi, seq: (current?.seq ?? 0) + 1 }));
      }
    } else if (pendingBookTarget.format === 'pdf') {
      handlePdfPageChange(pendingBookTarget.page);
      setPdfHighlightRequest((current) => ({
        page: pendingBookTarget.page,
        rects: pendingBookTarget.rects || [],
        seq: (current?.seq ?? 0) + 1,
      }));
    }
    setPendingBookTarget(null);
  }, [format, handlePdfPageChange, pendingBookTarget, setPendingBookTarget]);

  useEffect(() => {
    if (!readerMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (readerMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setReaderMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setReaderMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [readerMenuOpen]);

  const statusLabel = format === 'pdf'
    ? pageCount > 0 ? `${page} / ${pageCount}` : 'PDF'
    : epubProgress.percentage !== null ? `${Math.round(epubProgress.percentage * 100)}%` : locator || 'EPUB';
  const renderMatchesFile = Boolean(renderUrl && renderFilePath === filePath);
  const epubSource = renderMatchesFile && format === 'epub'
    ? resolveEpubOpen(resourceMeta, renderHandle, renderUrl)
    : null;
  const tocNodes = useMemo(() => buildEpubOutlineNodes(toc), [toc]);
  const tocNodeMap = useMemo(() => buildOutlineNodeMap(tocNodes), [tocNodes]);
  const tocHrefById = useMemo(
    () => new Map(tocNodes.map((node) => [node.id, node.href])),
    [tocNodes],
  );
  const activeTocId = useMemo(
    () => findActiveEpubOutlineId(tocNodes, epubProgress.href),
    [epubProgress.href, tocNodes],
  );
  const tocAutoExpandedIds = useMemo(
    () => getAncestorAutoExpandedIds(activeTocId, tocNodeMap),
    [activeTocId, tocNodeMap],
  );
  const pdfOutlineNodeMap = useMemo(() => buildOutlineNodeMap(pdfOutline), [pdfOutline]);
  const activePdfOutlineId = useMemo(
    () => findActivePdfOutlineId(pdfOutline, page),
    [page, pdfOutline],
  );
  const pdfOutlineAutoExpandedIds = useMemo(
    () => getAncestorAutoExpandedIds(activePdfOutlineId, pdfOutlineNodeMap),
    [activePdfOutlineId, pdfOutlineNodeMap],
  );
  const hasPdfOutline = renderMatchesFile && format === 'pdf' && pdfOutline.length > 0;
  const hasReaderOutline = Boolean(epubSource || hasPdfOutline);
  const initialEpubCfi = useMemo(
    () => sessionBookViewState?.kind === 'epub' && sessionBookViewState.cfi
      ? sessionBookViewState.cfi
      : filePath
        ? loadSavedEpubProgress(filePath).cfi
        : null,
    [filePath, refreshSeq, resourceVersion, sessionBookViewState],
  );
  const toggleTocPopover = useCallback(() => {
    setReaderMenuOpen(false);
    setTocOpen((current) => !current);
  }, []);
  const readerMenu = (
    <div
      ref={readerMenuRef}
      className="absolute right-3 top-3 z-30 flex flex-col items-center gap-1"
    >
      {hasReaderOutline && outlineMode !== 'hidden' ? (
        <DocumentOutlineToggle expanded={false} onToggle={toggleTocPopover} />
      ) : null}
      {rightWorkspaceControl}
      <button
        type="button"
        className={`inline-flex h-7 w-7 items-center justify-center border-0 bg-transparent p-0 shadow-none transition-colors hover:text-brand focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand ${readerMenuOpen ? 'text-brand' : 'text-secondary-text'}`}
        onClick={() => {
          setTocOpen(false);
          setReaderMenuOpen((open) => !open);
        }}
        title="Reader actions"
        aria-label="Reader actions"
        aria-expanded={readerMenuOpen}
      >
        <MoreHorizontalIcon className="h-4 w-4" />
      </button>
      {readerMenuOpen ? (
        <PopupMenu className="absolute right-8 top-0 w-64 text-secondary-text">
          <div className="flex items-center justify-between px-2 py-1.5 text-xs text-tertiary-text">
            <span>Reading</span>
            <span className="tabular-nums text-secondary-text">{statusLabel}</span>
          </div>
          <PopupMenuSeparator />
          {format === 'epub' ? (
            <>
              {outlineMode !== 'hidden' ? (
                <PopupMenuItem
                  onClick={toggleTocPopover}
                  active={tocOpen}
                >
                  <ListIcon className="h-3.5 w-3.5" />
                  <span>{tocOpen ? 'Hide contents' : 'Show contents'}</span>
                </PopupMenuItem>
              ) : null}
              <div className="px-2 py-1">
                <div className="mb-1 text-[11px] text-tertiary-text">Theme</div>
                <div className="flex h-7 overflow-hidden rounded border border-border">
                  {(['auto', 'sepia', 'night'] as const).map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      className={`min-w-0 flex-1 px-2 text-xs capitalize ${epubReaderSettings.theme === theme ? 'bg-hover-bg text-primary-text' : 'text-secondary-text hover:bg-hover-bg hover:text-primary-text'}`}
                      onClick={() => handleEpubTheme(theme)}
                      title={theme === 'auto' ? 'Follow app theme' : undefined}
                    >
                      {theme}
                    </button>
                  ))}
                </div>
                <div className="mb-1 mt-2 text-[11px] text-tertiary-text">Font</div>
                <div className="flex h-7 overflow-hidden rounded border border-border">
                  {EPUB_FONT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`min-w-0 flex-1 px-1 text-[11px] ${epubReaderSettings.font === option.value ? 'bg-hover-bg text-primary-text' : 'text-secondary-text hover:bg-hover-bg hover:text-primary-text'}`}
                      onClick={() => handleEpubFont(option.value)}
                      title={option.title}
                      aria-pressed={epubReaderSettings.font === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <PopupMenuSeparator />
            </>
          ) : null}
          {format === 'pdf' ? (
            <>
              {hasPdfOutline && outlineMode !== 'hidden' ? (
                <PopupMenuItem
                  onClick={toggleTocPopover}
                  active={tocOpen}
                >
                  <ListIcon className="h-3.5 w-3.5" />
                  <span>{tocOpen ? 'Hide contents' : 'Show contents'}</span>
                </PopupMenuItem>
              ) : null}
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                <span className="text-secondary-text">Zoom</span>
                <div className="flex items-center gap-1">
                  <IconButton size={24} className="text-secondary-text" onClick={handleZoomOut} title="Zoom out" aria-label="Zoom out">
                    <span className="text-base leading-none">-</span>
                  </IconButton>
                  <span className="w-10 text-center text-xs tabular-nums text-secondary-text">
                    {pdfDisplayMode === 'fit-page' ? 'Fit' : `${Math.round(pdfCustomZoom * 100)}%`}
                  </span>
                  <IconButton size={24} className="text-secondary-text" onClick={handleZoomIn} title="Zoom in" aria-label="Zoom in">
                    <PlusIcon className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              </div>
              <PopupMenuItem onClick={handlePdfFitPage} active={pdfDisplayMode === 'fit-page'}>
                <span className="w-3.5 text-center text-xs">↔</span>
                <span>Fit page</span>
              </PopupMenuItem>
              <PopupMenuSeparator />
            </>
          ) : null}
          <PopupMenuItem onClick={handleOpenNotes} disabled={!notePath}>
            <FileIcon className="h-3.5 w-3.5" />
            <span>Open notes file</span>
          </PopupMenuItem>
          <PopupMenuItem onClick={handleRefresh}>
            <RefreshIcon className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </PopupMenuItem>
          <PopupMenuItem onClick={() => void handleCopyPath()} disabled={!filePath}>
            <CopyIcon className="h-3.5 w-3.5" />
            <span>Copy path</span>
          </PopupMenuItem>
        </PopupMenu>
      ) : null}
    </div>
  );

  return (
    <div ref={readerLayoutRef} className="relative flex h-full min-h-0 bg-editor-bg text-primary-text">
      <div className="relative h-full min-w-0 flex-1 bg-editor-bg">
        {readerMenuOpen ? (
          <div
            className="fixed inset-0 z-20"
            aria-hidden="true"
            onPointerDown={() => setReaderMenuOpen(false)}
          />
        ) : null}
        {readerMenu}
        {editingHighlight ? (
          <div
            className="absolute inset-0 z-30 flex items-end justify-center bg-black/20 p-4 sm:items-center"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setEditingHighlight(null);
              }
            }}
          >
            <div
              className="w-full max-w-md rounded-lg border border-border bg-editor-bg shadow-lg"
              role="dialog"
              aria-label="Highlight note"
            >
              <div className="border-b border-border px-4 py-3">
                <div className="text-sm font-medium text-primary-text">
                  {editingHighlight.note.trim() ? 'Edit note' : 'Add note'}
                </div>
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-secondary-text">
                  {editingHighlight.text}
                </p>
              </div>
              <div className="px-4 py-3">
                <textarea
                  className="min-h-[120px] w-full resize-y rounded border border-border bg-background px-3 py-2 text-sm leading-relaxed text-primary-text outline-none focus:border-brand"
                  placeholder="Add your reflection…"
                  value={editingHighlight.note}
                  autoFocus
                  onChange={(event) => {
                    const value = event.target.value;
                    setEditingHighlight((current) => (current ? { ...current, note: value } : current));
                  }}
                />
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
                <button
                  type="button"
                  className="ui-pill-btn-secondary px-2.5 py-1.5 text-sm"
                  onClick={() => void handleDeleteEditingHighlight()}
                >
                  Delete highlight
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="ui-pill-btn-secondary px-3 py-1.5 text-sm"
                    onClick={() => setEditingHighlight(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={`ui-pill-btn-primary ${OP_SG_CAPSULE} ${OP_SG_ON_EDITOR} px-3 py-1.5 text-sm`}
                    onClick={() => void handleSaveHighlightNote()}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div className="h-full min-h-0 bg-editor-bg">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-secondary-text">Loading book...</div>
          ) : error ? (
            <div className="flex h-full items-center justify-center p-6">
              <div className="max-w-[520px] rounded border border-border bg-editor-bg px-3 py-2 text-sm text-secondary-text">
                {error}
              </div>
            </div>
          ) : epubSource ? (
            <div className="h-full min-h-0">
              <EpubBookView
                url={epubSource.url}
                openMode={epubSource.mode}
                refreshKey={refreshSeq + resourceVersion}
                initialCfi={initialEpubCfi}
                displayRequest={epubDisplayRequest}
                highlightRequest={epubHighlightRequest}
                highlightNotes={highlightNotes}
                readerSettings={epubReaderSettings}
                appFontFamily={appDocumentFontFamily}
                onHighlightContextAction={handleHighlightContextAction}
                onProgressChange={handleEpubProgressChange}
                onTocChange={setToc}
                onError={handleError}
              />
            </div>
          ) : renderMatchesFile && format === 'pdf' ? (
            <PdfBookView
              url={renderUrl}
              refreshKey={refreshSeq + resourceVersion}
              page={page}
              displayMode={pdfDisplayMode}
              customZoom={pdfCustomZoom}
              initialViewState={initialPdfViewState}
              highlightRequest={pdfHighlightRequest}
              highlightNotes={highlightNotes}
              onPageChange={handlePdfPageChange}
              onPageCountChange={setPageCount}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onEffectiveZoomChange={setPdfEffectiveZoom}
              onOutlineChange={handlePdfOutlineChange}
              onViewStateChange={handlePdfViewStateChange}
              onHighlightContextAction={handleHighlightContextAction}
              onError={handleError}
            />
          ) : null}
        </div>
      </div>
      {hasReaderOutline && outlineMode !== 'hidden' ? (
        <OutlinePopover
          open={tocOpen}
          onOpenChange={setTocOpen}
          title={rendererI18n.t('shell:editorPane.outline')}
        >
          <OutlineTree
            nodes={hasPdfOutline ? pdfOutline : tocNodes}
            activeId={hasPdfOutline ? activePdfOutlineId : activeTocId}
            autoExpandedIds={hasPdfOutline ? pdfOutlineAutoExpandedIds : tocAutoExpandedIds}
            emptyLabel="No contents"
            onNavigate={(node) => {
              if (hasPdfOutline) {
                const target = pdfOutline.find((item) => item.id === node.id)?.page;
                if (target) {
                  handlePdfPageChange(target);
                }
                setTocOpen(false);
                return;
              }
              handleTocNavigate(tocHrefById.get(node.id) || '');
              setTocOpen(false);
            }}
          />
        </OutlinePopover>
      ) : null}
    </div>
  );
};
