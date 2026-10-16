import type { TableAlignment } from '../utils/tableParser';
import { parseTableBlock, serializeTable } from '../utils/tableParser';
import {
  matchTableCellLineBreakToken,
  parseTableCellInlineMarkdown,
  type TableCellInlineSegment,
} from '../utils/tableCellInlineMarkdown';
import { EditorSelection } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { openTableSourceEffect } from '../tableSourceState';
import { serializeTableCellSelectionRows } from '../utils/tableSelectionCopy';
import { EDIT_SOURCE_ICON_SVG } from './editSourceIcon';
import { CM_MD_INLINE_CODE } from '../markdownInlinePill';
import { writeClipboardText } from '../../../../services/clipboardService';

export const TABLE_SELECTION_TEXT_PROVIDER = '__hulalaTableSelectionTextProvider';

export type TableSelectionTextProvider = {
  getSelectedText: () => string | null;
};

type TableSelectionHost = HTMLElement & {
  [TABLE_SELECTION_TEXT_PROVIDER]?: TableSelectionTextProvider;
};

export function getActiveTableSelectionText(
  root: ParentNode | null | undefined,
  activeElement: Element | null = typeof document === 'undefined' ? null : document.activeElement
): string | null {
  if (!root) {
    return null;
  }
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('.cm-md-table-block'))
    .map((element) => {
      const provider = (element as TableSelectionHost)[TABLE_SELECTION_TEXT_PROVIDER];
      const text = provider?.getSelectedText() ?? null;
      return text === null ? null : { element, text };
    })
    .filter((candidate): candidate is { element: HTMLElement; text: string } => candidate !== null);

  if (activeElement) {
    const activeCandidate = candidates.find(({ element }) => element.contains(activeElement));
    if (activeCandidate) {
      return activeCandidate.text;
    }
  }
  return candidates[0]?.text ?? null;
}

function textAlignFor(a: TableAlignment | undefined): string {
  if (a === 'center') return 'center';
  if (a === 'right') return 'right';
  return 'left';
}

function applyAlignmentToCell(cell: HTMLElement, alignment: TableAlignment | undefined): void {
  cell.style.textAlign = textAlignFor(alignment);
}

function appendPlainCellContent(parent: HTMLElement, text: string): void {
  const normalized = text.replace(/\r?\n/g, '<br>');
  let chunkStart = 0;
  let index = 0;

  while (index < normalized.length) {
    const lineBreak = matchTableCellLineBreakToken(normalized, index);
    if (lineBreak) {
      const chunk = normalized.slice(chunkStart, index);
      if (chunk.length > 0) {
        parent.appendChild(document.createTextNode(chunk));
      }
      parent.appendChild(document.createElement('br'));
      index += lineBreak.length;
      chunkStart = index;
      continue;
    }
    index += 1;
  }

  const tail = normalized.slice(chunkStart);
  if (tail.length > 0 || parent.childNodes.length === 0) {
    parent.appendChild(document.createTextNode(tail));
  }
}

function appendRenderedInlineSegments(
  parent: Node,
  segments: readonly TableCellInlineSegment[]
): void {
  for (const segment of segments) {
    switch (segment.type) {
      case 'text':
        parent.appendChild(document.createTextNode(segment.text));
        break;
      case 'lineBreak':
        parent.appendChild(document.createElement('br'));
        break;
      case 'code': {
        const code = document.createElement('code');
        code.className = `cm-md-code ${CM_MD_INLINE_CODE}`;
        code.textContent = segment.text;
        parent.appendChild(code);
        break;
      }
      case 'strong': {
        const strong = document.createElement('strong');
        strong.className = 'cm-md-strong';
        appendRenderedInlineSegments(strong, segment.children);
        parent.appendChild(strong);
        break;
      }
      case 'emphasis': {
        const em = document.createElement('em');
        em.className = 'cm-md-emphasis';
        appendRenderedInlineSegments(em, segment.children);
        parent.appendChild(em);
        break;
      }
      case 'strikethrough': {
        const del = document.createElement('del');
        del.className = 'cm-md-strikethrough';
        appendRenderedInlineSegments(del, segment.children);
        parent.appendChild(del);
        break;
      }
      case 'highlight': {
        const mark = document.createElement('mark');
        mark.className = 'cm-md-highlight';
        appendRenderedInlineSegments(mark, segment.children);
        parent.appendChild(mark);
        break;
      }
    }
  }
}

function setCellContent(cell: HTMLElement, text: string): void {
  cell.replaceChildren();
  appendRenderedInlineSegments(cell, parseTableCellInlineMarkdown(text));
  if (cell.childNodes.length === 0) {
    cell.appendChild(document.createTextNode(''));
  }
}

function setCellPlainContent(cell: HTMLElement, text: string): void {
  cell.replaceChildren();
  appendPlainCellContent(cell, text);
}

function readCellTextFromDom(cell: HTMLTableCellElement): string {
  const readNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? '';
    }
    if (!(node instanceof HTMLElement)) {
      return '';
    }
    if (node.tagName === 'BR') {
      return '<br>';
    }
    return Array.from(node.childNodes).map(readNode).join('');
  };

  return Array.from(cell.childNodes).map(readNode).join('');
}

// Table cells keep raw markdown in data-raw. Unfocused cells render inline markdown;
// focused cells fall back to source text so editing stays plain-text and predictable.
function setCellRawText(cell: HTMLTableCellElement, text: string): void {
  cell.dataset.raw = text;
}

function syncCellRawTextFromDom(cell: HTMLTableCellElement): string {
  const text = readCellTextFromDom(cell);
  setCellRawText(cell, text);
  return text;
}

function isCellEditing(cell: HTMLTableCellElement): boolean {
  return cell.dataset.editing === 'true';
}

function enterCellEditMode(cell: HTMLTableCellElement): void {
  if (isCellEditing(cell)) {
    return;
  }
  const text = cell.dataset.raw ?? readCellTextFromDom(cell);
  setCellRawText(cell, text);
  cell.dataset.editing = 'true';
  setCellPlainContent(cell, text);
}

function exitCellEditMode(cell: HTMLTableCellElement): void {
  const text = isCellEditing(cell)
    ? syncCellRawTextFromDom(cell)
    : (cell.dataset.raw ?? readCellTextFromDom(cell));
  delete cell.dataset.editing;
  setCellContent(cell, text);
}

function readCellText(cell: HTMLTableCellElement): string {
  if (isCellEditing(cell)) {
    return readCellTextFromDom(cell);
  }
  return cell.dataset.raw ?? readCellTextFromDom(cell);
}

function insertNodesAtSelection(target: HTMLElement, nodes: Node[]): void {
  if (document.activeElement !== target) {
    target.focus();
  }
  const selection = window.getSelection();
  if (!selection) return;

  let range: Range;
  if (selection.rangeCount === 0) {
    range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    selection.addRange(range);
  } else {
    range = selection.getRangeAt(0);
    if (!target.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  range.deleteContents();
  const fragment = document.createDocumentFragment();
  for (const node of nodes) {
    fragment.appendChild(node);
  }
  const lastNode = nodes[nodes.length - 1] ?? null;
  range.insertNode(fragment);
  if (!lastNode) return;

  const caret = document.createRange();
  caret.setStartAfter(lastNode);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
}

function insertLineBreakAtSelection(target: HTMLElement): void {
  insertNodesAtSelection(target, [document.createElement('br'), document.createTextNode('')]);
}

function insertPlainTextAtSelection(target: HTMLElement, text: string): void {
  const normalized = text.replace(/\r\n?/g, '\n');
  const parts = normalized.split('\n');
  const nodes: Node[] = [];

  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length > 0 || i === parts.length - 1) {
      nodes.push(document.createTextNode(parts[i]));
    }
    if (i < parts.length - 1) {
      nodes.push(document.createElement('br'));
      nodes.push(document.createTextNode(''));
    }
  }

  if (nodes.length === 0) {
    nodes.push(document.createTextNode(''));
  }
  insertNodesAtSelection(target, nodes);
}

