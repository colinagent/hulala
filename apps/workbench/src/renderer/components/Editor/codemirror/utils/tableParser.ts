export interface TableCellRange {
  from: number;
  to: number;
}

export interface TableLineParsed {
  // Pipe character offsets in the line (relative to line start).
  pipes: number[];
  // Trimmed content ranges for cells between pipes (or inferred edges).
  cells: TableCellRange[];
  // True when all cells match markdown separator syntax (:---:, ---:, :---, ---).
  isSeparator: boolean;
}

function trimRange(text: string, from: number, to: number): TableCellRange | null {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(text[start])) {
    start += 1;
  }
  while (end > start && /\s/.test(text[end - 1])) {
    end -= 1;
  }
  if (start >= end) {
    return null;
  }
  return { from: start, to: end };
}

function countRepeatedChar(text: string, index: number, ch: string): number {
  let cursor = index;
  while (cursor < text.length && text[cursor] === ch) {
    cursor += 1;
  }
  return cursor - index;
}

function findClosingBacktickRun(text: string, from: number, runLength: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] !== '`') {
      continue;
    }
    const nextRunLength = countRepeatedChar(text, index, '`');
    if (nextRunLength === runLength) {
      return index;
    }
    index += nextRunLength - 1;
  }
  return -1;
}

function findTablePipePositions(text: string): number[] {
  const pipes: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];

    if (ch === '\\') {
      if (index + 1 < text.length) {
        index += 1;
      }
      continue;
    }

    if (ch === '`') {
      const runLength = countRepeatedChar(text, index, '`');
      const closingIndex = findClosingBacktickRun(text, index + runLength, runLength);
      if (closingIndex !== -1) {
        index = closingIndex + runLength - 1;
        continue;
      }
      index += runLength - 1;
      continue;
    }

    if (ch === '|') {
      pipes.push(index);
    }
  }

  return pipes;
}

function buildTableCellBoundaries(text: string): number[] | null {
  const pipes = findTablePipePositions(text);
  if (pipes.length === 0) {
    return null;
  }

  const boundaries = pipes.slice();
  if (boundaries[0] !== 0) {
    boundaries.unshift(-1);
  }
  if (boundaries[boundaries.length - 1] !== text.length - 1) {
    boundaries.push(text.length);
  }
  return boundaries;
}

export function parseTableLine(text: string): TableLineParsed | null {
  const pipes = findTablePipePositions(text);
  if (pipes.length === 0) {
    return null;
  }

  const boundaries = buildTableCellBoundaries(text);
  if (!boundaries) {
    return null;
  }

  const cells: TableCellRange[] = [];
  const cellTexts: string[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const rawFrom = boundaries[i] + 1;
    const rawTo = boundaries[i + 1];
    if (rawFrom > rawTo) {
      continue;
    }
    const rawCellText = text.slice(rawFrom, rawTo).trim();
    cellTexts.push(rawCellText);
    const trimmed = trimRange(text, rawFrom, rawTo);
    if (trimmed) {
      cells.push(trimmed);
    }
  }

  const isSeparator =
    cellTexts.length > 0 &&
    cellTexts.every((cellText) => /^:?-+:?$/.test(cellText));

  return { pipes, cells, isSeparator };
}

/** Split a table line by pipes and trim each cell. Handles escaped pipes and code spans. */
export function splitTableCells(line: string): string[] {
  const boundaries = buildTableCellBoundaries(line);
  if (!boundaries) {
    return [];
  }

  const cells: string[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const rawFrom = boundaries[i] + 1;
    const rawTo = boundaries[i + 1];
    cells.push(line.slice(rawFrom, rawTo).trim());
  }
  return cells;
}

export type TableAlignment = 'left' | 'right' | 'center' | 'none';

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  alignments: TableAlignment[];
}

function getColumnCount(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  alignments: readonly TableAlignment[]
): number {
  return Math.max(headers.length, alignments.length, 0, ...rows.map((row) => row.length));
}

