import {
  EditorSelection,
  EditorState,
  Range,
  RangeSet,
  RangeSetBuilder,
  StateField,
  Transaction,
} from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { getMarkdownDocumentPath } from './documentPathState';
import { getWorkspaceStateForEditor } from './workspaceStoreState';
import {
  getDefaultMarkdownImageWidthPercent,
  isImagePath,
  resolveMarkdownPath,
  resolveRenderedMarkdownImageWidth,
} from '../../../utils/markdownMedia';
import { imageSourceField, type ImageSourceRange } from './imageSourceState';
import { FRONTMATTER_SCAN_MAX_LINES, type FrontmatterInfo } from './utils/frontmatter';
import { shouldCollapseFrontmatterYaml, toggleFrontmatterSourceModeEffect } from '../../../utils/frontmatterPanelState';
import { getBlockReplacementTo } from './utils/blockReplacement';
import { LRUCache } from './utils/lru';
import { collectListContinuationLineInfo } from './utils/listPrefix';
import { decorateLineRange } from './utils/lineDecorations';
import { buildMathBlockDecorationsInRange, findMathBlockAtLine } from './utils/mathBlocks';
import { parseTableBlock } from './utils/tableParser';
import { findTableRangeAtPos, isSelectionWithinRange, tableSourceBlockField } from './tableSourceState';
import { shouldUseBlockWidgetMouseSelection } from './mouseSelectionPolicy';
import { MermaidWidget } from './widgets/MermaidWidget';
import { TableWidget } from './widgets/TableWidget';
import { WikilinkWidget } from './widgets/WikilinkWidget';
import { ExcalidrawWidget } from './widgets/ExcalidrawWidget';
import { BookNoteWidget } from './widgets/BookNoteWidget';
import { parseBookHighlightNoteBlock } from '../bookNotes';
import {
  blockStructureIndexField,
  findIndexedFenceBlockAtPos,
  findIndexedImageBlockBySourceRange,
  findIndexedIndentedCodeBlockAtPos,
  findIndexedTableBlockAtPos,
  findIndexedTableBlockByFrom,
  getBlockStructureIndex,
  getOverlappingFenceBlocks,
  getOverlappingImageBlocks,
  getOverlappingIndentedCodeBlocks,
  getOverlappingTableBlocks,
  type BlockStructureIndex,
  type IndexedFenceBlock,
} from './utils/blockStructureIndex';
import {
  refreshLivePreviewDecorationsEffect,
  refreshLivePreviewViewportDecorationsEffect,
} from './livePreviewDecorationEffects';

const widgetCache = new LRUCache<WidgetType>(300);

function getCachedWidget<T extends WidgetType>(key: string, build: () => T): T {
  return widgetCache.getOrCreate(key, build) as T;
}

type LivePreviewBlockDecorationOptions = {
  exportMode?: boolean;
  showImageDeleteButton?: boolean;
};

let currentLivePreviewBlockOptions: Required<LivePreviewBlockDecorationOptions> = {
  exportMode: false,
  showImageDeleteButton: false,
};

const hideMark = Decoration.replace({});

