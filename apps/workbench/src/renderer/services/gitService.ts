export interface GitBranch {
  name: string;
  current: boolean;
}

export interface GitDirtySummary {
  changedFiles: number;
  addedLines: number;
  deletedLines: number;
  hasChanges: boolean;
}

export interface GitBranchesResult {
  isRepo: boolean;
  repoRoot?: string;
  currentBranch?: string;
  detached?: boolean;
  detachedLabel?: string;
  branches?: GitBranch[];
  dirty?: GitDirtySummary;
  error?: string;
}

export interface GitCheckoutResult {
  repoRoot?: string;
  currentBranch?: string;
  error?: string;
}

class GitService {
  constructor(private tabId: string) {}

  async getBranches(path: string): Promise<GitBranchesResult> {
    try {
      const result = await window.hulala!.desktop.git.branches(this.tabId, path) as {
        workspace: { path: string };
        branches: { current: string; branches: string[]; isRepo?: boolean };
        status: { changes: string[] };
      };
      if (result.branches.isRepo === false) return { isRepo: false };
      return {
        isRepo: true,
        repoRoot: result.workspace.path,
        currentBranch: result.branches.current,
        branches: result.branches.branches.map((name) => ({ name, current: name === result.branches.current })),
        dirty: { changedFiles: result.status.changes.length, addedLines: 0, deletedLines: 0, hasChanges: result.status.changes.length > 0 },
      };
    } catch (error) {
      return { isRepo: false, error: (error as Error).message };
    }
  }

  async checkout(params: { path: string; branch: string; create?: boolean }): Promise<GitCheckoutResult> {
    try {
      const result = await window.hulala!.desktop.git.checkout(this.tabId, params) as { workspace: { path: string }; branch: string };
      return { repoRoot: result.workspace.path, currentBranch: result.branch };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }
}

export function createGitService(tabId: string) {
  return new GitService(tabId);
}

export type { GitService };
