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
 * The clipboard helper is the second native module. The TUI bundle inlines
 * `@earendil-works/pi-tui`, and that library reads the clipboard through an
 * N-API prebuild it loads from its own package tree - a file a bundle cannot
 * carry. It is copied into the package as `native/<platform>/prebuilds/...`,
 * which is one of the locations the library probes relative to the bundle.
 * Without it macOS has no image reader at all: text has `pbcopy`, images have
 * no command-line equivalent, so `Ctrl-V` could only ever answer "no reader".
 *
 * @module hulala/release/native-tools
 */
import { chmod, copyFile, mkdir } from 'node:fs/promises'
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

/**
 * The file name the clipboard helper is published under.
 *
 * macOS builds one plain helper; Linux builds the X11 reader only, which the
 * library names `linux-platform-x11.node` because Wayland reads stay with
 * `wl-paste`.
 * @param platform - `darwin` or `linux`.
 * @returns the file name inside the arch directory.
 */
function clipboardHelperName(platform: 'darwin' | 'linux'): string {
  return platform === 'darwin' ? 'darwin-platform.node' : 'linux-platform-x11.node'
}

/**
 * Copy the terminal clipboard helper into the package.
 *
 * The client looks for it beside its own bundle (`<root>/native/...` or
 * `<root>/bin/native/...`), and inside the installed `@earendil-works/pi-tui`
 * package, which a release does not have: the TUI ships as one bundled file.
 * The prebuild beside the bundle is what makes `Ctrl-V` read an image on the
 * user's own machine.
 * @param options - staging directory, target triple and repository root.
 * @throws when the prebuild is not installed, so a package can never ship
 *   without its clipboard reader.
 */
export async function bundleClipboardHelper(options: BundleNativeToolsOptions): Promise<void> {
  // Windows packaging is not implemented yet, so no prebuild is published for it.
  const platform = options.target.startsWith('darwin-') ? 'darwin' : options.target.startsWith('linux-') ? 'linux' : undefined
  if (platform === undefined) return
  const arch = options.target.slice(platform.length + 1)
  const relative = join('native', platform, 'prebuilds', `${platform}-${arch}`, clipboardHelperName(platform))
  const source = join(options.repositoryRoot, 'node_modules', '@earendil-works', 'pi-tui', relative)
  const destination = join(options.staging, relative)
  await mkdir(dirname(destination), { recursive: true })
  try {
    await copyFile(source, destination)
  } catch {
    throw new Error(`the clipboard helper is missing from the installed TUI package: ${source}`)
  }
  await chmod(destination, 0o755)
}
