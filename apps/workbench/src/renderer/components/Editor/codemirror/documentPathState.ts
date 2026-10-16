import { Facet, type EditorState } from '@codemirror/state';

export const markdownDocumentPathFacet = Facet.define<string | null, string | null>({
  combine(values) {
    if (values.length === 0) {
      return null;
    }
    const value = values[0];
    const normalized = (value || '').trim();
    return normalized || null;
  },
});

export function getMarkdownDocumentPath(state: EditorState): string | null {
  const value = state.facet(markdownDocumentPathFacet);
  const normalized = (value || '').trim();
  return normalized || null;
}
