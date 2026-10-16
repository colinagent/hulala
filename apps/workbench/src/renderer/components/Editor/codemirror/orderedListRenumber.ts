import { Annotation, EditorState, type Extension, type Transaction } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

type DocumentRange = {
  from: number;
  to: number;
};

export type OrderedListRenumberChange = {
  from: number;
  to: number;
  insert: string;
};

const ORDERED_MARKER_RE = /^(\d+)[.)]$/;
const MAX_MARKDOWN_ORDERED_MARKER = 999_999_999n;

function overlapsChangedRange(node: SyntaxNode, ranges: readonly DocumentRange[]): boolean {
  return ranges.some((range) => range.from <= node.to && range.to >= node.from);
}

function getDirectListMarker(listItem: SyntaxNode): SyntaxNode | null {
  for (let child = listItem.firstChild; child; child = child.nextSibling) {
    if (child.name === 'ListMark') {
      return child;
    }
  }
  return null;
}

function getChangesForOrderedList(
  state: EditorState,
  orderedList: SyntaxNode
): OrderedListRenumberChange[] | null {
  const markers: Array<{ node: SyntaxNode; digits: string }> = [];
  for (let child = orderedList.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'ListItem') {
      continue;
    }
    const marker = getDirectListMarker(child);
    if (!marker) {
      return null;
    }
    const match = ORDERED_MARKER_RE.exec(state.doc.sliceString(marker.from, marker.to));
    if (!match) {
      return null;
    }
    markers.push({ node: marker, digits: match[1] });
  }

  if (markers.length < 2) {
    return [];
  }

  const start = BigInt(markers[0].digits);
  const changes: OrderedListRenumberChange[] = [];
  for (let index = 1; index < markers.length; index += 1) {
    const expected = start + BigInt(index);
    if (expected > MAX_MARKDOWN_ORDERED_MARKER) {
      return null;
    }
    const insert = expected.toString();
    const marker = markers[index];
    if (marker.digits !== insert) {
      changes.push({
        from: marker.node.from,
        to: marker.node.from + marker.digits.length,
        insert,
      });
    }
  }
  return changes;
}

/**
 * Rebuilds numbering only for ordered lists touched by the current edit.
 * Each Markdown OrderedList keeps its first marker as the starting number;
 * nested OrderedList nodes are numbered independently.
 */
export function getOrderedListRenumberChanges(
  state: EditorState,
  changedRanges: readonly DocumentRange[]
): OrderedListRenumberChange[] {
  if (changedRanges.length === 0) {
    return [];
  }

  const changes: OrderedListRenumberChange[] = [];
  const seenLists = new Set<string>();
  const tree = syntaxTree(state);
  for (const range of changedRanges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (ref) => {
        if (ref.name !== 'OrderedList' || !overlapsChangedRange(ref.node, changedRanges)) {
          return;
        }
        const key = `${ref.from}:${ref.to}`;
        if (seenLists.has(key)) {
          return;
        }
        seenLists.add(key);
        const listChanges = getChangesForOrderedList(state, ref.node);
        if (listChanges) {
          changes.push(...listChanges);
        }
      },
    });
  }
  return changes.sort((left, right) => left.from - right.from);
}

export const skipOrderedListRenumber = Annotation.define<boolean>();

function getChangedDocumentRanges(transaction: Transaction): DocumentRange[] {
  const ranges: DocumentRange[] = [];
  transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    ranges.push({ from: fromB, to: toB });
  });
  return ranges;
}

export function orderedListRenumbering(): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged || transaction.annotation(skipOrderedListRenumber)) {
      return transaction;
    }

    const changes = getOrderedListRenumberChanges(
      transaction.state,
      getChangedDocumentRanges(transaction)
    );
    if (changes.length === 0) {
      return transaction;
    }

    return [
      transaction,
      {
        changes,
        sequential: true,
      },
    ];
  });
}
