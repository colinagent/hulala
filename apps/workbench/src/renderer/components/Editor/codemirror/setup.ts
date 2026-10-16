/**
 * CodeMirror 6 setup for Markdown Live Preview
 * Reference: VS Code markdownEditor/browser/codemirror/setup.ts
 */

import { EditorView, ViewUpdate, keymap } from '@codemirror/view';
import { Annotation, Compartment, EditorState, Extension, Prec, StateCommand, Transaction } from '@codemirror/state';
import { markdown, markdownLanguage, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { indentUnit, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { SyntaxNode } from '@lezer/common';
import { livePreviewBlockDecorations } from './livePreviewBlockDecorations';
import { refreshLivePreviewDecorationsEffect } from './livePreviewDecorationEffects';
import { imageSourceField } from './imageSourceState';
import { livePreviewInteractions, livePreviewPlugin, type ImageActivation } from './livePreviewPlugin';
import { listHangingIndent } from './listHangingIndent';
import { livePreviewParseRefresh } from './livePreviewParseRefresh';
import { focusRangePlugin } from './focusRangePlugin';
import { frontmatterDecorations } from './frontmatterDecorations';
import {
  createFrontmatterPanelOptionsCompartment,
  frontmatterPanelOptionsExtension,
  frontmatterPanelPlugin,
  reconfigureFrontmatterPanelOptions,
  refreshFrontmatterPanel,
} from './frontmatterPanelPlugin';
import {
  createDocumentHeaderOptionsCompartment,
  documentHeaderOptionsExtension,
  reconfigureDocumentHeaderOptions,
  refreshDocumentHeader,
  type DocumentHeaderOptions,
} from '../../../utils/documentHeaderState';
import { documentHeaderPlugin } from './documentHeaderPlugin';
import { getMarkdownDocumentPath, markdownDocumentPathFacet } from './documentPathState';
import { getWorkspaceStateForEditor, workspaceStoreFacet } from './workspaceStoreState';
import type { WorkspaceStore } from '../../../store/appStore';
import { markdownEditorTheme } from './theme';
import { editorSyntaxHighlighter } from './highlight';
import { editorMouseWheelZoom } from './editorMouseWheelZoom';
import { imeCompositionLayout } from './imeCompositionLayout';
import { createHiddenSearchPanel } from '../search/hiddenSearchPanel';
import { getActiveTableSelectionText } from './widgets/TableWidget';
import { useToastStore } from '../../../store/toastStore';
import { writeClipboardText } from '../../../services/clipboardService';
import {
  applyInlineFormat,
  clearInlineFormatting as clearInlineFormattingCommand,
  type InlineFormatResult,
  type MarkdownInlineFormat,
} from './utils/inlineFormat';
import {
  getListContinuationInsertAt,
  getListDepth,
  getListItemContinuationIndentAt,
  parseListLinePrefix,
} from './utils/listPrefix';
import {
  firstOrderedListMarkerForDepth,
  normalizeOrderedListMarker,
  normalizeOrderedListMarkersInMarkdown,
} from './utils/orderedListDisplay';
import { orderedListRenumbering, skipOrderedListRenumber } from './orderedListRenumber';
import { editableMarkdownTail } from './editableTail';
import { buildImageInsertion } from './imageInsertion';
import {
  createCodeMirrorViewStateTracker,
  getCodeMirrorScrollAnchor,
  restoreCodeMirrorViewState,
  type CodeMirrorViewStateSnapshot,
} from './viewState';

function getMarkdownContext(state: EditorState, pos: number): {
  inCodeBlock: boolean;
  inBlockquote: boolean;
} {
  const tree = syntaxTree(state);
  const clampedPos = Math.max(0, Math.min(pos, state.doc.length));
  const startNodes = [
    tree.resolve(clampedPos, -1),
    tree.resolve(clampedPos, 1),
  ];

  let inCodeBlock = false;
  let inBlockquote = false;
  for (const startNode of startNodes) {
    let node: SyntaxNode | null = startNode;
    while (node) {
      const name = node.name;
      if (name === 'FencedCode' || name === 'CodeBlock') {
        inCodeBlock = true;
        break;
      }
      if (name === 'Blockquote') {
        inBlockquote = true;
      }
      node = node.parent;
    }
    if (inCodeBlock) {
      break;
    }
  }
  return { inCodeBlock, inBlockquote };
}

function getEmptyBlockquotePrefixLength(lineText: string): number | null {
  const m = lineText.match(/^(\s*(?:> ?)+)\s*$/);
  return m ? m[1].length : null;
}

const EMPTY_TASK_ITEM_RE = /^\s*(?:[-*+]|\d+\.|[A-Za-z]+\.)\s+\[(?: |x|X)\]\s*$/;
const FENCE_OPENER_RE = /^(\s*)(`{3,}|~{3,})/;
const FENCE_AUTOPAIR_TRIGGER_RE = /^(\s*)(`{3}|~{3})$/;
const MARKDOWN_INDENT = '  ';

function replaceSelection(
  view: EditorView,
  insert: string,
  userEvent: string = 'input',
  cursorOffset: number = insert.length,
): void {
  const selection = view.state.selection.main;
  const from = selection.from;
  const to = selection.to;
  const cursor = from + cursorOffset;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: cursor },
    scrollIntoView: true,
    userEvent,
  });
  view.focus();
}

