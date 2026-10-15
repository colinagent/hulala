/**
 * Markdown theme configuration from markdown-themes.jsonc
 */
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

export type CodeThemeConfig = {
  id: string;
  name: string;
  tokens?: CodeThemeTokens;
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
  frontmatterLink?: string;
  tableBorder?: string;
  tableBg?: string;
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

export type MarkdownThemeConfig = {
  id: string;
  name: string;
  editor?: MarkdownThemeEditor;
  syntax?: MarkdownThemeSyntax;
  preview?: MarkdownThemePreview;
};

export type ThemeTokens = {
  background: string;
  secondaryBg: string;
  overlayBg: string;
  tertiaryBg: string;
  buttonBg: string;
  buttonBgHover: string;
  buttonText: string;
  primeText: string;
  secondaryText: string;
  tertiaryText: string;
  linkText: string;
  linkTextHover: string;
  logoLight: string;
  logoDark: string;
  trigramYao: string;
  healthText: string;
  editorBg: string;
  editorFg: string;
  sidebarBg: string;
  sidebarHoverBg: string;
  sidebarFg: string;
  titlebarBg: string;
  border: string;
  activeBorder: string;
  brand: string;
  accent: string;
  accentHover: string;
  hoverBg: string;
  secondaryHoverBg: string;
  selection: string;
  /** 选中相同字符高亮背景（.cm-selectionMatch） */
  selectionMatch: string;
  /** 搜索命中项背景色（全局搜索结果 / 局部搜索高亮） */
  searchMatchBg: string;
  /** 搜索命中项前景色（对应 searchMatchBg 的可读色） */
  searchMatchText: string;
  highlight: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;
  editorCaret: string;
  editorActiveLine: string;
  editorGutterBg: string;
  editorGutterBorder: string;
  editorGutterFg: string;
  editorFontFamily: string;
  codeKeyword: string;
  codeString: string;
  codeNumber: string;
  codeType: string;
  codeFunction: string;
  codeProperty: string;
  codeVariable: string;
  codeComment: string;
  codeMeta: string;
  codeOperator: string;
  codePunctuation: string;
  codeInvalid: string;
  syntaxHeading1: string;
  syntaxHeading2: string;
  syntaxHeading3: string;
  syntaxHeading4: string;
  syntaxEmphasis: string;
  syntaxStrong: string;
  syntaxLink: string;
  syntaxUrl: string;
  syntaxQuote: string;
  syntaxList: string;
  syntaxHr: string;
  syntaxMeta: string;
  syntaxComment: string;
  previewHeading1: string;
  previewHeading2: string;
  previewHeading3: string;
  previewHeading4: string;
  previewEmphasis: string;
  previewStrong: string;
  previewHighlightBg: string;
  previewCodeInlineBg: string;
  previewCodeInlineText: string;
  previewCodeBlockFontFamily: string;
  previewLink: string;
  previewBlockquoteBorder: string;
  previewBlockquoteText: string;
  previewSyntaxVisible: string;
  previewCodeBlockBg: string;
  previewCodeBlockText: string;
  previewCalloutBg: string;
  previewCalloutBorder: string;
  previewCalloutNote: string;
  previewCalloutWarning: string;
  previewCalloutInfo: string;
  previewCalloutTip: string;
  previewCalloutSuccess: string;
  previewCalloutDanger: string;
  previewFrontmatterText: string;
  previewFrontmatterBg: string;
  previewFrontmatterLink: string;
  previewTableBorder: string;
  previewTableBg: string;
  previewWikilink: string;
  previewTaskBorder: string;
  previewTaskBg: string;
  previewTaskCheckedBg: string;
  previewTaskCheckedText: string;
  previewTaskLineText: string;
  previewMathInline: string;
  previewMathBlockBg: string;
  previewMermaidBg: string;
  previewMermaidError: string;
  terminalBg: string;
  terminalFg: string;
  terminalSelection: string;
  terminalCursor: string;
};

const cssVarPrefix = '--color-';

function toKebabCase(input: string) {
  return input.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function tokenToCssVar(token: keyof ThemeTokens | string) {
  return `${cssVarPrefix}${toKebabCase(String(token))}`;
}

export function tokensToCssVariables(tokens: ThemeTokens) {
  return Object.entries(tokens)
    .map(([key, value]) => `  ${tokenToCssVar(key)}: ${value};`)
    .join('\n');
}

export function cssVar(token: keyof ThemeTokens) {
  return `var(${tokenToCssVar(token)})`;
}

export function tokenValueToRgb(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 3) {
    return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
  }
  return trimmed;
}

export function resolveTokenColor(token: keyof ThemeTokens, fallback: string) {
  if (typeof window === 'undefined') {
    return fallback;
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(tokenToCssVar(token))
    .trim();
  if (!raw) {
    return fallback;
  }
  const parts = raw.split(/\s+/);
  if (parts.length >= 3) {
    return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
  }
  return raw;
}
