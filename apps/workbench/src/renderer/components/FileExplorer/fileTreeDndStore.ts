/**
 * fileTreeDndStore.ts
 *
 * Global clipboard for sidebar file trees.
 * Selection and hover/drop state stay local to each tree instance so hidden sidebars
 * do not keep surprising ghost selections, while clipboard remains cross-workspace.
 */
import { create } from 'zustand';

export type FileTreeClipboardMode = 'copy' | 'cut';

export type FileTreeClipboardItem = {
  path: string;
  isDir: boolean;
};

type FileTreeDndState = {
  clipboardItems: FileTreeClipboardItem[];
  clipboardMode: FileTreeClipboardMode | null;
  dragItems: FileTreeClipboardItem[];
  setClipboard: (items: FileTreeClipboardItem[], mode: FileTreeClipboardMode) => void;
  clearClipboard: () => void;
  setDragItems: (items: FileTreeClipboardItem[]) => void;
  clearDragItems: () => void;
};

export const useFileTreeDndStore = create<FileTreeDndState>((set) => ({
  clipboardItems: [],
  clipboardMode: null,
  dragItems: [],
  setClipboard: (items, mode) => set({ clipboardItems: items, clipboardMode: mode }),
  clearClipboard: () => set({ clipboardItems: [], clipboardMode: null }),
  setDragItems: (items) => set({ dragItems: items }),
  clearDragItems: () => set({ dragItems: [] }),
}));
