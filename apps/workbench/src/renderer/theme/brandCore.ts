import type { BasePalette } from './presets';
import type { CodeThemeConfig, MarkdownThemeConfig } from './tokens';

/** Brand Core — the 8 tokens stored in settings jsonc. */
export type BrandCore = {
  brand: string;
  highlight: string;
  brandDark: string;
  background: string;
  primeText: string;
  secondaryText: string;
  onSurface: string;
  onSurfaceMuted: string;
};

export type ColorScheme = 'light' | 'dark';

const HEALTH_TEXT_LIGHT = '#16a34a';
const HEALTH_TEXT_DARK = '#4ade80';

export const DEFAULT_LIGHT_CORE: BrandCore = {
  brand: '#918072',
  highlight: '#be7e4a',
  brandDark: '#8f5a2e',
  background: '#f3f0e7',
  primeText: '#000000',
  secondaryText: 'rgba(0,0,0,0.7)',
  onSurface: '#000000',
  onSurfaceMuted: 'rgba(0,0,0,0.7)',
};

export const DEFAULT_DARK_CORE: BrandCore = {
  brand: '#918072',
  highlight: '#be7e4a',
  brandDark: '#8f5a2e',
  // Ghostty's default background anchors the built-in dark surface scale.
  background: '#282c34',
  primeText: '#ffffff',
  secondaryText: 'rgba(255,255,255,0.7)',
  onSurface: '#000000',
  onSurfaceMuted: 'rgba(0,0,0,0.7)',
};

const DEFAULT_MARKDOWN_CODE_BLOCK_FONT_FAMILY =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

type Rgb = { r: number; g: number; b: number; a: number };

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseHex(hex: string): Rgb | null {
  const normalized = hex.trim().replace(/^#/, '');
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return { r, g, b, a: 1 };
  }
  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return { r, g, b, a: 1 };
  }
  return null;
}

function parseRgb(color: string): Rgb | null {
  const match = color.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => part.trim());
  if (parts.length < 3) return null;
  const r = Number(parts[0]);
  const g = Number(parts[1]);
  const b = Number(parts[2]);
  const a = parts.length >= 4 ? Number(parts[3]) : 1;
  if ([r, g, b, a].some((value) => Number.isNaN(value))) return null;
  return { r, g, b, a };
}

function parseColor(color: string): Rgb | null {
  if (!color) return null;
  return parseHex(color) ?? parseRgb(color);
}