function selectionSpansMultipleLines(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (selection.empty) {
    return false;
  }
  const fromLine = view.state.doc.lineAt(selection.from);
  const toLine = view.state.doc.lineAt(Math.max(selection.from, selection.to - 1));
  return fromLine.number !== toLine.number;
}

function notifyInlineFormatRequiresSingleLine(): void {
  useToastStore.getState().pushToast('Inline formatting only supports a single line selection');
}

function dispatchInlineFormatResult(
  view: EditorView,
  currentText: string,
  result: InlineFormatResult
): void {
  let prefixLength = 0;
  const maxPrefixLength = Math.min(currentText.length, result.text.length);
  while (
    prefixLength < maxPrefixLength &&
    currentText[prefixLength] === result.text[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < currentText.length - prefixLength &&
    suffixLength < result.text.length - prefixLength &&
    currentText[currentText.length - 1 - suffixLength] === result.text[result.text.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  view.dispatch({
    changes: {
      from: prefixLength,
      to: currentText.length - suffixLength,
      insert: result.text.slice(prefixLength, result.text.length - suffixLength),
    },
    selection: { anchor: result.anchor, head: result.head },
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

function toggleInlineFormatInView(
  view: EditorView,
  format: MarkdownInlineFormat
): boolean {
  if (view.state.facet(EditorState.readOnly)) {
    return true;
  }
  if (selectionSpansMultipleLines(view)) {
    notifyInlineFormatRequiresSingleLine();
    return true;
  }
  const selection = view.state.selection.main;
  const currentText = view.state.doc.toString();
  const result = applyInlineFormat(currentText, {
    anchor: selection.anchor,
    head: selection.head,
  }, format);
  dispatchInlineFormatResult(view, currentText, result);
  return true;
}

const toggleBoldCommand = (view: EditorView): boolean => (
  toggleInlineFormatInView(view, 'bold')
);

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read clipboard image'));
    reader.readAsDataURL(blob);
  });
}

function getClipboardImageItem(event: ClipboardEvent): DataTransferItem | null {
  const items = Array.from(event.clipboardData?.items || []);
  return items.find((item) => item.type.startsWith('image/')) || null;
}

async function readClipboardImageBase64FromEvent(event: ClipboardEvent): Promise<string | null> {
  const item = getClipboardImageItem(event);
  const file = item?.getAsFile();
  if (!file) {
    return null;
  }
  return blobToBase64(file);
}

async function readClipboardImageBase64FromElectron(): Promise<string | null> {
  const result = await window.hulala?.clipboard?.readImagePngBase64?.();
  return result?.base64 || null;
}

async function pasteClipboardImage(view: EditorView, event?: ClipboardEvent): Promise<boolean> {
  const pushToast = useToastStore.getState().pushToast;
  const documentPath = getMarkdownDocumentPath(view.state);
  if (!documentPath) {
    pushToast('请先创建对话草稿后再粘贴图片');
    return false;
  }
  let base64 = '';
  try {
    base64 = event
      ? (await readClipboardImageBase64FromEvent(event)) || ''
      : (await readClipboardImageBase64FromElectron()) || '';
  } catch {
    pushToast('读取剪贴板图片失败');
    return false;
  }
  if (!base64) {
    return false;
  }

  const result = await getWorkspaceStateForEditor(view.state).persistPastedImage(base64, documentPath);
  if (result.error) {
    pushToast(result.error);
    return true;
  }
  if (!result.markdown) {
    pushToast('写入图片文件失败');
    return true;
  }

  const insertion = buildImageInsertion(view.state, result.markdown);
  replaceSelection(view, insertion.insert, 'input.paste', insertion.cursorOffset);
  return true;
}

function getUnclosedFenceOpenerAtLine(
  state: EditorState,
  line: { from: number; text: string }
): { indent: string; fence: string } | null {
  const fenceMatch = line.text.match(FENCE_OPENER_RE);
  if (!fenceMatch) {
    return null;
  }

  const tree = syntaxTree(state);
  let node: SyntaxNode | null = tree.resolve(line.from, 1);
  while (node && node.name !== 'FencedCode') {
    node = node.parent;
  }
  if (!node || node.from !== line.from) {
    return null;
  }

  let markCount = 0;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'CodeMark') {
      markCount += 1;
    }
  }
  if (markCount >= 2) {
    return null;
  }

  return {
    indent: fenceMatch[1],
    fence: fenceMatch[2],
  };
}

const fencedCodeAutoPairInputHandler = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '`' && text !== '~') {
    return false;
  }

  const line = view.state.doc.lineAt(from);
  const before = view.state.doc.sliceString(line.from, from);
  const after = view.state.doc.sliceString(to, line.to);
  const nextLine = before + text + after;
  const triggerMatch = nextLine.match(FENCE_AUTOPAIR_TRIGGER_RE);
  if (!triggerMatch) {
    return false;
  }

  // Do not auto-pair when typing inside an existing fenced/code block.
  if (getMarkdownContext(view.state, from).inCodeBlock) {
    return false;
  }

  const indent = triggerMatch[1];
  const fence = triggerMatch[2];
  const insert = `${text}\n${indent}\n${indent}${fence}`;
  const cursor = from + text.length + 1 + indent.length;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: cursor },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
});

