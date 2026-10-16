import { ThemeTokens, MarkdownThemeConfig, CodeThemeConfig } from './tokens';
import {
  DEFAULT_DARK_CORE,
  DEFAULT_LIGHT_CORE,
  expandCoreToPalette,
  codeSurfaceBgForScheme,
  mixHex,
} from './brandCore';

export type ThemeDefinition = {
  id: string;
  label: string;
  scheme: 'dark' | 'light';
  tokens: ThemeTokens;
};

export type BasePalette = {
  brand: string;
  highlight: string;
  background: string;
  /** Primary editor and Welcome surface; defaults to Markdown/background. */
  editorBg?: string;
  /** Sidebar rail, sidebar toolbar, and file tree surface; defaults to secondaryBg/background. */
  sidebarBg?: string;
  /** Hover surface used only inside the sidebar tree and controls. */
  sidebarHoverBg?: string;
  /** Top title bar; defaults to background. */
  titlebarBg?: string;
  secondaryBg?: string;
  overlayBg?: string;
  tertiaryBg?: string;
  buttonBg: string;
  buttonBgHover: string;
  buttonText: string;
  primeText: string;
  secondaryText: string;
  tertiaryText?: string;
  linkText: string;
  linkTextHover: string;
  hoverBg?: string;
  secondaryHoverBg?: string;
  activeBorder?: string;
  logoLight: string;
  logoDark: string;
  trigramYao: string;
  healthText: string;
  selection?: string;
  /** 选中相同字符高亮背景，不填则用 brand */
  selectionMatch?: string;
  /** 搜索命中项背景，不填则用 scheme 默认 */
  searchMatchBg?: string;
  /** 搜索命中项前景，不填则用 primeText */
  searchMatchText?: string;
};

// Match the website first-screen --paper token exactly; do not color-compensate
// for browser, display profile, operating system, or capture-path differences.
const DEFAULT_LIGHT_BACKGROUND = DEFAULT_LIGHT_CORE.background;
const DEFAULT_DARK_BACKGROUND = DEFAULT_DARK_CORE.background;

/** Keep product-specific surface choices scoped to the built-in theme. */
export function applyBuiltInSurfaceOverrides(themeId: string, palette: BasePalette): BasePalette {
  if (themeId === 'default-light') {
    // Keep the paper background continuous; borders separate the chrome.
    const chromeBg = DEFAULT_LIGHT_BACKGROUND;
    const lighterBg = mixHex(DEFAULT_LIGHT_BACKGROUND, '#ffffff', 20);
    const borderShade = mixHex(DEFAULT_LIGHT_BACKGROUND, '#000000', 10);
    return {
      ...palette,
      background: DEFAULT_LIGHT_BACKGROUND,
      editorBg: DEFAULT_LIGHT_BACKGROUND,
      titlebarBg: chromeBg,
      sidebarBg: chromeBg,
      secondaryBg: chromeBg,
      tertiaryBg: lighterBg,
      logoLight: borderShade,
    };
  }
  if (themeId === 'default-dark') {
    // Separate the chrome from the editor with borders, using one background.
    const chromeBg = DEFAULT_DARK_BACKGROUND;
    const lighterBg = mixHex(DEFAULT_DARK_BACKGROUND, '#ffffff', 4);
    const borderShade = mixHex(DEFAULT_DARK_BACKGROUND, '#ffffff', 8);
    return {
      ...palette,
      background: DEFAULT_DARK_BACKGROUND,
      editorBg: DEFAULT_DARK_BACKGROUND,
      titlebarBg: chromeBg,
      sidebarBg: chromeBg,
      secondaryBg: chromeBg,
      tertiaryBg: lighterBg,
      logoLight: borderShade,
    };
  }
  return palette;
}

const defaultLightPalette = applyBuiltInSurfaceOverrides(
  'default-light',
  expandCoreToPalette(DEFAULT_LIGHT_CORE, 'light'),
);
const defaultDarkPalette = applyBuiltInSurfaceOverrides(
  'default-dark',
  expandCoreToPalette(DEFAULT_DARK_CORE, 'dark'),
);

const defaultMarkdownEditorFontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const defaultMarkdownCodeBlockFontFamily = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

