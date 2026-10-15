const REQUIRED_EDITABLE_TAIL_NEWLINES = 2;

/**
 * Return the line breaks needed to keep one real, editable Markdown line after
 * the final rendered block. Live-preview block widgets consume the first
 * trailing line break as part of their replacement range, so one is not
 * enough when an image, table, diagram, or note card is the last block.
 */
export function getEditableMarkdownTailAppend(content: string): string {
  if (!content) {
    return '';
  }

  let trailingNewlines = 0;
  for (let index = content.length - 1; index >= 0 && content[index] === '\n'; index -= 1) {
    trailingNewlines += 1;
  }
  return '\n'.repeat(Math.max(0, REQUIRED_EDITABLE_TAIL_NEWLINES - trailingNewlines));
}

export function ensureEditableMarkdownTail(content: string): string {
  return `${content}${getEditableMarkdownTailAppend(content)}`;
}
