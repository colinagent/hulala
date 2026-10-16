import { EditorState, StateField } from '@codemirror/state';
import {
  isMatchingFenceCloser,
  parseFenceLine,
} from '../../markdownFences.ts';
import { getFrontmatterInfo, type FrontmatterInfo } from './frontmatter.ts';
import { matchLeadingMarkdownImage } from './imageSourceRanges.ts';
import { parseDrawingEmbed } from '../../excalidraw/drawingDocument';
import { parseTableBlock, parseTableLine } from './tableParser.ts';

export type IndexedFenceBlock = {
  from: number;
  to: number;
  startLineNumber: number;
  endLineNumber: number;
  closerLineNumber: number | null;
  language: string;
};

export type IndexedTableBlock = {
  from: number;
  to: number;
  startLineNumber: number;
  endLineNumber: number;
};

export type IndexedImageBlock = {
  from: number;
  to: number;
  lineNumber: number;
  sourceFrom: number;
  sourceTo: number;
  alt: string;
  url: string;
  widthPercent: number | null;
  drawing?: boolean;
};

export type IndexedIndentedCodeBlock = {
  from: number;
  to: number;
  startLineNumber: number;
  endLineNumber: number;
};

export type BlockStructureIndex = {
  frontmatter: FrontmatterInfo | null;
  fences: IndexedFenceBlock[];
  tables: IndexedTableBlock[];
  images: IndexedImageBlock[];
  indentedCodeBlocks: IndexedIndentedCodeBlock[];
};

function lineContainsTableSyntax(text: string): boolean {
  return parseTableLine(text) !== null;
}

function isIndentedCodeLine(text: string): boolean {
  if (!text.trim()) {
    return false;
  }
  return text.startsWith('\t') || text.startsWith('    ');
}

function canStartIndentedCodeBlock(doc: EditorState['doc'], lineNumber: number): boolean {
  if (!isIndentedCodeLine(doc.line(lineNumber).text)) {
    return false;
  }
  if (lineNumber <= 1) {
    return true;
  }
  const previousLine = doc.line(lineNumber - 1).text;
  return previousLine.trim() === '';
}

function buildFenceBlock(state: EditorState, startLineNumber: number): IndexedFenceBlock | null {
  const doc = state.doc;
  const openerLine = doc.line(startLineNumber);
  const openerFence = parseFenceLine(openerLine.text);
  if (!openerFence) {
    return null;
  }

  let endLineNumber = doc.lines;
  let closerLineNumber: number | null = null;
  for (let lineNumber = startLineNumber + 1; lineNumber <= doc.lines; lineNumber += 1) {
    if (isMatchingFenceCloser(openerFence, doc.line(lineNumber).text)) {
      endLineNumber = lineNumber;
      closerLineNumber = lineNumber;
      break;
    }
  }

  const language = (openerFence.info || '').trim().toLowerCase();
  return {
    from: openerLine.from,
    to: doc.line(endLineNumber).to,
    startLineNumber,
    endLineNumber,
    closerLineNumber,
    language,
  };
}

function buildIndentedCodeBlock(state: EditorState, startLineNumber: number): IndexedIndentedCodeBlock | null {
  const doc = state.doc;
  if (!canStartIndentedCodeBlock(doc, startLineNumber)) {
    return null;
  }

  let endLineNumber = startLineNumber;
  for (let lineNumber = startLineNumber + 1; lineNumber <= doc.lines; lineNumber += 1) {
    const text = doc.line(lineNumber).text;
    if (!text.trim()) {
      endLineNumber = lineNumber;
      continue;
    }
    if (!isIndentedCodeLine(text)) {
      break;
    }
    endLineNumber = lineNumber;
  }

  return {
    from: doc.line(startLineNumber).from,
    to: doc.line(endLineNumber).to,
    startLineNumber,
    endLineNumber,
  };
}

function buildTableBlock(state: EditorState, startLineNumber: number): IndexedTableBlock | null {
  const doc = state.doc;
  if (startLineNumber >= doc.lines) {
    return null;
  }

  const firstLine = doc.line(startLineNumber);
  const secondLine = doc.line(startLineNumber + 1);
  const secondParsed = parseTableLine(secondLine.text);
  if (!lineContainsTableSyntax(firstLine.text) || !secondParsed?.isSeparator) {
    return null;
  }

  let endLineNumber = startLineNumber + 1;
  for (let lineNumber = startLineNumber + 2; lineNumber <= doc.lines; lineNumber += 1) {
    const nextLine = doc.line(lineNumber);
    if (!nextLine.text.trim()) {
      break;
    }
    if (parseFenceLine(nextLine.text) || !lineContainsTableSyntax(nextLine.text)) {
      break;
    }
    endLineNumber = lineNumber;
  }

  const startPos = firstLine.from;
  const endPos = doc.line(endLineNumber).to;
  const tableText = doc.sliceString(startPos, endPos);
  if (!parseTableBlock(tableText)) {
    return null;
  }

  return {
    from: startPos,
    to: endPos,
    startLineNumber,
    endLineNumber,
  };
}