function resolveFontFamily(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function mapTokens(
  palette: BasePalette,
  scheme: 'dark' | 'light',
  mdTheme?: MarkdownThemeConfig,
  codeTheme?: CodeThemeConfig
): ThemeTokens {
  const ed = mdTheme?.editor;
  const syn = mdTheme?.syntax;
  const pv = mdTheme?.preview;
  const code = codeTheme?.tokens;
  const hoverBackground = (surface: string) => scheme === 'dark'
    ? mixHex(surface, palette.brand, 4, { color: '#ffffff', percent: 6 })
    : mixHex(surface, palette.brand, 8, { color: '#000000', percent: 2 });
  const hoverBg = hoverBackground(palette.editorBg ?? ed?.background ?? palette.background);
  const previewHighlightBg = pv?.highlightBg ?? palette.selectionMatch ?? palette.selection ?? palette.brand;
  const previewFrontmatterLink = pv?.frontmatterLink ?? palette.linkText;
  const darkSurfaceBg = palette.secondaryBg ?? palette.background;
  const darkActiveLineBg = palette.secondaryHoverBg ?? palette.logoLight;
  const sidebarBg = palette.sidebarBg ?? palette.secondaryBg ?? palette.background;
  const sidebarHoverBg = hoverBackground(sidebarBg);

  return {
    background: palette.background,
    secondaryBg: palette.secondaryBg ?? palette.background,
    overlayBg: palette.overlayBg ?? palette.secondaryBg ?? palette.background,
    tertiaryBg: palette.tertiaryBg ?? palette.secondaryBg ?? palette.background,
    buttonBg: palette.buttonBg,
    buttonBgHover: palette.buttonBgHover,
    buttonText: palette.buttonText,
    primeText: palette.primeText,
    secondaryText: palette.secondaryText,
    tertiaryText: palette.tertiaryText ?? palette.secondaryText,
    linkText: palette.linkText,
    linkTextHover: palette.linkTextHover,
    logoLight: palette.logoLight,
    logoDark: palette.logoDark,
    trigramYao: palette.trigramYao,
    healthText: palette.healthText,
    editorBg: palette.editorBg ?? ed?.background ?? palette.background,
    editorFg: ed?.foreground ?? palette.primeText,
    sidebarBg,
    sidebarHoverBg,
    sidebarFg: scheme === 'dark' ? palette.secondaryText : palette.primeText,
    titlebarBg: palette.titlebarBg ?? palette.background,
    border: palette.logoLight,
    activeBorder: palette.activeBorder ?? palette.logoLight,
    brand: palette.brand,
    accent: palette.brand,
    accentHover: palette.brand,
    hoverBg,
    secondaryHoverBg: palette.secondaryHoverBg
      ?? hoverBg,
    selection: palette.selection ?? palette.brand,
    selectionMatch: palette.selectionMatch ?? palette.brand,
    searchMatchBg: palette.searchMatchBg ?? palette.selectionMatch ?? palette.brand,
    searchMatchText: palette.searchMatchText ?? palette.primeText,
    highlight: palette.highlight,
    scrollbarThumb: palette.logoLight,
    scrollbarThumbHover: palette.logoLight,
    editorCaret: ed?.caret ?? palette.primeText,
    editorActiveLine: ed?.activeLine ?? (scheme === 'dark' ? darkActiveLineBg : palette.logoLight),
    editorGutterBg: palette.editorBg ?? ed?.gutterBg ?? palette.background,
    editorGutterBorder: ed?.gutterBorder ?? palette.logoLight,
    editorGutterFg: ed?.gutterFg ?? palette.logoLight,
    editorFontFamily: resolveFontFamily(ed?.fontFamily, defaultMarkdownEditorFontFamily),
    codeKeyword: code?.keyword ?? palette.brand,
    codeString: code?.string ?? palette.linkText,
    codeNumber: code?.number ?? palette.linkTextHover,
    codeType: code?.type ?? palette.linkTextHover,
    codeFunction: code?.function ?? palette.linkTextHover,
    codeProperty: code?.property ?? palette.primeText,
    codeVariable: code?.variable ?? palette.primeText,
    codeComment: code?.comment ?? palette.secondaryText,
    codeMeta: code?.meta ?? palette.secondaryText,
    codeOperator: code?.operator ?? palette.secondaryText,
    codePunctuation: code?.punctuation ?? palette.secondaryText,
    codeInvalid: code?.invalid ?? palette.brand,
    syntaxHeading1: syn?.heading1 ?? palette.primeText,
    syntaxHeading2: syn?.heading2 ?? palette.primeText,
    syntaxHeading3: syn?.heading3 ?? palette.primeText,
    syntaxHeading4: syn?.heading4 ?? palette.primeText,
    syntaxEmphasis: syn?.emphasis ?? palette.primeText,
    syntaxStrong: syn?.strong ?? palette.primeText,
    syntaxLink: syn?.link ?? palette.linkText,
    syntaxUrl: syn?.url ?? palette.linkText,
    syntaxQuote: syn?.quote ?? palette.secondaryText,
    syntaxList: syn?.list ?? palette.primeText,
    syntaxHr: syn?.hr ?? palette.logoLight,
    syntaxMeta: syn?.meta ?? palette.secondaryText,
    syntaxComment: syn?.comment ?? palette.secondaryText,
    previewHeading1: pv?.heading1 ?? palette.primeText,
    previewHeading2: pv?.heading2 ?? palette.primeText,
    previewHeading3: pv?.heading3 ?? palette.primeText,
    previewHeading4: pv?.heading4 ?? palette.primeText,
    previewEmphasis: pv?.emphasis ?? palette.primeText,
    previewStrong: pv?.strong ?? palette.primeText,
    previewHighlightBg,
    previewCodeInlineBg: pv?.codeInlineBg ?? (scheme === 'dark' ? darkSurfaceBg : codeSurfaceBgForScheme(palette, scheme)),
    previewCodeInlineText: pv?.codeInlineText ?? palette.secondaryText,
    previewCodeBlockFontFamily: resolveFontFamily(pv?.codeBlockFontFamily, defaultMarkdownCodeBlockFontFamily),
    previewLink: pv?.link ?? palette.linkText,
    previewBlockquoteBorder: pv?.blockquoteBorder ?? palette.logoLight,
    previewBlockquoteText: pv?.blockquoteText ?? palette.secondaryText,
    previewSyntaxVisible: pv?.syntaxVisible ?? palette.secondaryText,
    previewCodeBlockBg: pv?.codeBlockBg ?? (scheme === 'dark' ? darkSurfaceBg : codeSurfaceBgForScheme(palette, scheme)),
    previewCodeBlockText: pv?.codeBlockText ?? palette.secondaryText,
    previewCalloutBg: pv?.calloutBg ?? (scheme === 'dark' ? darkSurfaceBg : palette.logoLight),
    previewCalloutBorder: pv?.calloutBorder ?? palette.logoLight,
    previewCalloutNote: pv?.calloutNote ?? palette.brand,
    previewCalloutWarning: pv?.calloutWarning ?? palette.brand,
    previewCalloutInfo: pv?.calloutInfo ?? palette.brand,
    previewCalloutTip: pv?.calloutTip ?? palette.brand,
    previewCalloutSuccess: pv?.calloutSuccess ?? palette.brand,
    previewCalloutDanger: pv?.calloutDanger ?? palette.brand,
    previewFrontmatterText: pv?.frontmatterText ?? palette.secondaryText,
    previewFrontmatterBg: pv?.frontmatterBg ?? (scheme === 'dark' ? darkSurfaceBg : palette.logoLight),
    previewFrontmatterLink,
    previewTableBorder: pv?.tableBorder ?? palette.logoLight,
    previewTableBg: pv?.tableBg ?? (scheme === 'dark' ? darkSurfaceBg : palette.logoLight),
    previewWikilink: pv?.wikilink ?? palette.linkText,
    previewTaskBorder: pv?.taskBorder ?? palette.logoLight,
    previewTaskBg: pv?.taskBg ?? (scheme === 'dark' ? (palette.tertiaryBg ?? darkSurfaceBg) : palette.logoLight),
    previewTaskCheckedBg: pv?.taskCheckedBg ?? palette.brand,
    previewTaskCheckedText: pv?.taskCheckedText ?? palette.buttonText,
    previewTaskLineText: pv?.taskLineText ?? palette.primeText,
    previewMathInline: pv?.mathInline ?? palette.brand,
    previewMathBlockBg: pv?.mathBlockBg ?? (scheme === 'dark' ? darkSurfaceBg : palette.logoLight),
    previewMermaidBg: pv?.mermaidBg ?? (scheme === 'dark' ? darkSurfaceBg : palette.logoLight),
    previewMermaidError: pv?.mermaidError ?? palette.brand,
    terminalBg: palette.background,
    terminalFg: palette.primeText,
    terminalSelection: palette.selection ?? palette.brand,
    terminalCursor: palette.primeText,
  };
}

const defaultLightTokens = mapTokens(defaultLightPalette, 'light');
const defaultDarkTokens = mapTokens(defaultDarkPalette, 'dark');

export const themes: ThemeDefinition[] = [
  {
    id: 'default-light',
    label: 'Default Light',
    scheme: 'light',
    tokens: defaultLightTokens,
  },
  {
    id: 'default-dark',
    label: 'Default Dark',
    scheme: 'dark',
    tokens: defaultDarkTokens,
  },
];

export const defaultThemeId = 'default-light';

export function getThemeById(themeId: string) {
  return themes.find((theme) => theme.id === themeId);
}
