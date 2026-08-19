import { createRepositoryHarnessPatch } from '@loopwithai/runtime'

/** Build a location-independent DeepSeek Harness overlay for this checkout. */
export function createHarnessPatch(repositoryRoot: string): unknown[] {
  return createRepositoryHarnessPatch(repositoryRoot)
}
