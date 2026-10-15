import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { isOrderedListMarker, nextOrderedListMarker } from './orderedListDisplay';

export type ParsedListLine = {
  markerText: string;
  markerFrom: number;
  markerTo: number;
  isOrdered: boolean;
  taskMarkerFrom: number | null;
  taskMarkerTo: number | null;
  taskContentFrom: number | null;
  taskChecked: boolean;
};

export type ListContinuationLineInfo = {
  depth: number;
  markerTo: number;
};

export function parseListLinePrefix(text: string): ParsedListLine | null {
  // Obsidian-style: only treat as list when marker is followed by at least one space.
  // "-hello" / "2.hello" / "5." are plain text, not list lines.
  const listMatch = text.match(/^(\s*)([-*+]|\d+\.|[A-Za-z]+\.)(\s+)/);
  if (!listMatch) {
    return null;
  }

  const markerIndent = listMatch[1].length;
  const markerText = listMatch[2];
  const isOrdered = isOrderedListMarker(markerText);
  if (!isOrdered && !/^[-*+]$/.test(markerText)) {
    return null;
  }
  const markerSpacing = listMatch[3].length;
  const markerFrom = markerIndent;
  const markerTo = markerFrom + markerText.length + markerSpacing;
  const taskMatch = text.slice(markerTo).match(/^\[( |x|X)\](\s+)/);
  const taskMarkerFrom = taskMatch ? markerTo : null;
  const taskMarkerTo = taskMatch ? markerTo + 3 : null;
  const taskContentFrom = taskMatch ? markerTo + taskMatch[0].length : null;

  return {
    markerText,
    markerFrom,
    markerTo,
    isOrdered,
    taskMarkerFrom,
    taskMarkerTo,
    taskContentFrom,
    taskChecked: taskMatch ? taskMatch[1].toLowerCase() === 'x' : false,
  };
}

export function getTaskListPrefixRange(
  parsed: ParsedListLine
): { from: number; to: number } | null {
  if (parsed.taskContentFrom === null) {
    return null;
  }

  return {
    from: parsed.markerFrom,
    to: parsed.taskContentFrom,
  };
}

export function getListContinuationInsert(text: string): string | null {
  const parsed = parseListLinePrefix(text);
  if (!parsed) {
    return null;
  }

  const contentFrom = parsed.taskContentFrom ?? parsed.markerTo;
  if (text.slice(contentFrom).trim().length === 0) {
    return null;
  }

  return buildListContinuationInsert(text, parsed);
}

function buildListContinuationInsert(text: string, parsed: ParsedListLine): string {
  const indent = text.slice(0, parsed.markerFrom);
  const markerSpacing = text.slice(
    parsed.markerFrom + parsed.markerText.length,
    parsed.markerTo
  ) || ' ';
  const marker = parsed.isOrdered
    ? nextOrderedListMarker(parsed.markerText, getListDepth(parsed))
    : parsed.markerText;

  if (parsed.taskMarkerTo !== null && parsed.taskContentFrom !== null) {
    const taskSpacing = text.slice(parsed.taskMarkerTo, parsed.taskContentFrom) || ' ';
    return `\n${indent}${marker}${markerSpacing}[ ]${taskSpacing}`;
  }

  return `\n${indent}${marker}${markerSpacing}`;
}

export function getListContinuationInsertAt(state: EditorState, pos: number): string | null {
  const doc = state.doc;
  const clamped = Math.max(0, Math.min(pos, doc.length));
  const line = doc.lineAt(clamped);
  if (clamped !== line.to || line.text.trim().length === 0) {
    return null;
  }

  const direct = getListContinuationInsert(line.text);
  if (direct) {
    return direct;
  }
  if (parseListLinePrefix(line.text)) {
    // Empty nested bullets can parse as Setext headings instead of ListItems.
    // Do not climb to an outer list and accidentally continue the parent item.
    return null;
  }

  const tree = syntaxTree(state);
  const starts = [tree.resolve(clamped, -1), tree.resolve(clamped, 1)];
  for (const start of starts) {
    let node: SyntaxNode | null = start;
    while (node) {
      if (node.name === 'ListItem') {
        const firstLine = doc.lineAt(node.from);
        const parsed = parseListLinePrefix(firstLine.text);
        if (parsed) {
          // A marker-only current line must keep CodeMirror's normal exit-list behavior.
          if (firstLine.number === line.number) {
            return null;
          }
          return buildListContinuationInsert(firstLine.text, parsed);
        }
      }
      node = node.parent;
    }
  }

  return null;
}

export function getListDepth(parsed: ParsedListLine): number {
  return Math.min(Math.floor(parsed.markerFrom / 2), 5);
}

export function collectListContinuationLineInfo(
  state: EditorState,
  from: number,
  to: number
): Map<number, ListContinuationLineInfo> {
  const doc = state.doc;
  const lines = new Map<number, ListContinuationLineInfo>();
  const rangeStartLine = doc.lineAt(from).number;
  const rangeEndLine = doc.lineAt(to).number;
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name !== 'ListItem') {
        return;
      }
      const firstLine = doc.lineAt(node.from);
      const parsed = parseListLinePrefix(firstLine.text);
      if (!parsed) {
        return;
      }
      const lastLine = doc.lineAt(Math.max(node.from, node.to));
      if (lastLine.number <= firstLine.number) {
        return;
      }
      const info: ListContinuationLineInfo = {
        depth: getListDepth(parsed),
        markerTo: parsed.markerTo,
      };
      const startLine = Math.max(firstLine.number + 1, rangeStartLine);
      const endLine = Math.min(lastLine.number, rangeEndLine);
      for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
        const existing = lines.get(lineNumber);
        if (!existing || info.depth >= existing.depth) {
          lines.set(lineNumber, info);
        }
      }
    },
  });

  return lines;
}

export function getListItemContinuationIndentAt(state: EditorState, pos: number): string | null {
  const doc = state.doc;
  const clamped = Math.max(0, Math.min(pos, doc.length));
  const tree = syntaxTree(state);
  const starts = [tree.resolve(clamped, -1), tree.resolve(clamped, 1)];
  for (const start of starts) {
    let node: SyntaxNode | null = start;
    while (node) {
      if (node.name === 'ListItem') {
        const firstLine = doc.lineAt(node.from);
        const parsed = parseListLinePrefix(firstLine.text);
        if (!parsed) {
          return null;
        }
        const contentFrom = parsed.taskContentFrom ?? parsed.markerTo;
        return ' '.repeat(contentFrom);
      }
      node = node.parent;
    }
  }
  return null;
}
