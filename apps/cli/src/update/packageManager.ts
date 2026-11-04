/**
 * Self-update for package-manager installs.
 *
 * The npm launcher records which package manager owns the installation in
 * `HULALA_INSTALL_SOURCE`. `hulala update` uses that fact to run the matching
 * global install instead of printing a command the user has to copy. A
 * standalone install never reaches this module; it updates its immutable
 * version directory through `distribution/commands.ts`.
 *
 * @module hulala-cli/update/package-manager
 */
import { spawn } from 'node:child_process'

/** Global package managers that can replace their own `hulala` install. */
export type ManagedSource = 'npm' | 'bun' | 'pnpm'

export interface PackageManagerUpdate {
  /** Executable to spawn, including the Windows shim extension. */
  readonly command: string
  readonly args: string[]
  /** The same invocation as a line the user can run themselves. */
  readonly display: string
}

const versionPattern = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/

/** `npm` and `pnpm` are `.cmd` shims on Windows; `bun` is a real executable. */
function executable(name: ManagedSource): string {
  if (process.platform !== 'win32' || name === 'bun') return name
  return `${name}.cmd`
}

/**
 * Build the global install command for one release.
 *
 * The version is pinned instead of using a dist-tag so the command the user
 * sees matches the release the index advertised. Lifecycle scripts stay off:
 * Hulala ships a prebuilt platform package and has nothing to compile.
 * @param source - package manager that owns this installation.
 * @param version - exact release version to install.
 * @returns the spawnable command and its printable form.
 */
export function packageManagerUpdate(source: ManagedSource, version: string): PackageManagerUpdate {
  if (!versionPattern.test(version)) throw new Error('The package-manager update version is invalid')
  const spec = `hulala@${version}`
  const args = source === 'pnpm'
    ? ['add', '-g', '--ignore-scripts', spec]
    : ['install', '-g', '--ignore-scripts', spec]
  const command = executable(source)
  return { command, args, display: [command, ...args].join(' ') }
}

/**
 * Run a package-manager update with its output attached to this terminal.
 * @param update - command from {@link packageManagerUpdate}.
 */
export async function runPackageManagerUpdate(update: PackageManagerUpdate): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(update.command, update.args, {
      stdio: 'inherit',
      windowsHide: true,
      // npm/pnpm are `.cmd` shims on Windows, which CreateProcess cannot run
      // directly. The argv is built from a validated version, not user text.
      shell: process.platform === 'win32',
      env: { ...process.env, HULALA_SKIP_UPDATE_CHECK: '1' },
    })
    child.once('error', error => reject(new Error(`Could not start ${update.command}: ${error.message}`)))
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
      } else if (signal !== null) {
        reject(new Error(`${update.display} was terminated by ${signal}`))
      } else {
        reject(new Error(`${update.display} exited with code ${code ?? 'unknown'}`))
      }
    })
  })
}
