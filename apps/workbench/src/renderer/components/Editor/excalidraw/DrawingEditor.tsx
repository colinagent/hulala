import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore, useWorkspaceStoreApi, type WorkspaceStore } from '../../../store/appStore';
import { useTabManagerStore } from '../../../store/tabManagerStore';
import { useUiStore } from '../../../store/uiStore';
import { tokenValueToRgb } from '../../../theme/tokens';
import { readStaticGlassVariables } from '../../staticGlassCapsule';
import { DrawingCanvasFrame } from './DrawingCanvasFrame';
import type { DrawingFrameController } from './drawingFrameContract';
import { invalidateDrawingPreview } from './drawingPreview';
import './excalidraw.css';

type DrawingDocument = { id: string; filePath?: string; content: string; isDirty: boolean };

export function DrawingDocumentEditor({ document: drawing, workspace, autoFocus = false }: {
  document: DrawingDocument;
  workspace: WorkspaceStore;
  autoFocus?: boolean;
}) {
  const { t, i18n } = useTranslation('dialog');
  const theme = useUiStore((state) => state.theme);
  const staticGlass = useMemo(() => readStaticGlassVariables(), [theme]);
  const frameRef = useRef<DrawingFrameController | null>(null);
  const lastContentRef = useRef(drawing.content);
  const [source, setSource] = useState({ content: drawing.content, revision: 0 });
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Store echoes of our own edits must not recreate the canvas or undo stack.
    // A genuine file reload starts a fresh scene with the new file contents.
    if (drawing.content === lastContentRef.current) return;
    lastContentRef.current = drawing.content;
    setReady(false);
    setError('');
    setSource((current) => ({ content: drawing.content, revision: current.revision + 1 }));
  }, [drawing.content]);

  useEffect(() => {
    if (!drawing.isDirty && drawing.filePath) invalidateDrawingPreview(workspace, drawing.filePath);
  }, [drawing.isDirty, drawing.filePath, workspace]);

  const syncContent = (commitText: boolean) => {
    const frame = frameRef.current;
    if (!frame) return;
    const content = frame.serialize(commitText);
    lastContentRef.current = content;
    workspace.getState().setTabContent(drawing.id, content);
    if (drawing.filePath) invalidateDrawingPreview(workspace, drawing.filePath);
  };
  const save = async () => {
    if (!ready || savingRef.current || !drawing.filePath) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      syncContent(true);
      if (!await workspace.getState().saveTabByPath(drawing.filePath, drawing.id)) throw new Error('saveFailed');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'saveFailed');
    } finally { savingRef.current = false; setSaving(false); }
  };
  const errorKey = ['invalidFile', 'readFailed', 'saveFailed', 'conflict'].includes(error) ? error : 'loadFailed';

  return <div className="hulala-drawing-file-editor">
    <div className="hulala-drawing-canvas">
      <DrawingCanvasFrame key={source.revision}
        title={drawing.filePath?.split('/').pop() || 'Drawing'}
        controllerRef={frameRef}
        content={source.content}
        active
        autoFocus={autoFocus}
        editorBackground={tokenValueToRgb(theme.tokens.editorBg)}
        theme={theme.scheme}
        staticGlass={staticGlass}
        saving={saving}
        langCode={i18n.language.startsWith('zh') ? 'zh-CN' : 'en'}
        platform={window.hulala?.platform}
        onReady={() => setReady(true)}
        onDirty={() => syncContent(false)}
        onError={setError}
        onSave={() => void save()}
        onWorkspaceShortcut={(index) => {
          const state = useTabManagerStore.getState();
          const tab = state.tabs[index];
          if (tab) state.setActiveTab(tab.id);
        }}
      />
    </div>
    <footer className="hulala-drawing-footer">
      <div className="hulala-drawing-feedback" role={error ? 'alert' : 'status'}>
        {error ? t(`excalidraw.${errorKey}`) : !ready ? t('excalidraw.loading') : drawing.isDirty ? t('excalidraw.unsaved') : t('excalidraw.localFile')}
      </div>
      <button type="button" disabled={!ready || saving} onClick={() => void save()}>
        {t(saving ? 'excalidraw.saving' : 'excalidraw.save')}
      </button>
    </footer>
  </div>;
}

export function DrawingEditor({ tabId, autoFocus = false }: { tabId?: string; autoFocus?: boolean }) {
  const workspace = useWorkspaceStoreApi();
  const drawing = useAppStore((state) => state.documents.find((item) => item.id === (tabId ?? state.activeTabId)));
  return drawing ? <DrawingDocumentEditor key={drawing.id} document={drawing} workspace={workspace} autoFocus={autoFocus} /> : null;
}
