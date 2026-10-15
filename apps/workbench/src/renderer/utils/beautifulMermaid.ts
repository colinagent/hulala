type BeautifulMermaidModule = {
  renderMermaidSVG(code: string, theme: BeautifulMermaidTheme): string;
};

export type BeautifulMermaidTheme = {
  bg: string;
  fg: string;
  accent: string;
  border: string;
  transparent: boolean;
};

const HULALA_MERMAID_THEME: BeautifulMermaidTheme = {
  bg: 'var(--color-editor-bg)',
  fg: 'var(--color-editor-fg)',
  accent: 'var(--color-accent)',
  border: 'var(--color-border)',
  transparent: true,
};

let beautifulMermaidPromise: Promise<BeautifulMermaidModule> | null = null;

function loadBeautifulMermaid(): Promise<BeautifulMermaidModule> {
  beautifulMermaidPromise ??= import('beautiful-mermaid') as Promise<BeautifulMermaidModule>;
  return beautifulMermaidPromise;
}

function normalizeMermaidClassName(value: string): string {
  return value.replace(/[^\w]/g, '_');
}

/**
 * beautiful-mermaid 1.x does not accept the trailing semicolon Mermaid allows
 * on `class` assignments, and accepts hyphens in `:::` names but not in
 * `classDef` / `class` names. A rejected directive otherwise falls through as
 * a bare node named "class" or "classDef". Normalize those equivalent forms
 * before parsing and drop only malformed style directives that cannot be
 * represented without inventing a visible node.
 */
export function normalizeBeautifulMermaidSource(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      const classDef = /^(\s*classDef\s+)([\w-]+)(\s+.+)$/.exec(line);
      if (classDef) {
        return `${classDef[1]}${normalizeMermaidClassName(classDef[2])}${classDef[3]}`;
      }

      const classAssignment = /^(\s*class\s+)([\w,-]+)(\s+)([\w-]+)\s*;?\s*$/.exec(line);
      if (classAssignment) {
        return `${classAssignment[1]}${classAssignment[2]}${classAssignment[3]}${normalizeMermaidClassName(classAssignment[4])}`;
      }

      if (/^\s*class(?:Def)?\b/.test(line)) return '';
      return line.replace(/:::([\w][\w-]*)/g, (_match, className: string) => (
        `:::${normalizeMermaidClassName(className)}`
      ));
    })
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Render Mermaid with the same lazy-loaded engine and Hulala theme everywhere.
 * Both the Markdown editor widget and conversation Markdown use this boundary.
 */
export async function renderBeautifulMermaidSvg(code: string): Promise<string> {
  const { renderMermaidSVG } = await loadBeautifulMermaid();
  return renderMermaidSVG(normalizeBeautifulMermaidSource(code), HULALA_MERMAID_THEME);
}
