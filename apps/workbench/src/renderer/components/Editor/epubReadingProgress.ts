type EpubReadingProgressListener = () => void;

export type EpubLocationProgress = {
  start?: {
    index?: number;
    percentage?: number;
    displayed?: {
      page?: number;
      total?: number;
    };
  };
  atEnd?: boolean;
};

export type EpubSpineProgressIndex = {
  offsets: readonly number[];
  weights: readonly number[];
  totalWeight: number;
};

const progressByFilePath = new Map<string, number>();
const listenersByFilePath = new Map<string, Set<EpubReadingProgressListener>>();

function progressKey(filePath: string): string {
  return filePath.trim();
}

export function normalizeEpubReadingProgress(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, value));
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 1;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function createEpubSpineProgressIndex(
  rawWeights: ReadonlyArray<number | null | undefined>,
): EpubSpineProgressIndex {
  const validWeights = rawWeights.filter(
    (weight): weight is number => typeof weight === 'number' && Number.isFinite(weight) && weight > 0,
  );
  const fallbackWeight = median(validWeights);
  const weights = rawWeights.map((weight) => (
    typeof weight === 'number' && Number.isFinite(weight) && weight > 0
      ? weight
      : fallbackWeight
  ));
  const offsets: number[] = [];
  let totalWeight = 0;
  for (const weight of weights) {
    offsets.push(totalWeight);
    totalWeight += weight;
  }
  return { offsets, weights, totalWeight };
}

/**
 * Prefer epub.js locations only after a real location index exists. Most books
 * do not ship one, so fall back to a content-weighted spine position plus the
 * displayed page within the current item. This avoids loading every chapter
 * solely to generate locations, which can disrupt a large active rendition.
 */
export function resolveEpubReadingProgress(
  location: EpubLocationProgress | null | undefined,
  spineIndex: EpubSpineProgressIndex,
  hasGeneratedLocations: boolean,
): number | null {
  if (!location?.start) {
    return null;
  }
  if (location.atEnd) {
    return 1;
  }

  if (hasGeneratedLocations) {
    const exact = normalizeEpubReadingProgress(location.start.percentage);
    if (exact !== null) {
      return exact;
    }
  }

  const spineItemCount = spineIndex.weights.length;
  if (spineItemCount <= 0 || spineIndex.totalWeight <= 0) {
    return null;
  }
  const rawIndex = location.start.index;
  if (typeof rawIndex !== 'number' || !Number.isFinite(rawIndex)) {
    return null;
  }

  const index = Math.min(spineItemCount - 1, Math.max(0, Math.floor(rawIndex)));
  const page = location.start.displayed?.page;
  const total = location.start.displayed?.total;
  const sectionProgress = typeof page === 'number'
    && Number.isFinite(page)
    && typeof total === 'number'
    && Number.isFinite(total)
    && total > 0
    ? Math.min(1, Math.max(0, (page - 1) / total))
    : 0;
  const weightedPosition = spineIndex.offsets[index]
    + sectionProgress * spineIndex.weights[index];
  return normalizeEpubReadingProgress(weightedPosition / spineIndex.totalWeight);
}

export function formatEpubReadingProgress(value: number | null): string {
  const normalized = normalizeEpubReadingProgress(value);
  return normalized === null ? '—' : `${Math.round(normalized * 100)}%`;
}

export function getEpubReadingProgress(filePath: string): number | null {
  return progressByFilePath.get(progressKey(filePath)) ?? null;
}

export function setEpubReadingProgress(filePath: string, value: unknown): void {
  const key = progressKey(filePath);
  const progress = normalizeEpubReadingProgress(value);
  if (!key || progress === null || progressByFilePath.get(key) === progress) {
    return;
  }
  progressByFilePath.set(key, progress);
  listenersByFilePath.get(key)?.forEach((listener) => listener());
}

export function subscribeEpubReadingProgress(
  filePath: string,
  listener: EpubReadingProgressListener,
): () => void {
  const key = progressKey(filePath);
  let listeners = listenersByFilePath.get(key);
  if (!listeners) {
    listeners = new Set();
    listenersByFilePath.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      listenersByFilePath.delete(key);
    }
  };
}