function normalizeCells(cells: readonly string[], columnCount: number): string[] {
  const normalized = cells.slice(0, columnCount);
  while (normalized.length < columnCount) {
    normalized.push('');
  }
  return normalized;
}

function normalizeAlignments(
  alignments: readonly TableAlignment[],
  columnCount: number
): TableAlignment[] {
  const normalized = alignments.slice(0, columnCount);
  while (normalized.length < columnCount) {
    normalized.push('none');
  }
  return normalized;
}

/** Map separator cell content to alignment (:---: center, ---: right, :--- left, --- none). */
function parseAlignment(cell: string): TableAlignment {
  const t = cell.trim();
  if (t.startsWith(':') && t.endsWith(':')) return 'center';
  if (t.endsWith(':')) return 'right';
  if (t.startsWith(':')) return 'left';
  return 'none';
}

/**
 * Parse a full GFM table block (header + separator + body rows) into headers, rows, and alignments.
 * Returns null if the text is not a valid table (e.g. fewer than 2 lines, or separator invalid).
 */
export function parseTableBlock(text: string): ParsedTable | null {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    return null;
  }
  const rawHeaders = splitTableCells(lines[0]);
  if (rawHeaders.length === 0) {
    return null;
  }
  const secondLine = splitTableCells(lines[1]);
  const isSeparator =
    secondLine.length > 0 &&
    secondLine.every((cell) => /^:?-+:?$/.test(cell));
  if (!isSeparator) {
    return null;
  }
  const rawAlignments = secondLine.map(parseAlignment);
  const rawRows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    rawRows.push(splitTableCells(lines[i]));
  }
  const columnCount = getColumnCount(rawHeaders, rawRows, rawAlignments);
  const headers = normalizeCells(rawHeaders, columnCount);
  const alignments = normalizeAlignments(rawAlignments, columnCount);
  const rows = rawRows.map((row) => normalizeCells(row, columnCount));
  return { headers, rows, alignments };
}

/** Escape table-delimiting pipes while preserving escaped pipes and code spans. */
function escapeCell(s: string): string {
  let out = '';

  for (let index = 0; index < s.length; index += 1) {
    const ch = s[index];

    if (ch === '\\') {
      out += ch;
      if (index + 1 < s.length) {
        out += s[index + 1];
        index += 1;
      }
      continue;
    }

    if (ch === '`') {
      const runLength = countRepeatedChar(s, index, '`');
      const closingIndex = findClosingBacktickRun(s, index + runLength, runLength);
      if (closingIndex !== -1) {
        out += s.slice(index, closingIndex + runLength);
        index = closingIndex + runLength - 1;
        continue;
      }
      out += s.slice(index, index + runLength);
      index += runLength - 1;
      continue;
    }

    if (ch === '|') {
      out += '\\|';
      continue;
    }

    out += ch;
  }

  return out;
}

/** Serialize alignment to separator cell. */
function sepCell(a: TableAlignment): string {
  if (a === 'center') return ':---:';
  if (a === 'right') return '---:';
  return '---';
}

/**
 * Serialize headers, rows, and alignments back to GFM Markdown table text.
 */
export function serializeTable(
  headers: string[],
  rows: string[][],
  alignments: TableAlignment[]
): string {
  const line = (cells: string[]) => '| ' + cells.join(' | ') + ' |';
  const columnCount = getColumnCount(headers, rows, alignments);
  const normalizedHeaders = normalizeCells(headers, columnCount);
  const normalizedRows = rows.map((row) => normalizeCells(row, columnCount));
  const sep = normalizeAlignments(alignments, columnCount).map(sepCell);
  return [
    line(normalizedHeaders.map(escapeCell)),
    line(sep),
    ...normalizedRows.map((r) => line(r.map(escapeCell))),
  ].join('\n');
}
