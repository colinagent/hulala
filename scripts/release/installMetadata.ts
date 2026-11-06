/**
 * Turn built archives into the three published install metadata files.
 *
 * Kept pure and separate from `installScript.ts` so the case arms, the release
 * index and the checksum list can be checked without four platform builds: a
 * missing runtime pack arm or a missing `runtime` field in the index breaks every
 * `curl | sh` install, and that must fail in a test rather than after a release.
 *
 * @module hulala/release/install-metadata
 */
import { renderInstallScript } from './installScriptTemplate.ts'

/** One built archive and the dependency pack published beside it. */
export interface BuiltArchive {
  readonly target: string
  readonly file: string
  readonly sha256: string
  readonly manifestSha256: string
  /** Optional pre-installed dependency tree; Hulala no longer publishes one. */
  readonly runtimePack?: { readonly file: string, readonly sha256: string }
}

export interface InstallMetadataInput {
  readonly version: string
  readonly downloadBase: string
  readonly githubBase: string
  /** Filename of the shared npm lock, e.g. `runtime-package-lock.json`. */
  readonly lockFile: string
  readonly lockSha256: string
  readonly archives: readonly BuiltArchive[]
  readonly nodeLine?: string
}

export interface InstallMetadata {
  readonly installScript: string
  readonly index: Record<string, unknown>
  readonly shasums: string
}

/**
 * Render `install.sh`, `web-releases.json` and `SHASUMS256.txt` for one release.
 * @param input - version, download bases, the lock and every built archive.
 * @returns the three file contents.
 */
export function buildInstallMetadata(input: InstallMetadataInput): InstallMetadata {
  const { version, downloadBase, githubBase, lockFile, lockSha256, archives, nodeLine } = input
  // Every case arm carries the per-target runtime pack; `install.sh` passes all
  // four values to `hulala install`, so a missing one leaves an unset variable.
  const cases = archives.map(archive => `  ${archive.target}) archive='${archive.file}' archive_sha='${archive.sha256}'`
    + (archive.runtimePack === undefined ? '' : ` runtime_pack_url='${downloadBase}/${archive.runtimePack.file}' runtime_pack_sha='${archive.runtimePack.sha256}'`)
    + ' ;;').join('\n')
  const installScript = renderInstallScript({
    version,
    cases,
    downloadBase,
    githubBase,
    lock: `${downloadBase}/${lockFile}`,
    lockSha256,
    ...(nodeLine === undefined ? {} : { nodeLine }),
  })
  const index = {
    format: 1,
    product: 'hulala',
    channels: { stable: version },
    releases: [{
      version,
      dataFormat: 1,
      platforms: Object.fromEntries(archives.map(archive => [archive.target, {
        url: `${downloadBase}/${archive.file}`,
        sha256: archive.sha256,
        manifestSha256: archive.manifestSha256,
        runtime: {
          lock: { url: `${downloadBase}/${lockFile}`, sha256: lockSha256 },
          ...(archive.runtimePack === undefined ? {} : { pack: { url: `${downloadBase}/${archive.runtimePack.file}`, sha256: archive.runtimePack.sha256 } }),
        },
      }])),
    }],
  }
  const shasums = [
    ...archives.map(archive => `${archive.sha256}  ${archive.file}`),
    ...archives.filter(archive => archive.runtimePack !== undefined).map(archive => `${archive.runtimePack!.sha256}  ${archive.runtimePack!.file}`),
    `${lockSha256}  ${lockFile}`,
  ].join('\n')
  return { installScript, index, shasums }
}
