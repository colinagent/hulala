/**
 * Publishing `bin/ime`, the macOS input-source helper.
 *
 * A release package ships a prebuilt helper (see `scripts/release/nativeTools.ts`),
 * and `publishEditor` copies it into the state root with the editor. A source
 * checkout has no package, so `bun run start` used to have no helper at all: the
 * columns ran perfectly while the input source silently stayed on the user's
 * layout, which reads as "the switch is broken". Compiling the same C file here
 * closes that gap, with the checkout's source as the input and the state root as
 * the output, so the installed artifact and the development run behave alike.
 *
 * The build is deliberately synchronous and once per source change: the helper
 * has to exist before the first column takes focus, and a rebuild only happens
 * when `ime.c` is newer than the binary already in `bin/`.
 *
 * @module hulala-cli/tui/editor/imeHelper
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The helper's file name in both the package's and the state root's `bin/`. */
export const IME_EXECUTABLE = 'ime'

/** Where the C source sits inside this repository. */
const SOURCE_PATH = join('apps', 'cli', 'native', 'ime.c')

/** How far up from the module a checkout root may be. */
const SOURCE_WALK = 6

/**
 * Find `apps/cli/native/ime.c` in a source checkout.
 *
 * Every level is checked twice, because the walk starts wherever the module was
 * loaded from: a source run starts inside `apps/cli/src/tui/editor` (the file is
 * under `<root>/apps/cli/native`), while a script or test starts at the checkout
 * root (the file is under `<root>/apps/cli/native` as well, one level down).
 * @param start - directory to walk up from; the module's own by default.
 * @returns absolute path of the C source, or undefined outside a checkout.
 */
export function imeSourcePath(start: string = moduleDirectory()): string | undefined {
  let directory = start
  for (let step = 0; step < SOURCE_WALK; step += 1) {
    for (const candidate of [join(directory, SOURCE_PATH), join(directory, 'native', `${IME_EXECUTABLE}.c`)]) {
      if (existsSync(candidate)) return candidate
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

/** How a build is invoked; injected so a test does not need clang. */
export type ImeCompiler = (source: string, destination: string) => boolean

/** Options for {@link publishImeHelper}. */
export interface PublishImeHelperOptions {
  /** Compiler; defaults to the system `clang` with the Carbon framework. */
  readonly compile?: ImeCompiler
  /** Directory to look for the C source from; defaults to the module's own. */
  readonly from?: string
  /** Platform gate, injectable for tests. */
  readonly platform?: NodeJS.Platform
}

/**
 * Compile `apps/cli/native/ime.c` into a destination with the system clang.
 *
 * Output is dropped rather than inherited: the client owns an alternate screen,
 * and a compiler diagnostic printed over it would corrupt the frame. A machine
 * without the Command Line Tools simply has no switch.
 * @param source - the C file.
 * @param destination - file to write.
 * @returns true when clang exited 0.
 */
function compileWithClang(source: string, destination: string): boolean {
  const result = spawnSync(
    'clang', ['-O2', '-Wall', '-Wextra', '-o', destination, source, '-framework', 'Carbon'],
    { stdio: 'ignore' },
  )
  return result.status === 0
}

/**
 * Make sure `<bin>/ime` exists and is newer than the checkout's source.
 *
 * A packaged install already has the helper and no source to compare it with, so
 * this returns that path untouched. A source checkout compiles into a temporary
 * file and renames it into place, so an interrupted build never leaves a
 * half-written executable behind.
 * @param binHome - `<data>/bin`, the one directory of Hulala's executables.
 * @param options - compiler, search start and platform, all injectable.
 * @returns path of the helper, or undefined when there is none to have.
 */
export function publishImeHelper(binHome: string, options: PublishImeHelperOptions = {}): string | undefined {
  if ((options.platform ?? process.platform) !== 'darwin') return undefined
  const destination = join(binHome, IME_EXECUTABLE)
  /** An older or packaged helper is never taken away by a failed build. */
  const kept = (): string | undefined => existsSync(destination) ? destination : undefined
  const source = imeSourcePath(options.from)
  if (source === undefined) return kept()
  const temporary = `${destination}.${process.pid}.tmp`
  try {
    if (existsSync(destination) && statSync(destination).mtimeMs >= statSync(source).mtimeMs) return destination
    mkdirSync(binHome, { recursive: true })
    rmSync(temporary, { force: true })
    if (!(options.compile ?? compileWithClang)(source, temporary) || !existsSync(temporary)) {
      rmSync(temporary, { force: true })
      return kept()
    }
    chmodSync(temporary, 0o755)
    renameSync(temporary, destination)
    return destination
  } catch {
    // A read-only state root or a missing source must not fail the window: the
    // client works without the switch, it just keeps the user's layout.
    rmSync(temporary, { force: true })
    return kept()
  }
}

function moduleDirectory(): string {
  try {
    return dirname(fileURLToPath(import.meta.url))
  } catch {
    return process.cwd()
  }
}
