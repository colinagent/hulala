import type { EditorState } from '@codemirror/state';

export type FirstEditableMarkdownPosition = {
  position: number;
  insert: string;
};

export function resolveFirstEditableMarkdownPosition(
  state: EditorState,
  frontmatter: { endLineNumber: number } | null,
  collapseFrontmatter: boolean,
): FirstEditableMarkdownPosition {
  if (!frontmatter || !collapseFrontmatter) {
    return { position: 0, insert: '' };
  }

  let firstBlankPosition: number | null = null;
  for (let lineNumber = frontmatter.endLineNumber + 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (firstBlankPosition === null) {
      firstBlankPosition = line.from;
    }
    if (line.text.trim()) {
      return { position: line.from, insert: '' };
    }
  }

  if (firstBlankPosition !== null) {
    return { position: firstBlankPosition, insert: '' };
  }

  const insert = state.doc.length > 0 && state.doc.sliceString(state.doc.length - 1) !== '\n'
    ? '\n'
    : '';
  return {
    position: state.doc.length + insert.length,
    insert,
  };
}
