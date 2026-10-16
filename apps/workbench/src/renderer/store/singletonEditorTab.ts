export type SingletonEditorTabLike = {
  id: string;
  editorId: string;
};

export function upsertSingletonEditorTab<T extends SingletonEditorTabLike>(
  tabs: readonly T[],
  editorId: string,
  buildTab: () => T,
  options?: {
    removeWelcome?: boolean;
  },
): {
  tabs: T[];
  tab: T;
  existed: boolean;
} {
  const existing = tabs.find((tab) => tab.editorId === editorId);
  if (existing) {
    return {
      tabs: [...tabs],
      tab: existing,
      existed: true,
    };
  }

  const baseTabs = options?.removeWelcome
    ? tabs.filter((tab) => tab.editorId !== 'welcome')
    : [...tabs];
  const tab = buildTab();
  return {
    tabs: [...baseTabs, tab],
    tab,
    existed: false,
  };
}
