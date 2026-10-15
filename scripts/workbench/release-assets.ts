import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { verifyPackage } from './package-manifest'
import { downloadUrl, fileSha256 } from '@hulala/distribution/archive'
import { parseReleaseIndex, type ReleaseIndex } from '@hulala/distribution/channels'
import { posixInstaller, windowsInstaller, type BootstrapAsset } from './install-templates'
import type { ReleaseTarget } from '@hulala/distribution/targets'
import { writeReleaseArchive } from './archive'

export async function stageReleaseAssets(packages: string[], output: string, baseUrl: string): Promise<string> {
  if (!packages.length) throw new Error('At least one verified package is required')
  const base = downloadUrl(baseUrl)
  if (base.search || base.hash) throw new Error('Release asset base must not contain a query or fragment')
  base.pathname = base.pathname.replace(/\/?$/, '/')
  const manifests = await Promise.all(packages.map(directory => verifyPackage(directory)))
  const version = manifests[0]!.version
  if (manifests.some(manifest => manifest.stage !== 'workbench' || manifest.version !== version) || new Set(manifests.map(manifest => manifest.target)).size !== packages.length) throw new Error('Release packages must have one version and distinct targets')
  await mkdir(output, { recursive: true })
  const staging = await mkdtemp(join(output, 'hulala-browser-release-' + version + '-'))
  const assets: Partial<Record<ReleaseTarget, BootstrapAsset>> = {}, platforms: ReleaseIndex['releases'][number]['platforms'] = {}
  const files: string[] = []
  for (let index = 0; index < packages.length; index++) {
    const directory = packages[index]!, manifest = manifests[index]!, target = manifest.target as ReleaseTarget
    const archiveName = `hulala-${version}-${target}.tar.gz`, archive = join(staging, archiveName)
    await writeReleaseArchive(directory, archive, manifest)
    const installerName = `hulala-installer-${version}-${target}${target.startsWith('win32-') ? '.exe' : ''}`, installer = join(staging, installerName)
    await cp(join(directory, manifest.entrypoint), installer)
    const archiveSha256 = await fileSha256(archive), installerSha256 = await fileSha256(installer)
    assets[target] = { installer: new URL(installerName, base).href, installerSha256, archive: new URL(archiveName, base).href, archiveSha256 }
    platforms[target] = { url: assets[target]!.archive, sha256: archiveSha256, manifestSha256: await fileSha256(join(directory, 'manifest.json')) }
    files.push(archiveName, installerName)
  }
  const channel = version.includes('-') ? 'preview' : 'stable'
  const release: ReleaseIndex = { format: 1, product: 'hulala', channels: { [channel]: version }, releases: [{ version, dataFormat: manifests[0]!.dataFormat!, platforms }] }
  parseReleaseIndex(release)
  await writeFile(join(staging, 'browser-releases.json'), JSON.stringify(release, null, 2) + '\n')
  await writeFile(join(staging, 'install.sh'), posixInstaller(assets), { mode: 0o755 })
  await writeFile(join(staging, 'install.ps1'), windowsInstaller(assets['win32-x64']))
  files.push('browser-releases.json', 'install.sh', 'install.ps1')
  await writeFile(join(staging, 'SHASUMS256.txt'), (await Promise.all(files.map(async file => await fileSha256(join(staging, file)) + '  ' + file))).join('\n') + '\n')
  await writeFile(join(staging, 'STAGING.md'), `# Browser release staging\n\nVersion: ${version}\nTargets: ${manifests.map(item => item.target).join(', ')}\n\nThis command did not publish assets or change any channel. Review native test results, package inventories and licenses before publication. Browser releases use their own browser-v${version} tag and the browser-channels index; keep Desktop release tags and latest metadata unchanged.\n`)
  return staging
}
if (import.meta.main) {
  const packages: string[] = []; let output: string | undefined, base: string | undefined
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index++) {
    const key = args[index], value = args[++index]
    if (!value) throw new Error('Missing release argument')
    if (key === '--package') packages.push(resolve(value))
    else if (key === '--output') output = resolve(value)
    else if (key === '--base-url') base = value
    else throw new Error('Unknown release option: ' + key)
  }
  if (!output || !base) throw new Error('Use --package <directory> --output <parent> --base-url <asset URL>')
  console.log(JSON.stringify({ staged: await stageReleaseAssets(packages, output, base), published: false }))
}