const taskListBackspaceAsText: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (sel.head !== line.to) return false;
  if (!EMPTY_TASK_ITEM_RE.test(line.text)) return false;
  const from = Math.max(0, sel.head - 1);
  const to = sel.head;
  if (from === to) return true;
  if (dispatch) {
    dispatch(
      state.update({
        changes: { from, to, insert: '' },
        selection: { anchor: from },
        scrollIntoView: true,
        userEvent: 'delete.backward',
      })
    );
  }
  return true;
};

const taskListDeleteAsText: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (sel.head !== line.to) return false;
  if (!EMPTY_TASK_ITEM_RE.test(line.text)) return false;
  const from = sel.head;
  const to = Math.min(state.doc.length, sel.head + 1);
  if (from === to) return true;
  if (dispatch) {
    dispatch(
      state.update({
        changes: { from, to, insert: '' },
        selection: { anchor: from },
        scrollIntoView: true,
        userEvent: 'delete.forward',
      })
    );
  }
  return true;
};

const listIndentTab: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const parsed = parseListLinePrefix(line.text);
  if (!parsed) return false;
  if (dispatch) {
    const from = line.from;
    const insert = MARKDOWN_INDENT;
    const changes: { from: number; to: number; insert: string }[] = [
      { from, to: from, insert },
    ];

    // A newly nested ordered list starts with the native marker for its depth.
    if (parsed.isOrdered) {
      const targetMarker = firstOrderedListMarkerForDepth(getListDepth(parsed) + 1);
      const markerFrom = line.from + parsed.markerFrom;
      const markerTo = markerFrom + parsed.markerText.length;
      if (parsed.markerText !== targetMarker) {
        changes.push({ from: markerFrom, to: markerTo, insert: targetMarker });
      }
    }
    dispatch(
      state.update({
        changes,
        scrollIntoView: true,
        userEvent: 'input',
      })
    );
  }
  return true;
};

const listOutdentShiftTab: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.head);
  const parsed = parseListLinePrefix(line.text);
  if (!parsed) return false;
  const leadingSpaces = line.text.match(/^\s*/)?.[0].length ?? 0;
  if (leadingSpaces < 2) return false;
  const from = line.from;
  const to = line.from + MARKDOWN_INDENT.length;
  if (dispatch) {
    const changes: { from: number; to: number; insert: string }[] = [
      { from, to, insert: '' },
    ];
    if (parsed.isOrdered) {
      const currentDepth = getListDepth(parsed);
      const targetMarker = normalizeOrderedListMarker(
        parsed.markerText,
        currentDepth,
        Math.max(0, currentDepth - 1),
      );
      if (targetMarker !== parsed.markerText) {
        const markerFrom = line.from + parsed.markerFrom;
        changes.push({
          from: markerFrom,
          to: markerFrom + parsed.markerText.length,
          insert: targetMarker,
        });
      }
    }
    dispatch(
      state.update({
        changes,
        scrollIntoView: true,
        userEvent: 'input',
      })
    );
  }
  return true;
};

