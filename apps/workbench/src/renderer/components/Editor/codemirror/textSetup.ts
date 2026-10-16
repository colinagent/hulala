/**
 * CodeMirror 6 setup for Plain Text Editor
 */

import { EditorView, ViewUpdate, keymap, lineNumbers } from '@codemirror/view';
import { EditorState, Extension, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { syntaxHighlighting } from '@codemirror/language';
import { baseEditorTheme } from './theme';
import { editorSyntaxHighlighter } from './highlight';
import { frontmatterDecorations } from './frontmatterDecorations';
import { lineNumberToggleGutter, setLineNumbersVisible as applyLineNumbersVisible } from './lineNumberToggleGutter';
import { editorMouseWheelZoom } from './editorMouseWheelZoom';
import { createHiddenSearchPanel } from '../search/hiddenSearchPanel';
import {
  createCodeMirrorViewStateTracker,
  restoreCodeMirrorViewState,
  type CodeMirrorViewStateSnapshot,
} from './viewState';

export type TextEditorViewState = CodeMirrorViewStateSnapshot;

export interface TextEditorInstance {
  /**
   * Get the current content of the editor.
   */
  getContent(): string;

  /**
   * Set the content of the editor.
   */
  setContent(content: string): void;

  /**
   * Focus the editor.
   */
  focus(): void;

  /** Capture cursor, selection, and viewport state. */
  getViewState(): TextEditorViewState;

  /** Restore cursor, selection, and viewport state. */
  restoreViewState(state: TextEditorViewState): void;

  /**
   * Scroll to a document position.
   */
  scrollToPos(pos: number): boolean;

  /**
   * Get the underlying CodeMirror view instance.
   */
  getView(): EditorView;

  /**
   * Destroy the editor instance.
   */
  destroy(): void;

  /**
   * Toggle line numbers without recreating the editor.
   */
  setLineNumbersVisible(visible: boolean): void;
}

export interface TextEditorOptions {
  /**
   * Initial content
   */
  initialContent?: string;

  /**
   * Callback when content changes
   */
  onContentChange?: (content: string) => void;

  /**
   * Callback when selection changes.
   */
  onSelectionChange?: (selection: { anchor: number; head: number }) => void;

  /**
   * Callback when focus state changes.
   */
  onFocusChange?: (focused: boolean) => void;

  /** Preloaded language extensions for syntax highlighting. */
  languageExtensions?: Extension[];

  /**
   * Show line numbers in the gutter (default: true)
   */
  showLineNumbers?: boolean;

  /**
   * Initial review overlay line ranges.
   */


  /**
   * Called when the user requests the find/replace overlay (⌘F / ⌘⌥F).
   * Setting this disables the default CodeMirror search panel binding.
   */
  onOpenSearchPanel?: (options: { replace: boolean }) => void;
}

/**
 * Creates a CodeMirror 6 based text editor.
 */
export function createTextEditor(
  container: HTMLElement,
  options: TextEditorOptions = {}
): TextEditorInstance {
  const {
    initialContent = '',
    onContentChange,
    onSelectionChange,
    onFocusChange,
    languageExtensions = [],
    showLineNumbers = true,
    onOpenSearchPanel,
  } = options;

  let isUpdatingFromExternal = false;

  // Build extensions
  const extensions: Extension[] = [
    lineNumberToggleGutter(),
    lineNumbers(),

    // Language support (if available)
    ...languageExtensions,

    // Syntax highlighting styles
    syntaxHighlighting(editorSyntaxHighlighter, { fallback: true }),

    // History (undo/redo)
    history(),

    // Keymaps
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap.filter((b) => b.key !== 'Mod-f'),
    ]),
    Prec.high(
      keymap.of([
        {
          key: 'Mod-f',
          preventDefault: true,
          run: () => {
            if (onOpenSearchPanel) {
              onOpenSearchPanel({ replace: false });
              return true;
            }
            return false;
          },
        },
        {
          key: 'Mod-Alt-f',
          preventDefault: true,
          run: () => {
            if (onOpenSearchPanel) {
              onOpenSearchPanel({ replace: true });
              return true;
            }
            return false;
          },
        },
      ])
    ),

    // Search state/highlighting used by our custom React search overlay.
    // The real UI is React; this hidden panel only flips CodeMirror's panel=true
    // so the built-in search highlighter emits .cm-searchMatch decorations.
    search({ createPanel: createHiddenSearchPanel }),

    // Selection-match highlighting
    highlightSelectionMatches(),

    // Custom theme
    baseEditorTheme,
    editorMouseWheelZoom(),
    frontmatterDecorations(),

    // Update listener for syncing content
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.focusChanged && onFocusChange) {
        onFocusChange(update.view.hasFocus);
      }
      if (update.selectionSet && onSelectionChange) {
        const selection = update.state.selection.main;
        onSelectionChange({
          anchor: selection.anchor,
          head: selection.head,
        });
      }
      if (update.docChanged && !isUpdatingFromExternal && onContentChange) {
        onContentChange(update.state.doc.toString());
      }
    }),

    // No line wrapping for non-Markdown (code/config files keep long lines, horizontal scroll)
  ];

  // Create editor state
  const state = EditorState.create({
    doc: initialContent,
    extensions,
  });

  // Create editor view
  const view = new EditorView({
    state,
    parent: container,
  });
  const viewStateTracker = createCodeMirrorViewStateTracker(view);
  applyLineNumbersVisible(view, showLineNumbers);
  if (onSelectionChange) {
    const selection = view.state.selection.main;
    onSelectionChange({
      anchor: selection.anchor,
      head: selection.head,
    });
  }

  return {
    getContent(): string {
      return view.state.doc.toString();
    },

    setContent(content: string): void {
      const currentContent = view.state.doc.toString();
      if (currentContent !== content) {
        isUpdatingFromExternal = true;
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: content,
          },
        });
        isUpdatingFromExternal = false;
      }
    },

    focus(): void {
      view.focus();
    },

    getViewState(): TextEditorViewState {
      return viewStateTracker.get();
    },

    restoreViewState(state: TextEditorViewState): void {
      restoreCodeMirrorViewState(view, state);
      viewStateTracker.note(state);
    },

    scrollToPos(pos: number): boolean {
      const nextPos = Math.max(0, Math.min(pos, view.state.doc.length));
      view.dispatch({
        selection: { anchor: nextPos },
        scrollIntoView: true,
      });
      view.focus();
      return true;
    },

    getView(): EditorView {
      return view;
    },

    destroy(): void {
      viewStateTracker.destroy();
      view.destroy();
    },

    setLineNumbersVisible(visible: boolean): void {
      applyLineNumbersVisible(view, visible);
    },
  };
}