function getCurrentMarkdownFilePath(state: EditorState): string | null {
  const documentPath = getMarkdownDocumentPath(state);
  if (documentPath) {
    return documentPath;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  return getWorkspaceStateForEditor(state).currentFilePath || null;
}

function isCursorOnLineOverlappingRange(state: EditorState, range: { from: number; to: number }): boolean {
  const selection = state.selection.main;
  const cursorLine = state.doc.lineAt(selection.head);
  return cursorLine.from <= range.to && cursorLine.to >= range.from;
}

function getCursorLineRange(state: EditorState): { from: number; to: number } {
  const line = state.doc.lineAt(state.selection.main.head);
  return { from: line.from, to: line.to };
}

function extractFencedCodeBody(state: EditorState, startLineNum: number, endLineNum: number): string {
  if (startLineNum >= endLineNum - 1) {
    return '';
  }
  const lines: string[] = [];
  for (let i = startLineNum + 1; i <= endLineNum - 1; i += 1) {
    lines.push(state.doc.line(i).text);
  }
  return lines.join('\n');
}

function buildCodeBlockLineDecorations(
  state: EditorState,
  startLineNum: number,
  endLineNum: number,
  hideFences: boolean,
  out: Range<Decoration>[],
  extraClasses: string[] = []
): void {
  const doc = state.doc;
  for (let i = startLineNum; i <= endLineNum; i += 1) {
    const line = doc.line(i);
    const classes = ['cm-md-code-block-line', ...extraClasses];
    if (i === startLineNum) classes.push('cm-md-code-block-line-start');
    if (i === endLineNum) classes.push('cm-md-code-block-line-end');

    out.push(Decoration.line({ class: classes.join(' ') }).range(line.from));

    if (hideFences && (i === startLineNum || i === endLineNum) && line.to > line.from) {
      out.push(hideMark.range(line.from, line.to));
    }
  }
}

function isExplicitTableSourceOpen(state: EditorState, from: number, to: number): boolean {
  const explicitTableSourceFrom = state.field(tableSourceBlockField, false) ?? null;
  if (explicitTableSourceFrom !== from) {
    return false;
  }
  return isSelectionWithinRange(state.selection.main, from, to);
}

function getSourceStateRange(
  state: EditorState,
  index: BlockStructureIndex,
  sourceFrom: number
): { from: number; to: number } {
  const range = findIndexedTableBlockByFrom(index, sourceFrom) ?? findIndexedTableBlockAtPos(index, sourceFrom);
  if (range) {
    return { from: range.from, to: range.to };
  }
  const fallbackRange = findTableRangeAtPos(state, sourceFrom);
  if (fallbackRange) {
    return fallbackRange;
  }
  const clampedPos = Math.max(0, Math.min(sourceFrom, state.doc.length));
  const line = state.doc.lineAt(clampedPos);
  return { from: line.from, to: line.to };
}

function getImageSourceStateRange(
  state: EditorState,
  index: BlockStructureIndex,
  range: ImageSourceRange
): { from: number; to: number } {
  const imageBlock = findIndexedImageBlockBySourceRange(index, range.from, range.to);
  if (imageBlock) {
    return {
      from: imageBlock.from,
      to: getBlockReplacementTo(state, imageBlock.from, imageBlock.to),
    };
  }
  const clampedPos = Math.max(0, Math.min(range.from, state.doc.length));
  const line = state.doc.lineAt(clampedPos);
  return {
    from: line.from,
    to: getBlockReplacementTo(state, line.from, line.to),
  };
}

function buildFrontmatterDecorations(
  state: EditorState,
  frontmatter: FrontmatterInfo | null,
  out: Range<Decoration>[]
): void {
  if (!frontmatter) {
    return;
  }

  const doc = state.doc;
  const cursorInBlock = isCursorOnLineOverlappingRange(state, frontmatter);
  const collapseYaml = shouldCollapseFrontmatterYaml(state);
  for (let lineNumber = 1; lineNumber <= frontmatter.endLineNumber; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const isDelimiterLine = lineNumber === 1 || lineNumber === frontmatter.endLineNumber;

    if (isDelimiterLine) {
      const classes = ['cm-md-frontmatter-line'];
      if (collapseYaml) {
        classes.push('cm-md-frontmatter-collapsed');
      }
      if (lineNumber === 1) classes.push('cm-md-frontmatter-start');
      if (lineNumber === frontmatter.endLineNumber) classes.push('cm-md-frontmatter-end');
      classes.push('cm-md-frontmatter-delim');
      if (!cursorInBlock) classes.push('cm-md-frontmatter-delim-hidden');
      out.push(Decoration.line({ class: classes.join(' ') }).range(line.from));
      continue;
    }

    const classes = ['cm-md-frontmatter-line'];
    if (collapseYaml) {
      classes.push('cm-md-frontmatter-collapsed');
    }
    out.push(Decoration.line({ class: classes.join(' ') }).range(line.from));
  }

  if (collapseYaml) {
    for (let lineNumber = frontmatter.endLineNumber + 1; lineNumber <= state.doc.lines; lineNumber += 1) {
      const line = state.doc.line(lineNumber);
      if (line.text.trim()) {
        break;
      }
      if (isCursorOnLineOverlappingRange(state, { from: line.from, to: line.to })) {
        continue;
      }
      out.push(Decoration.line({ class: 'cm-md-frontmatter-collapsed' }).range(line.from));
    }
  }
}

function buildImageWidgetDecorationsInRange(
  state: EditorState,
  index: BlockStructureIndex,
  rangeFrom: number,
  rangeTo: number,
  out: Range<Decoration>[]
): void {
  const imageBlocks = getOverlappingImageBlocks(index, rangeFrom, rangeTo);
  if (imageBlocks.length === 0) {
    return;
  }
  const currentFilePath = getCurrentMarkdownFilePath(state);
  const activeImageSource = state.field(imageSourceField, false) ?? null;
  const listContinuations = collectListContinuationLineInfo(state, rangeFrom, rangeTo);

  for (const imageBlock of imageBlocks) {
    const resolvedPath = resolveMarkdownPath(currentFilePath, imageBlock.url, false);
    if (!imageBlock.drawing && (!resolvedPath || !isImagePath(resolvedPath))) {
      continue;
    }

    const imageSourceActive = Boolean(
      activeImageSource &&
      activeImageSource.from === imageBlock.sourceFrom &&
      activeImageSource.to === imageBlock.sourceTo
    );
    if (imageSourceActive) {
      continue;
    }

    if (imageBlock.drawing) {
      out.push(Decoration.replace({
        widget: new ExcalidrawWidget(currentFilePath, imageBlock.url, imageBlock.alt,
          imageBlock.sourceFrom, imageBlock.sourceTo, currentLivePreviewBlockOptions.exportMode),
        block: true,
      }).range(imageBlock.from, getBlockReplacementTo(state, imageBlock.from, imageBlock.to)));
      continue;
    }

    const renderWidthPercent = resolveRenderedMarkdownImageWidth(imageBlock.widthPercent, {
      defaultWidthPercent: getDefaultMarkdownImageWidthPercent(currentFilePath),
    });
    const listContinuation = listContinuations.get(imageBlock.lineNumber);
    const className = listContinuation ? `cm-md-list-depth-${listContinuation.depth}` : '';
    const cacheKey = [
      'md-image',
      imageBlock.url,
      imageBlock.alt,
      currentFilePath || '',
      resolvedPath,
      renderWidthPercent ?? 'auto',
      imageBlock.sourceFrom,
      imageBlock.sourceTo,
      className,
    ].join(':');
    const widget = getCachedWidget(
      cacheKey,
      () => new WikilinkWidget({
        label: imageBlock.alt || imageBlock.url,
        target: imageBlock.url,
        isEmbed: true,
        isImage: true,
        documentPath: currentFilePath,
        resolvedPath: resolvedPath || undefined,
        widthPercent: renderWidthPercent,
        sourceFrom: imageBlock.sourceFrom,
        sourceTo: imageBlock.sourceTo,
        className,
        showDeleteButton: currentLivePreviewBlockOptions.showImageDeleteButton,
      })
    );
    out.push(
      Decoration.replace({ widget, block: true }).range(
        imageBlock.from,
        getBlockReplacementTo(state, imageBlock.from, imageBlock.to)
      )
    );
  }
}

function buildFenceWidgetDecorationsInRange(
  state: EditorState,
  index: BlockStructureIndex,
  rangeFrom: number,
  rangeTo: number,
  out: Range<Decoration>[]
): void {
  let currentFilePath: string | null = null;
  let currentFilePathLoaded = false;
  for (const block of getOverlappingFenceBlocks(index, rangeFrom, rangeTo)) {
    const cursorInBlock = isCursorOnLineOverlappingRange(state, block);

    if (cursorInBlock || block.startLineNumber >= block.endLineNumber) {
      continue;
    }

    const code = extractFencedCodeBody(state, block.startLineNumber, block.endLineNumber);
    if (block.language === 'note') {
      const note = parseBookHighlightNoteBlock(code);
      if (!note) {
        continue;
      }
      if (!currentFilePathLoaded) {
        currentFilePath = getCurrentMarkdownFilePath(state);
        currentFilePathLoaded = true;
      }
      const widget = getCachedWidget(
        `book-note:${block.from}:${block.to}:${code}:${currentFilePath || ''}:${currentLivePreviewBlockOptions.exportMode ? 'export' : 'edit'}`,
        () => new BookNoteWidget(
          note,
          currentFilePath,
          block.from,
          block.to,
          !currentLivePreviewBlockOptions.exportMode,
        )
      );
      out.push(
        Decoration.replace({ widget, block: true }).range(
          block.from,
          getBlockReplacementTo(state, block.from, block.to)
        )
      );
      continue;
    }

    if (block.language !== 'mermaid') {
      continue;
    }

    const widget = getCachedWidget(
      `mermaid:${block.from}:${block.to}:${code}`,
      () => new MermaidWidget(
        code,
        block.from,
        block.to,
        !currentLivePreviewBlockOptions.exportMode
      )
    );
    out.push(
      Decoration.replace({ widget, block: true }).range(
        block.from,
        getBlockReplacementTo(state, block.from, block.to)
      )
    );
  }
}

function buildTableWidgetDecorationsInRange(
  state: EditorState,
  index: BlockStructureIndex,
  rangeFrom: number,
  rangeTo: number,
  out: Range<Decoration>[]
): void {
  for (const block of getOverlappingTableBlocks(index, rangeFrom, rangeTo)) {
    if (block.startLineNumber >= block.endLineNumber || isExplicitTableSourceOpen(state, block.from, block.to)) {
      continue;
    }

    const tableText = state.doc.sliceString(block.from, block.to);
    const parsed = parseTableBlock(tableText);
    if (!parsed) {
      continue;
    }

    const widget = getCachedWidget(
        `table:${block.from}:${block.to}:${tableText}`,
        () => new TableWidget(
          parsed.headers,
          parsed.rows,
          parsed.alignments,
          block.from,
          block.to,
          !currentLivePreviewBlockOptions.exportMode
        )
      );
    out.push(
      Decoration.replace({ widget, block: true }).range(
        block.from,
        getBlockReplacementTo(state, block.from, block.to)
      )
    );
  }
}

function buildWidgetDecorationsInRange(
  state: EditorState,
  index: BlockStructureIndex,
  rangeFrom: number,
  rangeTo: number,
  out: Range<Decoration>[]
): void {
  buildImageWidgetDecorationsInRange(state, index, rangeFrom, rangeTo, out);
  buildFenceWidgetDecorationsInRange(state, index, rangeFrom, rangeTo, out);
  buildTableWidgetDecorationsInRange(state, index, rangeFrom, rangeTo, out);
}

function buildFenceCursorDecorationsInRange(
  state: EditorState,
  index: BlockStructureIndex,
  rangeFrom: number,
  rangeTo: number,
  out: Range<Decoration>[]
): void {
  for (const block of getOverlappingFenceBlocks(index, rangeFrom, rangeTo)) {
    const cursorInBlock = isCursorOnLineOverlappingRange(state, block);

    if ((block.language === 'mermaid' || block.language === 'note') && !cursorInBlock && block.startLineNumber < block.endLineNumber) {
      continue;
    }

    buildCodeBlockLineDecorations(
      state,
      block.startLineNumber,
      block.endLineNumber,
      !cursorInBlock,
      out
    );
  }
}

function buildTableCursorDecorationsInRange(
  state: EditorState,
  index: BlockStructureIndex,
  rangeFrom: number,
  rangeTo: number,
  out: Range<Decoration>[]
): void {
  for (const block of getOverlappingTableBlocks(index, rangeFrom, rangeTo)) {
    if (block.startLineNumber >= block.endLineNumber) {
      decorateLineRange(state, block.from, block.to, 'cm-md-table-line', out);
      continue;
    }
    const tableText = state.doc.sliceString(block.from, block.to);
    const parsed = parseTableBlock(tableText);
    if (!parsed || isExplicitTableSourceOpen(state, block.from, block.to)) {
      decorateLineRange(state, block.from, block.to, 'cm-md-table-line', out);
    }
  }
}

function buildIndentedCodeCursorDecorationsInRange(
  state: EditorState,
  index: BlockStructureIndex,
  rangeFrom: number,
  rangeTo: number,
  out: Range<Decoration>[]
): void {
  for (const block of getOverlappingIndentedCodeBlocks(index, rangeFrom, rangeTo)) {
    buildCodeBlockLineDecorations(state, block.startLineNumber, block.endLineNumber, false, out);
  }
}

function buildCursorDecorationsInRange(
  state: EditorState,
  index: BlockStructureIndex,
  rangeFrom: number,
  rangeTo: number,
  out: Range<Decoration>[]
): void {
  buildFenceCursorDecorationsInRange(state, index, rangeFrom, rangeTo, out);
  buildTableCursorDecorationsInRange(state, index, rangeFrom, rangeTo, out);
  buildIndentedCodeCursorDecorationsInRange(state, index, rangeFrom, rangeTo, out);
}

function buildWidgetDecorations(state: EditorState, index: BlockStructureIndex): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  buildWidgetDecorationsInRange(state, index, 0, state.doc.length, decorations);
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(decorations, true);
}

