/**
 * CodeMirror theme for markdown editor
 * Reference: VS Code markdownEditor/browser/codemirror/theme.ts
 */

import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { cssVar } from '../../../theme/tokens';

/** Shared editor theme; non-markdown editors use paddingLeft 0. */
export const baseEditorTheme = EditorView.theme({
  '&': {
    position: 'relative',
    backgroundColor: cssVar('editorBg'),
    color: cssVar('editorFg'),
  },
  '.cm-content': {
    caretColor: cssVar('editorCaret'),
    fontFamily: cssVar('editorFontFamily'),
    fontSize: 'var(--op-md-body-font-size)',
    lineHeight: 'var(--op-md-body-line-height)',
    paddingTop: '16px',
    paddingRight: '20px',
    paddingLeft: '0',
    paddingBottom: '16px',
  },
  '.cm-cursor': {
    borderLeftColor: cssVar('editorCaret'),
    borderLeftWidth: '2px',
  },
  '.cm-activeLine': {
    backgroundColor: cssVar('editorActiveLine'),
  },
  '.cm-activeLineGutter': {
    backgroundColor: cssVar('editorActiveLine'),
  },
  '.cm-selectionBackground': {
    backgroundColor: `${cssVar('selection')} !important`,
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: `${cssVar('selection')} !important`,
  },
  /* 选中相同字符高亮（highlightSelectionMatches），颜色由 theme 的 selectionMatch 控制 */
  '.cm-selectionMatch': {
    backgroundColor: cssVar('selectionMatch'),
  },
  /* 局部搜索命中高亮，和全局搜索结果共用 searchMatch token */
  '.cm-searchMatch': {
    backgroundColor: cssVar('searchMatchBg'),
    color: cssVar('searchMatchText'),
    borderRadius: '2px',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: cssVar('brand'),
    color: cssVar('buttonText'),
  },
  '.cm-gutters': {
    backgroundColor: cssVar('editorGutterBg'),
    color: cssVar('editorGutterFg'),
    fontSize: 'var(--op-md-body-font-size)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 0',
    minWidth: '2.5em',
    textAlign: 'right',
    lineHeight: 'var(--op-md-body-line-height)',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 4px',
  },
  '.cm-line': {
    padding: '0 var(--op-md-line-padding-x)',
  },
  '.cm-review-added-line': {
    backgroundColor: 'rgba(95, 185, 120, 0.12)',
    boxShadow: 'inset 3px 0 0 0 rgba(95, 185, 120, 0.72)',
  },
  '.cm-review-hunk-widget': {
    margin: '0',
    backgroundColor: 'transparent',
    color: cssVar('editorFg'),
    fontFamily: 'var(--op-proportional-font-family)',
    fontSize: '12px',
  },
  '.cm-review-hunk-header': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '8px',
    padding: '0 8px 2px',
    backgroundColor: 'transparent',
  },
  '.cm-review-hunk-count': {
    color: cssVar('secondaryText'),
    fontSize: '10px',
    fontWeight: '600',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    opacity: '0.7',
    whiteSpace: 'nowrap',
  },
  '.cm-review-file-toolbar': {
    position: 'absolute',
    top: '8px',
    left: '50%',
    zIndex: '20',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    transform: 'translateX(-50%)',
    padding: '4px 6px',
    border: '0',
    backgroundColor: 'transparent',
    boxShadow: 'none',
    pointerEvents: 'auto',
    fontFamily: 'var(--op-proportional-font-family)',
  },
  '.cm-review-file-toolbar.is-visible': {
    display: 'flex',
  },
  '.cm-review-action': {
    border: '1.5px solid rgba(255, 255, 255, 0.55)',
    borderRadius: '999px',
    padding: '3px 14px',
    fontSize: '12px',
    lineHeight: '18px',
    fontFamily: 'inherit',
    fontWeight: '500',
    color: cssVar('primeText'),
    backgroundColor: 'rgba(255, 255, 255, 0.52)',
    backdropFilter: 'blur(24px) saturate(140%)',
    WebkitBackdropFilter: 'blur(24px) saturate(140%)',
    boxShadow: 'inset 0 1px 0 0 rgba(255, 255, 255, 0.6), 0 2px 12px rgba(0, 0, 0, 0.08)',
    cursor: 'pointer',
    transition: 'color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
  },
  '.cm-review-action:hover:not(:disabled)': {
    color: cssVar('brand'),
  },
  '.cm-review-action:disabled': {
    cursor: 'default',
    opacity: '0.55',
  },
  '.cm-review-action-keepFile': {
    color: 'rgb(46, 125, 70)',
  },
  '.cm-review-action-undoFile': {
    color: 'rgb(155, 55, 75)',
  },
  '.cm-review-removed-block': {
    padding: '2px 0',
    backgroundColor: 'rgba(185, 75, 95, 0.14)',
    boxShadow: 'inset 3px 0 0 0 rgba(185, 75, 95, 0.72)',
  },
  '.cm-review-removed-line': {
    padding: '0 8px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    color: cssVar('editorFg'),
    lineHeight: '1.55',
  },

  // Markdown-specific styles
  '.cm-header': {
    fontWeight: 'bold',
  },
  '.cm-header-1': {
    fontSize: '1.6em',
    color: cssVar('syntaxHeading1'),
  },
  '.cm-header-2': {
    fontSize: '1.4em',
    color: cssVar('syntaxHeading2'),
  },
  '.cm-header-3': {
    fontSize: '1.2em',
    color: cssVar('syntaxHeading3'),
  },
  '.cm-header-4, .cm-header-5, .cm-header-6': {
    fontSize: '1.1em',
    color: cssVar('syntaxHeading4'),
  },
  '.cm-md-list-line .cm-header, .cm-md-list-line .cm-header-1, .cm-md-list-line .cm-header-2, .cm-md-list-line .cm-header-3, .cm-md-list-line .cm-header-4, .cm-md-list-line .cm-header-5, .cm-md-list-line .cm-header-6': {
    fontWeight: 'inherit',
    fontSize: 'inherit',
    color: 'inherit',
  },
  '.cm-em': {
    fontStyle: 'italic',
    color: cssVar('syntaxEmphasis'),
  },
  '.cm-strong': {
    fontWeight: 'bold',
    color: cssVar('syntaxStrong'),
  },
  '.cm-strikethrough': {
    textDecoration: 'line-through',
    color: cssVar('secondaryText'),
  },
  '.cm-link': {
    color: cssVar('syntaxLink'),
    textDecoration: 'none',
  },
  '.cm-url': {
    color: cssVar('syntaxUrl'),
    textDecoration: 'none',
  },
  '.cm-quote': {
    color: cssVar('syntaxQuote'),
    fontStyle: 'italic',
  },
  '.cm-list': {
    color: cssVar('syntaxList'),
  },
  '.cm-hr': {
    color: cssVar('syntaxHr'),
  },
  '.cm-meta': {
    color: cssVar('syntaxMeta'),
  },
  '.cm-comment': {
    color: cssVar('syntaxComment'),
  },

  // Code blocks
  '.cm-monospace': {
    fontFamily: '"SF Mono", Monaco, Menlo, Consolas, monospace',
  },

  // Live preview specific
  '.cm-md-heading': {
    fontWeight: 'bold',
  },
  '.cm-md-heading-1': {
    fontSize: 'var(--op-ui-markdown-heading1-size, 1.8em)',
    color: cssVar('previewHeading1'),
  },
  '.cm-md-heading-2': {
    fontSize: 'var(--op-ui-markdown-heading2-size, 1.5em)',
    color: cssVar('previewHeading2'),
  },
  '.cm-md-heading-3': {
    fontSize: 'var(--op-ui-markdown-heading3-size, 1.25em)',
    color: cssVar('previewHeading3'),
  },
  '.cm-md-heading-4, .cm-md-heading-5, .cm-md-heading-6': {
    fontSize: 'var(--op-ui-markdown-heading4-size, 1.1em)',
    color: cssVar('previewHeading4'),
  },
  /* 聚焦时标题行前的 # marker：只跟随标题字号，颜色走统一的源码显现语义 */
  '.cm-md-heading-marker-1': {
    fontSize: 'var(--op-ui-markdown-heading1-size, 1.8em)',
    fontWeight: 'normal',
  },
  '.cm-md-heading-marker-2': {
    fontSize: 'var(--op-ui-markdown-heading2-size, 1.5em)',
    fontWeight: 'normal',
  },
  '.cm-md-heading-marker-3': {
    fontSize: 'var(--op-ui-markdown-heading3-size, 1.25em)',
    fontWeight: 'normal',
  },
  '.cm-md-heading-marker-4, .cm-md-heading-marker-5, .cm-md-heading-marker-6': {
    fontSize: 'var(--op-ui-markdown-heading4-size, 1.1em)',
    fontWeight: 'normal',
  },
  '.cm-md-list-line .cm-md-heading, .cm-md-list-line .cm-md-heading-1, .cm-md-list-line .cm-md-heading-2, .cm-md-list-line .cm-md-heading-3, .cm-md-list-line .cm-md-heading-4, .cm-md-list-line .cm-md-heading-5, .cm-md-list-line .cm-md-heading-6, .cm-md-list-line .cm-md-heading-marker-1, .cm-md-list-line .cm-md-heading-marker-2, .cm-md-list-line .cm-md-heading-marker-3, .cm-md-list-line .cm-md-heading-marker-4, .cm-md-list-line .cm-md-heading-marker-5, .cm-md-list-line .cm-md-heading-marker-6': {
    fontWeight: 'inherit',
    fontSize: 'inherit',
    color: 'inherit',
  },
  '.cm-md-emphasis': {
    fontStyle: 'italic',
    color: cssVar('previewEmphasis'),
  },
  '.cm-md-strong': {
    fontWeight: 'bold',
    color: cssVar('previewStrong'),
  },
  '.cm-md-blockquote .cm-md-strong': {
    color: 'inherit',
  },
  '.cm-md-highlight': {
    backgroundColor: cssVar('previewHighlightBg'),
    color: 'inherit',
    borderRadius: '2px',
    padding: '0 1px',
  },
  '.cm-md-code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: '0.92em',
    lineHeight: '1.35',
    verticalAlign: 'baseline',
  },
  '.cm-md-link': {
    color: cssVar('linkText'),
    textDecoration: 'underline',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
  },
  '.cm-md-wikilink': {
    color: cssVar('linkText'),
    textDecoration: 'underline',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
  },
  '.cm-md-frontmatter-placeholder': {
    fontSize: '12px',
    color: cssVar('previewFrontmatterText'),
    backgroundColor: cssVar('previewFrontmatterBg'),
    padding: '6px 10px',
    borderRadius: '6px',
  },
  '.cm-md-table': {
    margin: '8px 0',
  },
  '.cm-md-table-block': {
    position: 'relative',
    cursor: 'text',
  },
  '.cm-md-table-src-btn': {
    opacity: 0,
  },
  '.cm-md-table-src-rail:hover .cm-md-table-src-btn': {
    opacity: 1,
  },
  '.cm-md-callout': {
    backgroundColor: cssVar('previewCalloutBg'),
    borderLeft: `4px solid ${cssVar('previewCalloutBorder')}`,
    borderRadius: '6px',
    padding: '6px 12px',
    margin: '6px 0',
  },
  // Block-widget spacing must be inside the measured root box. Vertical
  // margins are excluded from offsetHeight and corrupt CodeMirror posAtCoords.
  '.cm-md-book-note-block': {
    padding: '8px 0',
  },
  '.cm-md-book-note': {
    padding: '10px 12px',
    border: `1px solid ${cssVar('border')}`,
    borderLeft: `4px solid ${cssVar('brand')}`,
    borderRadius: '6px',
    backgroundColor: cssVar('editorBg'),
  },
  '.cm-md-book-note-header': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '6px',
  },
  '.cm-md-book-note-meta': {
    minWidth: 0,
  },
  '.cm-md-book-note-title': {
    color: cssVar('primeText'),
    fontWeight: 600,
    fontSize: '13px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-md-book-note-detail': {
    marginTop: '2px',
    color: cssVar('secondaryText'),
    fontSize: '11px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-md-book-note-actions': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    flex: '0 0 auto',
  },
  '.cm-md-book-note-src-btn': {
    position: 'static',
    opacity: 1,
    width: '24px',
    height: '24px',
    padding: 0,
    border: `1px solid ${cssVar('border')}`,
    borderRadius: '4px',
    color: cssVar('secondaryText'),
  },
  '.cm-md-book-note-src-btn:hover': {
    backgroundColor: cssVar('hoverBg'),
    color: cssVar('primeText'),
  },
  '.cm-md-book-note-src-btn svg': {
    width: '14px',
    height: '14px',
  },
  '.cm-md-book-note-open': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    flex: '0 0 24px',
    padding: 0,
    border: `1px solid ${cssVar('border')}`,
    borderRadius: '4px',
    backgroundColor: 'transparent',
    color: cssVar('secondaryText'),
    cursor: 'pointer',
  },
  '.cm-md-book-note-open:hover': {
    backgroundColor: cssVar('hoverBg'),
    color: cssVar('primeText'),
  },
  '.cm-md-book-note-open-icon': {
    display: 'block',
  },
  '.cm-md-book-note-quote': {
    margin: 0,
    padding: '0 0 0 10px',
    borderLeft: `2px solid ${cssVar('border')}`,
    color: cssVar('editorFg'),
    whiteSpace: 'pre-wrap',
  },
  '.cm-md-book-note-reflection': {
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: `1px solid ${cssVar('border')}`,
    color: cssVar('primeText'),
    fontSize: '13px',
    lineHeight: '1.55',
    whiteSpace: 'pre-wrap',
  },
  '.cm-md-math-inline': {
    padding: '0 2px',
    color: cssVar('previewMathInline'),
  },
  '.cm-md-math-block': {
    margin: '8px 0',
    padding: '8px 10px',
    backgroundColor: cssVar('previewMathBlockBg'),
    borderRadius: '6px',
  },
  '.cm-md-syntax-visible': {
    color: cssVar('brand'),
  },
}, { dark: true });

const markdownDocumentFontFamily = 'var(--op-markdown-document-font-family)';

export const markdownEditorTheme: Extension[] = [
  baseEditorTheme,
  EditorView.theme({
    '.cm-content': {
      fontFamily: markdownDocumentFontFamily,
    },
  }),
];