const insertMarkdownIndentAtCursor: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main;
  if (!sel.empty) return false;
  if (dispatch) {
    dispatch(
      state.update({
        changes: { from: sel.from, to: sel.to, insert: MARKDOWN_INDENT },
        selection: { anchor: sel.from + MARKDOWN_INDENT.length },
        scrollIntoView: true,
        userEvent: 'input',
      })
    );
  }
  return true;
};

const markdownIndentTab: StateCommand = (target) => {
  const sel = target.state.selection.main;
  if (!sel.empty) {
    return indentMore(target);
  }
  const line = target.state.doc.lineAt(sel.head);
  if (parseListLinePrefix(line.text)) {
    return listIndentTab(target);
  }
  return insertMarkdownIndentAtCursor(target);
};

const markdownOutdentShiftTab: StateCommand = (target) => {
  const sel = target.state.selection.main;
  const line = target.state.doc.lineAt(sel.head);
  if (sel.empty && parseListLinePrefix(line.text)) {
    if (listOutdentShiftTab(target)) {
      return true;
    }
  }
  return indentLess(target);
};

const markdownListLineBreakCommand: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main;
  if (!sel.empty) return false;
  if (getMarkdownContext(state, sel.head).inCodeBlock) return false;

  const indent = getListItemContinuationIndentAt(state, sel.head);
  if (indent === null) return false;

  const insert = `\n${indent}`;
  if (dispatch) {
    dispatch(
      state.update({
        changes: { from: sel.from, to: sel.to, insert },
        selection: { anchor: sel.from + insert.length },
        scrollIntoView: true,
        userEvent: 'input',
      })
    );
  }
  return true;
};

const markdownEnterCommand: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main;
  if (!sel.empty) {
    return insertNewlineContinueMarkup({ state, dispatch });
  }

  const pos = sel.head;
  const line = state.doc.lineAt(pos);
  const ctx = getMarkdownContext(state, pos);
  const prefixLen = getEmptyBlockquotePrefixLength(line.text);

  // Enter fallback path for already-typed/pasted opener lines:
  // if the current line is an unclosed FencedCode opener, auto-insert body + closer.
  if (pos === line.to) {
    const opener = getUnclosedFenceOpenerAtLine(state, line);
    if (opener) {
      const indent = opener.indent;
      const fence = opener.fence;
      const insert = `\n${indent}\n${indent}${fence}`;
      const cursor = pos + 1 + indent.length;
      if (dispatch) {
        dispatch(
          state.update({
            changes: { from: pos, to: pos, insert },
            selection: { anchor: cursor },
            scrollIntoView: true,
            userEvent: 'input',
          })
        );
      }
      return true;
    }
  }

  // In an empty blockquote line (`> `), pressing Enter should exit the blockquote
  // in at most 2 presses from a content line:
  //   > hello  + Enter ->  >
  //   >        + Enter ->  (empty line, not a blockquote)
  if (prefixLen !== null && ctx.inBlockquote && !ctx.inCodeBlock) {
    const prefixEnd = line.from + prefixLen;
    if (pos >= prefixEnd && pos <= line.to) {
      if (dispatch) {
        dispatch(
          state.update({
            changes: { from: line.from, to: line.to, insert: '' },
            selection: { anchor: line.from },
            scrollIntoView: true,
            userEvent: 'input',
          })
        );
      }
      return true;
    }
  }

  // Continue the innermost list item even from a lazy continuation paragraph line.
  // CodeMirror only continues markup when the current source line owns the marker.
  if (pos === line.to && !ctx.inCodeBlock) {
    const insert = getListContinuationInsertAt(state, pos);
    if (insert) {
      if (dispatch) {
        dispatch(
          state.update({
            changes: {
              from: pos,
              to: pos,
              insert,
            },
            selection: { anchor: pos + insert.length },
            scrollIntoView: true,
            userEvent: 'input',
          })
        );
      }
      return true;
    }
  }

  return insertNewlineContinueMarkup({ state, dispatch });
};

export interface MarkdownEditorInstance {
  /**
   * Get the current content of the editor.
   */
  getContent(): string;

  /**
   * Set the content of the editor.
   */
  setContent(content: string, options?: { preserveScroll?: boolean; scrollToBottom?: boolean }): void;

  /**
   * Toggle editor read-only mode without recreating the editor.
   */
  setReadOnly(readOnly: boolean): void;

  /**
   * Focus the editor.
   */
  focus(): void;

  /**
   * Blur the editor.
   */
  blur(): void;