function buildCursorDecorations(state: EditorState, index: BlockStructureIndex): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  buildFrontmatterDecorations(state, index.frontmatter, decorations);
  buildMathBlockDecorationsInRange(state, 0, state.doc.length, decorations, currentLivePreviewBlockOptions.exportMode);
  buildCursorDecorationsInRange(state, index, 0, state.doc.length, decorations);
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(decorations, true);
}

function getChangedRanges(tr: Transaction): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const doc = tr.state.doc;
    const startLine = doc.lineAt(fromB);
    const endLine = doc.lineAt(Math.min(toB, doc.length));
    ranges.push({ from: startLine.from, to: endLine.to });
  });
  return ranges;
}

function mergeRanges(ranges: Array<{ from: number; to: number }>): Array<{ from: number; to: number }> {
  if (ranges.length === 0) {
    return [];
  }
  ranges.sort((a, b) => a.from - b.from);
  const merged: Array<{ from: number; to: number }> = [{ ...ranges[0] }];
  for (let i = 1; i < ranges.length; i += 1) {
    const last = merged[merged.length - 1];
    const current = ranges[i];
    if (current.from <= last.to + 1) {
      last.to = Math.max(last.to, current.to);
      continue;
    }
    merged.push({ ...current });
  }
  return merged;
}

