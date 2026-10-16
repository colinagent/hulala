import { create } from 'zustand';
import { sessionStore } from '../../platform/storage';
import type { SshHost, WorkspaceTabKind } from './tabManagerStore';

// sessionStorage scopes layout to this browser tab and Workspace, including
// when the same Workspace is open in two separate tabs.
const visibilityKey = typeof window === 'undefined'
  ? null
  : 'hulala.right-pane.open.' + window.location.pathname;
let restoringVisibility = false;

export function beginRightWorkspaceRestore(): () => void {
  const saved = visibilityKey ? sessionStore.getItem(visibilityKey) : null;
  restoringVisibility = saved === 'true' || saved === 'false';
  if (restoringVisibility) useRightWorkspaceStore.setState({ open: saved === 'true' });
  return () => { restoringVisibility = false; };
}

export type RightWorkspaceFileRef = {
  workspaceTabId: string;
  tabId: string;
  source?: {
    kind: WorkspaceTabKind;
    workspacePath?: string;
    remoteHost?: SshHost;
    label?: string;
    workspaceId?: string;
  };
};

export type RightWorkspaceTabKey = 'outline' | 'activity' | `file:${string}:${string}`;

export function rightWorkspaceFileKey(ref: RightWorkspaceFileRef): `file:${string}:${string}` {
  return `file:${ref.workspaceTabId}:${ref.tabId}`;
}

type RightWorkspaceState = {
  open: boolean;
  files: RightWorkspaceFileRef[];
  activeTabKey?: RightWorkspaceTabKey;
  outlineOpen: boolean;
  activityPinned: boolean;
  setOpen: (open: boolean) => void;
  addFile: (ref: RightWorkspaceFileRef) => void;
  removeFile: (ref: RightWorkspaceFileRef) => void;
  selectTab: (key: RightWorkspaceTabKey) => void;
  openOutline: () => void;
  closeOutline: () => void;
  setActivityPinned: (pinned: boolean) => void;
  removeWorkspace: (workspaceTabId: string) => void;
};

function sameFile(left: RightWorkspaceFileRef, right: RightWorkspaceFileRef): boolean {
  return left.workspaceTabId === right.workspaceTabId && left.tabId === right.tabId;
}

function fallbackKey(
  files: RightWorkspaceFileRef[],
  outlineOpen: boolean,
  activityPinned: boolean,
): RightWorkspaceTabKey | undefined {
  const lastFile = files.at(-1);
  if (lastFile) return rightWorkspaceFileKey(lastFile);
  if (outlineOpen) return 'outline';
  if (activityPinned) return 'activity';
  return undefined;
}

export const useRightWorkspaceStore = create<RightWorkspaceState>((set) => ({
  open: false,
  files: [],
  activeTabKey: undefined,
  outlineOpen: false,
  activityPinned: false,
  setOpen: (open) => set({ open }),
  addFile: (ref) => set((state) => ({
    // Restoring retained files must not undo the user's collapsed layout.
    open: restoringVisibility ? state.open : true,
    files: state.files.some((existing) => sameFile(existing, ref))
      ? state.files.map(existing => sameFile(existing, ref) ? { ...existing, ...ref } : existing)
      : [...state.files, ref],
    activeTabKey: rightWorkspaceFileKey(ref),
  })),
  removeFile: (ref) => set((state) => {
    const files = state.files.filter((existing) => !sameFile(existing, ref));
    const key = rightWorkspaceFileKey(ref);
    return {
      files,
      activeTabKey: state.activeTabKey === key
        ? fallbackKey(files, state.outlineOpen, state.activityPinned)
        : state.activeTabKey,
    };
  }),
  selectTab: (activeTabKey) => set({ open: true, activeTabKey }),
  openOutline: () => set({ open: true, outlineOpen: true, activeTabKey: 'outline' }),
  closeOutline: () => set((state) => ({
    outlineOpen: false,
    activeTabKey: state.activeTabKey === 'outline'
      ? fallbackKey(state.files, false, state.activityPinned)
      : state.activeTabKey,
  })),
  setActivityPinned: (activityPinned) => set((state) => ({
    open: activityPinned ? true : state.open,
    activityPinned,
    activeTabKey: activityPinned
      ? 'activity'
      : state.activeTabKey === 'activity'
        ? fallbackKey(state.files, state.outlineOpen, false)
        : state.activeTabKey,
  })),
  removeWorkspace: (workspaceTabId) => set((state) => {
    const files = state.files.filter((ref) => ref.workspaceTabId !== workspaceTabId);
    const activeStillExists = state.activeTabKey?.startsWith(`file:${workspaceTabId}:`) !== true;
    return {
      files,
      activeTabKey: activeStillExists
        ? state.activeTabKey
        : fallbackKey(files, state.outlineOpen, state.activityPinned),
    };
  }),
}));

useRightWorkspaceStore.subscribe((state, previous) => {
  if (visibilityKey && state.open !== previous.open) {
    sessionStore.setItem(visibilityKey, String(state.open));
  }
});
