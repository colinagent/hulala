import * as fs from 'fs/promises';
import * as path from 'path';
import {
  parse as parseJsonc,
  type ParseError,
} from 'jsonc-parser';
import type { RecentWorkspaces } from '../shared/recentWorkspaces';
import { createEmptyRecentWorkspaces, normalizeRecentWorkspaces } from '../shared/recentWorkspaces';
import { resolveHulalaConfigDir } from '../hulalaPaths';
import {
  DEFAULT_FILE_EXCLUDES,
  normalizeFileExcludeConfig,
  type FileExcludeConfig,
} from '../shared/fileExcludes';

// ============================================================================
// Type Definitions
// ============================================================================

export type IdleSleepPolicy = 'off' | 'whileAppRunning';

export type SystemSettings = {
  version: number;
  remoteConnectionDefaults?: {
    host?: string;
    port?: number;
    user?: string;
  };
  logging?: {
    enabled: boolean;
    level?: 'debug' | 'info' | 'warn' | 'error';
  };
  diagnostics?: {
    enabled: boolean;
  };
  power?: {
    idleSleepPolicy?: IdleSleepPolicy;
  };
};

export type UserSettings = {
  version: number;
  defaultWorkspacePath?: string | null;
  recentWorkspaces?: RecentWorkspaces;
};

/** Markdown 标题字号（相对正文的 em 倍数），在 ui.jsonc 中统一配置 */
export type MarkdownFontSize = {
  heading1?: number;
  heading2?: number;
  heading3?: number;
  heading4?: number;
};

import { normalizeDisplayLocale, type DisplayLocale } from '../i18n/locales';
import {
  DEFAULT_DOCUMENT_OUTLINE_WIDTH,
  normalizeDocumentOutlineWidth,
} from '../shared/documentOutlineWidth';
import { SYSTEM_THEME_ID } from '../shared/themePreference';

export {
  DEFAULT_DOCUMENT_OUTLINE_WIDTH,
  DOCUMENT_OUTLINE_MAX_WIDTH,
  DOCUMENT_OUTLINE_MIN_WIDTH,
  clampDocumentOutlineWidthForContainer,
  normalizeDocumentOutlineWidth,
} from '../shared/documentOutlineWidth';

export type UiSettings = {
  version: number;
  themeId: string;
  displayLocale?: DisplayLocale;
  showLineNumbers?: boolean;
  fontSize?: number;
  sidebarFontSize?: number;
  sidebarWidth?: number;
  pinnedFilePanelWidth?: number;
  activityPanelWidth?: number;
  activityPanelMaxHeight?: number;
  conversationComposerDockHeight?: number;
  markdownTextOffset?: number;
  markdownContentWidth?: number;
  documentOutlineWidth?: number;
  titlebarFontSize?: number;
  statusbarFontSize?: number;
  tabBarHeight?: number;
  tabBarFontSize?: number;
  fontFamily?: string;
  markdownFontSize?: MarkdownFontSize;
};

export type EditorSettings = {
  version: number;
  filesAssociations: Record<string, string>; // glob pattern -> languageId
  workbenchEditorAssociations: Record<string, string>; // glob pattern -> editorId
  filesExclude: FileExcludeConfig; // glob pattern -> hidden in file tree / pickers
  openableExtensions: string[]; // explicit whitelist (empty means all text files)
  defaultLanguage: string; // fallback languageId for unknown extensions
  markdownLivePreview?: {
    enabled: boolean;
    focusRangeEnabled?: boolean;
  };
};

export type TerminalSettings = {
  fontFamily: string;
  fontSize: number;
  theme: 'dark' | 'light';
  cursorStyle: 'block' | 'bar' | 'underline';
  cursorBlink: boolean;
  scrollback: number;
};

export type TerminalProfile = {
  id: string;
  name: string;
  shell: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  shellIntegration?: boolean;
};

export type TerminalConfig = {
  version: number;
  terminal: TerminalSettings;
  profiles: TerminalProfile[];
  defaultProfileId: string;
};

export type KeybindingItem = {
  key: string;
  command: string;
  when?: string;
  args?: unknown;
  mac?: string;
  linux?: string;
  win?: string;
};

export type KeybindingsConfig = {
  version: number;
  keybindings: KeybindingItem[];
};

export type ThemeCore = {
  brand: string;
  highlight: string;
  brandDark: string;
  background: string;
  primeText: string;
  secondaryText: string;
  onSurface: string;
  onSurfaceMuted: string;
};

export type ThemeItem = {
  id: string;
  name: string;
  markdownTheme?: string;
  codeTheme?: string;
  core: ThemeCore;
};

export type ThemeConfig = {
  version: number;
  builtInVersion: number;
  themes: ThemeItem[];
};