function collectIndexedBlockRefreshRanges(
  index: BlockStructureIndex,
  ranges: Array<{ from: number; to: number }>
): Array<{ from: number; to: number }> {
  const expanded: Array<{ from: number; to: number }> = [];
  const frontmatter = index.frontmatter;
  if (frontmatter && ranges.some((range) => range.from <= frontmatter.to && range.to >= frontmatter.from)) {
    expanded.push({ from: frontmatter.from, to: frontmatter.to });
  }
  for (const range of ranges) {
    for (const block of getOverlappingFenceBlocks(index, range.from, range.to)) {
      expanded.push({ from: block.from, to: block.to });
    }
    for (const block of getOverlappingTableBlocks(index, range.from, range.to)) {
      expanded.push({ from: block.from, to: block.to });
    }
    for (const block of getOverlappingImageBlocks(index, range.from, range.to)) {
      expanded.push({ from: block.from, to: block.to });
    }
    for (const block of getOverlappingIndentedCodeBlocks(index, range.from, range.to)) {
      expanded.push({ from: block.from, to: block.to });
    }
  }
  return expanded;
}

function expandChangedRanges(
  state: EditorState,
  index: BlockStructureIndex,
  changedRanges: Array<{ from: number; to: number }>
): Array<{ from: number; to: number }> {
  const padded = mergeRanges(
    changedRanges.map((range) => ({
      from: Math.max(0, range.from - 500),
      to: Math.min(state.doc.length, range.to + 500),
    }))
  );
  return mergeRanges([...padded, ...collectIndexedBlockRefreshRanges(index, padded)]);
}

