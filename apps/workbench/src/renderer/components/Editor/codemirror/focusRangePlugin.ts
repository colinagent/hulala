/**
 * Focus Range Plugin for CodeMirror 6
 * Shows markdown source code near the cursor position
 * Reference: VS Code markdownEditor/browser/codemirror/focusRangePlugin.ts
 */

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';

/**
 * Number of lines around cursor to show source code
 */
const FOCUS_LINES = 0; // Only the current line shows source

/**
 * CSS class for the focus range indicator
 */
const FOCUS_LINE_CLASS = 'cm-focus-line';

/**
 * Build decorations for the focus range
 */
function buildFocusDecorations(view: EditorView): DecorationSet {
  const selection = view.state.selection.main;
  if (!selection) {
    return Decoration.none;
  }

  const cursorLine = view.state.doc.lineAt(selection.head);
  const startLine = Math.max(1, cursorLine.number - FOCUS_LINES);
  const endLine = Math.min(view.state.doc.lines, cursorLine.number + FOCUS_LINES);

  const decorations = [];

  for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
    const line = view.state.doc.line(lineNum);
    decorations.push(
      Decoration.line({
        class: FOCUS_LINE_CLASS,
      }).range(line.from)
    );
  }

  return Decoration.set(decorations, true);
}

/**
 * ViewPlugin for focus range highlighting
 */
class FocusRangePluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildFocusDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.selectionSet || update.docChanged) {
      this.decorations = buildFocusDecorations(update.view);
    }
  }
}

/**
 * Focus range theme
 */
const focusRangeTheme = EditorView.baseTheme({
  '.cm-focus-line': {
    // Focus lines can have a subtle indicator
    // The actual "show source" logic is in livePreviewPlugin
  },
});

/**
 * Create the focus range plugin extension
 */
export function focusRangePlugin() {
  return [
    ViewPlugin.fromClass(FocusRangePluginValue, {
      decorations: (v) => v.decorations,
    }),
    focusRangeTheme,
  ];
}
