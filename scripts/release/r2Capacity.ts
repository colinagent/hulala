export const R2_CAPACITY_BYTES = 9_000_000_000
export interface SizedObject { key: string; size: number }

export function projectedPeak(existing: SizedObject[], incoming: SizedObject[]): number {
  const sizes = new Map<string, number>()
  for (const item of existing) {
    if (sizes.has(item.key) || !Number.isSafeInteger(item.size) || item.size < 0) throw new Error('Invalid bucket inventory')
    sizes.set(item.key, item.size)
  }
  const seen = new Set<string>()
  let peak = existing.reduce((sum, item) => sum + item.size, 0)
  for (const item of incoming) {
    if (seen.has(item.key) || !Number.isSafeInteger(item.size) || item.size < 0) throw new Error('Invalid upload plan')
    seen.add(item.key)
    // Reserve the complete batch in addition to current objects, including
    // temporary multipart data during replacement. Never rely on deletion credit.
    peak += item.size
  }
  if (!Number.isSafeInteger(peak) || peak > R2_CAPACITY_BYTES) throw new Error(`Upload refused: projected storage ${peak} bytes exceeds the ${R2_CAPACITY_BYTES}-byte limit`)
  return peak
}
