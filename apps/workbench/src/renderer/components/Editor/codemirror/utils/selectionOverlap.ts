export type SelectionSnapshot = {
  from: number;
  to: number;
  head: number;
  empty: boolean;
};

export function isSelectionOverlappingRange(
  selection: SelectionSnapshot,
  from: number,
  to: number
): boolean {
  if (selection.empty) {
    return selection.head >= from && selection.head <= to;
  }
  return selection.from < to && selection.to > from;
}