function updateWidgetDecorationsForRanges(
  state: EditorState,
  index: BlockStructureIndex,
  oldDecos: DecorationSet,
  ranges: Array<{ from: number; to: number }>
): DecorationSet {
  const normalizedRanges = mergeRanges(ranges);
  if (normalizedRanges.length === 0) {
    return oldDecos;
  }

  const newDecos: Range<Decoration>[] = [];
  for (const range of normalizedRanges) {
    buildWidgetDecorationsInRange(state, index, range.from, range.to, newDecos);
  }

  let result = oldDecos;
  for (const range of normalizedRanges) {
    result = result.update({
      filterFrom: range.from,
      filterTo: range.to,
      filter: () => false,
    });
  }

  newDecos.sort((a, b) => a.from - b.from || a.to - b.to);
  if (newDecos.length > 0) {
    result = result.update({ add: newDecos });
  }
  return result;
}

function updateCursorDecorationsForRanges(
  state: EditorState,
  index: BlockStructureIndex,
  oldDecos: DecorationSet,
  ranges: Array<{ from: number; to: number }>
): DecorationSet {
  const normalizedRanges = mergeRanges(ranges);
  if (normalizedRanges.length === 0) {
    return oldDecos;
  }

  const newDecos: Range<Decoration>[] = [];
  const frontmatter = index.frontmatter;
  const needsFrontmatter = frontmatter
    ? normalizedRanges.some((range) => range.from <= frontmatter.to && range.to >= frontmatter.from)
    : false;
  if (needsFrontmatter) {
    buildFrontmatterDecorations(state, frontmatter, newDecos);
  }

  for (const range of normalizedRanges) {
    buildMathBlockDecorationsInRange(state, range.from, range.to, newDecos, currentLivePreviewBlockOptions.exportMode);
    buildCursorDecorationsInRange(state, index, range.from, range.to, newDecos);
  }

  let result = oldDecos;
  for (const range of normalizedRanges) {
    result = result.update({
      filterFrom: range.from,
      filterTo: range.to,
      filter: () => false,
    });
  }

  newDecos.sort((a, b) => a.from - b.from || a.to - b.to);
  if (newDecos.length > 0) {
    result = result.update({ add: newDecos });
  }
  return result;
}

