import type { DisplayLocale } from './locales';

import enCommon from '../../locales/en/common.json';
import enMenu from '../../locales/en/menu.json';
import enSidebar from '../../locales/en/sidebar.json';
import enShell from '../../locales/en/shell.json';
import enDialog from '../../locales/en/dialog.json';
import enSettings from '../../locales/en/settings.json';
import enError from '../../locales/en/error.json';

import zhCommon from '../../locales/zh-CN/common.json';
import zhMenu from '../../locales/zh-CN/menu.json';
import zhSidebar from '../../locales/zh-CN/sidebar.json';
import zhShell from '../../locales/zh-CN/shell.json';
import zhDialog from '../../locales/zh-CN/dialog.json';
import zhSettings from '../../locales/zh-CN/settings.json';
import zhError from '../../locales/zh-CN/error.json';

export const I18N_NAMESPACES = [
  'common',
  'menu',
  'sidebar',
  'shell',
  'dialog',
  'settings',
  'error',
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

const enResources = {
  common: enCommon,
  menu: enMenu,
  sidebar: enSidebar,
  shell: enShell,
  dialog: enDialog,
  settings: enSettings,
  error: enError,
};

const zhResources = {
  common: zhCommon,
  menu: zhMenu,
  sidebar: zhSidebar,
  shell: zhShell,
  dialog: zhDialog,
  settings: zhSettings,
  error: zhError,
};

export const I18N_RESOURCES: Record<DisplayLocale, Record<I18nNamespace, Record<string, unknown>>> = {
  en: enResources,
  'zh-CN': zhResources,
};