  /**
   * Get editor view state (selection and scroll).
   */
  getViewState(): MarkdownEditorViewState;

  /**
   * Restore editor view state (selection and scroll).
   */
  restoreViewState(state: MarkdownEditorViewState): void;

  /**
   * Scroll to a heading if it exists.
   */
  scrollToHeading(heading: string): boolean;

  /**
   * Scroll to a document position.
   */
  scrollToPos(pos: number): boolean;

  /**
   * Scroll the editor viewport to the end of the document.
   */
  scrollToBottom(): void;

  /**
   * Get the underlying CodeMirror view instance.
   */
  getView(): EditorView;

  /**
   * Copy current selection to clipboard.
   */
  copySelection(): Promise<void> | void;

  /**
   * Paste clipboard image or text at current selection.
   */
  pasteFromClipboard(): Promise<void>;

  /**
   * Insert text at current selection.
   */
  insertAtSelection(text: string): void;

  /**
   * Toggle markdown inline formatting around the current selection.
   */
  toggleInlineFormat(format: MarkdownInlineFormat): void;

  /**
   * Clear supported markdown inline formatting around the current selection.
   */
  clearInlineFormatting(): void;

  /**
   * Reconfigure a composer-only footer widget extension.
   */
  setFooterWidgetExtension(extension: Extension | null): void;

  /**
   * Update the document header (title / modified time).
   */
  setDocumentHeader(options: DocumentHeaderOptions): void;

  /**
   * Destroy the editor instance.
   */
  destroy(): void;

}

export interface MarkdownEditorOptions {
  /**
   * Initial content
   */
  initialContent?: string;

  /**
   * Callback when content changes
   */
  onContentChange?: (content: string) => void;

  /**
   * Callback when focus state changes
   */
  onFocusChange?: (focused: boolean) => void;

  /**
   * Callback when selection changes.
   */
  onSelectionChange?: (selection: { anchor: number; head: number }) => void;

  /**
   * Enable live preview (default: true)
   */
  livePreview?: boolean;

  /**
   * Disable editing while keeping selection/scroll interactions available.
   */
  readOnly?: boolean;

  /**
   * Called when a rendered markdown image is activated from live preview.
   */
  onImageActivate?: (image: ImageActivation) => void;

  /**
   * Called when a composer image delete affordance is activated.
   */
  onImageDelete?: (image: ImageActivation) => void;

  /**
   * Resolve relative markdown paths against this document path.
   */
  documentPath?: string | null;

  /**
   * Render delete affordances on live-preview image widgets.
   */
  showImageDeleteButton?: boolean;

  /**
   * Render the editor in static PDF export mode.
   */
  exportMode?: boolean;

  /**
   * Render a composer-only footer widget extension at the document tail.
   */
  footerWidgetExtension?: Extension | null;

  /**
   * Render an interactive append surface below the document body.
   */
  editableTail?: boolean;


  /**
   * Called when the user requests the find/replace overlay (⌘F / ⌘⌥F).
   * Setting this disables the default CodeMirror search panel binding.
   */
  onOpenSearchPanel?: (options: { replace: boolean }) => void;

  /**
   * Feishu-style document header above frontmatter and body.
   */
  documentHeader?: DocumentHeaderOptions;

  /** Workspace capability store that owns this editor document. */
  workspaceStore?: WorkspaceStore;
}

export type MarkdownEditorViewState = CodeMirrorViewStateSnapshot;

/**
 * Creates a CodeMirror 6 based Markdown editor with Live Preview support.
 */
