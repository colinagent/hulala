import React, { useEffect, useRef, useCallback } from 'react';
import { createTextEditor, TextEditorInstance } from './codemirror/textSetup';
import { EditorSearchOverlay, type EditorSearchOverlayHandle } from './search/EditorSearchOverlay';
import { revealTargetToPos } from './revealTarget';
import { useAppStore, useWorkspaceStoreApi } from '../../store/appStore';
import { useUiStore } from '../../store/uiStore';
import { languageRegistry } from '../../services/languageRegistry';
import { PinIcon } from '../Icons';

type TextEditorProps = {
  tabId?: string | null;
  autoFocus?: boolean;
  pinEnabled?: boolean;
  pinned?: boolean;
  onPinToggle?: () => void;
};

export const TextEditor: React.FC<TextEditorProps> = ({
  tabId = null,
  autoFocus = false,
  pinEnabled = false,
  pinned = false,
  onPinToggle,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TextEditorInstance | null>(null);
  const searchOverlayRef = useRef<EditorSearchOverlayHandle | null>(null);
  const showLineNumbers = useUiStore((state) => state.showLineNumbers);
  const appState = useAppStore();
  const workspaceStore = useWorkspaceStoreApi();
  const {
    documents,
    editorFocusRequest,
    setFileContent,
    setTabContent,
    saveEditorViewState,
    loadEditorViewState,
    saveFile,
    saveTabByPath,
    setPendingRevealTarget,
    setEditorFocused,
  } = appState;
  const openDocuments = documents;
  const boundTab = tabId ? openDocuments.find((tab) => tab.id === tabId) || null : null;
  const isBoundToTab = Boolean(tabId);
  const boundTabId = boundTab?.id || null;
  const editorTab = boundTab || openDocuments.find((tab) => tab.id === appState.activeTabId) || null;
  const editorViewStateTabId = editorTab?.id || '';
  const editorViewStateURI = editorTab?.uri || '';
  const editorViewStatePath = editorTab?.filePath || '';
  const currentFileURI = isBoundToTab ? (boundTab?.uri || null) : appState.currentFileURI;
  const currentFilePath = isBoundToTab ? (boundTab?.filePath || null) : appState.currentFilePath;
  const fileContent = isBoundToTab ? (boundTab?.content || '') : appState.fileContent;
  const isDirty = isBoundToTab ? Boolean(boundTab?.isDirty) : appState.isDirty;
  const pendingRevealTarget = isBoundToTab ? (boundTab?.pendingRevealTarget || null) : appState.pendingRevealTarget;

  const fileContentRef = useRef(fileContent);
  const pendingRevealTargetRef = useRef(pendingRevealTarget);

  useEffect(() => {
    fileContentRef.current = fileContent;
  }, [fileContent]);

  useEffect(() => {
    pendingRevealTargetRef.current = pendingRevealTarget;
  }, [pendingRevealTarget]);

  const focusEditorIfRequested = useCallback((editor: TextEditorInstance | null): boolean => {
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

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    const openingIdentity = currentFileURI || currentFilePath;
    const viewStateIdentity = editorViewStateTabId
      ? {
          tabId: editorViewStateTabId,
          uri: editorViewStateURI || null,
          filePath: editorViewStatePath || null,
        }
      : null;

    if (editorRef.current) {
      editorRef.current.destroy();
    }

    const resolveLanguage = async () => {
      const settings = await window.hulala?.settings.get();
      const editorSettings = settings?.editor;
      const languageId = currentFilePath
        ? languageRegistry.resolveLanguageId(
          currentFilePath,
          editorSettings?.filesAssociations || {},
          editorSettings?.defaultLanguage || 'plaintext'
        )
        : (editorSettings?.defaultLanguage || 'plaintext');
      const languageExtensions = await languageRegistry.getExtensions(languageId);
      return { languageExtensions, languageId };
    };

    resolveLanguage().then(({ languageExtensions }) => {
      if (cancelled) return;
      if (!containerRef.current) return;
      if (openingIdentity !== (currentFileURI || currentFilePath)) return;

      editorRef.current = createTextEditor(containerRef.current, {
        initialContent: fileContentRef.current,
        onContentChange: (content) => {
          if (isBoundToTab && boundTabId) {
            setTabContent(boundTabId, content);
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
        languageExtensions,
        showLineNumbers,
        onOpenSearchPanel: ({ replace }) => {
          searchOverlayRef.current?.open({ replace });
        },
      });

      const reveal = pendingRevealTargetRef.current;
      if (reveal) {
        editorRef.current.scrollToPos(revealTargetToPos(fileContentRef.current, reveal));
        if (!isBoundToTab) {
          workspaceStore.getState().setPendingRevealTarget(null);
        }
      } else if (viewStateIdentity) {
        const cached = loadEditorViewState(viewStateIdentity, 'text');
        if (cached?.kind === 'text') {
          editorRef.current.restoreViewState(cached);
        }
      }

      if (focusEditorIfRequested(editorRef.current)) {
        // Focus request consumed.
      } else if (autoFocus) {
        editorRef.current.focus();
      } else if (!isBoundToTab) {
        setEditorFocused(false);
      }
    });

    return () => {
      cancelled = true;
      if (editorRef.current) {
        if (viewStateIdentity) {
          saveEditorViewState(viewStateIdentity, {
            kind: 'text',
            ...editorRef.current.getViewState(),
          });
        }
        editorRef.current.destroy();
        editorRef.current = null;
      }
      if (!isBoundToTab || workspaceStore.getState().activeTabId === boundTab?.id) {
        setEditorFocused(false);
      }
    };
  }, [autoFocus, boundTabId, currentFileURI, currentFilePath, editorViewStatePath, editorViewStateTabId, editorViewStateURI, focusEditorIfRequested, isBoundToTab, loadEditorViewState, saveEditorViewState, setEditorFocused, setFileContent, setTabContent]);

  useEffect(() => {
    if (!editorFocusRequest) {
      return;
    }
    focusEditorIfRequested(editorRef.current);
  }, [editorFocusRequest, focusEditorIfRequested]);

  useEffect(() => {
    editorRef.current?.setLineNumbersVisible(showLineNumbers);
  }, [showLineNumbers]);

  useEffect(() => {
    if (editorRef.current) {
      const currentContent = editorRef.current.getContent();
      if (currentContent !== fileContent) {
        editorRef.current.setContent(fileContent);
      }
    }
  }, [fileContent]);

  useEffect(() => {
    if (isBoundToTab || !editorRef.current || !pendingRevealTarget) {
      return;
    }
    editorRef.current.scrollToPos(revealTargetToPos(fileContent, pendingRevealTarget));
    setPendingRevealTarget(null);
  }, [fileContent, isBoundToTab, pendingRevealTarget, setPendingRevealTarget]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
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

  return (
    <div className="op-text-editor flex-1 overflow-hidden relative">
      <div
        ref={containerRef}
        className="flex-1 h-full overflow-hidden"
        onKeyDown={handleKeyDown}
      />
      {pinEnabled && (
        <button
          type="button"
          className={`op-text-editor-pin icon-gutter-btn-sm icon-button-inline ${pinned ? 'is-pinned' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            onPinToggle?.();
          }}
          title={pinned ? 'Unpin file' : 'Pin file to right'}
          aria-label={pinned ? 'Unpin file' : 'Pin file to right'}
          aria-pressed={pinned}
        >
          <PinIcon className="h-3.5 w-3.5" />
        </button>
      )}
      <EditorSearchOverlay
        getView={() => editorRef.current?.getView() || null}
        registerHandle={(handle) => {
          searchOverlayRef.current = handle;
        }}
      />
    </div>
  );
};