function toHex({ r, g, b }: Rgb): string {
  const hex = (value: number) => clampByte(value).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Mix colors with an optional third tint; the remaining weight belongs to color a. */
export function mixHex(a: string, b: string, percentB: number, tint?: { color: string; percent: number }): string {
  const colorA = parseColor(a);
  const colorB = parseColor(b);
  const colorTint = parseColor(tint?.color ?? '#000000');
  if (!colorA || !colorB || !colorTint) return a;
  const weightB = Math.max(0, Math.min(100, percentB)) / 100;
  const weightTint = Math.max(0, Math.min(1 - weightB, (tint?.percent ?? 0) / 100));
  const weightA = 1 - weightB - weightTint;
  return toHex({
    r: colorA.r * weightA + colorB.r * weightB + colorTint.r * weightTint,
    g: colorA.g * weightA + colorB.g * weightB + colorTint.g * weightTint,
    b: colorA.b * weightA + colorB.b * weightB + colorTint.b * weightTint,
    a: 1,
  });
}

/** Composite fg at alpha over opaque bg; returns opaque hex. */
export function alphaOnBg(bg: string, fg: string, alpha: number): string {
  const background = parseColor(bg);
  const foreground = parseColor(fg);
  if (!background || !foreground) return bg;
  const a = Math.max(0, Math.min(1, alpha));
  return toHex({
    r: background.r * (1 - a) + foreground.r * a,
    g: background.g * (1 - a) + foreground.g * a,
    b: background.b * (1 - a) + foreground.b * a,
    a: 1,
  });
}

/** Resolve rgba/hex to opaque hex composited on background. */
export function resolveColorOnBg(color: string, background: string): string {
  const parsed = parseColor(color);
  if (!parsed) return color;
  if (parsed.a >= 1) return toHex(parsed);
  const fg = toHex({ ...parsed, a: 1 });
  return alphaOnBg(background, fg, parsed.a);
}

function brandMixLight(brand: string): string {
  return mixHex(brand, '#ffffff', 30);
}

function brandMixDark(brand: string, background: string): string {
  return mixHex(brand, background, 30);
}

/**
 * Expand Brand Core to BasePalette (~25 keys).
 * Formulas match docs/color-system.md Desktop v5.
 */
export function expandCoreToPalette(core: BrandCore, scheme: ColorScheme): BasePalette {
  const secondaryText = resolveColorOnBg(core.secondaryText, core.background);
  const tertiaryText = resolveColorOnBg(core.onSurfaceMuted, '#ffffff');
  const sidebarBg =
    scheme === 'light'
      ? mixHex(core.background, core.primeText, 4)
      : mixHex(core.background, '#000000', 12);
  const tertiaryBg =
    scheme === 'light'
      ? mixHex(core.background, '#ffffff', 20)
      : mixHex(core.background, '#ffffff', 4);
  const logoLight =
    scheme === 'light'
      ? mixHex(core.background, core.primeText, 10)
      : mixHex(core.background, '#ffffff', 8);
  const hoverBg =
    scheme === 'light'
      ? alphaOnBg(core.background, core.primeText, 0.06)
      : alphaOnBg(core.background, '#ffffff', 0.06);
  const secondaryHoverBg =
    scheme === 'light'
      ? mixHex(core.background, core.primeText, 15)
      : mixHex(core.background, '#ffffff', 8);
  const overlayBg =
    scheme === 'light' ? '#ffffff' : mixHex(core.background, '#000000', 8);
  const selection =
    scheme === 'light'
      ? alphaOnBg(core.background, core.primeText, 0.08)
      : alphaOnBg(core.background, '#ffffff', 0.14);
  const selectionMatch =
    scheme === 'light'
      ? alphaOnBg(core.background, core.primeText, 0.12)
      : alphaOnBg(core.background, '#ffffff', 0.18);
  const buttonBg = scheme === 'light' ? core.brandDark : '#ffffff';
  const buttonText = scheme === 'light' ? '#ffffff' : core.onSurface;

  return {
    brand: core.brand,
    highlight: core.highlight,
    background: core.background,
    titlebarBg: core.background,
    sidebarBg,
    secondaryBg: sidebarBg,
    tertiaryBg,
    buttonBg,
    buttonBgHover: core.brand,
    buttonText,
    primeText: core.primeText,
    secondaryText,
    tertiaryText,
    linkText: core.primeText,
    linkTextHover: core.brand,
    hoverBg,
    secondaryHoverBg,
    activeBorder: core.brand,
    logoLight,
    logoDark: scheme === 'light' ? core.brandDark : '#ffffff',
    trigramYao: core.primeText,
    healthText: scheme === 'light' ? HEALTH_TEXT_LIGHT : HEALTH_TEXT_DARK,
    selection,
    selectionMatch,
    overlayBg,
  };
}

export function expandCoreToCodeTokens(
  core: BrandCore,
  scheme: ColorScheme,
): NonNullable<CodeThemeConfig['tokens']> {
  const secondaryText = resolveColorOnBg(core.secondaryText, core.background);
  const brandLight = brandMixLight(core.brand);
  const brandDark = brandMixDark(core.brand, core.background);

  return {
    keyword: core.brandDark,
    string: core.brand,
    number: scheme === 'light' ? brandLight : brandDark,
    type: scheme === 'light' ? brandLight : brandDark,
    function: core.brand,
    property: scheme === 'light' ? core.brandDark : brandLight,
    variable: core.primeText,
    comment: secondaryText,
    meta: secondaryText,
    operator: secondaryText,
    punctuation: core.primeText,
    invalid: core.brandDark,
  };
}

/** Markdown code surfaces: light = subtle neutral lift; dark = secondary chrome. */
export function codeSurfaceBgForScheme(palette: BasePalette, scheme: ColorScheme): string {
  return scheme === 'light'
    ? mixHex(palette.background, palette.primeText, 2)
    : palette.secondaryBg ?? palette.background;
}

export function expandCoreToMarkdownTheme(
  core: BrandCore,
  scheme: ColorScheme,
): Pick<MarkdownThemeConfig, 'editor' | 'syntax' | 'preview'> {
  const palette = expandCoreToPalette(core, scheme);
  const secondaryText = palette.secondaryText;
  const codeSurfaceBg = codeSurfaceBgForScheme(palette, scheme);

  return {
    editor: {
      background: palette.background,
      foreground: palette.primeText,
      caret: palette.primeText,
      activeLine: scheme === 'dark' ? palette.secondaryHoverBg : palette.tertiaryBg,
      gutterBg: palette.background,
      gutterFg: palette.logoLight,
      gutterBorder: palette.logoLight,
      fontFamily: '',
    },
    syntax: {
      heading1: palette.primeText,
      heading2: palette.primeText,
      heading3: palette.primeText,
      heading4: palette.primeText,
      emphasis: palette.primeText,
      strong: palette.primeText,
      link: core.brand,
      url: core.brand,
      quote: secondaryText,
      list: palette.primeText,
      hr: palette.logoLight,
      meta: secondaryText,
      comment: secondaryText,
    },
    preview: {
      heading1: palette.primeText,
      heading2: palette.primeText,
      heading3: palette.primeText,
      heading4: palette.primeText,
      emphasis: palette.primeText,
      strong: palette.primeText,
      highlightBg: palette.selectionMatch,
      codeInlineBg: codeSurfaceBg,
      codeInlineText: secondaryText,
      codeBlockBg: codeSurfaceBg,
      codeBlockText: secondaryText,
      codeBlockFontFamily: DEFAULT_MARKDOWN_CODE_BLOCK_FONT_FAMILY,
      link: palette.linkText,
      wikilink: palette.linkText,
      frontmatterLink: palette.linkText,
      blockquoteBorder: palette.logoLight,
      blockquoteText: secondaryText,
      syntaxVisible: palette.primeText,
      calloutBg: palette.secondaryBg,
      calloutBorder: palette.logoLight,
      calloutNote: core.brand,
      calloutWarning: core.brand,
      calloutInfo: core.brand,
      calloutTip: core.brand,
      calloutSuccess: core.brand,
      calloutDanger: core.brand,
      frontmatterBg: palette.secondaryBg,
      frontmatterText: secondaryText,
      tableBorder: palette.logoLight,
      taskBorder: palette.logoLight,
      taskBg: palette.tertiaryBg,
      taskCheckedBg: core.brand,
      taskCheckedText: scheme === 'light' ? '#ffffff' : core.onSurface,
      taskLineText: palette.primeText,
      mathInline: core.brand,
      mathBlockBg: palette.secondaryBg,
      mermaidBg: palette.secondaryBg,
      mermaidError: core.brandDark,
    },
  };
}

/** Non-empty override strings win over base values. */
export function mergeTokenOverrides<T extends Record<string, string | undefined>>(
  base: T,
  overrides?: Partial<T> | Record<string, string | undefined>,
): T {
  if (!overrides) return base;
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'string' && value.trim() !== '') {
      (result as Record<string, string>)[key] = value.trim();
    }
  }
  return result;
}
