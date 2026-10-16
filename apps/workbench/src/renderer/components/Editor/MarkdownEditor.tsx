import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { createMarkdownEditor, MarkdownEditorInstance } from './codemirror/setup';
import { EditorSearchOverlay, type EditorSearchOverlayHandle } from './search/EditorSearchOverlay';
import { useAppStore, useWorkspaceStoreApi, useWorkspaceViewId } from '../../store/appStore';
import { EditorContextMenu } from './EditorContextMenu';
import { DocumentOutline } from './DocumentOutline';
import { ImageContextMenu } from './ImageContextMenu';
import { getImageMenuStateFromElement, resolveImageMenuTarget, useMarkdownImageMenu } from './useMarkdownImageMenu';
import { ResizeDivider } from '../ResizeDivider';
import { IconButton } from '../IconButton';
import { ArrowUpTinyIcon } from '../Icons';
import { normalizePosixPath } from '../../utils/markdownMedia';
import { useToastStore } from '../../store/toastStore';
import { writeClipboardImageFromElement, writeClipboardText } from '../../services/clipboardService';
import { revealTargetToPos } from './revealTarget';
import {
  DEFAULT_MARKDOWN_CONTENT_WIDTH,
  DEFAULT_MARKDOWN_TEXT_OFFSET,
  MARKDOWN_LINE_PADDING_X,
  MARKDOWN_DOCUMENT_COLUMN_OFFSET,
  clampMarkdownContentWidthForEditor,
  clampMarkdownTextOffsetForEditor,
  normalizeMarkdownContentWidth,
  normalizeMarkdownTextOffset,
  setMarkdownContentWidthDragLocked,
  setMarkdownTextOffsetDragLocked,
} from '../../utils/markdownTextOffset';
import {
  buildMarkdownDocumentRenameTarget,
  getMarkdownDocumentTitle,
} from '../../utils/documentHeader';
import type {
  DocumentHeaderOptions,
  DocumentHeaderRenameResult,
} from '../../utils/documentHeaderState';
import { moveCursorToEditableMarkdownTail } from './codemirror/editableTail';
import {
  firstEditableMarkdownTop,
  moveCursorToFirstEditableMarkdownPosition,
} from './codemirror/documentLeadIn';
import { rendererI18n } from '../../../i18n/renderer';
import { OutlinePopover } from './outline/OutlinePopover';
import { resolveDrawingPath } from './excalidraw/drawingDocument';
import { createDrawingFile } from './excalidraw/drawingFiles';

const TEXT_OFFSET_HOVER_DELAY_MS = 1000;
const SCROLL_JUMP_CONTROL_VISIBLE_MS = 1500;
const SCROLL_JUMP_CONTROL_SCREEN_THRESHOLD = 2;

type MarkdownEditorProps = {
  tabId?: string | null;
  autoFocus?: boolean;
  rightWorkspaceControl?: React.ReactNode;
  outlineToggleEnabled?: boolean;
  textOffsetEnabled?: boolean;
  compact?: boolean;
  outlineMode?: 'popover' | 'hidden';
};

type MarkdownUiSettingsSnapshot = {
  ui?: {
    markdownContentWidth?: unknown;
    markdownTextOffset?: unknown;
  };
};

function isDotMdFile(path: string | null | undefined): boolean {
  if (!path) {
    return false;
  }
  const normalized = path.trim().toLowerCase();
  return normalized.endsWith('.md') || normalized.endsWith('.markdown');
}

function isTextEntryFocusedElement(element: Element | null): boolean {
  if (!element) {
    return false;
  }
  const tagName = typeof element.tagName === 'string'
    ? element.tagName.toUpperCase()
    : typeof element.nodeName === 'string'
      ? element.nodeName.toUpperCase()
      : '';
  if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
    return true;
  }
  if ('isContentEditable' in element && (element as HTMLElement).isContentEditable) {
    return true;
  }
  return Boolean(element.closest?.('.cm-content'));
}

function isDocumentTextEntryFocused(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return isTextEntryFocusedElement(document.activeElement);
}

function blurDocumentTextEntryFocus(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const active = document.activeElement;
  if (!isTextEntryFocusedElement(active) || !(active instanceof HTMLElement)) {
    return;
  }
  active.blur();
}

function documentTitleValidationMessage(reason: 'required' | 'invalid' | 'path-separator'): string {
  if (reason === 'required') {
    return rendererI18n.t('documentTitleNameRequired');
  }
  if (reason === 'path-separator') {
    return rendererI18n.t('documentTitlePathSeparator');
  }
  return rendererI18n.t('documentTitleNameInvalid');
}

function isMarkdownMarkerLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }
  if (/^(#{1,6}\s+|>\s?)/.test(trimmed)) {
    return true;
  }
  if (/^([-+*]|\d+\.)\s+/.test(trimmed)) {
    return true;
  }
  if (/^(```+|~~~+)/.test(trimmed)) {
    return true;
  }
  if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed.replace(/\s+/g, ''))) {
    return true;
  }
  if (/^\|.*\|$/.test(trimmed)) {
    return true;
  }
  if (/^\[.+\]:\s+\S+/.test(trimmed)) {
    return true;
  }
  return false;
}

function findFirstPlainTextPos(content: string): number | null {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const hasFrontmatter = lines.length > 1
    && lines[0].trim() === '---'
    && lines.slice(1).some((entry) => {
      const token = entry.trim();
      return token === '---' || token === '...';
    });
  let inFrontmatter = hasFrontmatter;
  let checkedFrontmatter = hasFrontmatter;
  let inFence = false;
  let fenceChar = '';
  let fenceWidth = 0;
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!checkedFrontmatter) {
      checkedFrontmatter = true;
      if (trimmed === '---') {
        inFrontmatter = true;
        offset += line.length + 1;
        continue;
      }
    }

    if (inFrontmatter) {
      if (offset > 0 && (trimmed === '---' || trimmed === '...')) {
        inFrontmatter = false;
      }
      offset += line.length + 1;
      continue;
    }

    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      const nextFenceChar = fenceMatch[1][0];
      const nextFenceWidth = fenceMatch[1].length;
      if (!inFence) {
        inFence = true;
        fenceChar = nextFenceChar;
        fenceWidth = nextFenceWidth;
      } else if (fenceChar === nextFenceChar && nextFenceWidth >= fenceWidth) {
        inFence = false;
        fenceChar = '';
        fenceWidth = 0;
      }
      offset += line.length + 1;
      continue;
    }

    if (inFence) {
      offset += line.length + 1;
      continue;
    }

    if (!isMarkdownMarkerLine(line)) {
      const firstTextIndex = line.search(/\S/);
      return offset + (firstTextIndex >= 0 ? firstTextIndex : 0);
    }

    offset += line.length + 1;
  }

  return null;
}

function getLineAnchor(doc: Text, preferredLineNumber: number): number {
  const clampedPreferred = Math.min(Math.max(preferredLineNumber, 1), doc.lines);
  return doc.line(clampedPreferred).from;
}

function MarkdownPinIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M5.3 2.8h5.4L9.6 6.4l2.1 2.1v1.4H8.6L8 14H6.9l-.6-4.1H3.2V8.5l2.1-2.1-1-3.6Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  tabId = null,
  autoFocus = false,
  rightWorkspaceControl,
  outlineToggleEnabled = true,
  textOffsetEnabled = true,
  compact = false,
  outlineMode = 'popover',
}) => {
  const layoutRef = useRef<HTMLDivElement>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MarkdownEditorInstance | null>(null);
  const searchOverlayRef = useRef<EditorSearchOverlayHandle | null>(null);
  const textOffsetValueRef = useRef(DEFAULT_MARKDOWN_TEXT_OFFSET);
  const contentWidthValueRef = useRef(DEFAULT_MARKDOWN_CONTENT_WIDTH);
  const textOffsetPreviewBroadcastRef = useRef<number | null>(null);
  const contentWidthPreviewBroadcastRef = useRef<number | null>(null);
  const textOffsetHoverDeadlineRef = useRef(0);
  const contentWidthHoverDeadlineRef = useRef(0);
  const textOffsetHoveredStateRef = useRef(false);
  const contentWidthHoveredStateRef = useRef(false);
  const textOffsetDraggingStateRef = useRef(false);
  const contentWidthDraggingStateRef = useRef(false);
  const textOffsetHoverTimerRef = useRef<number | null>(null);
  const contentWidthHoverTimerRef = useRef<number | null>(null);
  const textOffsetResizeRef = useRef<{
    startX: number;
    startOffset: number;
    currentOffset: number;
  } | null>(null);
  const contentWidthResizeRef = useRef<{
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuX, setMenuX] = useState(0);
  const [menuY, setMenuY] = useState(0);
  const [textOffset, setTextOffset] = useState(DEFAULT_MARKDOWN_TEXT_OFFSET);
  const [contentWidth, setContentWidth] = useState(DEFAULT_MARKDOWN_CONTENT_WIDTH);
  const [textOffsetHovered, setTextOffsetHovered] = useState(false);
  const [contentWidthHovered, setContentWidthHovered] = useState(false);
  const [textOffsetDragging, setTextOffsetDragging] = useState(false);
  const [contentWidthDragging, setContentWidthDragging] = useState(false);
  const [outlineExpanded, setOutlineExpanded] = useState(false);
  const [hasOutlineEntries, setHasOutlineEntries] = useState(false);
  const [scrollJumpControlsVisible, setScrollJumpControlsVisible] = useState(false);
  const scrollJumpControlsTimerRef = useRef<number | null>(null);
  const scrollJumpSessionRef = useRef<{ baselineTop: number; lastScrollAt: number } | null>(null);
  const appState = useAppStore();
  const workspaceStore = useWorkspaceStoreApi();
  const workspaceViewId = useWorkspaceViewId();
  const {
    connectionState,
    currentDir,
    remoteSession,
    baseDir,
    workspaceRootDir,
    instanceID,
    documents,
    activeTabId,
    editorBlurRequestSeq,
    editorFocusRequest,
    setFileContent,
    setTabContent,
    saveEditorViewState,
    loadEditorViewState,
    setEditorFocused,
    saveFile,
    saveTabByPath,
    setPendingScrollHeading,
    setPendingRevealTarget,
    requestEditorRandomID,
    statPath,
    renameEntry,
  } = appState;
  const openDocuments = documents;
  const boundTab = tabId ? openDocuments.find((tab) => tab.id === tabId) || null : null;
  const isBoundToTab = Boolean(tabId);
  const currentFileURI = isBoundToTab ? (boundTab?.uri || null) : appState.currentFileURI;
  const currentFilePath = isBoundToTab ? (boundTab?.filePath || null) : appState.currentFilePath;
  const fileContent = isBoundToTab ? (boundTab?.content || '') : appState.fileContent;
  const isDirty = isBoundToTab ? Boolean(boundTab?.isDirty) : appState.isDirty;
  const pendingScrollHeading = isBoundToTab ? (boundTab?.pendingScrollHeading || null) : appState.pendingScrollHeading;
  const pendingRevealTarget = isBoundToTab ? (boundTab?.pendingRevealTarget || null) : appState.pendingRevealTarget;
  const pushToast = useToastStore((state) => state.pushToast);
  const lastBlurSeqRef = useRef(editorBlurRequestSeq);
  const isDotMd = isDotMdFile(currentFilePath);
  const activeTab = isBoundToTab ? boundTab : openDocuments.find((tab) => tab.id === activeTabId);
  const editorViewStateTabId = activeTab?.id || '';
  const editorViewStateURI = activeTab?.uri || '';
  const editorViewStatePath = activeTab?.filePath || '';
  const outlineDocumentKey = isBoundToTab ? tabId : activeTabId;
  const activeTabTitle = activeTab?.title || '';
  const showDocumentHeader = isDotMd && !compact;
  const [fileModTime, setFileModTime] = useState<number | null>(null);
  const handleDocumentTitleRename = useCallback(async (nextTitle: string): Promise<DocumentHeaderRenameResult> => {
    const target = buildMarkdownDocumentRenameTarget(currentFilePath || '', nextTitle);
    if (!target.ok) {
      return {
        success: false,
        error: documentTitleValidationMessage(target.reason),
      };
    }
    if (target.unchanged) {
      return { success: true };
    }
    const result = await renameEntry(currentFilePath || '', target.filePath);
    if (!result.success) {
      return {
        success: false,
        error: result.error || rendererI18n.t('documentTitleRenameFailed'),
      };
    }
    return { success: true };
  }, [currentFilePath, renameEntry]);
  const documentHeaderOptions: DocumentHeaderOptions = {
    enabled: showDocumentHeader,
    title: showDocumentHeader && currentFilePath ? getMarkdownDocumentTitle(currentFilePath) : '',
    modTime: fileModTime,
    onRenameTitle: showDocumentHeader ? handleDocumentTitleRename : undefined,
  };

  const handleDocumentLeadInPointerDownCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !showDocumentHeader) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest([
      'input',
      'textarea',
      'select',
      'button',
      'a',
      '[contenteditable]:not([contenteditable="false"])',
      '[role="separator"]',
      '.op-md-frontmatter-properties-mount',
    ].join(','))) {
      return;
    }

    const view = editorRef.current?.getView();
    if (!view) {
      return;
    }
    const scrollerRect = view.scrollDOM.getBoundingClientRect();
    const scrollbarWidth = Math.max(0, view.scrollDOM.offsetWidth - view.scrollDOM.clientWidth);
    if (scrollbarWidth > 0 && event.clientX >= scrollerRect.right - scrollbarWidth) {
      return;
    }
    const headerMount = view.scrollDOM.querySelector<HTMLElement>('.op-md-document-header-mount');
    const firstEditableTop = firstEditableMarkdownTop(view);
    if (!headerMount || headerMount.style.display === 'none' || firstEditableTop === null) {
      return;
    }
    const headerTop = headerMount.getBoundingClientRect().top;
    if (
      firstEditableTop <= headerTop
      || event.clientY < headerTop
      || event.clientY >= firstEditableTop
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    moveCursorToFirstEditableMarkdownPosition(view);
  }, [showDocumentHeader]);

  const refreshFileModTime = useCallback(async (path: string | null | undefined) => {
    const normalizedPath = (path || '').trim();
    if (!normalizedPath) {
      setFileModTime(null);
      return;
    }
    try {
      const stat = await statPath(normalizedPath);
      if (stat.error || typeof stat.modTime !== 'number' || !Number.isFinite(stat.modTime)) {
        setFileModTime(null);
        return;
      }
      setFileModTime(stat.modTime);
    } catch {
      setFileModTime(null);
    }
  }, [statPath]);

  useEffect(() => {
    if (!showDocumentHeader || !currentFilePath) {
      setFileModTime(null);
      return;
    }
    void refreshFileModTime(currentFilePath);
  }, [currentFilePath, refreshFileModTime, showDocumentHeader]);

  useEffect(() => {
    if (!showDocumentHeader || !currentFilePath || isDirty) {
      return;
    }
    void refreshFileModTime(currentFilePath);
  }, [currentFilePath, isDirty, refreshFileModTime, showDocumentHeader]);

  const getEditorMainWidth = useCallback(() => mainAreaRef.current?.clientWidth ?? null, []);
  const getTextColumnStart = useCallback(() => {
    return textOffset
      + (isDotMd ? MARKDOWN_DOCUMENT_COLUMN_OFFSET : 0)
      + MARKDOWN_LINE_PADDING_X;
  }, [isDotMd, textOffset]);

  const applyTextOffsetForLayout = useCallback((nextValue: number) => {
    const rendered = clampMarkdownTextOffsetForEditor(nextValue, getEditorMainWidth());
    setTextOffset((prev) => (prev === rendered ? prev : rendered));
    return rendered;
  }, [getEditorMainWidth]);

  const applyContentWidthForLayout = useCallback((nextValue: number) => {
    const rendered = clampMarkdownContentWidthForEditor(
      nextValue,
      getEditorMainWidth(),
      getTextColumnStart()
    );
    setContentWidth((prev) => (prev === rendered ? prev : rendered));
    return rendered;
  }, [getEditorMainWidth, getTextColumnStart]);

  const focusEditorIfRequested = useCallback((editor: MarkdownEditorInstance | null): boolean => {
    if (!editor) {
      return false;
    }
    const state = workspaceStore.getState();
    const tabId = ((isBoundToTab ? boundTab?.id : state.activeTabId) || '').trim();
    if (!tabId || state.editorFocusRequest?.tabId !== tabId) {
      return false;
    }
    editor.focus();
    state.consumeEditorFocusRequest(tabId);
    return true;
  }, [boundTab?.id, isBoundToTab, workspaceStore]);

  const broadcastMarkdownTextOffsetPreview = useCallback((nextValue: number) => {
    if (textOffsetPreviewBroadcastRef.current === nextValue) {
      return;
    }
    textOffsetPreviewBroadcastRef.current = nextValue;
    window.hulala?.settings?.previewMarkdownTextOffset?.(nextValue);
  }, []);

  const broadcastMarkdownContentWidthPreview = useCallback((nextValue: number) => {
    if (contentWidthPreviewBroadcastRef.current === nextValue) {
      return;
    }
    contentWidthPreviewBroadcastRef.current = nextValue;
    window.hulala?.settings?.previewMarkdownContentWidth?.(nextValue);
  }, []);

  useEffect(() => {
    textOffsetHoveredStateRef.current = textOffsetHovered;
  }, [textOffsetHovered]);

  useEffect(() => {
    contentWidthHoveredStateRef.current = contentWidthHovered;
  }, [contentWidthHovered]);

  useEffect(() => {
    textOffsetDraggingStateRef.current = textOffsetDragging;
  }, [textOffsetDragging]);

  useEffect(() => {
    contentWidthDraggingStateRef.current = contentWidthDragging;
  }, [contentWidthDragging]);

  const clearTextOffsetHoverTimer = useCallback(() => {
    if (textOffsetHoverTimerRef.current === null) {
      return;
    }
    window.clearTimeout(textOffsetHoverTimerRef.current);
    textOffsetHoverTimerRef.current = null;
  }, []);

  const clearContentWidthHoverTimer = useCallback(() => {
    if (contentWidthHoverTimerRef.current === null) {
      return;
    }
    window.clearTimeout(contentWidthHoverTimerRef.current);
    contentWidthHoverTimerRef.current = null;
  }, []);

  const hideTextOffsetHover = useCallback(() => {
    clearTextOffsetHoverTimer();
    textOffsetHoveredStateRef.current = false;
    if (!textOffsetDraggingStateRef.current) {
      setTextOffsetHovered(false);
    }
  }, [clearTextOffsetHoverTimer]);

  const hideContentWidthHover = useCallback(() => {
    clearContentWidthHoverTimer();
    contentWidthHoveredStateRef.current = false;
    if (!contentWidthDraggingStateRef.current) {
      setContentWidthHovered(false);
    }
  }, [clearContentWidthHoverTimer]);

  const scheduleScrollJumpControlsHide = useCallback(() => {
    if (scrollJumpControlsTimerRef.current !== null) {
      window.clearTimeout(scrollJumpControlsTimerRef.current);
    }
    scrollJumpControlsTimerRef.current = window.setTimeout(() => {
      scrollJumpControlsTimerRef.current = null;
      scrollJumpSessionRef.current = null;
      setScrollJumpControlsVisible(false);
    }, SCROLL_JUMP_CONTROL_VISIBLE_MS);
  }, []);

  const handleScrollJumpControls = useCallback((scrollEl: HTMLElement) => {
    const now = performance.now();
    const currentTop = scrollEl.scrollTop;
    const threshold = Math.max(1, scrollEl.clientHeight * SCROLL_JUMP_CONTROL_SCREEN_THRESHOLD);
    const session = scrollJumpSessionRef.current;
    const sessionExpired = !session || now - session.lastScrollAt > SCROLL_JUMP_CONTROL_VISIBLE_MS;

    if (sessionExpired) {
      scrollJumpSessionRef.current = {
        baselineTop: currentTop,
        lastScrollAt: now,
      };
      scheduleScrollJumpControlsHide();
      return;
    }

    session.lastScrollAt = now;
    if (!scrollJumpControlsVisible && Math.abs(currentTop - session.baselineTop) < threshold) {
      scheduleScrollJumpControlsHide();
      return;
    }

    setScrollJumpControlsVisible(true);
    scheduleScrollJumpControlsHide();
  }, [scheduleScrollJumpControlsHide, scrollJumpControlsVisible]);

  const ensureTextOffsetHoverTimer = useCallback(() => {
    if (textOffsetHoverTimerRef.current !== null) {
      return;
    }
    const tick = () => {
      textOffsetHoverTimerRef.current = null;
      if (textOffsetDraggingStateRef.current || textOffsetHoveredStateRef.current) {
        return;
      }
      const remaining = textOffsetHoverDeadlineRef.current - performance.now();
      if (remaining <= 0) {
        if (isDocumentTextEntryFocused()) {
          textOffsetHoveredStateRef.current = false;
          setTextOffsetHovered(false);
          return;
        }
        textOffsetHoveredStateRef.current = true;
        setTextOffsetHovered(true);
        return;
      }
      textOffsetHoverTimerRef.current = window.setTimeout(tick, remaining);
    };
    const remaining = Math.max(0, textOffsetHoverDeadlineRef.current - performance.now());
    textOffsetHoverTimerRef.current = window.setTimeout(tick, remaining);
  }, []);

  const ensureContentWidthHoverTimer = useCallback(() => {
    if (contentWidthHoverTimerRef.current !== null) {
      return;
    }
    const tick = () => {
      contentWidthHoverTimerRef.current = null;
      if (contentWidthDraggingStateRef.current || contentWidthHoveredStateRef.current) {
        return;
      }
      const remaining = contentWidthHoverDeadlineRef.current - performance.now();
      if (remaining <= 0) {
        if (isDocumentTextEntryFocused()) {
          contentWidthHoveredStateRef.current = false;
          setContentWidthHovered(false);
          return;
        }
        contentWidthHoveredStateRef.current = true;
        setContentWidthHovered(true);
        return;
      }
      contentWidthHoverTimerRef.current = window.setTimeout(tick, remaining);
    };
    const remaining = Math.max(0, contentWidthHoverDeadlineRef.current - performance.now());
    contentWidthHoverTimerRef.current = window.setTimeout(tick, remaining);
  }, []);

  const touchTextOffsetHoverReveal = useCallback(() => {
    if (textOffsetDraggingStateRef.current || textOffsetHoveredStateRef.current) {
      return;
    }
    if (isDocumentTextEntryFocused()) {
      hideTextOffsetHover();
      return;
    }
    textOffsetHoverDeadlineRef.current = performance.now() + TEXT_OFFSET_HOVER_DELAY_MS;
    ensureTextOffsetHoverTimer();
  }, [ensureTextOffsetHoverTimer, hideTextOffsetHover]);

  const touchContentWidthHoverReveal = useCallback(() => {
    if (contentWidthDraggingStateRef.current || contentWidthHoveredStateRef.current) {
      return;
    }
    if (isDocumentTextEntryFocused()) {
      hideContentWidthHover();
      return;
    }
    contentWidthHoverDeadlineRef.current = performance.now() + TEXT_OFFSET_HOVER_DELAY_MS;
    ensureContentWidthHoverTimer();
  }, [ensureContentWidthHoverTimer, hideContentWidthHover]);

  const armTextOffsetHoverReveal = useCallback(() => {
    if (textOffsetDraggingStateRef.current || textOffsetHoveredStateRef.current) {
      return;
    }
    blurDocumentTextEntryFocus();
    textOffsetHoverDeadlineRef.current = performance.now() + TEXT_OFFSET_HOVER_DELAY_MS;
    ensureTextOffsetHoverTimer();
  }, [ensureTextOffsetHoverTimer]);

  const armContentWidthHoverReveal = useCallback(() => {
    if (contentWidthDraggingStateRef.current || contentWidthHoveredStateRef.current) {
      return;
    }
    blurDocumentTextEntryFocus();
    contentWidthHoverDeadlineRef.current = performance.now() + TEXT_OFFSET_HOVER_DELAY_MS;
    ensureContentWidthHoverTimer();
  }, [ensureContentWidthHoverTimer]);

  useEffect(() => {
    if (!textOffsetEnabled || typeof document === 'undefined') {
      return;
    }
    const hideIfTextEntryFocused = () => {
      if (isDocumentTextEntryFocused()) {
        hideTextOffsetHover();
        hideContentWidthHover();
      }
    };
    document.addEventListener('focusin', hideIfTextEntryFocused, true);
    document.addEventListener('keydown', hideIfTextEntryFocused, true);
    document.addEventListener('input', hideIfTextEntryFocused, true);
    return () => {
      document.removeEventListener('focusin', hideIfTextEntryFocused, true);
      document.removeEventListener('keydown', hideIfTextEntryFocused, true);
      document.removeEventListener('input', hideIfTextEntryFocused, true);
    };
  }, [hideContentWidthHover, hideTextOffsetHover, textOffsetEnabled]);

  const moveCursorOutsideImageSource = useCallback((view: EditorView, anchorPos: number) => {
    requestAnimationFrame(() => {
      const line = view.state.doc.lineAt(Math.min(anchorPos, Math.max(0, view.state.doc.length)));
      if (line.number >= view.state.doc.lines) {
        moveCursorToEditableMarkdownTail(view);
        return;
      }
      const nextAnchor = getLineAnchor(
        view.state.doc,
        line.number + 1
      );

      view.dispatch({
        selection: { anchor: nextAnchor },
        scrollIntoView: true,
      });
    });
  }, []);

  const {
    imageMenu,
    openImageMenu,
    closeImageContextMenu,
    handleImageWidthSelect,
    handleImageEditSource,
    handleImageDelete,
  } = useMarkdownImageMenu({
    getView: () => editorRef.current?.getView() || null,
    afterWidthChange: moveCursorOutsideImageSource,
    afterDelete: moveCursorOutsideImageSource,
  });

  const resolveCurrentImageTarget = useCallback(() => {
    if (!imageMenu) {
      return null;
    }
    const view = editorRef.current?.getView();
    if (!view) {
      return null;
    }
    return resolveImageMenuTarget(view, imageMenu, currentFilePath || null);
  }, [currentFilePath, imageMenu]);

  const handleImageCopyPath = useCallback(async () => {
    const target = resolveCurrentImageTarget();
    if (!target) {
      pushToast('Failed to copy path');
      return;
    }
    try {
      await writeClipboardText(target.path);
      pushToast('Path copied');
    } catch {
      pushToast('Failed to copy path');
    }
  }, [pushToast, resolveCurrentImageTarget]);

  const handleImageCopy = useCallback(async () => {
    const imageElement = imageMenu?.imageElement ?? null;
    if (!imageElement) {
      pushToast('Image is not loaded');
      return;
    }
    try {
      await writeClipboardImageFromElement(imageElement);
      pushToast('Image copied');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Failed to copy image');
    }
  }, [imageMenu, pushToast]);

  // Create editor instance
  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up previous editor
    if (editorRef.current) {
      editorRef.current.destroy();
    }

    // Create new editor
    editorRef.current = createMarkdownEditor(containerRef.current, {
      initialContent: fileContent,
      documentPath: currentFilePath || null,
      onContentChange: (content) => {
        if (isBoundToTab && boundTab) {
          setTabContent(boundTab.id, content);
          return;
        }
        setFileContent(content);
      },
      onFocusChange: (focused) => {
        if (isBoundToTab && boundTab) {
          const state = workspaceStore.getState();
          if (focused) {
            state.setActiveTab(boundTab.id);
            state.setEditorFocused(true);
          } else if (state.activeTabId === boundTab.id) {
            state.setEditorFocused(false);
          }
          return;
        }
        setEditorFocused(focused);
      },
      livePreview: true,
      editableTail: true,
      onImageActivate: (image) => {
        setMenuOpen(false);
        openImageMenu(image);
      },
      onOpenSearchPanel: ({ replace }) => {
        searchOverlayRef.current?.open({ replace });
      },
      documentHeader: documentHeaderOptions,
      workspaceStore,
    });
    const viewStateIdentity = editorViewStateTabId
      ? {
          tabId: editorViewStateTabId,
          uri: editorViewStateURI || null,
          filePath: editorViewStatePath || null,
        }
      : null;
    if (viewStateIdentity) {
      const cached = loadEditorViewState(viewStateIdentity, 'markdown');
      if (cached?.kind === 'markdown' && !pendingScrollHeading && !pendingRevealTarget) {
        editorRef.current.restoreViewState(cached);
      } else if (!pendingScrollHeading && !pendingRevealTarget) {
        const firstPlainTextPos = findFirstPlainTextPos(fileContent);
        if (firstPlainTextPos !== null) {
          editorRef.current.restoreViewState({
            selectionAnchor: firstPlainTextPos,
            selectionHead: firstPlainTextPos,
            scrollTop: 0,
            scrollLeft: 0,
          });
        }
      }
    }
    const shouldAutoFocus = autoFocus && Boolean(currentFilePath);
    if (focusEditorIfRequested(editorRef.current)) {
      // Focus request consumed.
    } else if (shouldAutoFocus) {
      editorRef.current.focus();
    } else {
      if (!isBoundToTab || workspaceStore.getState().activeTabId === boundTab?.id) {
        setEditorFocused(false);
      }
    }

    return () => {
      const editor = editorRef.current;
      if (editor && viewStateIdentity) {
        saveEditorViewState(viewStateIdentity, {
          kind: 'markdown',
          ...editor.getViewState(),
        });
      }
      if (editor) {
        editor.destroy();
        editorRef.current = null;
      }
      if (!isBoundToTab) {
        setEditorFocused(false);
      }
    };
  }, [autoFocus, boundTab?.id, currentFileURI, currentFilePath, editorViewStatePath, editorViewStateTabId, editorViewStateURI, focusEditorIfRequested, isBoundToTab, loadEditorViewState, openImageMenu, saveEditorViewState, setEditorFocused, setFileContent, setTabContent, workspaceStore]);

  useEffect(() => {
    if (!editorFocusRequest) {
      return;
    }
    focusEditorIfRequested(editorRef.current);
  }, [editorFocusRequest, focusEditorIfRequested]);

  useEffect(() => {
    editorRef.current?.setDocumentHeader(documentHeaderOptions);
  }, [
    documentHeaderOptions.enabled,
    documentHeaderOptions.modTime,
    documentHeaderOptions.onRenameTitle,
    documentHeaderOptions.title,
  ]);

  useEffect(() => {
    if (editorBlurRequestSeq === lastBlurSeqRef.current) {
      return;
    }
    lastBlurSeqRef.current = editorBlurRequestSeq;
    editorRef.current?.blur();
    setEditorFocused(false);
  }, [editorBlurRequestSeq, setEditorFocused]);

  useEffect(() => {
    const view = editorRef.current?.getView();
    if (!view) {
      return;
    }
    const onScrollJumpControls = () => {
      handleScrollJumpControls(view.scrollDOM);
    };
    view.scrollDOM.addEventListener('scroll', onScrollJumpControls, { passive: true });
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScrollJumpControls);
    };
  }, [currentFilePath, handleScrollJumpControls]);

  // Sync content when file content changes externally.
  // Skip when editor is focused — the editor's doc is authoritative during editing;
  // external updates during a dirty edit would cause cursor/scroll jumps.
  // If the tab is clean, focused editors should still accept file reloads/stream updates.
  useEffect(() => {
    if (!editorRef.current) return;
    const currentContent = editorRef.current.getContent();
    const cmContent = containerRef.current?.querySelector('.cm-content');
    if (cmContent && cmContent === document.activeElement && isDirty) return;

    if (currentContent !== fileContent) {
      editorRef.current.setContent(fileContent, { preserveScroll: true });
    }
  }, [
    currentFilePath,
    fileContent,
    isDirty,
  ]);

  useEffect(() => {
    if (!hasOutlineEntries && outlineExpanded) {
      setOutlineExpanded(false);
    }
  }, [hasOutlineEntries, outlineExpanded]);

  useEffect(() => {
    setOutlineExpanded(false);
  }, [outlineDocumentKey]);

  useEffect(() => {
    return () => {
      clearTextOffsetHoverTimer();
      clearContentWidthHoverTimer();
      if (scrollJumpControlsTimerRef.current !== null) {
        window.clearTimeout(scrollJumpControlsTimerRef.current);
        scrollJumpControlsTimerRef.current = null;
      }
      scrollJumpSessionRef.current = null;
      setMarkdownTextOffsetDragLocked(false);
      setMarkdownContentWidthDragLocked(false);
    };
  }, [clearContentWidthHoverTimer, clearTextOffsetHoverTimer]);

  useEffect(() => {
    const settingsApi = window.hulala?.settings;
    if (!settingsApi?.get) {
      textOffsetValueRef.current = DEFAULT_MARKDOWN_TEXT_OFFSET;
      applyTextOffsetForLayout(DEFAULT_MARKDOWN_TEXT_OFFSET);
      return;
    }

    let disposed = false;
    const applyTextOffsetSetting = (settings?: MarkdownUiSettingsSnapshot) => {
      if (disposed || textOffsetResizeRef.current) {
        return;
      }
      const resolved = normalizeMarkdownTextOffset(settings?.ui?.markdownTextOffset);
      textOffsetValueRef.current = resolved;
      applyTextOffsetForLayout(resolved);
    };

    settingsApi.get()
      .then((settings) => {
        applyTextOffsetSetting(settings as MarkdownUiSettingsSnapshot);
      })
      .catch(() => {
        textOffsetValueRef.current = DEFAULT_MARKDOWN_TEXT_OFFSET;
        applyTextOffsetForLayout(DEFAULT_MARKDOWN_TEXT_OFFSET);
      });

    const disposeSettingsChanged = settingsApi.onChanged?.((settings) => {
      applyTextOffsetSetting(settings as MarkdownUiSettingsSnapshot);
    });

    return () => {
      disposed = true;
      disposeSettingsChanged?.();
    };
  }, [applyTextOffsetForLayout]);

  useEffect(() => {
    const settingsApi = window.hulala?.settings;
    if (!settingsApi?.get) {
      contentWidthValueRef.current = DEFAULT_MARKDOWN_CONTENT_WIDTH;
      applyContentWidthForLayout(DEFAULT_MARKDOWN_CONTENT_WIDTH);
      return;
    }

    let disposed = false;
    const applyContentWidthSetting = (settings?: MarkdownUiSettingsSnapshot) => {
      if (disposed || contentWidthResizeRef.current) {
        return;
      }
      const resolved = normalizeMarkdownContentWidth(settings?.ui?.markdownContentWidth);
      contentWidthValueRef.current = resolved;
      applyContentWidthForLayout(resolved);
    };

    settingsApi.get()
      .then((settings) => {
        applyContentWidthSetting(settings as MarkdownUiSettingsSnapshot);
      })
      .catch(() => {
        contentWidthValueRef.current = DEFAULT_MARKDOWN_CONTENT_WIDTH;
        applyContentWidthForLayout(DEFAULT_MARKDOWN_CONTENT_WIDTH);
      });

    const disposeSettingsChanged = settingsApi.onChanged?.((settings) => {
      applyContentWidthSetting(settings as MarkdownUiSettingsSnapshot);
    });

    return () => {
      disposed = true;
      disposeSettingsChanged?.();
    };
  }, [applyContentWidthForLayout]);

  useEffect(() => {
    const mainAreaEl = mainAreaRef.current;
    if (!mainAreaEl || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!textOffsetResizeRef.current) {
        applyTextOffsetForLayout(textOffsetValueRef.current);
      }
      if (!contentWidthResizeRef.current) {
        applyContentWidthForLayout(contentWidthValueRef.current);
      }
    });

    observer.observe(mainAreaEl);
    return () => {
      observer.disconnect();
    };
  }, [applyContentWidthForLayout, applyTextOffsetForLayout]);

  useEffect(() => {
    if (contentWidthResizeRef.current) {
      return;
    }
    applyContentWidthForLayout(contentWidthValueRef.current);
  }, [applyContentWidthForLayout]);

  // Scroll to heading if requested after file open
  useEffect(() => {
    if (isBoundToTab) {
      return;
    }
    if (editorRef.current && pendingScrollHeading) {
      editorRef.current.scrollToHeading(pendingScrollHeading);
      setPendingScrollHeading(null);
    }
  }, [fileContent, isBoundToTab, pendingScrollHeading, setPendingScrollHeading]);

  useEffect(() => {
    if (isBoundToTab) {
      return;
    }
    if (editorRef.current && pendingRevealTarget) {
      editorRef.current.scrollToPos(revealTargetToPos(fileContent, pendingRevealTarget));
      setPendingRevealTarget(null);
    }
  }, [fileContent, isBoundToTab, pendingRevealTarget, setPendingRevealTarget]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Save: Cmd+S / Ctrl+S
    const key = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && key === 's') {
      e.preventDefault();
      if (e.shiftKey) {
        void saveFile({ tabId: tabId || undefined, saveAs: true });
      } else if (isBoundToTab && currentFilePath) {
        void saveTabByPath(currentFilePath, tabId || undefined);
      } else {
        saveFile();
      }
      return;
    }
  }, [currentFilePath, isBoundToTab, saveFile, saveTabByPath, tabId]);

  const handleContextMenuCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();

    const target = e.target instanceof Element ? e.target : null;
    const imageEl = target?.closest('[data-md-image-source-from][data-md-image-source-to]') as HTMLElement | null;
    if (imageEl) {
      const nextMenu = getImageMenuStateFromElement(imageEl, e.clientX, e.clientY);
      if (nextMenu) {
        openImageMenu(nextMenu);
        return;
      }
    }

    closeImageContextMenu();
    setMenuOpen(true);
    setMenuX(e.clientX);
    setMenuY(e.clientY);
  }, [closeImageContextMenu, getImageMenuStateFromElement, openImageMenu]);

  const closeContextMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const handleInsertRandomID = useCallback(async () => {
    const randomID = await requestEditorRandomID();
    if (!randomID) {
      pushToast('Failed to generate random ID');
      return;
    }
    editorRef.current?.insertAtSelection(randomID);
  }, [pushToast, requestEditorRandomID]);

  const handleInsertExcalidraw = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !currentFilePath || connectionState !== 'connected') return;
    const view = editor.getView();
    if (view.state.readOnly) return;
    const sourceTabId = boundTab?.id ?? workspaceStore.getState().activeTabId;
    const fileName = `Drawing-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.excalidraw`;
    const target = `assets/${fileName}`;
    const path = resolveDrawingPath(currentFilePath, target);
    try {
      await createDrawingFile(workspaceStore.getState(), path);
      const reference = `\n\n![[${target}]]\n\n`;
      if (editorRef.current === editor) {
        editor.insertAtSelection(reference);
      } else {
        // File creation can finish after the user has switched tabs. Keep the
        // reference in its original Markdown document without replacing edits.
        const state = workspaceStore.getState();
        const source = state.documents.find((item) => item.id === sourceTabId);
        if (source) state.setTabContent(source.id, source.content + reference);
      }
      await workspaceStore.getState().openFile(path, { focusEditor: true });
    } catch {
      pushToast(rendererI18n.t('dialog:excalidraw.saveFailed'));
    }
  }, [boundTab?.id, connectionState, currentFilePath, pushToast, workspaceStore]);

  const handleScrollToTop = useCallback(() => {
    const view = editorRef.current?.getView();
    if (!view) {
      return;
    }
    view.scrollDOM.scrollTop = 0;
    setScrollJumpControlsVisible(true);
    scheduleScrollJumpControlsHide();
  }, [scheduleScrollJumpControlsHide]);

  const handleScrollToBottom = useCallback(() => {
    editorRef.current?.scrollToBottom();
    setScrollJumpControlsVisible(true);
    scheduleScrollJumpControlsHide();
  }, [scheduleScrollJumpControlsHide]);

  const handleExportPdf = useCallback(async () => {
    const api = window.hulala;
    if (!api?.exportMarkdownPdfToPath || !api?.getPdfExportDefaultPath) {
      pushToast('PDF export is not available');
      return;
    }

    const fallbackTitle = currentFilePath
      ? currentFilePath.split('/').pop() || 'Untitled'
      : 'Untitled';

    // Step 1: get default path info from main process
    const defaults = await api.getPdfExportDefaultPath({
      workspaceViewId,
      sourcePath: currentFilePath || undefined,
      currentDir: currentDir || undefined,
      isRemote: !!remoteSession,
    });

    // Step 2: show unified save dialog
    const { requestSaveFileDialog } = await import('../FileDialog/saveFileDialogBridge');
    const chosenPath = await requestSaveFileDialog({
      workspaceViewId,
      defaultDir: defaults.defaultDir,
      defaultFileName: defaults.defaultFileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!chosenPath) return;

    // Step 3: export to the chosen path
    const result = await api.exportMarkdownPdfToPath({
      workspaceViewId,
      outputPath: chosenPath,
      title: activeTabTitle || fallbackTitle,
      content: fileContent,
      sourcePath: currentFilePath || undefined,
      currentDir: currentDir || undefined,
      remoteSession,
      baseDir: baseDir || undefined,
      workspaceRootDir: workspaceRootDir || undefined,
      instanceID: instanceID || undefined,
    });

    if (result.error) {
      pushToast(result.error);
      return;
    }
    pushToast('PDF exported');
  }, [
    activeTabTitle,
    baseDir,
    currentDir,
    currentFilePath,
    fileContent,
    instanceID,
    pushToast,
    remoteSession,
    workspaceRootDir,
    workspaceViewId,
  ]);

  const handleTextOffsetResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!textOffsetHoveredStateRef.current && !textOffsetDraggingStateRef.current) {
      return;
    }
    event.preventDefault();
    if (textOffsetResizeRef.current) {
      return;
    }

    clearTextOffsetHoverTimer();
    setMarkdownTextOffsetDragLocked(true);
    textOffsetDraggingStateRef.current = true;
    textOffsetPreviewBroadcastRef.current = textOffsetValueRef.current;
    textOffsetResizeRef.current = {
      startX: event.clientX,
      startOffset: textOffset,
      currentOffset: textOffset,
    };
    setTextOffsetDragging(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = textOffsetResizeRef.current;
      if (!drag) {
        return;
      }
      const deltaX = moveEvent.clientX - drag.startX;
      const nextOffset = clampMarkdownTextOffsetForEditor(
        drag.startOffset + deltaX,
        getEditorMainWidth()
      );
      drag.currentOffset = nextOffset;
      setTextOffset((prev) => (prev === nextOffset ? prev : nextOffset));
      broadcastMarkdownTextOffsetPreview(nextOffset);
    };

    const cleanup = () => {
      const drag = textOffsetResizeRef.current;
      textOffsetResizeRef.current = null;
      textOffsetHoveredStateRef.current = false;
      textOffsetDraggingStateRef.current = false;
      textOffsetPreviewBroadcastRef.current = null;
      setTextOffsetDragging(false);
      setTextOffsetHovered(false);
      setMarkdownTextOffsetDragLocked(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);

      if (!drag) {
        return;
      }

      if (drag.currentOffset === drag.startOffset) {
        applyTextOffsetForLayout(textOffsetValueRef.current);
        return;
      }

      const finalPersistedOffset = normalizeMarkdownTextOffset(drag.currentOffset);
      textOffsetValueRef.current = finalPersistedOffset;
      applyTextOffsetForLayout(finalPersistedOffset);

      const persistPromise = window.hulala?.settings?.set?.({
        ui: {
          markdownTextOffset: finalPersistedOffset,
        },
      });
      if (!persistPromise) {
        return;
      }
      void persistPromise.catch((error) => {
        console.warn('[markdownTextOffset] failed to persist:', error);
      });
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  }, [applyTextOffsetForLayout, broadcastMarkdownTextOffsetPreview, clearTextOffsetHoverTimer, getEditorMainWidth, textOffset]);

  const handleContentWidthResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!contentWidthHoveredStateRef.current && !contentWidthDraggingStateRef.current) {
      return;
    }
    event.preventDefault();
    if (contentWidthResizeRef.current) {
      return;
    }

    clearContentWidthHoverTimer();
    setMarkdownContentWidthDragLocked(true);
    contentWidthDraggingStateRef.current = true;
    contentWidthPreviewBroadcastRef.current = contentWidthValueRef.current;
    contentWidthResizeRef.current = {
      startX: event.clientX,
      startWidth: contentWidth,
      currentWidth: contentWidth,
    };
    setContentWidthDragging(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = contentWidthResizeRef.current;
      if (!drag) {
        return;
      }
      const deltaX = moveEvent.clientX - drag.startX;
      const nextWidth = clampMarkdownContentWidthForEditor(
        drag.startWidth + deltaX,
        getEditorMainWidth(),
        getTextColumnStart()
      );
      drag.currentWidth = nextWidth;
      setContentWidth((prev) => (prev === nextWidth ? prev : nextWidth));
      broadcastMarkdownContentWidthPreview(nextWidth);
    };

    const cleanup = () => {
      const drag = contentWidthResizeRef.current;
      contentWidthResizeRef.current = null;
      contentWidthHoveredStateRef.current = false;
      contentWidthDraggingStateRef.current = false;
      contentWidthPreviewBroadcastRef.current = null;
      setContentWidthDragging(false);
      setContentWidthHovered(false);
      setMarkdownContentWidthDragLocked(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);

      if (!drag) {
        return;
      }

      if (drag.currentWidth === drag.startWidth) {
        applyContentWidthForLayout(contentWidthValueRef.current);
        return;
      }

      const finalPersistedWidth = normalizeMarkdownContentWidth(drag.currentWidth);
      contentWidthValueRef.current = finalPersistedWidth;
      applyContentWidthForLayout(finalPersistedWidth);

      const persistPromise = window.hulala?.settings?.set?.({
        ui: {
          markdownContentWidth: finalPersistedWidth,
        },
      });
      if (!persistPromise) {
        return;
      }
      void persistPromise.catch((error) => {
        console.warn('[markdownContentWidth] failed to persist:', error);
      });
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  }, [
    applyContentWidthForLayout,
    broadcastMarkdownContentWidthPreview,
    clearContentWidthHoverTimer,
    contentWidth,
    getEditorMainWidth,
    getTextColumnStart,
  ]);

  const handleOutlineExpandedChange = useCallback((expanded: boolean) => {
    if (expanded && !hasOutlineEntries) {
      return;
    }
    setOutlineExpanded(expanded);
  }, [hasOutlineEntries]);

  const handleOutlineEntriesChange = useCallback((hasEntries: boolean) => {
    setHasOutlineEntries((prev) => (prev === hasEntries ? prev : hasEntries));
  }, []);

  const textOffsetHotzoneBaseWidth = Math.max(
    0,
    textOffset + (isDotMd ? MARKDOWN_DOCUMENT_COLUMN_OFFSET : 0)
  );
  const contentWidthLineX = Math.max(0, getTextColumnStart() + contentWidth);
  const markdownEditorStyle = {
    '--op-md-effective-column-offset': `${isDotMd ? MARKDOWN_DOCUMENT_COLUMN_OFFSET : 0}px`,
    '--op-md-content-padding-left': `${Math.max(0, textOffset)}px`,
    '--op-md-content-max-width': `${Math.max(0, contentWidth)}px`,
  } as React.CSSProperties;
  const outlineElements: React.ReactNode[] = [];
  if (outlineMode === 'hidden') {
    // Callers can still suppress document chrome for compact embeddings.
  } else {
    outlineElements.push(
      <div
        key="outline-shell"
        className="op-document-outline-shell is-collapsed"
      >
        <DocumentOutline
          content={fileContent}
          editorRef={editorRef}
          expanded={false}
          onExpandedChange={handleOutlineExpandedChange}
          onEntriesChange={handleOutlineEntriesChange}
          rightWorkspaceControl={rightWorkspaceControl}
          outlineToggleEnabled={outlineToggleEnabled}
        />
      </div>
    );
    outlineElements.push(
      <OutlinePopover
        key="outline-popover"
        open={outlineExpanded && hasOutlineEntries}
        onOpenChange={handleOutlineExpandedChange}
        title={rendererI18n.t('shell:editorPane.outline')}
      >
        <DocumentOutline
          content={fileContent}
          editorRef={editorRef}
          expanded={true}
          onExpandedChange={handleOutlineExpandedChange}
          onEntriesChange={handleOutlineEntriesChange}
          outlineToggleEnabled={false}
          onNavigate={() => setOutlineExpanded(false)}
        />
      </OutlinePopover>
    );
  }

  return (
    <>
      <div
        ref={layoutRef}
        className={`op-markdown-editor relative flex flex-1 overflow-hidden ${isDotMd ? 'is-dot-md' : ''} ${compact ? 'is-compact' : ''} is-outline-collapsed`}
        style={markdownEditorStyle}
      >
        <div
          ref={mainAreaRef}
          className="op-markdown-editor-main relative flex-1 min-w-0 overflow-hidden"
          onPointerDownCapture={handleDocumentLeadInPointerDownCapture}
        >
          {textOffsetEnabled && (
            <div
              className="op-md-text-offset-zone"
              style={{ width: `calc(${textOffsetHotzoneBaseWidth}px + var(--op-md-line-padding-x))` }}
              onPointerEnter={() => {
                touchTextOffsetHoverReveal();
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return;
                }
                armTextOffsetHoverReveal();
              }}
              onPointerMove={() => {
                if (!textOffsetHovered && !textOffsetDragging) {
                  touchTextOffsetHoverReveal();
                }
              }}
              onPointerLeave={() => {
                clearTextOffsetHoverTimer();
                textOffsetHoveredStateRef.current = false;
                if (!textOffsetDragging) {
                  setTextOffsetHovered(false);
                }
              }}
            >
              <div className="absolute inset-y-0 right-0 flex">
                <ResizeDivider
                  direction="vertical"
                  onResizeStart={handleTextOffsetResizeStart}
                  ariaLabel="Resize markdown text offset"
                  highlighted={textOffsetDragging}
                  visible={textOffsetHovered || textOffsetDragging}
                  hitTargetEnabled={textOffsetHovered || textOffsetDragging}
                  activeColor="var(--color-brand)"
                />
              </div>
            </div>
          )}
          {textOffsetEnabled && (
            <div
              className="op-md-content-width-zone"
              style={{ left: `${contentWidthLineX}px` }}
              onPointerEnter={() => {
                touchContentWidthHoverReveal();
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return;
                }
                armContentWidthHoverReveal();
              }}
              onPointerMove={() => {
                if (!contentWidthHovered && !contentWidthDragging) {
                  touchContentWidthHoverReveal();
                }
              }}
              onPointerLeave={() => {
                clearContentWidthHoverTimer();
                contentWidthHoveredStateRef.current = false;
                if (!contentWidthDragging) {
                  setContentWidthHovered(false);
                }
              }}
            >
              <div className="absolute inset-y-0 left-0 flex">
                <ResizeDivider
                  direction="vertical"
                  onResizeStart={handleContentWidthResizeStart}
                  ariaLabel="Resize markdown content width"
                  highlighted={contentWidthDragging}
                  visible={contentWidthHovered || contentWidthDragging}
                  hitTargetEnabled={contentWidthHovered || contentWidthDragging}
                  activeColor="var(--color-brand)"
                />
              </div>
            </div>
          )}
          <div
            ref={containerRef}
            className="relative z-0 h-full"
            onKeyDown={handleKeyDown}
            onContextMenuCapture={handleContextMenuCapture}
          />
          <EditorSearchOverlay
            getView={() => editorRef.current?.getView() || null}
            registerHandle={(handle) => {
              searchOverlayRef.current = handle;
            }}
            enableReplace
          />
        </div>
        {outlineElements}
        {scrollJumpControlsVisible && (
          <div className="op-md-scroll-jump-controls">
            <IconButton
              variant="inline"
              size={24}
              className="op-md-scroll-jump-btn"
              onClick={handleScrollToTop}
              title="Scroll to top"
              aria-label="Scroll to top"
            >
              <ArrowUpTinyIcon className="w-3.5 h-3.5" />
            </IconButton>
            <IconButton
              variant="inline"
              size={24}
              className="op-md-scroll-jump-btn"
              onClick={handleScrollToBottom}
              title="Scroll to bottom"
              aria-label="Scroll to bottom"
            >
              <ArrowUpTinyIcon className="w-3.5 h-3.5 rotate-180" />
            </IconButton>
          </div>
        )}
      </div>
      <EditorContextMenu
        open={menuOpen}
        x={menuX}
        y={menuY}
        onClose={closeContextMenu}
        editorApi={editorRef.current}
        onExportPdf={handleExportPdf}
        onInsertRandomID={handleInsertRandomID}
        canInsertRandomID={connectionState === 'connected'}
        onInsertExcalidraw={handleInsertExcalidraw}
        canInsertExcalidraw={connectionState === 'connected' && Boolean(currentFilePath)}
      />
      <ImageContextMenu
        open={!!imageMenu}
        x={imageMenu?.x || 0}
        y={imageMenu?.y || 0}
        currentWidthPercent={imageMenu?.widthPercent ?? null}
        onClose={closeImageContextMenu}
        onCopy={handleImageCopy}
        onCopyPath={handleImageCopyPath}
        onEditSource={handleImageEditSource}
        onDelete={handleImageDelete}
        onSelectWidth={handleImageWidthSelect}
      />
    </>
  );
};