function getTableSourceChangedRanges(
  oldState: EditorState,
  state: EditorState
): Array<{ from: number; to: number }> {
  const oldIndex = getBlockStructureIndex(oldState);
  const newIndex = getBlockStructureIndex(state);
  const ranges: Array<{ from: number; to: number }> = [];
  const oldSource = oldState.field(tableSourceBlockField, false) ?? null;
  const newSource = state.field(tableSourceBlockField, false) ?? null;
  if (oldSource !== null) {
    ranges.push(getSourceStateRange(oldState, oldIndex, oldSource));
  }
  if (newSource !== null) {
    ranges.push(getSourceStateRange(state, newIndex, newSource));
  }
  return mergeRanges(ranges);
}

function getImageSourceChangedRanges(
  oldState: EditorState,
  state: EditorState
): Array<{ from: number; to: number }> {
  const oldIndex = getBlockStructureIndex(oldState);
  const newIndex = getBlockStructureIndex(state);
  const ranges: Array<{ from: number; to: number }> = [];
  const oldSource = oldState.field(imageSourceField, false) ?? null;
  const newSource = state.field(imageSourceField, false) ?? null;
  if (oldSource !== null) {
    ranges.push(getImageSourceStateRange(oldState, oldIndex, oldSource));
  }
  if (newSource !== null) {
    ranges.push(getImageSourceStateRange(state, newIndex, newSource));
  }
  return mergeRanges(ranges);
}

function getCursorBlockRange(
  state: EditorState,
  index: BlockStructureIndex
): { from: number; to: number } | null {
  const pos = state.selection.main.head;
  if (index.frontmatter && pos >= index.frontmatter.from && pos <= index.frontmatter.to) {
    return { from: index.frontmatter.from, to: index.frontmatter.to };
  }

  const fenceBlock = findIndexedFenceBlockAtPos(index, pos);
  if (fenceBlock) {
    return { from: fenceBlock.from, to: fenceBlock.to };
  }

  const tableBlock = findIndexedTableBlockAtPos(index, pos);
  if (tableBlock) {
    return { from: tableBlock.from, to: tableBlock.to };
  }

  const indentedCodeBlock = findIndexedIndentedCodeBlockAtPos(index, pos);
  if (indentedCodeBlock) {
    return { from: indentedCodeBlock.from, to: indentedCodeBlock.to };
  }

  const cursorLine = state.doc.lineAt(pos);
  return findMathBlockAtLine(state, cursorLine.number);
}

function updateWidgetDecorationsForSelectionChange(
  state: EditorState,
  oldState: EditorState,
  oldDecos: DecorationSet
): DecorationSet {
  const oldIndex = getBlockStructureIndex(oldState);
  const newIndex = getBlockStructureIndex(state);
  const rangesToRefresh: Array<{ from: number; to: number }> = [];
  const oldBlock = getCursorBlockRange(oldState, oldIndex);
  const newBlock = getCursorBlockRange(state, newIndex);
  if (oldBlock) rangesToRefresh.push(oldBlock);
  if (newBlock) rangesToRefresh.push(newBlock);
  return updateWidgetDecorationsForRanges(state, newIndex, oldDecos, rangesToRefresh);
}