export const BUILT_IN_DESKTOP_THEME_IDS = ['default-light', 'default-dark'] as const;
export const RETIRED_BUILT_IN_DESKTOP_THEME_IDS = ['hulala-light', 'hulala-dark'] as const;
export const BUILT_IN_CODE_THEME_IDS = ['default-code-light', 'default-code-dark'] as const;
export const RETIRED_BUILT_IN_CODE_THEME_IDS = ['hulala-code-light', 'hulala-code-dark'] as const;

const RETIRED_THEME_REPLACEMENTS: Readonly<Record<string, string>> = {
  'hulala-light': 'default-light',
  'hulala-dark': 'default-dark',
};

export type MarkdownThemeEditor = {
  background?: string;
  foreground?: string;
  caret?: string;
  activeLine?: string;
  gutterBg?: string;
  gutterFg?: string;
  gutterBorder?: string;
  fontFamily?: string;
};

export type MarkdownThemeSyntax = {
  heading1?: string;
  heading2?: string;
  heading3?: string;
  heading4?: string;
  emphasis?: string;
  strong?: string;
  link?: string;
  url?: string;
  quote?: string;
  list?: string;
  hr?: string;
  meta?: string;
  comment?: string;
};

export type MarkdownThemePreview = {
  heading1?: string;
  heading2?: string;
  heading3?: string;
  heading4?: string;
  emphasis?: string;
  strong?: string;
  highlightBg?: string;
  codeInlineBg?: string;
  codeInlineText?: string;
  codeBlockBg?: string;
  codeBlockText?: string;
  codeBlockFontFamily?: string;
  link?: string;
  wikilink?: string;
  blockquoteBorder?: string;
  blockquoteText?: string;
  syntaxVisible?: string;
  calloutBg?: string;
  calloutBorder?: string;
  calloutNote?: string;
  calloutWarning?: string;
  calloutInfo?: string;
  calloutTip?: string;
  calloutSuccess?: string;
  calloutDanger?: string;
  frontmatterBg?: string;
  frontmatterText?: string;
  tableBorder?: string;
  taskBorder?: string;
  taskBg?: string;
  taskCheckedBg?: string;
  taskCheckedText?: string;
  taskLineText?: string;
  mathInline?: string;
  mathBlockBg?: string;
  mermaidBg?: string;
  mermaidError?: string;
};

export type MarkdownThemeItem = {
  id: string;
  name: string;
  core: ThemeCore;
  editor?: MarkdownThemeEditor;
  syntax?: MarkdownThemeSyntax;
  preview?: MarkdownThemePreview;
};

export type MarkdownThemesConfig = {
  version: number;
  builtInVersion?: number;
  themes: MarkdownThemeItem[];
};

export type CodeThemeTokens = {
  keyword?: string;
  string?: string;
  number?: string;
  type?: string;
  function?: string;
  property?: string;
  variable?: string;
  comment?: string;
  meta?: string;
  operator?: string;
  punctuation?: string;
  invalid?: string;
};

export type CodeThemeItem = {
  id: string;
  name: string;
  core: ThemeCore;
  tokens?: CodeThemeTokens;
};

export type CodeThemesConfig = {
  version: number;
  builtInVersion: number;
  themes: CodeThemeItem[];
};

function parseSettingsJson<T>(data: string): T | null {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(data, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0 || parsed === undefined || parsed === null) {
    return null;
  }
  return parsed as T;
}

const SETTINGS_FILE_EXTENSION = '.jsonc';
const SETTINGS_FILE_BASENAMES = [
  'system',
  'user',
  'ui',
  'editor',
  'terminal',
  'keybindings',
  'theme',
  'markdown-themes',
  'code-themes',
  'version',
] as const;

async function readSettingsFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

export function settingsFileName(basename: string): string {
  return `${basename}${SETTINGS_FILE_EXTENSION}`;
}

export function settingsBasenameFromFileName(fileName: string): string | null {
  if (fileName.endsWith(SETTINGS_FILE_EXTENSION)) {
    return fileName.slice(0, -SETTINGS_FILE_EXTENSION.length);
  }
  return null;
}

export function isSettingsConfigFileName(fileName: string): boolean {
  const basename = settingsBasenameFromFileName(fileName);
  return basename ? (SETTINGS_FILE_BASENAMES as readonly string[]).includes(basename) : false;
}

export function settingsConfigFileNameVariants(basename: string): string[] {
  return [settingsFileName(basename)];
}

export function getSettingsVersionTemplateFileName(): string {
  return settingsFileName('version');
}

export function getVersionSettingsPath(settingsRoot: string): string {
  return path.join(settingsRoot, settingsFileName('version'));
}

export type SettingsState = {
  system: SystemSettings;
  user: UserSettings;
  ui: UiSettings;
  editor: EditorSettings;
  terminal: TerminalSettings;
  profiles: TerminalProfile[];
  defaultProfileId: string;
  keybindings: KeybindingItem[];
  theme?: ThemeConfig;
  markdownThemes?: MarkdownThemesConfig;
  codeThemes?: CodeThemesConfig;
};

