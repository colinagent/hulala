import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  canonicalFileURIFromPath,
  getDownloadHandleForPhysicalPath,
  getRenderHandleForPhysicalPath,
} from '../../services/resourceService';
import { useAppStore, useWorkspaceViewId } from '../../store/appStore';
import { CopyIcon, RefreshIcon, SearchIcon } from '../Icons';
import { IconButton } from '../IconButton';
import { UI_PILL_BTN_COMPACT, UI_PILL_BTN_SECONDARY } from '../staticGlassCapsule';
import {
  inspectWordArchive,
  type WordSelectionContext,
} from './wordArchiveSecurity';

type WordEditorProps = {
  tabId?: string | null;
};

type PreviewSelection = Omit<WordSelectionContext, 'canonicalUri'>;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_DOCX_PREVIEW_BYTES = 50 * 1024 * 1024;
const SELECTION_CONTEXT_CHARACTERS = 500;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

const WORD_PREVIEW_STYLES = `
  :host {
    color: var(--color-primary-text);
    display: block;
    min-height: 100%;
  }
  .word-preview-styles {
    display: none;
  }
  .word-preview-body {
    box-sizing: border-box;
    min-height: 100%;
    overflow: visible;
    padding: 24px;
  }
  .word-preview-body:focus {
    outline: none;
  }
  .word-preview-body .docx-wrapper {
    background: transparent !important;
    padding: 0 !important;
  }
  .word-preview-body .docx-wrapper > section.docx {
    box-shadow: 0 1px 4px rgb(0 0 0 / 18%), 0 12px 36px rgb(0 0 0 / 10%);
    margin: 0 auto 24px !important;
  }
  .word-preview-body mark.word-search-match {
    background: color-mix(in srgb, var(--color-brand) 32%, transparent);
    color: inherit;
    border-radius: 2px;
  }
  .word-preview-body mark.word-search-match.is-active {
    background: color-mix(in srgb, var(--color-brand) 64%, transparent);
    outline: 1px solid var(--color-brand);
  }
  @media (max-width: 720px) {
    .word-preview-body {
      padding: 12px;
    }
  }
`;

function wordErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  if (!message) {
    return 'Unable to load Word document';
  }
  if (/unsafe or unsupported docx archive/i.test(message)) {
    return message;
  }
  if (/zip|central directory|end of data|corrupt|xml/i.test(message)) {
    return 'The file is not a valid or readable DOCX document.';
  }
  return message;
}

function collectBlobUrls(root: ParentNode): string[] {
  const urls = new Set<string>();
  for (const element of root.querySelectorAll<HTMLElement>('[src], [href]')) {
    for (const attribute of ['src', 'href']) {
      const value = element.getAttribute(attribute) || '';
      if (value.startsWith('blob:')) {
        urls.add(value);
      }
    }
  }
  for (const style of root.querySelectorAll('style')) {
    for (const match of style.textContent?.matchAll(/blob:[^)'"\s]+/g) || []) {
      urls.add(match[0]);
    }
  }
  return Array.from(urls);
}

function revokeBlobUrls(root: ParentNode) {
  for (const url of collectBlobUrls(root)) {
    URL.revokeObjectURL(url);
  }
}

function preparePreviewRoot(host: HTMLDivElement): {
  bodyContainer: HTMLDivElement;
  styleContainer: HTMLDivElement;
} {
  const shadowRoot = host.shadowRoot || host.attachShadow({ mode: 'open' });
  revokeBlobUrls(shadowRoot);

  const baseStyle = document.createElement('style');
  baseStyle.textContent = WORD_PREVIEW_STYLES;
  const styleContainer = document.createElement('div');
  styleContainer.className = 'word-preview-styles';
  styleContainer.setAttribute('aria-hidden', 'true');
  const bodyContainer = document.createElement('div');
  bodyContainer.className = 'word-preview-body';
  bodyContainer.tabIndex = 0;
  bodyContainer.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) {
      event.preventDefault();
    }
  });
  shadowRoot.replaceChildren(baseStyle, styleContainer, bodyContainer);
  return { bodyContainer, styleContainer };
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 10) / 10));
}

function clearSearchMarks(body: HTMLElement) {
  for (const mark of Array.from(body.querySelectorAll('mark.word-search-match'))) {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent || ''));
    parent?.normalize();
  }
}