function updateCursorDecorationsForSelectionChange(
  state: EditorState,
  oldState: EditorState,
  oldDecos: DecorationSet
): DecorationSet {
  const oldIndex = getBlockStructureIndex(oldState);
  const newIndex = getBlockStructureIndex(state);
  const rangesToRefresh: Array<{ from: number; to: number }> = [];
  const oldBlock = getCursorBlockRange(oldState, oldIndex);
  const newBlock = getCursorBlockRange(state, newIndex);
  if (oldBlock) rangesToRefresh.push(oldBlock);
  if (newBlock) rangesToRefresh.push(newBlock);
  rangesToRefresh.push(getCursorLineRange(oldState));
  rangesToRefresh.push(getCursorLineRange(state));
  return updateCursorDecorationsForRanges(state, newIndex, oldDecos, rangesToRefresh);
}

const blockWidgetDecorationField = StateField.define<DecorationSet>({
  create(state) {
    const index = getBlockStructureIndex(state);
    return buildWidgetDecorations(state, index);
  },
  update(value, tr) {
    const index = getBlockStructureIndex(tr.state);
    if (tr.effects.some((effect) => effect.is(toggleFrontmatterSourceModeEffect))) {
      return buildWidgetDecorations(tr.state, index);
    }
    if (tr.docChanged) {
      const changedRanges = getChangedRanges(tr);
      const mapped = value.map(tr.changes);
      return updateWidgetDecorationsForRanges(tr.state, index, mapped, expandChangedRanges(tr.state, index, changedRanges));
    }
    const tableSourceRanges = getTableSourceChangedRanges(tr.startState, tr.state);
    if (tableSourceRanges.length > 0) {
      return updateWidgetDecorationsForRanges(tr.state, index, value, tableSourceRanges);
    }
    const imageSourceRanges = getImageSourceChangedRanges(tr.startState, tr.state);
    if (imageSourceRanges.length > 0) {
      return updateWidgetDecorationsForRanges(tr.state, index, value, imageSourceRanges);
    }
    if (tr.selection) {
      return updateWidgetDecorationsForSelectionChange(tr.state, tr.startState, value);
    }
    return value;
  },
});

const blockCursorDecorationField = StateField.define<DecorationSet>({
  create(state) {
    const index = getBlockStructureIndex(state);
    return buildCursorDecorations(state, index);
  },
  update(value, tr) {
    const index = getBlockStructureIndex(tr.state);
    const viewportRefresh = tr.effects.filter((effect) => effect.is(refreshLivePreviewViewportDecorationsEffect));
    if (viewportRefresh.length > 0) {
      const ranges = mergeRanges(viewportRefresh.flatMap((effect) => effect.value));
      if (ranges.length > 0) {
        return updateCursorDecorationsForRanges(
          tr.state,
          index,
          value,
          expandChangedRanges(tr.state, index, ranges)
        );
      }
    }
    if (tr.effects.some((effect) => effect.is(refreshLivePreviewDecorationsEffect))) {
      return updateCursorDecorationsForSelectionChange(tr.state, tr.startState, value);
    }
    if (tr.docChanged) {
      const changedRanges = getChangedRanges(tr);
      const mapped = value.map(tr.changes);
      let finalRanges = expandChangedRanges(tr.state, index, changedRanges);
      const fmScanEnd = tr.state.doc.line(Math.min(tr.state.doc.lines, FRONTMATTER_SCAN_MAX_LINES)).to;
      const touchesFrontmatterRegion = changedRanges.some((range) => range.from <= fmScanEnd);
      if (touchesFrontmatterRegion) {
        finalRanges = mergeRanges([...finalRanges, { from: 0, to: fmScanEnd }]);
      }
      return updateCursorDecorationsForRanges(tr.state, index, mapped, finalRanges);
    }
    const tableSourceRanges = getTableSourceChangedRanges(tr.startState, tr.state);
    if (tableSourceRanges.length > 0) {
      return updateCursorDecorationsForRanges(tr.state, index, value, tableSourceRanges);
    }
    if (tr.selection) {
      return updateCursorDecorationsForSelectionChange(tr.state, tr.startState, value);
    }
    return value;
  },
});

