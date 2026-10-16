import type { CSSProperties } from 'react';

export const TAB_PREFERRED_WIDTH = 160;
export const TAB_MIN_WIDTH = 52;
export const TAB_MAX_WIDTH = TAB_PREFERRED_WIDTH;

export const TAB_ITEM_FLEX_STYLE: CSSProperties = {
  flex: `0 1 ${TAB_PREFERRED_WIDTH}px`,
  width: TAB_PREFERRED_WIDTH,
  minWidth: TAB_MIN_WIDTH,
  maxWidth: TAB_MAX_WIDTH,
};

export const WORKSPACE_TAB_PREFERRED_WIDTH = 136;

export const WORKSPACE_TAB_ITEM_FLEX_STYLE: CSSProperties = {
  ...TAB_ITEM_FLEX_STYLE,
  flex: `0 1 ${WORKSPACE_TAB_PREFERRED_WIDTH}px`,
  width: WORKSPACE_TAB_PREFERRED_WIDTH,
  maxWidth: WORKSPACE_TAB_PREFERRED_WIDTH,
};

export const TAB_SHELL_CLASS =
  'tab-hover-shell group relative flex h-[30px] self-center items-center overflow-hidden rounded-full px-3 bg-transparent';
export const TAB_CLOSE_BUTTON_CLASS =
  'tab-close-btn absolute inset-y-0 right-1 z-10 my-auto';
export const TAB_CLOSE_BUTTON_DELAYED_REVEAL_CLASS = 'tab-close-btn-delayed';
export const TAB_ICON_HOVER_LIFT_CLASS = 'tab-icon-hover-lift';
export const TAB_CLOSE_BUTTON_BACKGROUND_SYNC_CLASS =
  'tab-hover-bg-sync';

export function getTabShellClassName(isActive: boolean, extraClassName = ''): string {
  return [
    TAB_SHELL_CLASS,
    isActive ? 'tab-active-shell text-brand' : 'text-secondary-text',
    extraClassName,
  ]
    .filter(Boolean)
    .join(' ');
}

export function getTabCloseButtonClassName(
  backgroundClassName: string,
  extraClassName = '',
): string {
  return [
    TAB_CLOSE_BUTTON_CLASS,
    TAB_ICON_HOVER_LIFT_CLASS,
    backgroundClassName,
    TAB_CLOSE_BUTTON_BACKGROUND_SYNC_CLASS,
    extraClassName,
  ]
    .filter(Boolean)
    .join(' ');
}

export const ACTIVE_TAB_LABEL_CLASS = 'text-brand';
