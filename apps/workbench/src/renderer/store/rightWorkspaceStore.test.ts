import { beforeEach, describe, expect, test } from 'bun:test';
import { rightWorkspaceFileKey, useRightWorkspaceStore } from './rightWorkspaceStore';

beforeEach(() => {
  useRightWorkspaceStore.setState({
    open: false,
    files: [],
    activeTabKey: undefined,
    outlineOpen: false,
    activityPinned: false,
  });
});

describe('fixed right workspace', () => {
  test('keeps files from multiple source workspaces', () => {
    const first = { workspaceTabId: 'workspace-a', tabId: 'a' };
    const second = { workspaceTabId: 'workspace-b', tabId: 'b' };
    useRightWorkspaceStore.getState().addFile(first);
    useRightWorkspaceStore.getState().addFile(second);
    expect(useRightWorkspaceStore.getState().files).toEqual([first, second]);
    expect(useRightWorkspaceStore.getState().activeTabKey).toBe(rightWorkspaceFileKey(second));
  });

  test('manual close changes only visibility and preserves right-side tabs', () => {
    const file = { workspaceTabId: 'workspace-a', tabId: 'a' };
    useRightWorkspaceStore.getState().addFile(file);
    useRightWorkspaceStore.getState().setOpen(false);
    expect(useRightWorkspaceStore.getState().open).toBe(false);
    expect(useRightWorkspaceStore.getState().files).toEqual([file]);
  });
});