function markSearchMatches(body: HTMLElement, rawQuery: string): HTMLElement[] {
  clearSearchMarks(body);
  const query = rawQuery.trim();
  if (!query) {
    return [];
  }

  const matches: HTMLElement[] = [];
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('style, script, mark.word-search-match')) {
        return NodeFilter.FILTER_REJECT;
      }
      return (node.textContent || '').toLocaleLowerCase().includes(query.toLocaleLowerCase())
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  const normalizedQuery = query.toLocaleLowerCase();
  for (const textNode of textNodes) {
    const text = textNode.data;
    const normalizedText = text.toLocaleLowerCase();
    const offsets: number[] = [];
    let start = 0;
    while (start <= normalizedText.length - normalizedQuery.length) {
      const found = normalizedText.indexOf(normalizedQuery, start);
      if (found < 0) break;
      offsets.push(found);
      start = found + Math.max(1, normalizedQuery.length);
    }
    const nodeMatches: HTMLElement[] = [];
    for (let index = offsets.length - 1; index >= 0; index -= 1) {
      const matchNode = textNode.splitText(offsets[index]);
      matchNode.splitText(query.length);
      const mark = document.createElement('mark');
      mark.className = 'word-search-match';
      matchNode.replaceWith(mark);
      mark.append(matchNode);
      nodeMatches.unshift(mark);
    }
    matches.push(...nodeMatches);
  }
  return matches;
}

function shadowSelection(body: HTMLElement): Selection | null {
  const root = body.getRootNode();
  const selection = root instanceof ShadowRoot
    ? (root as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.()
    : null;
  return selection || window.getSelection();
}

function compactContext(value: string, take: 'start' | 'end'): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return take === 'start'
    ? normalized.slice(0, SELECTION_CONTEXT_CHARACTERS)
    : normalized.slice(-SELECTION_CONTEXT_CHARACTERS);
}

function capturePreviewSelection(body: HTMLElement): PreviewSelection | null {
  const selection = shadowSelection(body);
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) {
    return null;
  }
  const quote = selection.toString().trim();
  if (!quote) {
    return null;
  }

  const beforeRange = range.cloneRange();
  beforeRange.selectNodeContents(body);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const afterRange = range.cloneRange();
  afterRange.selectNodeContents(body);
  afterRange.setStart(range.endContainer, range.endOffset);
  const startElement = range.startContainer instanceof Element
    ? range.startContainer
    : range.startContainer.parentElement;
  const pageElement = startElement?.closest('section.docx') || null;
  const pages = Array.from(body.querySelectorAll('section.docx'));
  const pageIndex = pageElement ? pages.indexOf(pageElement) : -1;

  return {
    quote,
    contextBefore: compactContext(beforeRange.toString(), 'end'),
    contextAfter: compactContext(afterRange.toString(), 'start'),
    page: pageIndex >= 0 ? pageIndex + 1 : null,
  };
}

