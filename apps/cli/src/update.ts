import { VERSION } from './constants.js'
import { compareVersions, selectRelease } from '@hulala/distribution/channels'
export interface UpdateStatus { currentVersion: string; latestVersion?: string; available: boolean; error?: string }
export async function checkForUpdate(): Promise<UpdateStatus> {
  try {
    const selected = await selectRelease({ channel: 'stable' })
    return { currentVersion: VERSION, latestVersion: selected.release.version, available: compareVersions(selected.release.version, VERSION) > 0 }
  } catch (error) { return { currentVersion: VERSION, available: false, error: error instanceof Error ? error.message : 'Release check failed' } }
}