function buildStandaloneImageBlock(state: EditorState, lineNumber: number): IndexedImageBlock | null {
  const doc = state.doc;
  const line = doc.line(lineNumber);
  const trimmed = line.text.trim();
  if (!trimmed.startsWith('![')) {
    return null;
  }

  const drawing = parseDrawingEmbed(trimmed);
  if (drawing) {
    const leading = line.text.length - line.text.trimStart().length;
    return {
      from: line.from, to: line.to, lineNumber,
      sourceFrom: line.from + leading, sourceTo: line.from + leading + trimmed.length,
      alt: drawing.label, url: drawing.target, widthPercent: null, drawing: true,
    };
  }
  const match = matchLeadingMarkdownImage(trimmed);
  if (!match || match.trailingText) {
    return null;
  }

  const leading = line.text.length - line.text.trimStart().length;
  return {
    from: line.from,
    to: line.to,
    lineNumber,
    sourceFrom: line.from + leading + match.sourceFrom,
    sourceTo: line.from + leading + match.sourceTo,
    alt: match.alt,
    url: match.url,
    widthPercent: match.widthPercent,
  };
}

export function buildBlockStructureIndex(state: EditorState): BlockStructureIndex {
  const doc = state.doc;
  const frontmatter = getFrontmatterInfo(state);
  const fences: IndexedFenceBlock[] = [];
  const tables: IndexedTableBlock[] = [];
  const images: IndexedImageBlock[] = [];
  const indentedCodeBlocks: IndexedIndentedCodeBlock[] = [];

  let lineNumber = frontmatter ? frontmatter.endLineNumber + 1 : 1;
  while (lineNumber <= doc.lines) {
    const fenceBlock = buildFenceBlock(state, lineNumber);
    if (fenceBlock) {
      fences.push(fenceBlock);
      lineNumber = fenceBlock.endLineNumber + 1;
      continue;
    }

    const indentedCodeBlock = buildIndentedCodeBlock(state, lineNumber);
    if (indentedCodeBlock) {
      indentedCodeBlocks.push(indentedCodeBlock);
      lineNumber = indentedCodeBlock.endLineNumber + 1;
      continue;
    }

    const tableBlock = buildTableBlock(state, lineNumber);
    if (tableBlock) {
      tables.push(tableBlock);
      lineNumber = tableBlock.endLineNumber + 1;
      continue;
    }

    const imageBlock = buildStandaloneImageBlock(state, lineNumber);
    if (imageBlock) {
      images.push(imageBlock);
    }

    lineNumber += 1;
  }

  return {
    frontmatter,
    fences,
    tables,
    images,
    indentedCodeBlocks,
  };
}

export const blockStructureIndexField = StateField.define<BlockStructureIndex>({
  create(state) {
    return buildBlockStructureIndex(state);
  },
  update(value, tr) {
    if (!tr.docChanged) {
      return value;
    }
    return buildBlockStructureIndex(tr.state);
  },
});

export function getBlockStructureIndex(state: EditorState): BlockStructureIndex {
  return state.field(blockStructureIndexField, false) ?? buildBlockStructureIndex(state);
}

function containsPos(range: { from: number; to: number }, pos: number): boolean {
  return pos >= range.from && pos < range.to;
}

function overlapsRange(range: { from: number; to: number }, from: number, to: number): boolean {
  return range.from <= to && range.to >= from;
}

export function findIndexedFenceBlockByFrom(
  index: BlockStructureIndex,
  from: number
): IndexedFenceBlock | null {
  return index.fences.find((block) => block.from === from) ?? null;
}

export function findIndexedFenceBlockAtPos(
  index: BlockStructureIndex,
  pos: number
): IndexedFenceBlock | null {
  return index.fences.find((block) => containsPos(block, pos)) ?? null;
}

export function findIndexedTableBlockByFrom(
  index: BlockStructureIndex,
  from: number
): IndexedTableBlock | null {
  return index.tables.find((block) => block.from === from) ?? null;
}

export function findIndexedTableBlockAtPos(
  index: BlockStructureIndex,
  pos: number
): IndexedTableBlock | null {
  return index.tables.find((block) => containsPos(block, pos)) ?? null;
}

export function findIndexedImageBlockBySourceRange(
  index: BlockStructureIndex,
  from: number,
  to: number
): IndexedImageBlock | null {
  return index.images.find((block) => block.sourceFrom === from && block.sourceTo === to) ?? null;
}

export function findIndexedIndentedCodeBlockAtPos(
  index: BlockStructureIndex,
  pos: number
): IndexedIndentedCodeBlock | null {
  return index.indentedCodeBlocks.find((block) => containsPos(block, pos)) ?? null;
}

export function getOverlappingFenceBlocks(
  index: BlockStructureIndex,
  from: number,
  to: number
): IndexedFenceBlock[] {
  return index.fences.filter((block) => overlapsRange(block, from, to));
}

export function getOverlappingTableBlocks(
  index: BlockStructureIndex,
  from: number,
  to: number
): IndexedTableBlock[] {
  return index.tables.filter((block) => overlapsRange(block, from, to));
}

export function getOverlappingImageBlocks(
  index: BlockStructureIndex,
  from: number,
  to: number
): IndexedImageBlock[] {
  return index.images.filter((block) => overlapsRange(block, from, to));
}

export function getOverlappingIndentedCodeBlocks(
  index: BlockStructureIndex,
  from: number,
  to: number
): IndexedIndentedCodeBlock[] {
  return index.indentedCodeBlocks.filter((block) => overlapsRange(block, from, to));
}