export const WordEditor: React.FC<WordEditorProps> = ({ tabId = null }) => {
  const documents = useAppStore((state) => state.documents);
  const activeTabId = useAppStore((state) => state.activeTabId);
  const remoteSession = useAppStore((state) => state.remoteSession);
  const workspaceTabId = useWorkspaceViewId();
  const saveEditorViewState = useAppStore(state => state.saveEditorViewState);
  const loadEditorViewState = useAppStore(state => state.loadEditorViewState);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [renderSeq, setRenderSeq] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResultCount, setSearchResultCount] = useState(0);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const previewHostRef = useRef<HTMLDivElement | null>(null);
  const previewBodyRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchMarksRef = useRef<HTMLElement[]>([]);

  const tab = useMemo(() => {
    const id = tabId || activeTabId || '';
    return documents.find((item) => item.id === id) || null;
  }, [activeTabId, documents, tabId]);

  const filePath = (tab?.filePath || '').trim();
  const canonicalUri = useMemo(
    () => (filePath ? canonicalFileURIFromPath(filePath, workspaceTabId) : ''),
    [filePath, workspaceTabId],
  );
  const resourceVersion = tab?.resourceVersion ?? 0;
  const missing = Boolean(tab?.missing);
  const viewIdentity = useMemo(() => ({ tabId: tab?.id || '', uri: canonicalUri, filePath }), [tab?.id, canonicalUri, filePath]);
  const initialView = useMemo(() => loadEditorViewState(viewIdentity, 'word'), [loadEditorViewState, viewIdentity]);
  const isRemote = Boolean(remoteSession);

  const handleRefresh = useCallback(() => {
    setRefreshSeq((current) => current + 1);
  }, []);

  const updateSelection = useCallback(() => {
    const body = previewBodyRef.current;
    setPreviewSelection(body ? capturePreviewSelection(body) : null);
  }, []);

  const copySelection = useCallback(() => {
    if (!previewSelection) return;
    window.hulala?.clipboard.writeText(previewSelection.quote);
    setActionMessage('Selection copied.');
  }, [previewSelection]);

  const downloadCopy = useCallback(async () => {
    if (!filePath) return;
    try {
      setActionMessage('Preparing download...');
      const { url, meta } = await getDownloadHandleForPhysicalPath(filePath, workspaceTabId);
      const link = document.createElement('a');
      link.href = url;
      link.download = meta.name || tab?.title || 'document.docx';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setActionMessage('Download started.');
    } catch (nextError) {
      setActionMessage(wordErrorMessage(nextError));
    }
  }, [filePath, tab?.title, workspaceTabId]);

  const openInSystemApp = useCallback(async () => {
    if (!filePath || isRemote) return;
    const result = await window.hulala?.openLocalFileWithSystemApp?.(filePath, workspaceTabId);
    setActionMessage(result?.success ? 'Opened in the system application.' : (result?.error || 'Unable to open the document.'));
  }, [filePath, isRemote]);

  const goToPage = useCallback((nextPage: number) => {
    const body = previewBodyRef.current;
    if (!body || pageCount === 0) return;
    const normalized = Math.min(pageCount, Math.max(1, nextPage));
    body.querySelectorAll<HTMLElement>('section.docx')[normalized - 1]?.scrollIntoView({ block: 'start' });
    setCurrentPage(normalized);
  }, [pageCount]);

  const moveSearch = useCallback((delta: number) => {
    if (searchResultCount === 0) return;
    setActiveSearchIndex((current) => {
      const base = current < 0 ? 0 : current;
      return (base + delta + searchResultCount) % searchResultCount;
    });
  }, [searchResultCount]);

  useEffect(() => {
    const host = previewHostRef.current;
    if (!host) {
      return;
    }

    const { bodyContainer, styleContainer } = preparePreviewRoot(host);
    previewBodyRef.current = bodyContainer;
    bodyContainer.style.setProperty('zoom', String(zoom));
    const abortController = new AbortController();
    const handleSelectionChange = () => updateSelection();
    bodyContainer.addEventListener('pointerup', handleSelectionChange);
    bodyContainer.addEventListener('keyup', handleSelectionChange);
    let cancelled = false;
    setError(null);
    setActionMessage(null);
    setPreviewSelection(null);
    setPageCount(0);
    setCurrentPage(0);

    if (!filePath) {
      setLoading(false);
      setError('Word document path is missing');
      return () => {
        cancelled = true;
        abortController.abort();
        bodyContainer.removeEventListener('pointerup', handleSelectionChange);
        bodyContainer.removeEventListener('keyup', handleSelectionChange);
        revokeBlobUrls(bodyContainer);
        revokeBlobUrls(styleContainer);
      };
    }
    if (missing) {
      setLoading(false);
      setError('File was deleted on disk');
      return () => {
        cancelled = true;
        abortController.abort();
        bodyContainer.removeEventListener('pointerup', handleSelectionChange);
        bodyContainer.removeEventListener('keyup', handleSelectionChange);
        revokeBlobUrls(bodyContainer);
        revokeBlobUrls(styleContainer);
      };
    }

    setLoading(true);
    void (async () => {
      try {
        const { url, meta } = await getRenderHandleForPhysicalPath(filePath, workspaceTabId);
        if (cancelled) return;
        if (meta.mimeType !== DOCX_MIME) {
          throw new Error(`Unsupported Word document type: ${meta.mimeType || 'unknown'}`);
        }
        if ((meta.size ?? 0) === 0) {
          throw new Error('Word document is empty');
        }
        if ((meta.size ?? 0) > MAX_DOCX_PREVIEW_BYTES) {
          throw new Error('Word document exceeds the 50 MB preview limit');
        }

        const response = await fetch(url, {
          cache: 'no-store',
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`Unable to read Word document (${response.status})`);
        }
        const documentData = await response.arrayBuffer();
        if (cancelled) return;
        if (documentData.byteLength === 0) {
          throw new Error('Word document is empty');
        }
        if (documentData.byteLength > MAX_DOCX_PREVIEW_BYTES) {
          throw new Error('Word document exceeds the 50 MB preview limit');
        }
        inspectWordArchive(documentData);

        const { renderAsync } = await import('docx-preview');
        if (cancelled) return;
        await renderAsync(documentData, bodyContainer, styleContainer, {
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          renderComments: false,
          renderChanges: false,
          renderAltChunks: false,
          debug: false,
        });
        if (cancelled) {
          revokeBlobUrls(bodyContainer);
          revokeBlobUrls(styleContainer);
          return;
        }
        const nextPageCount = bodyContainer.querySelectorAll('section.docx').length;
        setPageCount(nextPageCount);
        setCurrentPage(nextPageCount > 0 ? 1 : 0);
        setRenderSeq((current) => current + 1);
        setError(null);
      } catch (nextError) {
        if (cancelled || (nextError instanceof DOMException && nextError.name === 'AbortError')) {
          return;
        }
        revokeBlobUrls(bodyContainer);
        revokeBlobUrls(styleContainer);
        bodyContainer.replaceChildren();
        styleContainer.replaceChildren();
        setError(wordErrorMessage(nextError));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      abortController.abort();
      bodyContainer.removeEventListener('pointerup', handleSelectionChange);
      bodyContainer.removeEventListener('keyup', handleSelectionChange);
      clearSearchMarks(bodyContainer);
      searchMarksRef.current = [];
      revokeBlobUrls(bodyContainer);
      revokeBlobUrls(styleContainer);
      if (previewBodyRef.current === bodyContainer) {
        previewBodyRef.current = null;
      }
    };
  }, [filePath, missing, refreshSeq, resourceVersion, updateSelection, workspaceTabId]);

  useEffect(() => {
    previewBodyRef.current?.style.setProperty('zoom', String(zoom));
  }, [zoom]);

  useEffect(() => {
    const body = previewBodyRef.current;
    if (!body) return;
    const matches = markSearchMatches(body, searchQuery);
    searchMarksRef.current = matches;
    setSearchResultCount(matches.length);
    setActiveSearchIndex(matches.length > 0 ? 0 : -1);
  }, [renderSeq, searchQuery]);

  useEffect(() => {
    const marks = searchMarksRef.current;
    marks.forEach((mark, index) => mark.classList.toggle('is-active', index === activeSearchIndex));
    if (activeSearchIndex >= 0) {
      marks[activeSearchIndex]?.scrollIntoView({ block: 'center' });
    }
  }, [activeSearchIndex]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const body = previewBodyRef.current;
    if (!scrollContainer || !body || pageCount === 0) return;
    let frame = 0;
    const updateCurrentPage = () => {
      frame = 0;
      const containerTop = scrollContainer.getBoundingClientRect().top;
      const pages = Array.from(body.querySelectorAll<HTMLElement>('section.docx'));
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      pages.forEach((page, index) => {
        const distance = Math.abs(page.getBoundingClientRect().top - containerTop - 12);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      setCurrentPage(bestIndex + 1);
      saveEditorViewState(viewIdentity, { kind: 'word', page: bestIndex + 1, scrollTop: scrollContainer.scrollTop, zoom });
    };
    const handleScroll = () => {
      if (!frame) frame = requestAnimationFrame(updateCurrentPage);
    };
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    updateCurrentPage();
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pageCount, renderSeq, zoom, saveEditorViewState, viewIdentity]);

  useEffect(() => {
    if (!renderSeq || initialView?.kind !== 'word') return;
    setZoom(initialView.zoom);
    const frame = requestAnimationFrame(() => { if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = initialView.scrollTop; });
    return () => cancelAnimationFrame(frame);
  }, [renderSeq, initialView]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 'f') {
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      return;
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor-bg text-primary-text" onKeyDown={handleKeyDown}>
      <div className="flex min-h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1 text-xs text-secondary-text">
        <div className="min-w-[120px] flex-1 truncate" title={canonicalUri || filePath || tab?.title || 'Word document'}>
          {tab?.title || filePath || 'Word document'}
        </div>
        <div className="relative shrink-0">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') moveSearch(event.shiftKey ? -1 : 1);
            }}
            className="h-7 w-40 rounded border border-border bg-editor-bg pl-7 pr-2 text-xs text-primary-text outline-none focus:border-brand"
            placeholder="Search document"
            aria-label="Search Word document"
          />
        </div>
        <span className="w-12 shrink-0 text-center tabular-nums">
          {searchQuery.trim() ? `${activeSearchIndex >= 0 ? activeSearchIndex + 1 : 0}/${searchResultCount}` : ''}
        </span>
        <IconButton size={26} onClick={() => moveSearch(-1)} disabled={searchResultCount === 0} title="Previous match" aria-label="Previous search match">↑</IconButton>
        <IconButton size={26} onClick={() => moveSearch(1)} disabled={searchResultCount === 0} title="Next match" aria-label="Next search match">↓</IconButton>
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        <IconButton size={26} onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} title="Previous page" aria-label="Previous page">‹</IconButton>
        <span className="w-14 shrink-0 text-center tabular-nums">{pageCount ? `${currentPage}/${pageCount}` : '—'}</span>
        <IconButton size={26} onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= pageCount} title="Next page" aria-label="Next page">›</IconButton>
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        <IconButton size={26} onClick={() => setZoom((current) => clampZoom(current - ZOOM_STEP))} disabled={zoom <= MIN_ZOOM} title="Zoom out" aria-label="Zoom out">−</IconButton>
        <button type="button" className="w-11 shrink-0 text-center tabular-nums hover:text-brand" onClick={() => setZoom(1)} title="Reset zoom">
          {Math.round(zoom * 100)}%
        </button>
        <IconButton size={26} onClick={() => setZoom((current) => clampZoom(current + ZOOM_STEP))} disabled={zoom >= MAX_ZOOM} title="Zoom in" aria-label="Zoom in">+</IconButton>
        <span className="mx-1 h-4 w-px shrink-0 bg-border" />
        <IconButton size={26} onClick={copySelection} disabled={!previewSelection} title="Copy selection" aria-label="Copy Word selection">
          <CopyIcon className="h-3.5 w-3.5" />
        </IconButton>
        <button type="button" className={`${UI_PILL_BTN_SECONDARY} ${UI_PILL_BTN_COMPACT} shrink-0`} onClick={() => void downloadCopy()} disabled={!filePath}>
          Download copy
        </button>
        {!isRemote ? (
          <button type="button" className={`${UI_PILL_BTN_SECONDARY} ${UI_PILL_BTN_COMPACT} shrink-0`} onClick={() => void openInSystemApp()} disabled={!filePath}>
            Open externally
          </button>
        ) : null}
        <IconButton size={26} className="text-secondary-text" onClick={handleRefresh} title="Refresh" aria-label="Refresh Word preview">
          <RefreshIcon className="h-3.5 w-3.5" />
        </IconButton>
        <div className="shrink-0">Read only</div>
      </div>
      {actionMessage ? (
        <div className="shrink-0 border-b border-border px-3 py-1 text-xs text-secondary-text" role="status">
          {actionMessage}
        </div>
      ) : null}
      <div ref={scrollContainerRef} className="relative min-h-0 flex-1 overflow-auto bg-secondary-bg">
        <div ref={previewHostRef} className="min-h-full" />
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-editor-bg/95 text-sm text-secondary-text">
            Loading Word document...
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-[620px] rounded border border-border bg-editor-bg px-4 py-3 text-sm text-secondary-text">
              <div>{error}</div>
              {filePath ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={`${UI_PILL_BTN_SECONDARY} ${UI_PILL_BTN_COMPACT}`} onClick={() => void downloadCopy()}>
                    Download copy
                  </button>
                  {!isRemote ? (
                    <button type="button" className={`${UI_PILL_BTN_SECONDARY} ${UI_PILL_BTN_COMPACT}`} onClick={() => void openInSystemApp()}>
                      Open externally
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
