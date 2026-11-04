/**
 * Build the native helpers that ship in the package's `bin/`.
 *
 * The TUI switches the keyboard input source when the editor column takes
 * focus, and macOS only allows that through the Text Input Source API. The
 * helper is one small C file (`apps/cli/native/ime.c`) compiled here, so the
 * release stays self-contained and the source lives in this repository rather
 * than in a user's state directory.
 *
 * Only macOS targets get helpers for now; other platforms ship the package
 * unchanged.
 *
 * @module hulala/release/native-tools
 */
import { chmod, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface BundleNativeToolsOptions {
  readonly staging: string
  readonly target: string
  readonly repositoryRoot: string
}

/**
 * Compile every native helper the target supports into `<staging>/bin/`.
 * @param options - staging directory, target triple and repository root.
 */
export async function bundleNativeTools(options: BundleNativeToolsOptions): Promise<void> {
  if (!options.target.startsWith('darwin-')) return
  const output = join(options.staging, 'bin', 'ime')
  await mkdir(dirname(output), { recursive: true })
  const clang = Bun.spawn(
    [
      'clang', '-O2', '-Wall', '-Wextra',
      '-o', output,
      join(options.repositoryRoot, 'apps', 'cli', 'native', 'ime.c'),
      '-framework', 'Carbon',
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  )
  if (await clang.exited !== 0) throw new Error('failed to build bin/ime')
  await chmod(output, 0o755)
}
