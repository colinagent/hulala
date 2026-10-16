export const RELEASE_TARGETS = {
  'darwin-arm64': 'bun-darwin-arm64',
  'darwin-x64': 'bun-darwin-x64',
  'linux-arm64': 'bun-linux-arm64',
  'linux-x64': 'bun-linux-x64-baseline',
  'win32-x64': 'bun-windows-x64-baseline',
} as const
export type ReleaseTarget = keyof typeof RELEASE_TARGETS
export function releaseTarget(platform: string = process.platform, arch: string = process.arch): ReleaseTarget {
  const target = `${platform}-${arch}`
  if (!Object.hasOwn(RELEASE_TARGETS, target)) throw new Error(`Unsupported Hulala platform: ${target}`)
  return target as ReleaseTarget
}
export function targetFromBun(target: string): ReleaseTarget {
  const match = Object.entries(RELEASE_TARGETS).find(([, value]) => value === target)
  if (!match) throw new Error(`Unsupported Bun release target: ${target}`)
  return match[0] as ReleaseTarget
}
export const platformPackage = (target: ReleaseTarget) => 'hulala-' + target
export const platformVersion = (version: string, target: ReleaseTarget) => version + '-' + target
