import { create } from 'zustand';

import {
  getEnabledFileExcludePatterns,
} from '../../shared/fileExcludes';

type FileExcludeState = {
  patterns: string[];
  setFromSettings: (settings: unknown) => void;
};

function readFilesExclude(settings: unknown): unknown {
  if (!settings || typeof settings !== 'object') {
    return undefined;
  }
  const editor = (settings as { editor?: unknown }).editor;
  if (!editor || typeof editor !== 'object') {
    return undefined;
  }
  return (editor as { filesExclude?: unknown }).filesExclude;
}

function patternsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export const useFileExcludeStore = create<FileExcludeState>((set, get) => ({
  patterns: getEnabledFileExcludePatterns(undefined),
  setFromSettings: (settings) => {
    const patterns = getEnabledFileExcludePatterns(readFilesExclude(settings));
    if (patternsEqual(get().patterns, patterns)) {
      return;
    }
    set({ patterns });
  },
}));
