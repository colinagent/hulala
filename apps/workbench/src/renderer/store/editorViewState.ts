export type EditorViewStateKind = 'markdown' | 'text' | 'epub' | 'pdf' | 'word';

export type CodeMirrorEditorViewState = {
  kind: 'markdown' | 'text';
  selectionAnchor: number;
  selectionHead: number;
  scrollTop: number;
  scrollLeft: number;
  selectionHeadViewportOffsetTop?: number;
  scrollAnchorPos?: number;
  scrollAnchorOffsetTop?: number;
};

export type EpubEditorViewState = {
  kind: 'epub';
  locator: string;
  cfi: string;
  href: string;
  percentage: number | null;
};

export type PdfEditorViewState = {
  kind: 'pdf';
  page: number;
  displayMode: 'fit-page' | 'custom';
  customZoom: number;
  scrollTop: number;
  scrollLeft: number;
};

export type EditorViewState =
  | CodeMirrorEditorViewState
  | EpubEditorViewState
  | PdfEditorViewState
  | { kind: 'word'; page: number; scrollTop: number; zoom: number };

export type EditorViewStateIdentity = {
  tabId: string;
  uri?: string | null;
  filePath?: string | null;
};

type SaveEditorViewStateOptions = {
  tabOpen?: boolean;
};

function normalizedTabId(identity: EditorViewStateIdentity): string {
  return identity.tabId.trim();
}

function resourceKey(identity: EditorViewStateIdentity): string {
  // The memento is Workspace-owned. Paths survive a Host instance restart.
  const filePath = (identity.filePath || '').trim();
  if (filePath) return `path:${filePath}`;
  const uri = (identity.uri || '').trim();
  if (uri) {
    return `uri:${uri}`;
  }
  return '';
}

function validViewState(value: unknown): value is EditorViewState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  const number = (key: string) => typeof state[key] === 'number' && Number.isFinite(state[key]);
  if (state.kind === 'markdown' || state.kind === 'text') return ['selectionAnchor', 'selectionHead', 'scrollTop', 'scrollLeft'].every(number);
  if (state.kind === 'pdf') return ['page', 'customZoom', 'scrollTop', 'scrollLeft'].every(number) && ['fit-page', 'custom'].includes(String(state.displayMode));
  if (state.kind === 'word') return ['page', 'scrollTop', 'zoom'].every(number) && Number(state.page) >= 1 && Number(state.scrollTop) >= 0 && Number(state.zoom) >= 0.25 && Number(state.zoom) <= 5;
  if (state.kind === 'epub') return ['locator', 'cfi', 'href'].every(key => typeof state[key] === 'string' && (state[key] as string).length < 32768) && (state.percentage === null || number('percentage'));
  return false;
}

function copyViewState<T extends EditorViewState>(state: T): T {
  return { ...state };
}

/**
 * Workspace-owned, runtime-only editor view-state storage.
 *
 * Tab entries preserve state while an open tab is retargeted. Resource entries
 * preserve it when a file tab is closed and reopened during the same app run.
 */
export class EditorViewStateMemento {
  private readonly tabStates = new Map<string, EditorViewState>();
  private readonly resourceStates = new Map<string, EditorViewState>();
  private readonly resourceLimit: number;

  constructor(resourceLimit = 200, private readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, private readonly storageKey = 'hulala.editor-positions') {
    this.resourceLimit = resourceLimit;
    try {
      const saved: unknown = JSON.parse(storage?.getItem(storageKey) || '[]');
      if (Array.isArray(saved)) for (const item of saved.slice(-resourceLimit)) {
        if (Array.isArray(item) && typeof item[0] === 'string' && validViewState(item[1])) this.resourceStates.set(item[0], item[1]);
      }
    } catch { /* A corrupt optional view preference must not block the editor. */ }
  }

  save(
    identity: EditorViewStateIdentity,
    state: EditorViewState,
    options: SaveEditorViewStateOptions = {},
  ): void {
    const tabId = normalizedTabId(identity);
    if (tabId) {
      if (options.tabOpen === false) {
        this.tabStates.delete(tabId);
      } else {
        this.tabStates.set(tabId, copyViewState(state));
      }
    }

    const key = resourceKey(identity);
    if (!key || this.resourceLimit <= 0) {
      return;
    }
    this.resourceStates.delete(key);
    this.resourceStates.set(key, copyViewState(state));
    while (this.resourceStates.size > this.resourceLimit) {
      const oldestKey = this.resourceStates.keys().next().value;
      if (typeof oldestKey !== 'string') {
        break;
      }
      this.resourceStates.delete(oldestKey);
    }
    try { this.storage?.setItem(this.storageKey, JSON.stringify([...this.resourceStates])); } catch { /* Draft durability is handled separately. */ }
  }

  load(
    identity: EditorViewStateIdentity,
    kind: EditorViewStateKind,
  ): EditorViewState | null {
    const tabId = normalizedTabId(identity);
    const tabState = tabId ? this.tabStates.get(tabId) : undefined;
    if (tabState?.kind === kind) {
      return copyViewState(tabState);
    }

    const key = resourceKey(identity);
    const resourceState = key ? this.resourceStates.get(key) : undefined;
    if (!resourceState || resourceState.kind !== kind) {
      return null;
    }
    this.resourceStates.delete(key);
    this.resourceStates.set(key, resourceState);
    if (tabId) {
      this.tabStates.set(tabId, copyViewState(resourceState));
    }
    return copyViewState(resourceState);
  }

  forgetTab(tabId: string): void {
    this.tabStates.delete(tabId.trim());
  }

  clear(options: { persistent?: boolean } = {}): void {
    this.tabStates.clear();
    this.resourceStates.clear();
    if (options.persistent !== false) this.storage?.removeItem(this.storageKey);
  }
}
