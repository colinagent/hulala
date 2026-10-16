import { rendererI18n } from '../../../i18n/renderer';

export type SidebarBuiltinView = 'workspace' | 'messenger';
export type SidebarView = SidebarBuiltinView | 'search' | 'cron' | `plugin:${string}`;
export type SidebarRailItemKey = SidebarBuiltinView | 'cron';

export type SidebarRailItemDescriptor = {
  key: SidebarRailItemKey;
  label: string;
};

export function getMainSidebarRailItems(): SidebarRailItemDescriptor[] {
  return [
    { key: 'workspace', label: rendererI18n.t('sidebar:rail.folder') },
    { key: 'messenger', label: 'Messenger' },
    { key: 'cron', label: 'Cron' },
  ];
}

export function isMainSidebarRailItemActive(view: SidebarView, itemKey: SidebarRailItemKey): boolean {
  return view === itemKey;
}

export function isMainSidebarRailItemHighlighted(
  view: SidebarView,
  itemKey: SidebarRailItemKey,
  sidebarPanelOpen: boolean,
): boolean {
  return sidebarPanelOpen && isMainSidebarRailItemActive(view, itemKey);
}

export function isSidebarMoreRailActive(view: SidebarView, moreMenuOpen: boolean): boolean {
  return moreMenuOpen;
}

/** Navigation icons (main items plus plugin views) shown before the rail folds. */
export const SIDEBAR_RAIL_ICON_CAPACITY = 5;

export type SidebarRailPluginView = {
  key: string;
  selected: boolean;
};

export type SidebarRailPluginLayout<View extends SidebarRailPluginView> = {
  visible: View[];
  overflow: View[];
  folding: boolean;
};

/**
 * Show every plugin icon while the rail still has room; once main items and
 * plugin views exceed the rail capacity, keep the current plugin visible and
 * fold the remaining plugins behind the expand toggle.
 */
export function planSidebarRailPluginLayout<View extends SidebarRailPluginView>(
  pluginViews: View[],
  mainItemCount: number,
  capacity: number = SIDEBAR_RAIL_ICON_CAPACITY,
): SidebarRailPluginLayout<View> {
  const availableSlots = Math.max(0, capacity - mainItemCount);
  if (pluginViews.length <= availableSlots) {
    return { visible: pluginViews, overflow: [], folding: false };
  }
  const ordered = [...pluginViews.filter((view) => view.selected), ...pluginViews.filter((view) => !view.selected)];
  const visible = ordered.slice(0, availableSlots);
  const visibleKeys = new Set(visible.map((view) => view.key));
  return {
    visible,
    overflow: pluginViews.filter((view) => !visibleKeys.has(view.key)),
    folding: true,
  };
}
