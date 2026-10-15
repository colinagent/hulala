export const MARKDOWN_TEXT_OFFSET_MIN = 24;
export const DEFAULT_MARKDOWN_TEXT_OFFSET = 60;
export const MARKDOWN_TEXT_OFFSET_EDITOR_MIN_WIDTH = 320;
export const MARKDOWN_DOCUMENT_COLUMN_OFFSET = 30;
export const MARKDOWN_LINE_PADDING_X = 4;
export const MARKDOWN_CONTENT_WIDTH_MIN = 320;
export const DEFAULT_MARKDOWN_CONTENT_WIDTH = 882;

const MARKDOWN_TEXT_OFFSET_CSS_VAR = '--op-md-content-padding-left';
const MARKDOWN_EFFECTIVE_COLUMN_OFFSET_CSS_VAR = '--op-md-effective-column-offset';
const MARKDOWN_CONTENT_WIDTH_CSS_VAR = '--op-md-content-max-width';
const MARKDOWN_TEXT_OFFSET_DRAG_LOCK_ATTR = 'data-op-md-text-offset-dragging';
const MARKDOWN_CONTENT_WIDTH_DRAG_LOCK_ATTR = 'data-op-md-content-width-dragging';
const MARKDOWN_CONTENT_WIDTH_TRAILING_HOTZONE = 16;

export function normalizeMarkdownTextOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MARKDOWN_TEXT_OFFSET;
  }
  return Math.max(MARKDOWN_TEXT_OFFSET_MIN, value);
}

export function clampMarkdownTextOffsetForEditor(
  value: number,
  editorMainWidth: number | null | undefined
): number {
  if (typeof editorMainWidth !== 'number' || !Number.isFinite(editorMainWidth) || editorMainWidth <= 0) {
    return Math.max(0, value);
  }
  const dynamicMax = Math.floor(editorMainWidth - MARKDOWN_TEXT_OFFSET_EDITOR_MIN_WIDTH);
  return Math.max(0, Math.min(value, dynamicMax));
}

export function normalizeMarkdownContentWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MARKDOWN_CONTENT_WIDTH;
  }
  return Math.max(MARKDOWN_CONTENT_WIDTH_MIN, value);
}

export function clampMarkdownContentWidthForEditor(
  value: number,
  editorMainWidth: number | null | undefined,
  textColumnStart: number
): number {
  if (
    typeof editorMainWidth !== 'number'
    || !Number.isFinite(editorMainWidth)
    || editorMainWidth <= 0
    || !Number.isFinite(textColumnStart)
  ) {
    return Math.max(0, value);
  }
  const dynamicMax = Math.floor(
    editorMainWidth - Math.max(0, textColumnStart) - MARKDOWN_CONTENT_WIDTH_TRAILING_HOTZONE
  );
  return Math.max(0, Math.min(value, dynamicMax));
}

export function setMarkdownTextOffsetCssVar(value: number): void {
  document.documentElement.style.setProperty(MARKDOWN_TEXT_OFFSET_CSS_VAR, `${Math.max(0, value)}px`);
}

export function setMarkdownContentWidthCssVar(value: number): void {
  document.documentElement.style.setProperty(MARKDOWN_CONTENT_WIDTH_CSS_VAR, `${Math.max(0, value)}px`);
}

export function setMarkdownEffectiveColumnOffsetCssVar(value: number): void {
  document.documentElement.style.setProperty(
    MARKDOWN_EFFECTIVE_COLUMN_OFFSET_CSS_VAR,
    `${Math.max(0, value)}px`
  );
}

export function isMarkdownTextOffsetDragLocked(): boolean {
  return document.documentElement.hasAttribute(MARKDOWN_TEXT_OFFSET_DRAG_LOCK_ATTR);
}

export function isMarkdownContentWidthDragLocked(): boolean {
  return document.documentElement.hasAttribute(MARKDOWN_CONTENT_WIDTH_DRAG_LOCK_ATTR);
}

export function setMarkdownTextOffsetDragLocked(locked: boolean): void {
  if (locked) {
    document.documentElement.setAttribute(MARKDOWN_TEXT_OFFSET_DRAG_LOCK_ATTR, 'true');
    return;
  }
  document.documentElement.removeAttribute(MARKDOWN_TEXT_OFFSET_DRAG_LOCK_ATTR);
}

export function setMarkdownContentWidthDragLocked(locked: boolean): void {
  if (locked) {
    document.documentElement.setAttribute(MARKDOWN_CONTENT_WIDTH_DRAG_LOCK_ATTR, 'true');
    return;
  }
  document.documentElement.removeAttribute(MARKDOWN_CONTENT_WIDTH_DRAG_LOCK_ATTR);
}