export function createMarkdownEditor(
  container: HTMLElement,
  options: MarkdownEditorOptions = {}
): MarkdownEditorInstance {
  const {
    initialContent = '',
    onContentChange,
    onFocusChange,
    onSelectionChange,
    livePreview = true,
    readOnly = false,
    onImageActivate,
    onImageDelete,
    documentPath = null,
    showImageDeleteButton = false,
    exportMode = false,
    footerWidgetExtension = null,
    editableTail = false,
    onOpenSearchPanel,
    documentHeader = { enabled: false, title: '', modTime: null },
    workspaceStore,
  } = options;
  const normalizedInitialContent = normalizeOrderedListMarkersInMarkdown(initialContent);

  let isUpdatingFromExternal = false;
  const readOnlyCompartment = new Compartment();
  const footerWidgetCompartment = new Compartment();
  const frontmatterPanelOptionsCompartment = createFrontmatterPanelOptionsCompartment();
  const documentHeaderOptionsCompartment = createDocumentHeaderOptionsCompartment();

  // Build extensions
  const extensions: Extension[] = [
    // Markdown language support with GFM extensions
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
    }),
    indentUnit.of(MARKDOWN_INDENT),
    orderedListRenumbering(),

    // Override Markdown Enter behavior: exit blockquote after a single empty quote line.
    Prec.highest(
      keymap.of([
        { key: 'Enter', run: markdownEnterCommand },
        { key: 'Shift-Enter', run: markdownListLineBreakCommand },
      ])
    ),
    // Keep task-list deletion as plain text editing. Avoid markdown delete-markup
    // commands from removing the whole list line when cursor is at empty item end.
    Prec.highest(
      keymap.of([
        { key: 'Backspace', run: taskListBackspaceAsText },
        { key: 'Delete', run: taskListDeleteAsText },
      ])
    ),
    // Tab / Shift-Tab: Markdown indentation.
    Prec.high(
      keymap.of([
        { key: 'Tab', run: markdownIndentTab },
        { key: 'Shift-Tab', run: markdownOutdentShiftTab },
      ])
    ),
    // Obsidian-style fence auto-pair while typing: on the third ` or ~,
    // immediately insert the closing fence and leave caret on opener line.
    Prec.highest(fencedCodeAutoPairInputHandler),
    Prec.highest(
      EditorView.domEventHandlers({
        paste: (event, view) => {
          if (readOnly) {
            return false;
          }
          if (!getClipboardImageItem(event)) {
            return false;
          }
          event.preventDefault();
          void pasteClipboardImage(view, event);
          return true;
        },
      })
    ),

    // Syntax highlighting styles
    syntaxHighlighting(editorSyntaxHighlighter, { fallback: true }),

    // History (undo/redo)
    history(),

    // Keymaps
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      // Filter out Mod-f: we render a custom React overlay instead of
      // CodeMirror's default search panel. Other search bindings (findNext,
      // findPrevious, gotoLine, selectNextOccurrence, ...) stay intact.
      ...searchKeymap.filter((b) => b.key !== 'Mod-f'),
    ]),
    // Markdown inline formatting. Mod-b is Ctrl-b on Windows/Linux and Cmd-b
    // on macOS, leaving macOS Ctrl-b available for native cursor movement.
    Prec.high(
      keymap.of([
        { key: 'Mod-b', preventDefault: true, run: toggleBoldCommand },
      ])
    ),
    // Custom find/replace shortcuts wired to our React overlay
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
            if (onOpenSearchPanel && !readOnly) {
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

    readOnlyCompartment.of([
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
    ]),
    footerWidgetCompartment.of(footerWidgetExtension ? [footerWidgetExtension] : []),
    ...(editableTail && !exportMode ? [editableMarkdownTail()] : []),
    markdownDocumentPathFacet.of(documentPath),
    ...(workspaceStore ? [workspaceStoreFacet.of(workspaceStore)] : []),
    ...(exportMode ? [EditorView.editorAttributes.of({ class: 'cm-export-mode' })] : []),

    // Custom theme
    ...markdownEditorTheme,
    editorMouseWheelZoom(),
    imeCompositionLayout(),
    frontmatterDecorations(),
    documentHeaderOptionsCompartment.of(documentHeaderOptionsExtension(documentHeader)),
    ...(!exportMode ? [documentHeaderPlugin()] : []),
    frontmatterPanelOptionsCompartment.of(frontmatterPanelOptionsExtension({ readOnly, exportMode })),
    ...(!exportMode ? [frontmatterPanelPlugin()] : []),
    // Markdown-only: content width limit + line wrapping (other editors use full width, no wrap)
    EditorView.theme({
      '.cm-content': {
        width: 'min(100%, var(--op-md-content-max-width))',
        maxWidth: 'var(--op-md-content-max-width)',
      },
    }),

    // Live Preview plugins (conditionally enabled)
    ...(livePreview ? [
      imageSourceField,
      ...livePreviewBlockDecorations({ exportMode, showImageDeleteButton }),
      livePreviewPlugin({ exportMode }),
      listHangingIndent(),
      livePreviewParseRefresh(),
      focusRangePlugin(),
      ...(!exportMode ? [livePreviewInteractions(onImageActivate, onImageDelete)] : []),
    ] : []),

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
      if (update.focusChanged) {
        update.view.dispatch({
          effects: refreshLivePreviewDecorationsEffect.of(null),
          annotations: Transaction.addToHistory.of(false),
        });
      }
      if (update.docChanged && !isUpdatingFromExternal && onContentChange) {
        onContentChange(update.state.doc.toString());
      }
    }),

    // Line wrapping
    EditorView.lineWrapping,
  ];

  // Create editor state
  const state = EditorState.create({
    doc: normalizedInitialContent,
    extensions,
  });

  // Create editor view
  const view = new EditorView({
    state,
    parent: container,
  });
  const viewStateTracker = createCodeMirrorViewStateTracker(view);
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

    setContent(content: string, options?: { preserveScroll?: boolean; scrollToBottom?: boolean }): void {
      const normalizedContent = normalizeOrderedListMarkersInMarkdown(content);
      const currentContent = view.state.doc.toString();
      if (currentContent !== normalizedContent) {
        const selection = view.state.selection.main;
        const preserveScroll = options?.preserveScroll !== false;
        const scrollToBottom = options?.scrollToBottom === true;
        const scrollTopBefore = view.scrollDOM.scrollTop;
        const nextScrollLeft = view.scrollDOM.scrollLeft;
        const replacement = findMinimalContentReplacement(currentContent, normalizedContent);
        const nextDocLength = normalizedContent.length;
        const scrollAnchor = preserveScroll && !scrollToBottom
          ? getCodeMirrorScrollAnchor(view, scrollTopBefore)
          : null;
        const mappedAnchorPos = scrollAnchor
          ? mapPosThroughReplacement(scrollAnchor.pos, replacement, nextDocLength)
          : null;
        isUpdatingFromExternal = true;
        try {
          view.dispatch({
            changes: replacement,
            selection: {
              anchor: mapPosThroughReplacement(selection.anchor, replacement, nextDocLength),
              head: mapPosThroughReplacement(selection.head, replacement, nextDocLength),
            },
            annotations: [
              Transaction.addToHistory.of(false),
              skipOrderedListRenumber.of(true),
            ],
          });
        } finally {
          isUpdatingFromExternal = false;
        }
        view.requestMeasure({
          key: 'setContentScroll',
          read: () => ({
            top: scrollTopBefore,
            left: nextScrollLeft,
            height: view.scrollDOM.scrollHeight,
            anchorTop: mappedAnchorPos === null ? null : view.lineBlockAt(mappedAnchorPos).top,
          }),
          write: ({ top, left, height, anchorTop }, v) => {
            if (scrollToBottom) {
              v.scrollDOM.scrollTop = height;
              if (preserveScroll) {
                v.scrollDOM.scrollLeft = left;
              }
              return;
            }
            if (preserveScroll) {
              v.scrollDOM.scrollTop = anchorTop === null || !scrollAnchor
                ? top
                : Math.max(0, anchorTop + scrollAnchor.offsetTop);
              v.scrollDOM.scrollLeft = left;
            }
          },
        });
      }
    },

    setReadOnly(nextReadOnly: boolean): void {
      view.dispatch({
        effects: [
          readOnlyCompartment.reconfigure([
            EditorState.readOnly.of(nextReadOnly),
            EditorView.editable.of(!nextReadOnly),
          ]),
          reconfigureFrontmatterPanelOptions(frontmatterPanelOptionsCompartment, {
            readOnly: nextReadOnly,
            exportMode,
          }),
        ],
        annotations: Transaction.addToHistory.of(false),
      });
      refreshFrontmatterPanel(view);
    },

    focus(): void {
      view.focus();
    },

    blur(): void {
      const active = document.activeElement as HTMLElement | null;
      if (active === view.contentDOM) {
        active.blur();
        return;
      }
      view.contentDOM.blur();
    },

    getViewState(): MarkdownEditorViewState {
      return viewStateTracker.get();
    },

    restoreViewState(nextState: MarkdownEditorViewState): void {
      restoreCodeMirrorViewState(view, nextState);
      viewStateTracker.note(nextState);
    },

    scrollToHeading(heading: string): boolean {
      const pos = findHeadingPosition(view, heading);
      if (pos === null) {
        return false;
      }
      view.dispatch({
        selection: { anchor: pos },
        scrollIntoView: true,
      });
      return true;
    },

    scrollToPos(pos: number): boolean {
      const nextPos = clampEditorPos(pos, view.state.doc.length);
      view.dispatch({
        selection: { anchor: nextPos },
        scrollIntoView: true,
        annotations: Transaction.addToHistory.of(false),
      });
      view.focus();
      return true;
    },

    scrollToBottom(): void {
      const nextScrollLeft = view.scrollDOM.scrollLeft;
      view.requestMeasure({
        key: 'scrollToBottom',
        read: () => ({ left: nextScrollLeft }),
        write: ({ left }, v) => {
          v.scrollDOM.scrollTop = v.scrollDOM.scrollHeight;
          v.scrollDOM.scrollLeft = left;
        },
      });
    },

    getView(): EditorView {
      return view;
    },

    async copySelection(): Promise<void> {
      const tableText = getActiveTableSelectionText(view.dom);
      if (tableText !== null) {
        try {
          await writeClipboardText(tableText);
        } catch {
          // Ignore clipboard permission/runtime failures in desktop environments.
        }
        return;
      }

      const selection = view.state.selection.main;
      if (selection.empty) {
        return;
      }
      const text = view.state.doc.sliceString(selection.from, selection.to);
      if (!text) {
        return;
      }
      try {
        await writeClipboardText(text);
      } catch {
        // Ignore clipboard permission/runtime failures in desktop environments.
      }
    },

    async pasteFromClipboard(): Promise<void> {
      if (readOnly) {
        return;
      }
      if (await pasteClipboardImage(view)) {
        return;
      }

      let text = '';
      try {
        text = await navigator.clipboard.readText();
      } catch {
        return;
      }
      if (!text) {
        useToastStore.getState().pushToast('剪贴板中没有可粘贴的图片或文本');
        return;
      }
      replaceSelection(view, text, 'input.paste');
    },

    insertAtSelection(text: string): void {
      replaceSelection(view, text);
    },

    toggleInlineFormat(format: MarkdownInlineFormat): void {
      toggleInlineFormatInView(view, format);
    },

    clearInlineFormatting(): void {
      if (view.state.facet(EditorState.readOnly)) {
        return;
      }
      if (selectionSpansMultipleLines(view)) {
        notifyInlineFormatRequiresSingleLine();
        return;
      }
      const selection = view.state.selection.main;
      const currentText = view.state.doc.toString();
      const result = clearInlineFormattingCommand(currentText, {
        anchor: selection.anchor,
        head: selection.head,
      });
      if (!result) {
        view.focus();
        return;
      }
      dispatchInlineFormatResult(view, currentText, result);
    },

    setFooterWidgetExtension(extension: Extension | null): void {
      view.dispatch({
        effects: footerWidgetCompartment.reconfigure(extension ? [extension] : []),
        annotations: Transaction.addToHistory.of(false),
      });
    },

    setDocumentHeader(nextDocumentHeader: DocumentHeaderOptions): void {
      view.dispatch({
        effects: reconfigureDocumentHeaderOptions(documentHeaderOptionsCompartment, nextDocumentHeader),
        annotations: Transaction.addToHistory.of(false),
      });
      refreshDocumentHeader(view);
    },

    destroy(): void {
      viewStateTracker.destroy();
      view.destroy();
    },
  };
}

