import { create } from 'zustand';
import type { SshHost, WorkspaceTabKind } from './tabManagerStore';

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
    open: true,
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