// ============================================================================
// Default Values
// ============================================================================

function getDefaultShell() {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'C:\\\\Windows\\\\System32\\\\cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function defaultSystemSettings(): SystemSettings {
  return {
    version: 1,
    remoteConnectionDefaults: undefined,
    logging: {
      enabled: false,
      level: 'info',
    },
    diagnostics: {
      enabled: false,
    },
    power: {
      idleSleepPolicy: 'off',
    },
  };
}

function resolveIdleSleepPolicy(power: unknown): IdleSleepPolicy {
  const raw = power && typeof power === 'object'
    ? power as { idleSleepPolicy?: unknown }
    : {};
  if (
    raw.idleSleepPolicy === 'off'
    || raw.idleSleepPolicy === 'whileAppRunning'
  ) {
    return raw.idleSleepPolicy;
  }
  return 'off';
}

export function normalizeIdleSleepPolicy(power: unknown): IdleSleepPolicy {
  return resolveIdleSleepPolicy(power);
}

function normalizeSystemSettings(settings: unknown): SystemSettings {
  const defaults = defaultSystemSettings();
  const raw = settings && typeof settings === 'object'
    ? settings as Partial<SystemSettings>
    : {};
  const idleSleepPolicy = resolveIdleSleepPolicy(raw.power);
  return {
    ...defaults,
    version: typeof raw.version === 'number' ? raw.version : defaults.version,
    remoteConnectionDefaults: raw.remoteConnectionDefaults,
    logging: {
      enabled: typeof raw.logging?.enabled === 'boolean' ? raw.logging.enabled : defaults.logging!.enabled,
      level: raw.logging?.level ?? defaults.logging!.level,
    },
    diagnostics: {
      enabled: typeof raw.diagnostics?.enabled === 'boolean' ? raw.diagnostics.enabled : defaults.diagnostics!.enabled,
    },
    power: {
      idleSleepPolicy,
    },
  };
}

export function getIdleSleepPolicy(settings: SystemSettings): IdleSleepPolicy {
  return settings.power?.idleSleepPolicy ?? 'off';
}

function defaultUserSettings(): UserSettings {
  return {
    version: 1,
    recentWorkspaces: createEmptyRecentWorkspaces(),
  };
}

export function normalizeDefaultWorkspacePath(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed && path.isAbsolute(trimmed) ? path.normalize(trimmed) : undefined;
}

export const MARKDOWN_TEXT_OFFSET_MIN = 24;
export const DEFAULT_MARKDOWN_TEXT_OFFSET = 60;
export const MARKDOWN_CONTENT_WIDTH_MIN = 320;
export const DEFAULT_MARKDOWN_CONTENT_WIDTH = 882;
export const PINNED_FILE_PANEL_MIN_WIDTH = 320;
export const PINNED_FILE_PANEL_MAX_WIDTH = 720;
export const DEFAULT_PINNED_FILE_PANEL_WIDTH = 420;
export const DEFAULT_ACTIVITY_PANEL_MAX_HEIGHT = 400;
export const DEFAULT_CONVERSATION_COMPOSER_DOCK_HEIGHT = 160;
const DEFAULT_UI_FONT_FAMILY = '';

export function normalizeMarkdownTextOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MARKDOWN_TEXT_OFFSET;
  }
  return Math.max(MARKDOWN_TEXT_OFFSET_MIN, value);
}

export function normalizeMarkdownContentWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MARKDOWN_CONTENT_WIDTH;
  }
  return Math.max(MARKDOWN_CONTENT_WIDTH_MIN, value);
}

function normalizeUiDimension(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function normalizePinnedFilePanelWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PINNED_FILE_PANEL_WIDTH;
  }
  return Math.min(
    PINNED_FILE_PANEL_MAX_WIDTH,
    Math.max(PINNED_FILE_PANEL_MIN_WIDTH, value)
  );
}

function normalizeActivityPanelWidth(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(4000, Math.max(320, value));
}

function normalizeActivityPanelMaxHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_ACTIVITY_PANEL_MAX_HEIGHT;
  return Math.min(2000, Math.max(80, value));
}

function normalizeConversationComposerDockHeight(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CONVERSATION_COMPOSER_DOCK_HEIGHT;
  return Math.min(2000, Math.max(120, value));
}

function normalizeUiFontFamily(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_UI_FONT_FAMILY;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_UI_FONT_FAMILY;
  }
  return trimmed;
}

const DEFAULT_MARKDOWN_FONT_SIZE: Required<MarkdownFontSize> = {
  heading1: 1.8,
  heading2: 1.5,
  heading3: 1.25,
  heading4: 1.1,
};

