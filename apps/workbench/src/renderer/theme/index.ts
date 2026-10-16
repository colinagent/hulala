import {
  BrandCore,
  DEFAULT_DARK_CORE,
  expandCoreToCodeTokens,
  expandCoreToMarkdownTheme,
  expandCoreToPalette,
  mergeTokenOverrides,
} from './brandCore';
import {
  applyBuiltInSurfaceOverrides,
  BasePalette,
  mapTokens,
  ThemeDefinition,
} from './presets';
import { MarkdownThemeConfig, CodeThemeConfig } from './tokens';

const CORE_KEYS: Array<keyof BrandCore> = [
  'brand',
  'highlight',
  'brandDark',
  'background',
  'primeText',
  'secondaryText',
  'onSurface',
  'onSurfaceMuted',
];

const CORE_KEY_ALIASES: Record<keyof BrandCore, string[]> = {
  brand: ['brand', 'obBrand'],
  highlight: ['highlight'],
  brandDark: ['brandDark', 'obBrandDark'],
  background: ['background'],
  primeText: ['primeText'],
  secondaryText: ['secondaryText'],
  onSurface: ['onSurface'],
  onSurfaceMuted: ['onSurfaceMuted'],
};

function readCoreValue(record: Record<string, unknown>, key: keyof BrandCore): string | null {
  for (const alias of CORE_KEY_ALIASES[key]) {
    const value = record[alias];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeBrandCore(core: unknown, themeId: string): BrandCore | null {
  if (!core || typeof core !== 'object') {
    return null;
  }
  const record = core as Record<string, unknown>;
  const normalized = {} as BrandCore;
  for (const key of CORE_KEYS) {
    const value = readCoreValue(record, key);
    if (!value) {
      return null;
    }
    normalized[key] = value;
  }
  // Normalize before expansion so persisted built-ins cannot derive text,
  // selections, Markdown surfaces, or syntax colors from an obsolete base.
  if (themeId === 'default-dark' || themeId === 'default-code-dark') {
    normalized.background = DEFAULT_DARK_CORE.background;
  }
  return normalized;
}

function normalizeMarkdownTheme(item: unknown): MarkdownThemeConfig | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const obj = item as Record<string, unknown>;
  if (typeof obj.id !== 'string' || typeof obj.name !== 'string') {
    return null;
  }
  const core = normalizeBrandCore(obj.core, obj.id);
  if (!core) {
    return null;
  }
  const scheme = inferSchemeFromId(obj.id);
  const expanded = expandCoreToMarkdownTheme(core, scheme);
  return {
    id: obj.id,
    name: obj.name,
    editor: mergeTokenOverrides(expanded.editor ?? {}, obj.editor as MarkdownThemeConfig['editor']),
    syntax: mergeTokenOverrides(expanded.syntax ?? {}, obj.syntax as MarkdownThemeConfig['syntax']),
    preview: mergeTokenOverrides(expanded.preview ?? {}, obj.preview as MarkdownThemeConfig['preview']),
  };
}

function normalizeCodeTheme(item: unknown): CodeThemeConfig | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const obj = item as Record<string, unknown>;
  if (typeof obj.id !== 'string' || typeof obj.name !== 'string') {
    return null;
  }
  const core = normalizeBrandCore(obj.core, obj.id);
  if (!core) {
    return null;
  }
  const scheme = inferSchemeFromCodeThemeId(obj.id);
  const expanded = expandCoreToCodeTokens(core, scheme);
  return {
    id: obj.id,
    name: obj.name,
    tokens: mergeTokenOverrides(expanded, obj.tokens as CodeThemeConfig['tokens']),
  };
}

export function buildMarkdownThemesFromConfig(config: unknown): MarkdownThemeConfig[] | null {
  if (!config || typeof config !== 'object') {
    return null;
  }
  const obj = config as Record<string, unknown>;
  const items = Array.isArray(obj.themes) ? obj.themes : null;
  if (!items) {
    return null;
  }
  const result: MarkdownThemeConfig[] = [];
  for (const item of items) {
    const normalized = normalizeMarkdownTheme(item);
    if (normalized) {
      result.push(normalized);
    }
  }
  return result.length ? result : null;
}

export function buildCodeThemesFromConfig(config: unknown): CodeThemeConfig[] | null {
  if (!config || typeof config !== 'object') {
    return null;
  }
  const obj = config as Record<string, unknown>;
  const items = Array.isArray(obj.themes) ? obj.themes : null;
  if (!items) {
    return null;
  }
  const result: CodeThemeConfig[] = [];
  for (const item of items) {
    const normalized = normalizeCodeTheme(item);
    if (normalized) {
      result.push(normalized);
    }
  }
  return result.length ? result : null;
}

function inferSchemeFromId(id: string): 'dark' | 'light' {
  return id.toLowerCase().endsWith('-dark') ? 'dark' : 'light';
}

function inferSchemeFromCodeThemeId(id: string): 'dark' | 'light' {
  return id.toLowerCase().includes('-dark') ? 'dark' : 'light';
}

export function buildThemeDefinitionsFromConfig(
  config: unknown,
  markdownThemeDefs: MarkdownThemeConfig[] = [],
  codeThemeDefs: CodeThemeConfig[] = []
): ThemeDefinition[] | null {
  if (!config || typeof config !== 'object') {
    return null;
  }
  const cfg = config as Record<string, unknown>;
  const items = Array.isArray(cfg.themes) ? cfg.themes : null;
  if (!items) {
    return null;
  }
  const markdownThemeById = new Map(markdownThemeDefs.map((theme) => [theme.id, theme]));
  const codeThemeById = new Map(codeThemeDefs.map((theme) => [theme.id, theme]));
  const defs: ThemeDefinition[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const normalizedItem = item as Record<string, unknown>;
    if (typeof normalizedItem.id !== 'string' || typeof normalizedItem.name !== 'string') {
      continue;
    }
    const core = normalizeBrandCore(normalizedItem.core, normalizedItem.id);
    if (!core) {
      continue;
    }
    const scheme = inferSchemeFromId(normalizedItem.id);
    const palette: BasePalette = applyBuiltInSurfaceOverrides(
      normalizedItem.id,
      expandCoreToPalette(core, scheme),
    );
    const mdThemeId = typeof normalizedItem.markdownTheme === 'string' ? normalizedItem.markdownTheme : null;
    const mdTheme = mdThemeId ? markdownThemeById.get(mdThemeId) : undefined;
    const codeThemeId = typeof normalizedItem.codeTheme === 'string' ? normalizedItem.codeTheme : null;
    const codeTheme = codeThemeId ? codeThemeById.get(codeThemeId) : undefined;
    defs.push({
      id: normalizedItem.id,
      label: normalizedItem.name,
      scheme,
      tokens: mapTokens(palette, scheme, mdTheme, codeTheme),
    });
  }
  return defs.length ? defs : null;
}