function findHeadingPosition(view: EditorView, heading: string): number | null {
  const doc = view.state.doc;
  const target = normalizeHeading(heading);
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.match(/^(#{1,6})\s+(.*)$/);
    if (!match) {
      continue;
    }
    const text = match[2].trim();
    if (normalizeHeading(text) === target || text.toLowerCase() === heading.toLowerCase()) {
      return line.from + match[1].length + 1;
    }
  }
  return null;
}

function normalizeHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

type ContentReplacement = {
  from: number;
  to: number;
  insert: string;
};

function findMinimalContentReplacement(current: string, next: string): ContentReplacement {
  let from = 0;
  const currentLength = current.length;
  const nextLength = next.length;
  const minLength = Math.min(currentLength, nextLength);
  while (from < minLength && current.charCodeAt(from) === next.charCodeAt(from)) {
    from += 1;
  }

  let currentEnd = currentLength;
  let nextEnd = nextLength;
  while (
    currentEnd > from
    && nextEnd > from
    && current.charCodeAt(currentEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    currentEnd -= 1;
    nextEnd -= 1;
  }

  return {
    from,
    to: currentEnd,
    insert: next.slice(from, nextEnd),
  };
}

function mapPosThroughReplacement(pos: number, replacement: ContentReplacement, nextDocLength: number): number {
  const anchor = clampEditorPos(pos, Number.MAX_SAFE_INTEGER);
  if (anchor <= replacement.from) {
    return clampEditorPos(anchor, nextDocLength);
  }
  if (anchor >= replacement.to) {
    return clampEditorPos(anchor + replacement.insert.length - (replacement.to - replacement.from), nextDocLength);
  }
  return clampEditorPos(replacement.from + replacement.insert.length, nextDocLength);
}

function clampEditorPos(pos: number, max: number): number {
  if (!Number.isFinite(pos)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.floor(pos), max));
}
