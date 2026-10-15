import { create } from 'zustand';

import type { FileTreeTransferItem } from './fileTreeTransfer';

type ScopeState = {
  selection: Set<string>;
  anchor: string | null;
  dragItems: FileTreeTransferItem[] | null;
  dropTargetPath: string | null;
};

type FileTreeSelectionStoreState = {
  scopes: Record<string, ScopeState>;
  ensureScope: (scopeId: string) => void;
  destroyScope: (scopeId: string) => void;
  select: (scopeId: string, path: string, mode: 'replace' | 'toggle' | 'range', visiblePaths?: string[]) => void;
  replaceSelection: (scopeId: string, paths: string[], anchor?: string | null) => void;
  ensureSelected: (scopeId: string, path: string) => void;
  clearSelection: (scopeId: string) => void;
  clearAllSelections: () => void;
  setDragItems: (scopeId: string, items: FileTreeTransferItem[] | null) => void;
  setDropTargetPath: (scopeId: string, path: string | null) => void;
};

function getOrCreateScope(state: FileTreeSelectionStoreState, scopeId: string): ScopeState {
  return state.scopes[scopeId] || {
    selection: new Set<string>(),
    anchor: null,
    dragItems: null,
    dropTargetPath: null,
  };
}

export const useFileTreeSelectionStore = create<FileTreeSelectionStoreState>((set, get) => ({
  scopes: {},

  ensureScope(scopeId) {
    if (!scopeId || get().scopes[scopeId]) return;
    set((state) => ({
      scopes: {
        ...state.scopes,
        [scopeId]: getOrCreateScope(state, scopeId),
      },
    }));
  },

  destroyScope(scopeId) {
    set((state) => {
      if (!state.scopes[scopeId]) return state;
      const nextScopes = { ...state.scopes };
      delete nextScopes[scopeId];
      return { scopes: nextScopes };
    });
  },

  select(scopeId, path, mode, visiblePaths) {
    if (!scopeId || !path) return;
    set((state) => {
      const scope = getOrCreateScope(state, scopeId);

      if (mode === 'replace') {
        return {
          scopes: {
            ...state.scopes,
            [scopeId]: {
              ...scope,
              selection: new Set([path]),
              anchor: path,
            },
          },
        };
      }

      if (mode === 'toggle') {
        const next = new Set(scope.selection);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return {
          scopes: {
            ...state.scopes,
            [scopeId]: {
              ...scope,
              selection: next,
              anchor: path,
            },
          },
        };
      }

      if (scope.anchor && visiblePaths && visiblePaths.length > 0) {
        const anchorIndex = visiblePaths.indexOf(scope.anchor);
        const targetIndex = visiblePaths.indexOf(path);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const lo = Math.min(anchorIndex, targetIndex);
          const hi = Math.max(anchorIndex, targetIndex);
          const next = new Set<string>();
          for (let index = lo; index <= hi; index += 1) {
            next.add(visiblePaths[index]);
          }
          return {
            scopes: {
              ...state.scopes,
              [scopeId]: {
                ...scope,
                selection: next,
              },
            },
          };
        }
      }

      return {
        scopes: {
          ...state.scopes,
          [scopeId]: {
            ...scope,
            selection: new Set([path]),
            anchor: path,
          },
        },
      };
    });
  },

  replaceSelection(scopeId, paths, anchor) {
    if (!scopeId) return;
    set((state) => {
      const scope = getOrCreateScope(state, scopeId);
      return {
        scopes: {
          ...state.scopes,
          [scopeId]: {
            ...scope,
            selection: new Set(paths.filter(Boolean)),
            anchor: anchor ?? paths[0] ?? null,
          },
        },
      };
    });
  },

  ensureSelected(scopeId, path) {
    if (!scopeId || !path) return;
    set((state) => {
      const scope = getOrCreateScope(state, scopeId);
      if (scope.selection.has(path) && scope.selection.size > 0) {
        return state;
      }
      return {
        scopes: {
          ...state.scopes,
          [scopeId]: {
            ...scope,
            selection: new Set([path]),
            anchor: path,
          },
        },
      };
    });
  },

  clearSelection(scopeId) {
    if (!scopeId) return;
    set((state) => {
      const scope = getOrCreateScope(state, scopeId);
      if (scope.selection.size === 0 && !scope.anchor) return state;
      return {
        scopes: {
          ...state.scopes,
          [scopeId]: {
            ...scope,
            selection: new Set(),
            anchor: null,
          },
        },
      };
    });
  },

  clearAllSelections() {
    set((state) => {
      let changed = false;
      const nextScopes: Record<string, ScopeState> = {};
      for (const [scopeId, scope] of Object.entries(state.scopes)) {
        if (scope.selection.size === 0 && !scope.anchor && !scope.dropTargetPath) {
          nextScopes[scopeId] = scope;
          continue;
        }
        changed = true;
        nextScopes[scopeId] = {
          ...scope,
          selection: new Set(),
          anchor: null,
          dropTargetPath: null,
        };
      }
      return changed ? { scopes: nextScopes } : state;
    });
  },

  setDragItems(scopeId, items) {
    if (!scopeId) return;
    set((state) => {
      const scope = getOrCreateScope(state, scopeId);
      return {
        scopes: {
          ...state.scopes,
          [scopeId]: {
            ...scope,
            dragItems: items,
          },
        },
      };
    });
  },

  setDropTargetPath(scopeId, path) {
    if (!scopeId) return;
    set((state) => {
      const scope = getOrCreateScope(state, scopeId);
      if (scope.dropTargetPath === path) return state;
      return {
        scopes: {
          ...state.scopes,
          [scopeId]: {
            ...scope,
            dropTargetPath: path,
          },
        },
      };
    });
  },
}));
