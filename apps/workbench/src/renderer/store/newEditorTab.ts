export const NEW_TAB_TITLE = 'New Tab';

export type NewEditorTabLike = {
  id: string;
  title: string;
  filePath?: string;
  editorId: string;
  content: string;
};

export function isBlankNewTab(tab: NewEditorTabLike | null | undefined): boolean {
  if (!tab) {
    return false;
  }
  return !tab.filePath
    && tab.editorId === 'markdown'
    && tab.title === NEW_TAB_TITLE
    && tab.content === '';
}

export function retargetActiveBlankNewTab<T extends NewEditorTabLike>(
  tabs: readonly T[],
  activeTabId: string | undefined,
  updater: (tab: T) => T,
): {
  tabs: T[];
  tab: T | null;
  retargeted: boolean;
} {
  const target = tabs.find((tab) => tab.id === activeTabId);
  if (!target || !isBlankNewTab(target)) {
    return {
      tabs: [...tabs],
      tab: null,
      retargeted: false,
    };
  }

  let nextTab: T | null = null;
  const nextTabs = tabs.map((tab) => {
    if (tab.id !== target.id) {
      return tab;
    }
    nextTab = updater(tab);
    return nextTab;
  });

  return {
    tabs: nextTabs,
    tab: nextTab,
    retargeted: Boolean(nextTab),
  };
}