function normalizeMarkdownHeadingSize(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeMarkdownFontSize(value: unknown): MarkdownFontSize {
  const source = value && typeof value === 'object' ? value as MarkdownFontSize : {};
  return {
    heading1: normalizeMarkdownHeadingSize(source.heading1, DEFAULT_MARKDOWN_FONT_SIZE.heading1),
    heading2: normalizeMarkdownHeadingSize(source.heading2, DEFAULT_MARKDOWN_FONT_SIZE.heading2),
    heading3: normalizeMarkdownHeadingSize(source.heading3, DEFAULT_MARKDOWN_FONT_SIZE.heading3),
    heading4: normalizeMarkdownHeadingSize(source.heading4, DEFAULT_MARKDOWN_FONT_SIZE.heading4),
  };
}

function defaultUiSettings(): UiSettings {
  return {
    version: 1,
    themeId: SYSTEM_THEME_ID,
    showLineNumbers: true,
    fontSize: 13,
    sidebarFontSize: undefined,
    sidebarWidth: undefined,
    pinnedFilePanelWidth: DEFAULT_PINNED_FILE_PANEL_WIDTH,
    activityPanelWidth: undefined,
    activityPanelMaxHeight: DEFAULT_ACTIVITY_PANEL_MAX_HEIGHT,
    conversationComposerDockHeight: DEFAULT_CONVERSATION_COMPOSER_DOCK_HEIGHT,
    markdownTextOffset: DEFAULT_MARKDOWN_TEXT_OFFSET,
    markdownContentWidth: DEFAULT_MARKDOWN_CONTENT_WIDTH,
    documentOutlineWidth: DEFAULT_DOCUMENT_OUTLINE_WIDTH,
    titlebarFontSize: 13,
    statusbarFontSize: 11,
    tabBarHeight: 32,
    tabBarFontSize: 13,
    fontFamily: DEFAULT_UI_FONT_FAMILY,
    markdownFontSize: { ...DEFAULT_MARKDOWN_FONT_SIZE },
    displayLocale: undefined,
  };
}

export function normalizeUiSettings(settings: UiSettings | null | undefined): UiSettings {
  const defaults = defaultUiSettings();
  if (!settings || typeof settings.version !== 'number') {
    return defaults;
  }
  return {
    ...defaults,
    ...settings,
    themeId: typeof settings.themeId === 'string' && settings.themeId.trim()
      ? RETIRED_THEME_REPLACEMENTS[settings.themeId.trim()] ?? settings.themeId.trim()
      : defaults.themeId,
    showLineNumbers: typeof settings.showLineNumbers === 'boolean'
      ? settings.showLineNumbers
      : defaults.showLineNumbers,
    pinnedFilePanelWidth: normalizePinnedFilePanelWidth(settings.pinnedFilePanelWidth),
    activityPanelWidth: normalizeActivityPanelWidth(settings.activityPanelWidth),
    activityPanelMaxHeight: normalizeActivityPanelMaxHeight(settings.activityPanelMaxHeight),
    conversationComposerDockHeight: normalizeConversationComposerDockHeight(settings.conversationComposerDockHeight),
    markdownTextOffset: normalizeMarkdownTextOffset(settings.markdownTextOffset),
    markdownContentWidth: normalizeMarkdownContentWidth(settings.markdownContentWidth),
    documentOutlineWidth: normalizeDocumentOutlineWidth(settings.documentOutlineWidth),
    titlebarFontSize: normalizeUiDimension(settings.titlebarFontSize, defaults.titlebarFontSize ?? 13),
    statusbarFontSize: normalizeUiDimension(settings.statusbarFontSize, defaults.statusbarFontSize ?? 11),
    tabBarHeight: normalizeUiDimension(settings.tabBarHeight, defaults.tabBarHeight ?? 32),
    tabBarFontSize: normalizeUiDimension(settings.tabBarFontSize, defaults.tabBarFontSize ?? 13),
    fontFamily: normalizeUiFontFamily(settings.fontFamily),
    markdownFontSize: normalizeMarkdownFontSize(settings.markdownFontSize),
    displayLocale: settings.displayLocale
      ? normalizeDisplayLocale(settings.displayLocale)
      : defaults.displayLocale,
  };
}

function defaultEditorSettings(): EditorSettings {
  return {
    version: 1,
    filesAssociations: {
      '*.md': 'markdown',
      '*.markdown': 'markdown',
      '*.json': 'json',
      '*.jsonc': 'json',
      '*.jsonl': 'plaintext',
      '*.yml': 'yaml',
      '*.yaml': 'yaml',
      '*.js': 'javascript',
      '*.jsx': 'javascript',
      '*.mjs': 'javascript',
      '*.cjs': 'javascript',
      '*.ts': 'typescript',
      '*.tsx': 'typescript',
      '*.mts': 'typescript',
      '*.cts': 'typescript',
      '*.py': 'python',
      '*.go': 'go',
      '*.txt': 'plaintext',
      '*.epub': 'book',
      '*.pdf': 'book',
      '*.docx': 'word',
    },
    workbenchEditorAssociations: {
      '*.md': 'markdown',
      '*.markdown': 'markdown',
      '*.json': 'text',
      '*.jsonc': 'text',
      '*.jsonl': 'text',
      '*.yml': 'text',
      '*.yaml': 'text',
      '*.js': 'text',
      '*.jsx': 'text',
      '*.mjs': 'text',
      '*.cjs': 'text',
      '*.ts': 'text',
      '*.tsx': 'text',
      '*.mts': 'text',
      '*.cts': 'text',
      '*.py': 'text',
      '*.go': 'text',
      '*.txt': 'text',
      '*.epub': 'book',
      '*.pdf': 'book',
      '*.docx': 'word',
    },
    filesExclude: { ...DEFAULT_FILE_EXCLUDES },
    openableExtensions: [],
    defaultLanguage: 'plaintext',
    markdownLivePreview: {
      enabled: true,
      focusRangeEnabled: true,
    },
  };
}

function defaultTerminalConfig(): TerminalConfig {
  return {
    version: 1,
    terminal: {
      fontFamily: 'SF Mono, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      theme: 'dark',
      cursorStyle: 'block',
      cursorBlink: true,
      scrollback: 5000,
    },
    profiles: [
      {
        id: 'default',
        name: 'Default',
        shell: getDefaultShell(),
        args: [],
        env: {},
        cwd: '',
        shellIntegration: true,
      },
    ],
    defaultProfileId: 'default',
  };
}

function defaultKeybindingsConfig(): KeybindingsConfig {
  return {
    version: 1,
    keybindings: [],
  };
}

function defaultThemeConfig(): ThemeConfig {
  return {
    version: 1,
    builtInVersion: 40,
    themes: [
      {
        id: 'default-light',
        name: 'Default Light',
        markdownTheme: 'default-light',
        codeTheme: 'default-code-light',
        core: {
          brand: '#918072',
          highlight: '#be7e4a',
          brandDark: '#8f5a2e',
          background: '#f3f0e7',
          primeText: '#000000',
          secondaryText: 'rgba(0,0,0,0.7)',
          onSurface: '#000000',
          onSurfaceMuted: 'rgba(0,0,0,0.7)',
        },
      },
      {
        id: 'default-dark',
        name: 'Default Dark',
        markdownTheme: 'default-dark',
        codeTheme: 'default-code-dark',
        core: {
          brand: '#918072',
          highlight: '#be7e4a',
          brandDark: '#8f5a2e',
          background: '#282c34',
          primeText: '#ffffff',
          secondaryText: 'rgba(255,255,255,0.7)',
          onSurface: '#000000',
          onSurfaceMuted: 'rgba(0,0,0,0.7)',
        },
      },
    ],
  };
}

function defaultCodeThemesConfig(): CodeThemesConfig {
  return {
    version: 1,
    builtInVersion: 10,
    themes: [
      {
        id: 'default-code-light',
        name: 'Default Code Light',
        core: {
          brand: '#2f8f6b',
          highlight: '#2f8f6b',
          brandDark: '#17604d',
          background: '#f4f9f7',
          primeText: '#000000',
          secondaryText: 'rgba(0,0,0,0.7)',
          onSurface: '#000000',
          onSurfaceMuted: 'rgba(0,0,0,0.7)',
        },
        tokens: {},
      },
      {
        id: 'default-code-dark',
        name: 'Default Code Dark',
        core: {
          brand: '#2f8f6b',
          highlight: '#2f8f6b',
          brandDark: '#17604d',
          background: '#282c34',
          primeText: '#ffffff',
          secondaryText: 'rgba(255,255,255,0.7)',
          onSurface: '#000000',
          onSurfaceMuted: 'rgba(0,0,0,0.7)',
        },
        tokens: {},
      },
    ],
  };
}

// ============================================================================
// Path Helpers
// ============================================================================

export function getSettingsRoot(homeDir: string): string {
  return path.join(resolveHulalaConfigDir(homeDir), 'settings');
}

export function getSystemSettingsPath(settingsRoot: string): string {
  return path.join(settingsRoot, settingsFileName('system'));
}

export function getUserSettingsPath(settingsRoot: string): string {
  return path.join(settingsRoot, settingsFileName('user'));
}

export function getUiSettingsPath(settingsRoot: string): string {
  return path.join(settingsRoot, settingsFileName('ui'));
}

export function getEditorSettingsPath(settingsRoot: string): string {
  return path.join(settingsRoot, settingsFileName('editor'));
}

export function getTerminalSettingsPath(settingsRoot: string): string {
  return path.join(settingsRoot, settingsFileName('terminal'));
}

export function getKeybindingsPath(settingsRoot: string): string {
  return path.join(settingsRoot, settingsFileName('keybindings'));
}

export function getThemePath(settingsRoot: string): string {
  return path.join(settingsRoot, settingsFileName('theme'));
}

export function getMarkdownThemesPath(settingsRoot: string): string {
  return path.join(settingsRoot, settingsFileName('markdown-themes'));
}

export function getCodeThemesPath(settingsRoot: string): string {
  return path.join(settingsRoot, settingsFileName('code-themes'));
}

export function getTerminalLayoutPath(settingsRoot: string, workspaceId?: string): string {
  if (workspaceId) {
    return path.join(settingsRoot, 'state', `terminal-layout.${workspaceId}.json`);
  }
  return path.join(settingsRoot, 'state', 'terminal-layout.json');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureSettingsInitialized(homeDir: string, settingsRoot = getSettingsRoot(homeDir)): Promise<void> {
  const stateDir = path.dirname(getTerminalLayoutPath(settingsRoot));

  await Promise.all([
    fs.mkdir(settingsRoot, { recursive: true }),
    fs.mkdir(stateDir, { recursive: true }),
  ]);

  const defaults: Array<[string, () => unknown]> = [
    [getSystemSettingsPath(settingsRoot), defaultSystemSettings],
    [getUserSettingsPath(settingsRoot), defaultUserSettings],
    [getUiSettingsPath(settingsRoot), defaultUiSettings],
    [getEditorSettingsPath(settingsRoot), defaultEditorSettings],
    [getTerminalSettingsPath(settingsRoot), defaultTerminalConfig],
    [getKeybindingsPath(settingsRoot), defaultKeybindingsConfig],
    [getThemePath(settingsRoot), defaultThemeConfig],
    [getCodeThemesPath(settingsRoot), defaultCodeThemesConfig],
  ];

  await Promise.all(
    defaults.map(async ([filePath, factory]) => {
      if (!(await pathExists(filePath))) {
        await fs.writeFile(filePath, JSON.stringify(factory(), null, 2), 'utf8');
      }
    })
  );
}

// ============================================================================
// Load Functions (per-domain)
// ============================================================================

export async function loadSystemSettings(settingsRoot: string): Promise<SystemSettings> {
  const filePath = getSystemSettingsPath(settingsRoot);
  try {
    const data = await readSettingsFile(filePath);
    const parsed = parseSettingsJson<SystemSettings>(data);
    if (!parsed || typeof parsed.version !== 'number') {
      return defaultSystemSettings();
    }
    return normalizeSystemSettings(parsed);
  } catch {
    return defaultSystemSettings();
  }
}

export async function loadUserSettings(settingsRoot: string): Promise<UserSettings> {
  const filePath = getUserSettingsPath(settingsRoot);
  try {
    const data = await readSettingsFile(filePath);
    const parsed = parseSettingsJson<UserSettings>(data);
    if (!parsed || typeof parsed.version !== 'number') {
      return defaultUserSettings();
    }
    return {
      version: parsed.version,
      ...(normalizeDefaultWorkspacePath(parsed.defaultWorkspacePath)
        ? { defaultWorkspacePath: normalizeDefaultWorkspacePath(parsed.defaultWorkspacePath) }
        : {}),
      recentWorkspaces: normalizeRecentWorkspaces(parsed.recentWorkspaces),
    };
  } catch {
    return defaultUserSettings();
  }
}

export async function loadUiSettings(settingsRoot: string): Promise<UiSettings> {
  const filePath = getUiSettingsPath(settingsRoot);
  try {
    const data = await readSettingsFile(filePath);
    const parsed = parseSettingsJson<UiSettings>(data);
    if (!parsed) {
      return defaultUiSettings();
    }
    return normalizeUiSettings(parsed);
  } catch {
    return defaultUiSettings();
  }
}

export async function loadEditorSettings(settingsRoot: string): Promise<EditorSettings> {
  const filePath = getEditorSettingsPath(settingsRoot);
  const defaults = defaultEditorSettings();
  try {
    const data = await readSettingsFile(filePath);
    const parsed = parseSettingsJson<EditorSettings>(data);
    if (!parsed || typeof parsed.version !== 'number') {
      return defaults;
    }
    return {
      ...defaults,
      ...parsed,
      filesAssociations: {
        ...defaults.filesAssociations,
        ...(parsed.filesAssociations || {}),
      },
      workbenchEditorAssociations: {
        ...defaults.workbenchEditorAssociations,
        ...(parsed.workbenchEditorAssociations || {}),
      },
      filesExclude: normalizeFileExcludeConfig(parsed.filesExclude),
    };
  } catch {
    return defaults;
  }
}

export async function loadTerminalConfig(settingsRoot: string): Promise<TerminalConfig> {
  const filePath = getTerminalSettingsPath(settingsRoot);
  try {
    const data = await readSettingsFile(filePath);
    const parsed = parseSettingsJson<TerminalConfig>(data);
    if (!parsed || typeof parsed.version !== 'number' || !parsed.terminal || !parsed.profiles) {
      return defaultTerminalConfig();
    }
    // Ensure at least one profile has a valid shell
    const nextProfiles = Array.isArray(parsed.profiles) ? parsed.profiles.map((p) => ({
      ...p,
      shell: p.shell || getDefaultShell(),
    })) : defaultTerminalConfig().profiles;
    return {
      ...defaultTerminalConfig(),
      ...parsed,
      terminal: {
        ...defaultTerminalConfig().terminal,
        ...parsed.terminal,
      },
      profiles: nextProfiles,
    };
  } catch {
    return defaultTerminalConfig();
  }
}

export async function loadKeybindings(settingsRoot: string): Promise<KeybindingsConfig> {
  const filePath = getKeybindingsPath(settingsRoot);
  try {
    const data = await readSettingsFile(filePath);
    const parsed = parseSettingsJson<KeybindingsConfig>(data);
    if (!parsed || typeof parsed.version !== 'number' || !Array.isArray(parsed.keybindings)) {
      return defaultKeybindingsConfig();
    }
    return parsed;
  } catch {
    return defaultKeybindingsConfig();
  }
}

export async function loadThemeConfig(settingsRoot: string): Promise<ThemeConfig> {
  const filePath = getThemePath(settingsRoot);
  try {
    const data = await readSettingsFile(filePath);
    const parsed = parseSettingsJson<ThemeConfig>(data);
    if (!parsed || typeof parsed.version !== 'number' || !Array.isArray(parsed.themes)) {
      return defaultThemeConfig();
    }
    return {
      ...defaultThemeConfig(),
      ...parsed,
      themes: parsed.themes,
    };
  } catch {
    return defaultThemeConfig();
  }
}

export async function loadMarkdownThemesConfig(settingsRoot: string): Promise<MarkdownThemesConfig | null> {
  const filePath = getMarkdownThemesPath(settingsRoot);
  try {
    const data = await readSettingsFile(filePath);
    const parsed = parseSettingsJson<MarkdownThemesConfig>(data);
    if (!parsed || typeof parsed.version !== 'number' || !Array.isArray(parsed.themes)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function loadCodeThemesConfig(settingsRoot: string): Promise<CodeThemesConfig | null> {
  const filePath = getCodeThemesPath(settingsRoot);
  try {
    const data = await readSettingsFile(filePath);
    const parsed = parseSettingsJson<CodeThemesConfig>(data);
    if (!parsed || typeof parsed.version !== 'number' || !Array.isArray(parsed.themes)) {
      return null;
    }
    return {
      ...defaultCodeThemesConfig(),
      ...parsed,
      themes: parsed.themes,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Save Functions (per-domain)
// ============================================================================

export async function saveSystemSettings(settingsRoot: string, settings: SystemSettings): Promise<void> {
  const filePath = getSystemSettingsPath(settingsRoot);
  await fs.mkdir(settingsRoot, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf8');
}

export async function saveUserSettings(settingsRoot: string, settings: UserSettings): Promise<void> {
  const filePath = getUserSettingsPath(settingsRoot);
  await fs.mkdir(settingsRoot, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf8');
}

export async function saveUiSettings(settingsRoot: string, settings: UiSettings): Promise<void> {
  const filePath = getUiSettingsPath(settingsRoot);
  await fs.mkdir(settingsRoot, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(normalizeUiSettings(settings), null, 2), 'utf8');
}

export async function saveEditorSettings(settingsRoot: string, settings: EditorSettings): Promise<void> {
  const filePath = getEditorSettingsPath(settingsRoot);
  await fs.mkdir(settingsRoot, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({
    ...settings,
    filesExclude: normalizeFileExcludeConfig(settings.filesExclude),
  }, null, 2), 'utf8');
}

export async function saveTerminalConfig(settingsRoot: string, config: TerminalConfig): Promise<void> {
  const filePath = getTerminalSettingsPath(settingsRoot);
  await fs.mkdir(settingsRoot, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
}

export async function saveKeybindings(settingsRoot: string, config: KeybindingsConfig): Promise<void> {
  const filePath = getKeybindingsPath(settingsRoot);
  await fs.mkdir(settingsRoot, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
}

export async function saveThemeConfig(settingsRoot: string, config: ThemeConfig): Promise<void> {
  const filePath = getThemePath(settingsRoot);
  await fs.mkdir(settingsRoot, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
}

export async function saveCodeThemesConfig(settingsRoot: string, config: CodeThemesConfig): Promise<void> {
  const filePath = getCodeThemesPath(settingsRoot);
  await fs.mkdir(settingsRoot, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
}

// ============================================================================
// Aggregated Load/Save
// ============================================================================

export async function loadAllSettings(homeDir: string, settingsRoot = getSettingsRoot(homeDir)): Promise<SettingsState> {
  const [system, user, ui, editor, keybindings, theme, markdownThemes, codeThemes] = await Promise.all([
    loadSystemSettings(settingsRoot),
    loadUserSettings(settingsRoot),
    loadUiSettings(settingsRoot),
    loadEditorSettings(settingsRoot),
    loadKeybindings(settingsRoot),
    loadThemeConfig(settingsRoot),
    loadMarkdownThemesConfig(settingsRoot),
    loadCodeThemesConfig(settingsRoot),
  ]);
  const terminalConfig = await loadTerminalConfig(settingsRoot);

  return {
    system,
    user,
    ui,
    editor,
    terminal: terminalConfig.terminal,
    profiles: terminalConfig.profiles,
    defaultProfileId: terminalConfig.defaultProfileId,
    keybindings: keybindings.keybindings,
    theme,
    markdownThemes: markdownThemes ?? undefined,
    codeThemes: codeThemes ?? undefined,
  };
}

export async function saveSettings(
  homeDir: string,
  patch: Partial<SettingsState>,
  settingsRoot = getSettingsRoot(homeDir)
): Promise<SettingsState> {
  const current = await loadAllSettings(homeDir, settingsRoot);
  const requestedDefaultWorkspacePath = patch.user
    && Object.prototype.hasOwnProperty.call(patch.user, 'defaultWorkspacePath')
    ? normalizeDefaultWorkspacePath(patch.user.defaultWorkspacePath)
    : current.user.defaultWorkspacePath;

  // Merge patch into current
  const merged: SettingsState = {
    system: patch.system
      ? normalizeSystemSettings({ ...current.system, ...patch.system })
      : current.system,
    user: patch.user
      ? {
          version: patch.user.version ?? current.user.version,
          ...(requestedDefaultWorkspacePath ? { defaultWorkspacePath: requestedDefaultWorkspacePath } : {}),
          recentWorkspaces: normalizeRecentWorkspaces(patch.user.recentWorkspaces || current.user.recentWorkspaces),
        }
      : {
          version: current.user.version,
          ...(requestedDefaultWorkspacePath ? { defaultWorkspacePath: requestedDefaultWorkspacePath } : {}),
          recentWorkspaces: normalizeRecentWorkspaces(current.user.recentWorkspaces),
        },
    ui: patch.ui ? normalizeUiSettings({ ...current.ui, ...patch.ui }) : current.ui,
    editor: patch.editor
      ? {
          ...current.editor,
          ...patch.editor,
          filesAssociations: {
            ...current.editor.filesAssociations,
            ...(patch.editor.filesAssociations || {}),
          },
          workbenchEditorAssociations: {
            ...current.editor.workbenchEditorAssociations,
            ...(patch.editor.workbenchEditorAssociations || {}),
          },
          filesExclude: normalizeFileExcludeConfig({
            ...current.editor.filesExclude,
            ...(patch.editor.filesExclude || {}),
          }),
        }
      : current.editor,
    terminal: patch.terminal || current.terminal,
    profiles: patch.profiles || current.profiles,
    defaultProfileId: patch.defaultProfileId || current.defaultProfileId,
    keybindings: patch.keybindings || current.keybindings,
    theme: current.theme,
    markdownThemes: current.markdownThemes,
    codeThemes: patch.codeThemes || current.codeThemes,
  };

  // Save only changed domains
  const savePromises: Promise<void>[] = [];
  if (patch.system) {
    savePromises.push(saveSystemSettings(settingsRoot, merged.system));
  }
  if (patch.user) {
    savePromises.push(saveUserSettings(settingsRoot, merged.user));
  }
  if (patch.ui) {
    savePromises.push(saveUiSettings(settingsRoot, merged.ui));
  }
  if (patch.editor) {
    savePromises.push(saveEditorSettings(settingsRoot, merged.editor));
  }
  if (patch.terminal || patch.profiles || patch.defaultProfileId) {
    savePromises.push(
      saveTerminalConfig(settingsRoot, {
        version: 1,
        terminal: merged.terminal,
        profiles: merged.profiles,
        defaultProfileId: merged.defaultProfileId,
      })
    );
  }
  if (patch.keybindings) {
    savePromises.push(
      saveKeybindings(settingsRoot, {
        version: 1,
        keybindings: merged.keybindings,
      })
    );
  }
  if (patch.codeThemes) {
    savePromises.push(
      saveCodeThemesConfig(settingsRoot, merged.codeThemes || defaultCodeThemesConfig())
    );
  }

  await Promise.all(savePromises);
  return merged;
}
