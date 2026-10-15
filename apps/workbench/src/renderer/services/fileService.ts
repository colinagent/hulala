import type { FileChange } from './desktopConnection';

export type { FileChange };

export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modTime: number;
}

export interface StatResult {
  path: string;
  name: string;
  size: number;
  isDir: boolean;
  modTime: number;
  mode: number;
}

export interface ReadFileResult {
  version?: string;
  content?: string;
  encoding?: string;
  size?: number;
  tooLarge?: boolean;
  error?: string;
}

export interface WriteFileResult {
  version?: string;
  conflict?: boolean;
  path?: string;
  size?: number;
  modTime?: number;
  error?: string;
}

export interface ReaddirResult {
  path?: string;
  entries?: FileEntry[];
  error?: string;
}

export interface SearchMatch {
  line: number;
  column: number;
  endColumn: number;
  text: string;
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
  count: number;
}

export interface SearchResult {
  files?: SearchFileResult[];
  totalCount?: number;
  truncated?: boolean;
  error?: string;
}

export interface WriteFileOptions {
  expectedVersion?: string | null;
  encoding?: string;
  create?: boolean;
  overwrite?: boolean;
  atomic?: boolean;
}

export function fileServiceErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || 'File operation failed');
  const message = raw.replace(/^Error invoking remote method '[^']+': Error:\s*/i, '').trim();
  if (/symlink escapes the workspace|path.*outside.*workspace/i.test(message)) {
    return 'This path is outside the selected workspace.';
  }
  return message || 'File operation failed';
}

class FileService {
  constructor(private tabId: string) {}

  async stat(path: string): Promise<StatResult & { error?: string }> {
    try {
      const result = await window.hulala!.desktop.files.stat(this.tabId, path) as StatResult;
      return result;
    } catch (error) {
      return { error: fileServiceErrorMessage(error) } as StatResult & { error: string };
    }
  }

  async readFile(path: string, options?: { encoding?: string; limits?: { size: number } }): Promise<ReadFileResult> {
    try {
      const result = await window.hulala!.desktop.files.readText(this.tabId, path) as { content: string; version: string };
      if (options?.limits?.size && new TextEncoder().encode(result.content).byteLength > options.limits.size) {
        return { tooLarge: true };
      }
      return { ...result, encoding: 'utf8', size: new TextEncoder().encode(result.content).byteLength };
    } catch (error) {
      return { error: fileServiceErrorMessage(error) };
    }
  }

  async writeFile(path: string, content: string, options?: WriteFileOptions): Promise<WriteFileResult> {
    try {
      if (options?.encoding === 'base64') throw new Error('Binary files must use the resource upload service.');
      const result = await window.hulala!.desktop.files.writeText(this.tabId, path, content, options?.expectedVersion ?? null);
      return { ...result, path, size: new TextEncoder().encode(content).byteLength, modTime: Date.now() };
    } catch (error) {
      return { error: fileServiceErrorMessage(error), conflict: (error as { code?: string }).code === 'file_conflict' };
    }
  }

  async readdir(path: string): Promise<ReaddirResult> {
    try {
      const result = await window.hulala!.desktop.files.readdir(this.tabId, path) as ReaddirResult;
      return result;
    } catch (error) {
      return { error: fileServiceErrorMessage(error) };
    }
  }

  async search(params: {
    root: string;
    query: string;
    regex?: boolean;
    matchCase?: boolean;
    wholeWord?: boolean;
    includes?: string[];
    excludes?: string[];
    maxFiles?: number;
    maxMatches?: number;
  }): Promise<SearchResult> {
    try {
      const result = await window.hulala!.desktop.files.search(this.tabId, params.root, params.query, params.maxMatches, params) as { items?: Array<{ path: string; line: number; text: string }> };
      const grouped = new Map<string, SearchMatch[]>();
      for (const item of result.items || []) {
        const matches = grouped.get(item.path) || [];
        matches.push({ line: item.line, column: 1, endColumn: Math.max(1, item.text.length + 1), text: item.text });
        grouped.set(item.path, matches);
      }
      return { files: [...grouped].map(([path, matches]) => ({ path, matches, count: matches.length })), totalCount: result.items?.length || 0, truncated: (result.items?.length || 0) >= (params.maxMatches || 200) };
    } catch (error) {
      return { error: fileServiceErrorMessage(error) };
    }
  }

  async mkdir(path: string, recursive: boolean = true): Promise<{ success?: boolean; error?: string }> {
    try {
      await window.hulala!.desktop.files.mkdir(this.tabId, path);
      return { success: true };
    } catch (error) {
      return { error: fileServiceErrorMessage(error) };
    }
  }

  async delete(
    path: string,
    recursive: boolean = false,
    useTrash: boolean = false
  ): Promise<{ success?: boolean; error?: string }> {
    try {
      await window.hulala!.desktop.files.delete(this.tabId, path);
      return { success: true };
    } catch (error) {
      return { error: fileServiceErrorMessage(error) };
    }
  }

  async rename(oldPath: string, newPath: string, overwrite: boolean = false): Promise<{ success?: boolean; error?: string; versionBefore?: string; versionAfter?: string }> {
    try {
      const result = await window.hulala!.desktop.files.move(this.tabId, oldPath, newPath, false);
      return { ...result, success: true };
    } catch (error) {
      return { error: fileServiceErrorMessage(error) };
    }
  }

  async copy(source: string, target: string, overwrite: boolean = false): Promise<{ success?: boolean; error?: string }> {
    try {
      await window.hulala!.desktop.files.move(this.tabId, source, target, true);
      return { success: true };
    } catch (error) {
      return { error: fileServiceErrorMessage(error) };
    }
  }

  async watch(path: string, recursive: boolean = false, excludes?: string[]): Promise<{ watchId?: string; error?: string }> {
    try {
      return { watchId: `${this.tabId}:${path}:${recursive}:${excludes?.join(',') || ''}` };
    } catch (error) {
      return { error: fileServiceErrorMessage(error) };
    }
  }

  async unwatch(watchId: string): Promise<{ success?: boolean; error?: string }> {
    try {
      return { success: true };
    } catch (error) {
      return { error: fileServiceErrorMessage(error) };
    }
  }
}

export function createFileService(tabId: string) {
  return new FileService(tabId);
}
