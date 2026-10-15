export type TableCellSelectionRange = {
  anchorRow: number;
  anchorCol: number;
  currentRow: number;
  currentCol: number;
};

export function serializeTableCellSelectionRows(
  rows: readonly (readonly string[])[],
  selection: TableCellSelectionRange | null
): string | null {
  if (!selection) {
    return null;
  }
  const { anchorRow, anchorCol, currentRow, currentCol } = selection;
  if (
    !Number.isInteger(anchorRow) ||
    !Number.isInteger(anchorCol) ||
    !Number.isInteger(currentRow) ||
    !Number.isInteger(currentCol)
  ) {
    return null;
  }
  const minR = Math.min(anchorRow, currentRow);
  const maxR = Math.max(anchorRow, currentRow);
  const minC = Math.min(anchorCol, currentCol);
  const maxC = Math.max(anchorCol, currentCol);
  if (minR < 0 || minC < 0 || maxR < minR || maxC < minC) {
    return null;
  }

  const lines: string[] = [];
  for (let r = minR; r <= maxR; r++) {
    const row = rows[r];
    if (!row) continue;
    const values: string[] = [];
    for (let c = minC; c <= maxC; c++) {
      values.push(row[c] ?? '');
    }
    lines.push(values.join('\t'));
  }
  return lines.length > 0 ? lines.join('\n') : null;
}