function buildStaticTableElement(
  headers: string[],
  rows: string[][],
  alignments: TableAlignment[],
  className: string
): HTMLElement {
  const element = document.createElement('div');
  element.className = ['cm-md-table-block', 'cm-md-table-block-static', className].filter(Boolean).join(' ');

  const wrapper = document.createElement('div');
  wrapper.className = 'cm-md-table-wrapper';
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const tbody = document.createElement('tbody');

  for (let c = 0; c < headers.length; c++) {
    const th = document.createElement('th');
    setCellContent(th, headers[c] ?? '');
    applyAlignmentToCell(th, alignments[c]);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);

  for (let r = 0; r < rows.length; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < headers.length; c++) {
      const td = document.createElement('td');
      setCellContent(td, rows[r]?.[c] ?? '');
      applyAlignmentToCell(td, alignments[c]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.appendChild(thead);
  table.appendChild(tbody);
  wrapper.appendChild(table);
  element.appendChild(wrapper);
  return element;
}

export class TableWidget extends WidgetType {
  constructor(
    private headers: string[],
    private rows: string[][],
    private alignments: TableAlignment[],
    private srcFrom: number,
    private srcTo: number,
    private interactive: boolean = true,
    private className: string = ''
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    if (
      this.headers.length !== other.headers.length ||
      this.rows.length !== other.rows.length ||
      this.alignments.length !== other.alignments.length ||
      this.interactive !== other.interactive ||
      this.className !== other.className
    ) {
      return false;
    }
    for (let i = 0; i < this.headers.length; i++) {
      if (this.headers[i] !== other.headers[i]) return false;
    }
    for (let i = 0; i < this.alignments.length; i++) {
      if (this.alignments[i] !== other.alignments[i]) return false;
    }
    for (let r = 0; r < this.rows.length; r++) {
      const a = this.rows[r];
      const b = other.rows[r];
      if (a.length !== b.length) return false;
      for (let c = 0; c < a.length; c++) {
        if (a[c] !== b[c]) return false;
      }
    }
    return true;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'wheel';
  }

  updateDOM(dom: HTMLElement): boolean {
    const ref = (dom as any).__tableSourceRef as { srcFrom: number; srcTo: number } | undefined;
    if (ref) {
      ref.srcFrom = this.srcFrom;
      ref.srcTo = this.srcTo;
    }
    return true;
  }

  toDOM(): HTMLElement {
    if (!this.interactive) {
      return buildStaticTableElement(this.headers, this.rows, this.alignments, this.className);
    }

    const element = document.createElement('div');
    element.className = ['cm-md-table-block', this.className].filter(Boolean).join(' ');
    element.tabIndex = -1;

    const wrapper = document.createElement('div');
    wrapper.className = 'cm-md-table-wrapper';
    const colBar = document.createElement('div');
    colBar.className = 'cm-md-table-col-bar';
    const rowBar = document.createElement('div');
    rowBar.className = 'cm-md-table-row-bar';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const tbody = document.createElement('tbody');
    const sourceRef = { srcFrom: this.srcFrom, srcTo: this.srcTo };
    (element as any).__tableSourceRef = sourceRef;
    let currentAlignments = this.alignments.slice();
    let draggingRowIndex: number | null = null;
    let rowDropIndex: number | null = null;
    let draggingColIndex: number | null = null;
    let colDropIndex: number | null = null;
    let activeRowVisualIndex: number | null = null;
    let activeColIndex: number | null = null;
    let selectedRowVisualIndex: number | null = null;
    let selectedColIndex: number | null = null;
    let menuKind: 'row' | 'col' | null = null;
    let menuRowIndex: number | null = null;
    let menuColIndex: number | null = null;
    let suppressDotHandleClick = false;
    let selAnchorRow: number | null = null;
    let selAnchorCol: number | null = null;
    let selCurrentRow: number | null = null;
    let selCurrentCol: number | null = null;
    let isMultiCellSelecting = false;
    let isCellComposing = false;
    let pendingTableCommitTimer: number | null = null;
    const handleMenu = document.createElement('div');
    handleMenu.className = 'cm-md-table-handle-menu';
    handleMenu.hidden = true;
    handleMenu.setAttribute('role', 'menu');
    handleMenu.addEventListener('mousedown', (event) => event.stopPropagation());
    handleMenu.addEventListener('contextmenu', (event) => event.preventDefault());
    const sourceRail = document.createElement('div');
    sourceRail.className = 'cm-md-table-src-rail';
    const btn = document.createElement('button');
    btn.className = 'cm-md-edit-src-btn cm-md-table-src-btn';
    btn.type = 'button';
    btn.title = 'Edit source';
    btn.setAttribute('aria-label', 'Edit source');
    btn.innerHTML = EDIT_SOURCE_ICON_SVG;
    sourceRail.appendChild(btn);

    // Collect all focusable cells in order (header first, then rows)
    const getCells = (): HTMLElement[] => {
      const ths = element.querySelectorAll<HTMLElement>('thead th');
      const tds = element.querySelectorAll<HTMLElement>('tbody td');
      return [...Array.from(ths), ...Array.from(tds)];
    };

    const createRowDrag = (rowIndex: number): HTMLButtonElement => {
      const drag = document.createElement('button');
      drag.className = 'cm-md-table-row-drag';
      drag.type = 'button';
      drag.draggable = true;
      drag.tabIndex = -1;
      drag.contentEditable = 'false';
      drag.dataset.rowDrag = 'true';
      drag.dataset.rowIndex = String(rowIndex);
      drag.setAttribute('aria-label', 'Drag row');
      return drag;
    };

    const createColumnDrag = (colIndex: number): HTMLButtonElement => {
      const drag = document.createElement('button');
      drag.className = 'cm-md-table-col-drag';
      drag.type = 'button';
      drag.draggable = true;
      drag.tabIndex = -1;
      drag.contentEditable = 'false';
      drag.dataset.colDrag = 'true';
      drag.dataset.colIndex = String(colIndex);
      drag.setAttribute('aria-label', 'Drag column');
      return drag;
    };

    const createRowDot = (gapIndex: number): HTMLButtonElement => {
      const dot = document.createElement('button');
      dot.className = 'cm-md-table-row-dot';
      dot.type = 'button';
      dot.draggable = false;
      dot.tabIndex = -1;
      dot.contentEditable = 'false';
      dot.dataset.rowDot = 'true';
      dot.dataset.rowGapIndex = String(gapIndex);
      dot.setAttribute('aria-label', 'Insert row');
      return dot;
    };

    const createColumnDot = (gapIndex: number): HTMLButtonElement => {
      const dot = document.createElement('button');
      dot.className = 'cm-md-table-col-dot';
      dot.type = 'button';
      dot.draggable = false;
      dot.tabIndex = -1;
      dot.contentEditable = 'false';
      dot.dataset.colDot = 'true';
      dot.dataset.colGapIndex = String(gapIndex);
      dot.setAttribute('aria-label', 'Insert column');
      return dot;
    };

    const createHeaderCell = (text: string, colIndex: number): HTMLTableCellElement => {
      const th = document.createElement('th');
      setCellRawText(th, text);
      setCellContent(th, text);
      th.contentEditable = 'true';
      th.dataset.cell = 'h';
      th.dataset.colIndex = String(colIndex);
      applyAlignmentToCell(th, currentAlignments[colIndex]);
      return th;
    };

    const createBodyCell = (text: string, colIndex: number): HTMLTableCellElement => {
      const td = document.createElement('td');
      setCellRawText(td, text);
      setCellContent(td, text);
      td.contentEditable = 'true';
      td.dataset.cell = 'd';
      td.dataset.colIndex = String(colIndex);
      applyAlignmentToCell(td, currentAlignments[colIndex]);
      return td;
    };

    const createBodyRow = (cells: string[], rowIndex: number): HTMLTableRowElement => {
      const tr = document.createElement('tr');
      tr.dataset.rowIndex = String(rowIndex);
      for (let c = 0; c < cells.length; c++) {
        tr.appendChild(createBodyCell(cells[c] ?? '', c));
      }
      return tr;
    };

    const getHeaderCells = (): HTMLTableCellElement[] =>
      Array.from(headerRow.children) as HTMLTableCellElement[];

    const getBodyRows = (): HTMLTableRowElement[] =>
      Array.from(tbody.children) as HTMLTableRowElement[];

    const getVisualRows = (): HTMLTableRowElement[] => {
      const rows: HTMLTableRowElement[] = [];
      if (headerRow.childElementCount > 0) {
        rows.push(headerRow);
      }
      return [...rows, ...getBodyRows()];
    };

    const getRowCells = (row: HTMLTableRowElement): HTMLTableCellElement[] =>
      Array.from(row.children) as HTMLTableCellElement[];

    const getVisualRowValues = (): string[][] =>
      getVisualRows().map((row) => getRowCells(row).map(readCellText));

    const getDomTableModel = (): { headers: string[]; rows: string[][] } => {
      const visualRows = getVisualRowValues();
      return {
        headers: visualRows[0] ?? [],
        rows: visualRows.slice(1),
      };
    };

    const normalizeAlignmentsFor = (headerCount: number): TableAlignment[] => {
      const next = currentAlignments.slice(0, headerCount);
      while (next.length < headerCount) {
        next.push('none');
      }
      return next;
    };

    const ensureElements = <T extends HTMLElement>(
      container: HTMLElement,
      selector: string,
      count: number,
      factory: (index: number) => T
    ): T[] => {
      const existing = Array.from(container.querySelectorAll<T>(selector));
      for (let i = count; i < existing.length; i++) {
        existing[i].remove();
      }
      const next = existing.slice(0, count);
      for (let i = next.length; i < count; i++) {
        const el = factory(i);
        container.appendChild(el);
        next.push(el);
      }
      return next;
    };

    const replaceVisualRows = (rows: string[][]) => {
      headerRow.replaceChildren();
      tbody.replaceChildren();

      if (rows.length === 0) {
        syncIndicesAndHandles();
        return;
      }

      const [headerCells, ...bodyRows] = rows;
      for (let c = 0; c < headerCells.length; c++) {
        headerRow.appendChild(createHeaderCell(headerCells[c] ?? '', c));
      }
      for (let r = 0; r < bodyRows.length; r++) {
        tbody.appendChild(createBodyRow(bodyRows[r], r));
      }
      syncIndicesAndHandles();
    };

    const clearSelectedHandles = () => {
      selectedRowVisualIndex = null;
      selectedColIndex = null;
      colBar.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
      rowBar.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
    };

    const closeHandleMenu = (clearSelection = true) => {
      menuKind = null;
      menuRowIndex = null;
      menuColIndex = null;
      handleMenu.hidden = true;
      handleMenu.replaceChildren();
      if (clearSelection) {
        clearSelectedHandles();
      }
    };

    const MENU_WIDTH = 120;
    const MENU_ITEM_HEIGHT = 24;
    const MENU_GAP = 4;

    const positionHandleMenu = (anchorRect: DOMRect, kind: 'row' | 'col', itemCount: number) => {
      const menuHeight = Math.max(MENU_ITEM_HEIGHT, itemCount * MENU_ITEM_HEIGHT) + 8;
      const rawLeft =
        kind === 'row' ? anchorRect.right + MENU_GAP : anchorRect.left + anchorRect.width / 2 - MENU_WIDTH / 2;
      const rawTop = kind === 'row' ? anchorRect.top + anchorRect.height / 2 - menuHeight / 2 : anchorRect.top - menuHeight - MENU_GAP;
      const left = Math.min(Math.max(8, rawLeft), Math.max(8, window.innerWidth - MENU_WIDTH - 8));
      const top = Math.min(Math.max(8, rawTop), Math.max(8, window.innerHeight - menuHeight - 8));
      handleMenu.style.left = `${left}px`;
      handleMenu.style.top = `${top}px`;
    };

    const createHandleMenuAction = (
      label: string,
      disabled: boolean,
      onClick: () => void
    ): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-md-table-handle-menu-item';
      button.textContent = label;
      button.disabled = disabled;
      button.setAttribute('role', 'menuitem');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        onClick();
      });
      return button;
    };

    const openHandleMenu = (
      kind: 'row' | 'col',
      anchor: HTMLElement,
      options: { rowVisualIndex?: number; rowIndex?: number; colIndex?: number }
    ) => {
      clearSelectedHandles();
      handleMenu.replaceChildren();

      if (kind === 'row') {
        const rowVisualIndex = options.rowVisualIndex ?? null;
        if (rowVisualIndex === null || rowVisualIndex < 0) {
          closeHandleMenu();
          return;
        }
        selectedRowVisualIndex = rowVisualIndex;
        menuKind = 'row';
        menuRowIndex = rowVisualIndex;
        menuColIndex = null;
        handleMenu.appendChild(
          createHandleMenuAction('Delete row', false, () => {
            closeHandleMenu();
            const changed = deleteRowAt(rowVisualIndex);
            if (changed) {
              commitTableToSource();
            }
          })
        );
      } else {
        const colIndex = options.colIndex ?? null;
        if (colIndex === null || colIndex < 0) {
          closeHandleMenu();
          return;
        }
        const disableDelete = getHeaderCells().length <= 1;
        selectedColIndex = colIndex;
        menuKind = 'col';
        menuColIndex = colIndex;
        menuRowIndex = null;
        handleMenu.appendChild(
          createHandleMenuAction('Delete column', disableDelete, () => {
            closeHandleMenu();
            const changed = deleteColumnAt(colIndex);
            if (changed) {
              commitTableToSource();
            }
          })
        );
      }

      positionHandleMenu(anchor.getBoundingClientRect(), kind, handleMenu.childElementCount);
      handleMenu.hidden = false;
      syncHandlePositions();
    };

    const syncHandlePositions = () => {
      const headers = getHeaderCells();
      const visualRows = getVisualRows();
      const elementRect = element.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();

      const colDrags = ensureElements(
        colBar,
        '[data-col-drag="true"]',
        headers.length,
        createColumnDrag
      );
      const colDots = ensureElements(
        colBar,
        '[data-col-dot="true"]',
        headers.length + 1,
        createColumnDot
      );

      const rowDrags = ensureElements(
        rowBar,
        '[data-row-drag="true"]',
        visualRows.length,
        createRowDrag
      );
      const rowDots = ensureElements(
        rowBar,
        '[data-row-dot="true"]',
        visualRows.length + 1,
        createRowDot
      );

      const inset = 4;
      for (let c = 0; c < headers.length; c++) {
        const rect = headers[c].getBoundingClientRect();
        const cellLeft = rect.left - wrapperRect.left;
        const drag = colDrags[c];
        drag.dataset.colIndex = String(c);
        drag.style.left = `${cellLeft + inset}px`;
        drag.style.width = `${Math.max(4, rect.width - inset * 2)}px`;
        drag.classList.toggle('cm-md-table-col-dragging', draggingColIndex === c);
      }

      if (headers.length > 0) {
        for (let gap = 0; gap <= headers.length; gap++) {
          let x = 0;
          if (gap === 0) {
            x = headers[0].getBoundingClientRect().left - wrapperRect.left;
          } else if (gap === headers.length) {
            x = headers[headers.length - 1].getBoundingClientRect().right - wrapperRect.left;
          } else {
            x = headers[gap].getBoundingClientRect().left - wrapperRect.left;
          }
          const dot = colDots[gap];
          dot.dataset.colGapIndex = String(gap);
          dot.style.left = `${x}px`;
        }
      }

      for (let r = 0; r < visualRows.length; r++) {
        const rect = visualRows[r].getBoundingClientRect();
        const cellTop = rect.top - wrapperRect.top;
        const drag = rowDrags[r];
        drag.dataset.rowVisualIndex = String(r);
        drag.draggable = true;
        drag.setAttribute('aria-label', 'Drag row');
        drag.style.top = `${cellTop + inset}px`;
        drag.style.height = `${Math.max(4, rect.height - inset * 2)}px`;
        drag.classList.toggle('cm-md-table-row-dragging', draggingRowIndex === r);
      }

      if (visualRows.length > 0) {
        for (let gap = 0; gap <= visualRows.length; gap++) {
          let y = 0;
          if (gap === 0) {
            y = visualRows[0].getBoundingClientRect().top - wrapperRect.top;
          } else if (gap === visualRows.length) {
            y = visualRows[visualRows.length - 1].getBoundingClientRect().bottom - wrapperRect.top;
          } else {
            y = visualRows[gap].getBoundingClientRect().top - wrapperRect.top;
          }
          const dot = rowDots[gap];
          dot.dataset.rowGapIndex = String(gap);
          dot.dataset.rowInsertIndex = String(gap);
          dot.style.top = `${y}px`;
        }
      } else if (rowDots[0]) {
        rowDots[0].dataset.rowGapIndex = '0';
        rowDots[0].dataset.rowInsertIndex = '0';
        rowDots[0].style.top = `${Math.max(8, wrapperRect.height / 2)}px`;
      }

      if (activeColIndex !== null) {
        const drag = colDrags[activeColIndex];
        const dotL = colDots[activeColIndex];
        const dotR = colDots[activeColIndex + 1];
        drag?.classList.add('active');
        dotL?.classList.add('active');
        dotR?.classList.add('active');
      }
      if (activeRowVisualIndex !== null) {
        const drag = rowDrags[activeRowVisualIndex];
        const dotT = rowDots[activeRowVisualIndex];
        const dotB = rowDots[activeRowVisualIndex + 1];
        drag?.classList.add('active');
        dotT?.classList.add('active');
        dotB?.classList.add('active');
      }
      if (selectedColIndex !== null) {
        colDrags[selectedColIndex]?.classList.add('selected');
      }
      if (selectedRowVisualIndex !== null) {
        rowDrags[selectedRowVisualIndex]?.classList.add('selected');
      }

      const firstRowRect = visualRows[0]?.getBoundingClientRect();
      const sourceButtonHeight = btn.offsetHeight || 32;
      const sourceButtonGap = 8;
      const sourceRailWidth = 44;
      const fallbackHeight = sourceButtonHeight;
      const railHeight = firstRowRect ? Math.max(sourceButtonHeight, Math.round(firstRowRect.height)) : fallbackHeight;
      const fallbackTop = wrapperRect.top - elementRect.top + 6;
      const top = firstRowRect
        ? firstRowRect.top - elementRect.top + (firstRowRect.height - railHeight) / 2
        : fallbackTop;
      const left = wrapperRect.right - elementRect.left + sourceButtonGap;
      sourceRail.style.top = `${Math.max(0, Math.round(top))}px`;
      sourceRail.style.left = `${Math.max(0, Math.round(left))}px`;
      sourceRail.style.width = `${sourceRailWidth}px`;
      sourceRail.style.height = `${Math.max(sourceButtonHeight, railHeight)}px`;
    };

    const syncIndicesAndHandles = () => {
      const visualRows = getVisualRows();
      for (let r = 0; r < visualRows.length; r++) {
        const row = visualRows[r];
        row.dataset.rowIndex = String(r);
        const cells = getRowCells(row);
        for (let c = 0; c < cells.length; c++) {
          cells[c].dataset.colIndex = String(c);
        }
      }
      syncHandlePositions();
    };

    const clearRowDropIndicator = () => {
      for (const row of getVisualRows()) {
        row.classList.remove('cm-md-table-drop-before');
      }
      wrapper.classList.remove('cm-md-table-drop-at-end');
    };

    const applyRowDropIndicator = (index: number | null) => {
      clearRowDropIndicator();
      if (index === null) return;
      const rows = getVisualRows();
      if (index >= rows.length) {
        wrapper.classList.add('cm-md-table-drop-at-end');
        return;
      }
      rows[index]?.classList.add('cm-md-table-drop-before');
    };

    const clearColumnDropIndicator = () => {
      for (const th of getHeaderCells()) {
        th.classList.remove('cm-md-table-col-drop-before', 'cm-md-table-col-drop-after-last');
      }
      for (const row of getBodyRows()) {
        for (const cell of getRowCells(row)) {
          cell.classList.remove('cm-md-table-col-drop-before', 'cm-md-table-col-drop-after-last');
        }
      }
    };

    const applyColumnDropIndicator = (index: number | null) => {
      clearColumnDropIndicator();
      if (index === null) return;
      const headers = getHeaderCells();
      if (headers.length === 0) return;
      const rows = getBodyRows();
      if (index >= headers.length) {
        headers[headers.length - 1].classList.add('cm-md-table-col-drop-after-last');
        for (const row of rows) {
          const cells = getRowCells(row);
          if (cells.length > 0) {
            cells[cells.length - 1].classList.add('cm-md-table-col-drop-after-last');
          }
        }
        return;
      }
      headers[index].classList.add('cm-md-table-col-drop-before');
      for (const row of rows) {
        const cells = getRowCells(row);
        const cell = cells[index];
        if (cell) {
          cell.classList.add('cm-md-table-col-drop-before');
        }
      }
    };

    const computeRowDropIndex = (clientY: number): number => {
      const rows = getVisualRows();
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
          return i;
        }
      }
      return rows.length;
    };

    const computeColumnDropIndex = (clientX: number): number => {
      const headers = getHeaderCells();
      for (let i = 0; i < headers.length; i++) {
        const rect = headers[i].getBoundingClientRect();
        if (clientX < rect.left + rect.width / 2) {
          return i;
        }
      }
      return headers.length;
    };

    const refreshDraggingClasses = () => {
      const dragging = draggingRowIndex !== null || draggingColIndex !== null;
      element.classList.toggle('cm-md-table-dragging', dragging);
      element.classList.toggle('cm-md-table-row-dragging-active', draggingRowIndex !== null);
      element.classList.toggle('cm-md-table-col-dragging-active', draggingColIndex !== null);
    };

    const markHandleClickSuppressed = () => {
      suppressDotHandleClick = true;
      window.setTimeout(() => {
        suppressDotHandleClick = false;
      }, 0);
    };

    const ACTIVE_HANDLE_HYSTERESIS_PX = 8;

    const clearActiveHandles = () => {
      activeColIndex = null;
      activeRowVisualIndex = null;
      colBar.querySelectorAll('.active').forEach((el) => el.classList.remove('active'));
      rowBar.querySelectorAll('.active').forEach((el) => el.classList.remove('active'));
    };

    const activateColumnHandles = (colIndex: number | null) => {
      if (draggingRowIndex !== null || draggingColIndex !== null) return;
      if (activeColIndex === colIndex && activeRowVisualIndex === null) return;
      clearActiveHandles();
      if (colIndex === null || colIndex < 0) return;
      activeColIndex = colIndex;
      colBar
        .querySelector<HTMLElement>(`[data-col-drag="true"][data-col-index="${colIndex}"]`)
        ?.classList.add('active');
      colBar
        .querySelector<HTMLElement>(`[data-col-dot="true"][data-col-gap-index="${colIndex}"]`)
        ?.classList.add('active');
      colBar
        .querySelector<HTMLElement>(`[data-col-dot="true"][data-col-gap-index="${colIndex + 1}"]`)
        ?.classList.add('active');
    };

    const activateRowHandles = (visualRowIndex: number | null) => {
      if (draggingRowIndex !== null || draggingColIndex !== null) return;
      if (activeRowVisualIndex === visualRowIndex && activeColIndex === null) return;
      clearActiveHandles();
      if (visualRowIndex === null || visualRowIndex < 0) return;
      activeRowVisualIndex = visualRowIndex;
      rowBar
        .querySelector<HTMLElement>(
          `[data-row-drag="true"][data-row-visual-index="${visualRowIndex}"]`
        )
        ?.classList.add('active');
      rowBar
        .querySelector<HTMLElement>(`[data-row-dot="true"][data-row-gap-index="${visualRowIndex}"]`)
        ?.classList.add('active');
      rowBar
        .querySelector<HTMLElement>(`[data-row-dot="true"][data-row-gap-index="${visualRowIndex + 1}"]`)
        ?.classList.add('active');
    };

    const hitTestColumn = (clientX: number): number | null => {
      const headers = getHeaderCells();
      if (activeColIndex !== null) {
        const activeHeader = headers[activeColIndex];
        if (activeHeader) {
          const rect = activeHeader.getBoundingClientRect();
          if (
            clientX >= rect.left - ACTIVE_HANDLE_HYSTERESIS_PX &&
            clientX < rect.right + ACTIVE_HANDLE_HYSTERESIS_PX
          ) {
            return activeColIndex;
          }
        }
      }
      for (let i = 0; i < headers.length; i++) {
        const rect = headers[i].getBoundingClientRect();
        if (clientX >= rect.left && clientX < rect.right) {
          return i;
        }
      }
      return null;
    };

    const hitTestVisualRow = (clientY: number): number | null => {
      const visualRows = getVisualRows();
      if (activeRowVisualIndex !== null) {
        const activeRow = visualRows[activeRowVisualIndex];
        if (activeRow) {
          const rect = activeRow.getBoundingClientRect();
          if (
            clientY >= rect.top - ACTIVE_HANDLE_HYSTERESIS_PX &&
            clientY < rect.bottom + ACTIVE_HANDLE_HYSTERESIS_PX
          ) {
            return activeRowVisualIndex;
          }
        }
      }
      for (let i = 0; i < visualRows.length; i++) {
        const rect = visualRows[i].getBoundingClientRect();
        if (clientY >= rect.top && clientY < rect.bottom) {
          return i;
        }
      }
      return null;
    };

    const clearRowDragState = () => {
      closeHandleMenu();
      clearActiveHandles();
      for (const row of getVisualRows()) {
        row.classList.remove('cm-md-table-row-dragging');
      }
      colBar.querySelectorAll('.cm-md-table-col-dragging').forEach((el) => {
        el.classList.remove('cm-md-table-col-dragging');
      });
      rowBar.querySelectorAll('.cm-md-table-row-dragging').forEach((el) => {
        el.classList.remove('cm-md-table-row-dragging');
      });
      clearRowDropIndicator();
      draggingRowIndex = null;
      rowDropIndex = null;
      refreshDraggingClasses();
    };

    const clearColumnDragState = () => {
      closeHandleMenu();
      clearActiveHandles();
      colBar.querySelectorAll('.cm-md-table-col-dragging').forEach((el) => {
        el.classList.remove('cm-md-table-col-dragging');
      });
      rowBar.querySelectorAll('.cm-md-table-row-dragging').forEach((el) => {
        el.classList.remove('cm-md-table-row-dragging');
      });
      clearColumnDropIndicator();
      draggingColIndex = null;
      colDropIndex = null;
      refreshDraggingClasses();
    };

    const clearPendingTableCommit = () => {
      if (pendingTableCommitTimer === null) {
        return;
      }
      window.clearTimeout(pendingTableCommitTimer);
      pendingTableCommitTimer = null;
    };

    const commitTableToSource = () => {
      clearPendingTableCommit();
      const view = EditorView.findFromDOM(element);
      if (!view || !Number.isFinite(sourceRef.srcFrom) || !Number.isFinite(sourceRef.srcTo)) return;
      if (sourceRef.srcFrom < 0 || sourceRef.srcTo > view.state.doc.length) return;
      const model = getDomTableModel();
      const oldText = view.state.doc.sliceString(sourceRef.srcFrom, sourceRef.srcTo);
      // Safety: verify the source range is still a valid table before overwriting
      if (!parseTableBlock(oldText)) return;
      if (model.headers.length === 0) {
        if (oldText.length === 0) return;
        view.dispatch({
          changes: { from: sourceRef.srcFrom, to: sourceRef.srcTo, insert: '' },
        });
        return;
      }
      const alignmentsToUse = normalizeAlignmentsFor(model.headers.length);
      const newText = serializeTable(model.headers, model.rows, alignmentsToUse);
      if (newText === oldText) return;
      view.dispatch({
        changes: { from: sourceRef.srcFrom, to: sourceRef.srcTo, insert: newText },
      });
    };

    const scheduleTableCommitToSource = () => {
      clearPendingTableCommit();
      pendingTableCommitTimer = window.setTimeout(() => {
        pendingTableCommitTimer = null;
        commitTableToSource();
      }, 300);
    };

    const insertRowAt = (insertPos: number): boolean => {
      const visualRows = getVisualRowValues();
      const columnCount = visualRows[0]?.length ?? getHeaderCells().length;
      if (columnCount <= 0) return false;
      const clampedIndex = Math.max(0, Math.min(insertPos, visualRows.length));
      visualRows.splice(clampedIndex, 0, new Array(columnCount).fill(''));
      replaceVisualRows(visualRows);
      return true;
    };

    const insertColumnAt = (insertPos: number): boolean => {
      const headers = getHeaderCells();
      if (headers.length === 0) return false;
      const clampedIndex = Math.max(0, Math.min(insertPos, headers.length));

      const newHeader = createHeaderCell('', clampedIndex);
      const headerAnchor = headers[clampedIndex];
      if (headerAnchor) {
        headerRow.insertBefore(newHeader, headerAnchor);
      } else {
        headerRow.appendChild(newHeader);
      }

      const rows = getBodyRows();
      for (const row of rows) {
        const newCell = createBodyCell('', clampedIndex);
        const cells = getRowCells(row);
        const anchor = cells[clampedIndex];
        if (anchor) {
          row.insertBefore(newCell, anchor);
        } else {
          row.appendChild(newCell);
        }
      }

      currentAlignments.splice(clampedIndex, 0, 'none');
      syncIndicesAndHandles();
      return true;
    };

    const deleteRowAt = (rowIndex: number): boolean => {
      const rows = getVisualRowValues();
      if (rowIndex < 0 || rowIndex >= rows.length) return false;
      rows.splice(rowIndex, 1);
      replaceVisualRows(rows);
      return true;
    };

    const deleteColumnAt = (colIndex: number): boolean => {
      const headers = getHeaderCells();
      if (headers.length <= 1) {
        return false;
      }
      const header = headers[colIndex];
      if (!header) {
        return false;
      }
      header.remove();
      for (const row of getBodyRows()) {
        const cell = getRowCells(row)[colIndex];
        cell?.remove();
      }
      if (colIndex < currentAlignments.length) {
        currentAlignments.splice(colIndex, 1);
      }
      syncIndicesAndHandles();
      return true;
    };

    const reorderRows = (dragIndex: number, rawDropIndex: number): boolean => {
      let insertIndex = rawDropIndex;
      if (insertIndex > dragIndex) {
        insertIndex -= 1;
      }
      if (insertIndex < 0) {
        insertIndex = 0;
      }
      const rows = getVisualRowValues();
      if (dragIndex >= rows.length) {
        return false;
      }
      const dragRow = rows[dragIndex];
      if (!dragRow || insertIndex === dragIndex) {
        return false;
      }
      rows.splice(dragIndex, 1);
      rows.splice(Math.min(insertIndex, rows.length), 0, dragRow);
      replaceVisualRows(rows);
      return true;
    };

    const reorderColumns = (dragIndex: number, rawDropIndex: number): boolean => {
      let insertIndex = rawDropIndex;
      if (insertIndex > dragIndex) {
        insertIndex -= 1;
      }
      if (insertIndex < 0) {
        insertIndex = 0;
      }

      const headers = getHeaderCells();
      if (dragIndex >= headers.length) {
        return false;
      }
      const dragHeader = headers[dragIndex];
      if (!dragHeader || insertIndex === dragIndex) {
        return false;
      }

      dragHeader.remove();
      const remainingHeaders = getHeaderCells();
      if (insertIndex >= remainingHeaders.length) {
        headerRow.appendChild(dragHeader);
      } else {
        headerRow.insertBefore(dragHeader, remainingHeaders[insertIndex]);
      }

      for (const row of getBodyRows()) {
        const cells = getRowCells(row);
        if (dragIndex >= cells.length) {
          continue;
        }
        const dragCell = cells[dragIndex];
        if (!dragCell) {
          continue;
        }
        dragCell.remove();
        const remainingCells = getRowCells(row);
        if (insertIndex >= remainingCells.length) {
          row.appendChild(dragCell);
        } else {
          row.insertBefore(dragCell, remainingCells[insertIndex]);
        }
      }

      if (dragIndex < currentAlignments.length) {
        const [movedAlignment] = currentAlignments.splice(dragIndex, 1);
        const alignment = movedAlignment ?? 'none';
        const clampedInsertIndex = Math.min(insertIndex, currentAlignments.length);
        currentAlignments.splice(clampedInsertIndex, 0, alignment);
      }

      syncIndicesAndHandles();
      return true;
    };

    for (let c = 0; c < this.headers.length; c++) {
      headerRow.appendChild(createHeaderCell(this.headers[c] ?? '', c));
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    for (let rowIndex = 0; rowIndex < this.rows.length; rowIndex++) {
      tbody.appendChild(createBodyRow(this.rows[rowIndex], rowIndex));
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
    element.appendChild(colBar);
    element.appendChild(rowBar);
    element.appendChild(wrapper);
    element.appendChild(handleMenu);
    element.appendChild(sourceRail);
    syncIndicesAndHandles();
    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => {
        syncHandlePositions();
      });
      resizeObserver.observe(wrapper);
    }

    const handleColumnBarHover = (event: MouseEvent) => {
      activateColumnHandles(hitTestColumn(event.clientX));
    };
    const handleRowBarHover = (event: MouseEvent) => {
      activateRowHandles(hitTestVisualRow(event.clientY));
    };

    colBar.addEventListener('mouseenter', handleColumnBarHover);
    colBar.addEventListener('mousemove', handleColumnBarHover);
    colBar.addEventListener('mouseleave', () => {
      activateColumnHandles(null);
      delete element.dataset.colGapHover;
    });
    rowBar.addEventListener('mouseenter', handleRowBarHover);
    rowBar.addEventListener('mousemove', handleRowBarHover);
    rowBar.addEventListener('mouseleave', () => {
      activateRowHandles(null);
      delete element.dataset.rowGapHover;
    });

    const onColDotOver = (e: MouseEvent) => {
      const dot = (e.target as HTMLElement).closest<HTMLElement>('[data-col-dot="true"]');
      if (dot?.dataset.colGapIndex != null) {
        element.dataset.colGapHover = dot.dataset.colGapIndex;
      }
    };
    const onColDotOut = (e: MouseEvent) => {
      const related = (e.relatedTarget as HTMLElement)?.closest?.('[data-col-dot="true"]');
      if (!related) {
        delete element.dataset.colGapHover;
      }
    };
    const onRowDotOver = (e: MouseEvent) => {
      const dot = (e.target as HTMLElement).closest<HTMLElement>('[data-row-dot="true"]');
      if (dot?.dataset.rowGapIndex != null) {
        element.dataset.rowGapHover = dot.dataset.rowGapIndex;
      }
    };
    const onRowDotOut = (e: MouseEvent) => {
      const related = (e.relatedTarget as HTMLElement)?.closest?.('[data-row-dot="true"]');
      if (!related) {
        delete element.dataset.rowGapHover;
      }
    };
    colBar.addEventListener('mouseover', onColDotOver);
    colBar.addEventListener('mouseout', onColDotOut);
    rowBar.addEventListener('mouseover', onRowDotOver);
    rowBar.addEventListener('mouseout', onRowDotOut);

    const getCellCoords = (cell: HTMLTableCellElement): { row: number; col: number } | null => {
      const col = Number(cell.dataset.colIndex);
      if (!Number.isInteger(col) || col < 0) return null;
      const tr = cell.closest('tr');
      if (!tr) return null;
      const rows = getVisualRows();
      const row = rows.indexOf(tr as HTMLTableRowElement);
      if (row < 0) return null;
      return { row, col };
    };

    const clearCellSelection = () => {
      if (!isMultiCellSelecting) return;
      element.querySelectorAll('.cm-md-table-cell-selected').forEach((el) => {
        el.classList.remove('cm-md-table-cell-selected');
      });
      selAnchorRow = null;
      selAnchorCol = null;
      selCurrentRow = null;
      selCurrentCol = null;
      isMultiCellSelecting = false;
    };

    const applyCellSelection = () => {
      element.querySelectorAll('.cm-md-table-cell-selected').forEach((el) => {
        el.classList.remove('cm-md-table-cell-selected');
      });
      if (
        selAnchorRow === null ||
        selAnchorCol === null ||
        selCurrentRow === null ||
        selCurrentCol === null
      )
        return;
      const minR = Math.min(selAnchorRow, selCurrentRow);
      const maxR = Math.max(selAnchorRow, selCurrentRow);
      const minC = Math.min(selAnchorCol, selCurrentCol);
      const maxC = Math.max(selAnchorCol, selCurrentCol);
      const rows = getVisualRows();
      for (let r = minR; r <= maxR; r++) {
        if (!rows[r]) continue;
        const cells = getRowCells(rows[r]);
        for (let c = minC; c <= maxC; c++) {
          cells[c]?.classList.add('cm-md-table-cell-selected');
        }
      }
    };

    const getSelectedCellsText = (): string | null => {
      if (
        !isMultiCellSelecting ||
        selAnchorRow === null ||
        selAnchorCol === null ||
        selCurrentRow === null ||
        selCurrentCol === null
      )
        return null;
      return serializeTableCellSelectionRows(getVisualRowValues(), {
        anchorRow: selAnchorRow,
        anchorCol: selAnchorCol,
        currentRow: selCurrentRow,
        currentCol: selCurrentCol,
      });
    };

    (element as TableSelectionHost)[TABLE_SELECTION_TEXT_PROVIDER] = {
      getSelectedText: getSelectedCellsText,
    };

    const writeSelectedCellsToClipboard = (event?: ClipboardEvent | KeyboardEvent): boolean => {
      const text = getSelectedCellsText();
      if (text === null) return false;
      event?.preventDefault();
      event?.stopPropagation();
      const clipboardEvent = typeof ClipboardEvent !== 'undefined' && event instanceof ClipboardEvent
        ? event
        : null;
      if (clipboardEvent) {
        clipboardEvent.clipboardData?.clearData();
        clipboardEvent.clipboardData?.setData('text/plain', text);
      } else {
        void writeClipboardText(text).catch(() => {
          // Ignore clipboard permission/runtime failures in desktop environments.
        });
      }
      return true;
    };

    element.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement | null;
      if (event.button !== 0 || event.ctrlKey) {
        return;
      }

      // Clear existing multi-cell selection on any mousedown inside the table
      if (isMultiCellSelecting) {
        clearCellSelection();
      }

      const cell = target?.closest<HTMLTableCellElement>('th, td');
      if (!cell || !element.contains(cell)) {
        return;
      }

      const coords = getCellCoords(cell);
      if (!coords) {
        enterCellEditMode(cell);
        return;
      }

      // Record anchor for potential multi-cell drag
      selAnchorRow = coords.row;
      selAnchorCol = coords.col;
      selCurrentRow = coords.row;
      selCurrentCol = coords.col;

      // Enter edit mode normally for single-cell click
      enterCellEditMode(cell);

      const onMouseMove = (e: MouseEvent) => {
        const elemUnder = document.elementFromPoint(e.clientX, e.clientY);
        const cellUnder = elemUnder?.closest<HTMLTableCellElement>('th, td');
        if (!cellUnder || !element.contains(cellUnder)) return;

        const coordsUnder = getCellCoords(cellUnder);
        if (!coordsUnder) return;

        // Same cell — not multi-cell
        if (coordsUnder.row === selAnchorRow && coordsUnder.col === selAnchorCol) {
          if (isMultiCellSelecting) {
            // Shrunk back to single cell; exit multi-cell mode
            clearCellSelection();
            selAnchorRow = coordsUnder.row;
            selAnchorCol = coordsUnder.col;
            selCurrentRow = coordsUnder.row;
            selCurrentCol = coordsUnder.col;
            enterCellEditMode(cellUnder);
            cellUnder.focus();
          }
          return;
        }

        // Different cell — enter multi-cell mode
        if (!isMultiCellSelecting) {
          isMultiCellSelecting = true;
          // Exit edit mode on all cells and clear text selection
          for (const c of getCells()) {
            if (c instanceof HTMLTableCellElement && isCellEditing(c)) {
              exitCellEditMode(c);
            }
          }
          window.getSelection()?.removeAllRanges();
          element.focus();
        }

        selCurrentRow = coordsUnder.row;
        selCurrentCol = coordsUnder.col;
        applyCellSelection();
        e.preventDefault();
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    element.addEventListener('focusin', (event) => {
      if (isMultiCellSelecting) return;
      const target = event.target;
      if (!(target instanceof HTMLTableCellElement) || !target.matches('th, td')) {
        return;
      }
      enterCellEditMode(target);
    });

    element.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTableCellElement) || !target.matches('th, td')) {
        return;
      }
      if (!isCellEditing(target)) {
        return;
      }
      syncCellRawTextFromDom(target);
      if (isCellComposing || (event instanceof InputEvent && event.isComposing)) {
        return;
      }
      scheduleTableCommitToSource();
    });

    element.addEventListener('compositionstart', (event) => {
      if (event.target instanceof HTMLTableCellElement && event.target.matches('th, td')) {
        isCellComposing = true;
      }
    });

    element.addEventListener('compositionend', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTableCellElement) || !target.matches('th, td')) {
        isCellComposing = false;
        return;
      }
      isCellComposing = false;
      if (!isCellEditing(target)) {
        return;
      }
      syncCellRawTextFromDom(target);
      scheduleTableCommitToSource();
    });

    element.addEventListener('focusout', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTableCellElement) || !target.matches('th, td')) {
        return;
      }
      const related = event.relatedTarget as Node | null;
      if (related && target.contains(related)) {
        return;
      }
      if (isCellEditing(target)) {
        exitCellEditMode(target);
        commitTableToSource();
      }
    });

    element.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        commitTableToSource();
      }
      if (e.key === 'Escape' && isMultiCellSelecting) {
        e.preventDefault();
        clearCellSelection();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') {
        if (writeSelectedCellsToClipboard(e)) {
          return;
        }
      }
      const target = e.target;
      if (!(target instanceof HTMLTableCellElement) || !target.matches('th, td')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        insertLineBreakAtSelection(target);
        syncCellRawTextFromDom(target);
        return;
      }
      if (e.key === 'Tab') {
        const cells = getCells();
        const idx = cells.indexOf(target);
        if (idx === -1) return;
        e.preventDefault();
        const next = e.shiftKey ? cells[idx - 1] : cells[idx + 1];
        if (next) {
          next.focus();
          const sel = window.getSelection();
          if (sel) {
            sel.selectAllChildren(next);
            sel.collapseToStart();
          }
        }
      }
    });

    element.addEventListener('copy', (e) => {
      writeSelectedCellsToClipboard(e);
    });

    element.addEventListener('paste', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLTableCellElement) || !target.matches('th, td')) return;
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      insertPlainTextAtSelection(target, text);
      syncCellRawTextFromDom(target);
    });

    element.addEventListener('dragstart', (e) => {
      const target = e.target as HTMLElement | null;
      const rowDrag = target?.closest<HTMLElement>('[data-row-drag="true"]');
      const colDrag = target?.closest<HTMLElement>('[data-col-drag="true"]');
      if (!rowDrag && !colDrag) return;

      if (rowDrag) {
        if (draggingColIndex !== null) {
          e.preventDefault();
          return;
        }
        const rowIndex = Number(rowDrag.dataset.rowVisualIndex);
        if (!Number.isInteger(rowIndex) || rowIndex < 0) {
          e.preventDefault();
          return;
        }
        draggingRowIndex = rowIndex;
        rowDropIndex = rowIndex;
        closeHandleMenu();
        clearActiveHandles();
        const row = getVisualRows()[rowIndex];
        row?.classList.add('cm-md-table-row-dragging');
        rowDrag.classList.add('cm-md-table-row-dragging');
        applyRowDropIndicator(rowDropIndex);
        refreshDraggingClasses();
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', `row:${rowIndex}`);
        }
        return;
      }

      if (!colDrag || draggingRowIndex !== null) {
        e.preventDefault();
        return;
      }
      const colIndex = Number(colDrag.dataset.colIndex);
      if (!Number.isInteger(colIndex) || colIndex < 0) {
        e.preventDefault();
        return;
      }
      draggingColIndex = colIndex;
      colDropIndex = colIndex;
      closeHandleMenu();
      clearActiveHandles();
      colDrag.classList.add('cm-md-table-col-dragging');
      applyColumnDropIndicator(colDropIndex);
      refreshDraggingClasses();
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', `col:${colIndex}`);
      }
    });

    element.addEventListener('dragover', (e) => {
      if (draggingRowIndex !== null) {
        e.preventDefault();
        const nextDropIndex = computeRowDropIndex(e.clientY);
        if (nextDropIndex === rowDropIndex) return;
        rowDropIndex = nextDropIndex;
        applyRowDropIndicator(rowDropIndex);
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move';
        }
        return;
      }
      if (draggingColIndex !== null) {
        e.preventDefault();
        const nextDropIndex = computeColumnDropIndex(e.clientX);
        if (nextDropIndex === colDropIndex) return;
        colDropIndex = nextDropIndex;
        applyColumnDropIndicator(colDropIndex);
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move';
        }
      }
    });

    element.addEventListener('drop', (e) => {
      if (draggingRowIndex !== null) {
        e.preventDefault();
        e.stopPropagation();
        const rawDropIndex = rowDropIndex ?? computeRowDropIndex(e.clientY);
        const changed = reorderRows(draggingRowIndex, rawDropIndex);
        clearRowDragState();
        if (changed) {
          commitTableToSource();
        }
        return;
      }

      if (draggingColIndex !== null) {
        e.preventDefault();
        e.stopPropagation();
        const rawDropIndex = colDropIndex ?? computeColumnDropIndex(e.clientX);
        const changed = reorderColumns(draggingColIndex, rawDropIndex);
        clearColumnDragState();
        if (changed) {
          commitTableToSource();
        }
        return;
      }
    });

    element.addEventListener('dragend', () => {
      if (draggingRowIndex !== null) {
        clearRowDragState();
        markHandleClickSuppressed();
        return;
      }
      if (draggingColIndex !== null) {
        clearColumnDragState();
        markHandleClickSuppressed();
      }
    });

    element.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target || suppressDotHandleClick) return;

      const rowDrag = target.closest<HTMLElement>('[data-row-drag="true"]');
      if (rowDrag) {
        e.preventDefault();
        e.stopPropagation();
        if (draggingRowIndex !== null || draggingColIndex !== null) return;
        const rowVisualIndex = Number(rowDrag.dataset.rowVisualIndex);
        if (!Number.isInteger(rowVisualIndex) || rowVisualIndex < 0) {
          return;
        }
        if (
          menuKind === 'row' &&
          selectedRowVisualIndex === rowVisualIndex &&
          menuRowIndex === rowVisualIndex &&
          !handleMenu.hidden
        ) {
          closeHandleMenu();
          return;
        }
        openHandleMenu('row', rowDrag, { rowVisualIndex });
        return;
      }

      const colDrag = target.closest<HTMLElement>('[data-col-drag="true"]');
      if (colDrag) {
        e.preventDefault();
        e.stopPropagation();
        if (draggingRowIndex !== null || draggingColIndex !== null) return;
        const colIndex = Number(colDrag.dataset.colIndex);
        if (!Number.isInteger(colIndex) || colIndex < 0) {
          return;
        }
        if (menuKind === 'col' && selectedColIndex === colIndex && menuColIndex === colIndex && !handleMenu.hidden) {
          closeHandleMenu();
          return;
        }
        openHandleMenu('col', colDrag, { colIndex });
        return;
      }

      const rowDot = target.closest<HTMLElement>('[data-row-dot="true"]');
      if (rowDot) {
        e.preventDefault();
        e.stopPropagation();
        if (draggingRowIndex !== null || draggingColIndex !== null) return;
        closeHandleMenu();
        const gapIndex = Number(rowDot.dataset.rowInsertIndex ?? rowDot.dataset.rowGapIndex);
        if (!Number.isInteger(gapIndex) || gapIndex < 0) return;
        const changed = insertRowAt(gapIndex);
        if (changed) {
          commitTableToSource();
        }
        return;
      }

      const colDot = target.closest<HTMLElement>('[data-col-dot="true"]');
      if (colDot) {
        e.preventDefault();
        e.stopPropagation();
        if (draggingRowIndex !== null || draggingColIndex !== null) return;
        closeHandleMenu();
        const gapIndex = Number(colDot.dataset.colGapIndex);
        if (!Number.isInteger(gapIndex) || gapIndex < 0) return;
        const changed = insertColumnAt(gapIndex);
        if (changed) {
          commitTableToSource();
        }
        return;
      }

      if (!handleMenu.hidden) {
        closeHandleMenu();
      }
    });

    window.addEventListener(
      'mousedown',
      (event) => {
        const target = event.target as Node | null;
        if (!handleMenu.hidden) {
          if (!(target && handleMenu.contains(target))) {
            closeHandleMenu();
          }
        }
        if (isMultiCellSelecting && (!target || !element.contains(target))) {
          clearCellSelection();
        }
      },
      true
    );
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (isMultiCellSelecting) {
          clearCellSelection();
        }
        if (!handleMenu.hidden) {
          closeHandleMenu();
        }
      }
    });
    window.addEventListener(
      'scroll',
      () => {
        if (handleMenu.hidden) return;
        closeHandleMenu();
      },
      true
    );

    const handleFocusOut = (e: FocusEvent) => {
      const related = e.relatedTarget as Node | null;
      if (related && element.contains(related)) return;
      if (draggingRowIndex !== null || draggingColIndex !== null) return;
      commitTableToSource();
    };
    element.addEventListener('focusout', handleFocusOut);

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!Number.isFinite(sourceRef.srcFrom)) return;
      const view = EditorView.findFromDOM(element);
      if (!view) return;
      const pos = view.state.doc.lineAt(sourceRef.srcFrom).from;
      view.dispatch({
        effects: openTableSourceEffect.of(sourceRef.srcFrom),
        selection: EditorSelection.cursor(pos),
        scrollIntoView: true,
      });
      view.focus();
    });

    return element;
  }
}
