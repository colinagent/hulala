export type ParsedInlineMarkdownLink = {
  label: string;
  target: string;
};

export function parseInlineMarkdownLinkSource(
  text: string
): ParsedInlineMarkdownLink | null {
  const match = text.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
  if (!match) {
    return null;
  }

  return {
    label: match[1],
    target: match[2].trim(),
  };
}

export function isInlineMarkdownLinkSource(text: string): boolean {
  return parseInlineMarkdownLinkSource(text) !== null;
}
