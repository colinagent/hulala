export type EditorPaneName = 'main' | 'right';

export type PaneDocumentLike = {
  id: string;
  filePath?: string;
  pane?: EditorPaneName;
};

export type MovePaneDocumentResult<T extends PaneDocumentLike> = {
  documents: T[];
  moved: T;
  sourcePane: EditorPaneName;
  sourceFallbackId?: string;
};

function paneOf(document: PaneDocumentLike): EditorPaneName {
  return document.pane === 'right' ? 'right' : 'main';
}
export function movePaneDocument<T extends PaneDocumentLike>(
  documents: readonly T[],
  tabId: string,
  targetPane: EditorPaneName,
): MovePaneDocumentResult<T> | null {
  const normalizedId = tabId.trim();
  const target = documents.find((document) => document.id === normalizedId);
  if (!target || !(target.filePath || '').trim()) {
    return null;
  }
  const sourcePane = paneOf(target);
  if (sourcePane === targetPane) {
    return {
      documents: [...documents],
      moved: target,
      sourcePane,
      sourceFallbackId: target.id,
    };
  }

  const sourceTabs = documents.filter((document) => paneOf(document) === sourcePane);
  const sourceIndex = sourceTabs.findIndex((document) => document.id === normalizedId);
  const nextDocuments = documents.map((document) =>
    document.id === normalizedId
      ? { ...document, pane: targetPane }
      : document,
  );
  const remainingSourceTabs = nextDocuments.filter((document) => paneOf(document) === sourcePane);
  const sourceFallback = remainingSourceTabs[sourceIndex]
    || remainingSourceTabs[sourceIndex - 1]
    || remainingSourceTabs[0];
  const moved = nextDocuments.find((document) => document.id === normalizedId);
  if (!moved) return null;
  return {
    documents: nextDocuments,
    moved,
    sourcePane,
    sourceFallbackId: sourceFallback?.id,
  };
}
