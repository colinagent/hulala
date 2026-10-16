/**
 * Promise-based bridge that lets zustand store actions await a React save-file dialog.
 *
 * Flow:
 *   1. Store calls `requestSaveFileDialog(options)` — returns a Promise<string | null>
 *   2. React component sees the request via `useSaveFileDialogRequest()` and renders the dialog
 *   3. User picks a path → component calls `resolveSaveFileDialog(path)`
 *   4. User cancels   → component calls `resolveSaveFileDialog(null)`
 *   5. The promise from step 1 resolves
 */

import { create } from 'zustand';

export type SaveFileDialogRequest = {
  workspaceViewId?: string;
  defaultDir: string | null;
  defaultFileName: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

type SaveFileDialogState = {
  request: SaveFileDialogRequest | null;
};

const useSaveFileDialogStore = create<SaveFileDialogState>(() => ({
  request: null,
}));

let pendingResolve: ((filePath: string | null) => void) | null = null;

export function requestSaveFileDialog(options: SaveFileDialogRequest): Promise<string | null> {
  // Cancel any existing pending request
  if (pendingResolve) {
    pendingResolve(null);
    pendingResolve = null;
  }

  return new Promise<string | null>((resolve) => {
    pendingResolve = resolve;
    useSaveFileDialogStore.setState({ request: options });
  });
}

export function resolveSaveFileDialog(filePath: string | null): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  useSaveFileDialogStore.setState({ request: null });
  resolve?.(filePath);
}

export function useSaveFileDialogRequest(): SaveFileDialogRequest | null {
  return useSaveFileDialogStore((state) => state.request);
}