const blockWidgetAtomicRanges = EditorView.atomicRanges.of((view) => {
  const decoSet = view.state.field(blockWidgetDecorationField, false);
  if (!decoSet) return RangeSet.empty;
  const builder = new RangeSetBuilder<Decoration>();
  const iter = decoSet.iter();
  while (iter.value) {
    if (iter.value.spec?.widget && iter.value.spec.block) {
      builder.add(iter.from, iter.to, iter.value);
    }
    iter.next();
  }
  return builder.finish();
});

export function findBlockWidgetRangeAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const decoSet = state.field(blockWidgetDecorationField, false);
  if (!decoSet) return null;
  const iter = decoSet.iter();
  while (iter.value) {
    if (iter.value.spec?.widget && iter.value.spec.block && pos >= iter.from && pos < iter.to) {
      return { from: iter.from, to: iter.to };
    }
    iter.next();
  }
  return null;
}

function clampSelectionPosForWidget(
  state: EditorState,
  pos: number,
  bias: 'before' | 'after' | 'closest'
): number {
  const range = findBlockWidgetRangeAt(state, pos);
  if (!range) {
    return pos;
  }
  if (bias === 'before') {
    return range.from;
  }
  if (bias === 'after') {
    return range.to;
  }
  return pos - range.from <= range.to - pos ? range.from : range.to;
}

function safePosAtCoords(view: EditorView, coords: { x: number; y: number }): number | null {
  try {
    return view.posAtCoords(coords);
  } catch (error) {
    console.warn('[livePreviewBlockDecorations] posAtCoords failed', error);
    return null;
  }
}

const BLOCK_WIDGET_MOUSE_CAPTURE_SELECTOR = [
  '.cm-md-table-block',
  '.cm-md-mermaid-block',
  '.cm-md-embed',
].join(', ');

function eventStartsInBlockWidget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest(BLOCK_WIDGET_MOUSE_CAPTURE_SELECTOR));
}

const blockWidgetMouseSelection = EditorView.mouseSelectionStyle.of((view, event) => {
  const startPos = safePosAtCoords(view, { x: event.clientX, y: event.clientY });
  const startInBlockWidgetDom = eventStartsInBlockWidget(event.target);
  const startInBlockWidgetRange = startPos !== null && findBlockWidgetRangeAt(view.state, startPos) !== null;
  const hasModifier = event.shiftKey || event.altKey || event.metaKey || event.ctrlKey;

  if (!shouldUseBlockWidgetMouseSelection({
    button: event.button,
    hasModifier,
    startPos,
    startInBlockWidgetRange,
    startInBlockWidgetDom,
  })) {
    return null;
  }
  if (startPos === null) {
    return null;
  }

  let anchorPos = clampSelectionPosForWidget(view.state, startPos, 'closest');
  return {
    get(curEvent) {
      const rawHead = safePosAtCoords(view, { x: curEvent.clientX, y: curEvent.clientY }) ?? startPos;
      const movingForward = rawHead >= startPos;
      const headPos = clampSelectionPosForWidget(view.state, rawHead, movingForward ? 'before' : 'after');
      return EditorSelection.single(anchorPos, headPos);
    },
    update(update) {
      if (!update.docChanged) {
        return false;
      }
      anchorPos = update.changes.mapPos(anchorPos);
      return false;
    },
  };
});

export function livePreviewBlockDecorations(options: LivePreviewBlockDecorationOptions = {}) {
  currentLivePreviewBlockOptions = {
    exportMode: options.exportMode === true,
    showImageDeleteButton: options.showImageDeleteButton === true,
  };
  return [
    blockStructureIndexField,
    tableSourceBlockField,
    blockWidgetDecorationField,
    blockCursorDecorationField,
    EditorView.decorations.compute([blockWidgetDecorationField], (state) => state.field(blockWidgetDecorationField)),
    EditorView.decorations.compute([blockCursorDecorationField], (state) => state.field(blockCursorDecorationField)),
    blockWidgetAtomicRanges,
    blockWidgetMouseSelection,
  ];
}
