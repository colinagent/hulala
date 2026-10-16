export const DOCUMENT_OUTLINE_MIN_WIDTH = 180;
export const DOCUMENT_OUTLINE_MAX_WIDTH = 480;
export const DEFAULT_DOCUMENT_OUTLINE_WIDTH = 260;
export const DOCUMENT_OUTLINE_MAIN_MIN_WIDTH = 320;

export function normalizeDocumentOutlineWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_DOCUMENT_OUTLINE_WIDTH;
  }
  return Math.min(
    DOCUMENT_OUTLINE_MAX_WIDTH,
    Math.max(DOCUMENT_OUTLINE_MIN_WIDTH, value),
  );
}

export function clampDocumentOutlineWidthForContainer(
  width: number,
  containerWidth: number | null | undefined,
): number {
  const clamped = normalizeDocumentOutlineWidth(width);
  if (typeof containerWidth !== 'number' || !Number.isFinite(containerWidth) || containerWidth <= 0) {
    return clamped;
  }
  const dynamicMax = Math.max(
    DOCUMENT_OUTLINE_MIN_WIDTH,
    Math.min(
      DOCUMENT_OUTLINE_MAX_WIDTH,
      Math.floor(containerWidth - DOCUMENT_OUTLINE_MAIN_MIN_WIDTH),
    ),
  );
  return Math.min(clamped, dynamicMax);
}
