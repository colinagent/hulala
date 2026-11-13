/**
 * Putting the selected text on the clipboard the user will actually paste from.
 *
 * The client is one process: it may run on the user's own machine, or on a
 * machine they reached over SSH with their terminal on the other end of the
 * link. Only one of those clipboards is the one the user can paste from, so the
 * routes are ordered by who owns it:
 *
 * 1. **A remote session** (SSH or mosh) is pasted from the terminal's machine,
 *    not from the box the client runs on. That clipboard is reachable only
 *    through OSC 52 — the one channel a process on the far side of a pty has —
 *    so a remote session copies that way and starts no writer on the remote
 *    box, where a selection daemon would hold the text for nobody (and stall on
 *    a forwarded display).
 * 2. **The user's own machine** is copied the ordinary way: the native helper
 *    the terminal package ships with, then the platform's writer command. OSC
 *    52 is not used there because a desktop terminal cannot confirm it, and a
 *    silent "copied" that pasted nothing is worse than an honest failure.
 * 3. **A display-less Linux** (a container, a server without a user session) has
 *    no clipboard of its own to write, so OSC 52 is the only route and is tried.
 *
 * A failure comes back as a reason, never as success; the terminal plugin turns
 * the reason into one line the user can act on.
 *
 * @module hulala-cli/tui/clipboard
 */
import { spawn } from 'node:child_process'
import { platform as hostPlatform } from 'node:os'
import { getNativeClipboard } from '@earendil-works/pi-tui'

/**
 * Base64 characters one OSC 52 payload may carry.
 *
 * The protocol has no reply, so a payload the terminal silently truncates would
 * look like a successful copy. 100k encoded characters is the size the reference
 * client settled on: well inside what terminals accept, and far above any
 * selection a reader makes by hand.
 */
export const OSC52_ENCODED_LIMIT = 100_000

/** What one writer command may take before it is killed. */
const WRITER_TIMEOUT_MS = 5_000

/** Why a copy did not land; the caller renders one message per reason. */
export type CopyProblem =
  /** The selection is too large to hand over in one OSC 52 sequence. */
  | 'too-large'
  /** Wayland: no `wl-copy`, so the selection had nowhere to go. */
  | 'wayland'
  /** X11: neither `xclip` nor `xsel` is installed. */
  | 'x11'
  /** This platform has no clipboard writer the client knows. */
  | 'unsupported'

/** What a copy came to: done, or the reason it could not be. */
export type CopyResult = 'copied' | CopyProblem

/** Everything a copy touches, injected so tests never spawn or write anything. */
export interface ClipboardPorts {
  /** The environment that decides remote-ness and which display exists. */
  readonly env: NodeJS.ProcessEnv
  /** The platform whose clipboard is written. */
  readonly platform: NodeJS.Platform
  /** Write one escape sequence to the terminal that owns the screen. */
  readonly write: (data: string) => void
  /**
   * Run one clipboard writer with `input` on stdin.
   *
   * `undefined` means the command could not start, timed out, or exited
   * non-zero.
   */
  readonly run: (command: string, args: readonly string[], input?: string) => Promise<Buffer | undefined>
  /** The native helper this build ships with, when it has one. */
  readonly native?: { readonly setText?: (text: string) => Promise<void> } | undefined
}

/**
 * Whether this process runs on the far side of a terminal link.
 *
 * mosh is checked as well as SSH: it forwards OSC 52 the same way but leaves no
 * `SSH_CONNECTION` behind. `HULALA_CLIPBOARD=terminal` covers clients that hide
 * both markers, such as a multiplexer attach or an IDE daemon.
 * @param env - the process environment.
 * @returns true when the clipboard to write belongs to the terminal, not this box.
 */
export function isRemoteSession(env: NodeJS.ProcessEnv): boolean {
  if (env.SSH_CONNECTION !== undefined || env.SSH_CLIENT !== undefined || env.SSH_TTY !== undefined) return true
  if (env.MOSH_CONNECTION !== undefined) return true
  // `osc52` is the reference client's spelling for the same override.
  return env.HULALA_CLIPBOARD === 'terminal' || env.HULALA_CLIPBOARD === 'osc52'
}

/**
 * The OSC 52 sequence that hands `text` to the terminal's own clipboard.
 * @param text - the selection to copy.
 * @returns the sequence, or undefined when it is too large to write once.
 */
export function osc52(text: string): string | undefined {
  const bytes = Buffer.byteLength(text)
  // Base64 is four characters per three bytes, rounded up. Checking the size
  // before encoding keeps an oversized selection from being copied twice.
  if (4 * Math.ceil(bytes / 3) > OSC52_ENCODED_LIMIT) return undefined
  return `\u001b]52;c;${Buffer.from(text).toString('base64')}\u0007`
}

/**
 * Whether this machine has a clipboard of its own to write.
 *
 * A display is what a Linux session needs for Wayland or X11, and Termux is
 * Android: no display, but its clipboard tool is the local one.
 */
function hasLocalClipboard(env: NodeJS.ProcessEnv): boolean {
  return env.DISPLAY !== undefined || env.WAYLAND_DISPLAY !== undefined || env.TERMUX_VERSION !== undefined
}

/**
 * The writer commands to try, in the order they own the clipboard.
 *
 * Termux comes first because its Android clipboard is the only one there;
 * Wayland before X11 because a session that has both is a Wayland session with
 * XWayland.
 * @param platform - the platform whose clipboard is written.
 * @param env - the environment that names the display.
 * @returns one command per attempt, or none when the platform has no writer.
 */
function platformWriters(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): ReadonlyArray<readonly [string, readonly string[]]> {
  if (platform === 'darwin') return [['pbcopy', []]]
  if (platform === 'win32') return [['clip', []]]
  if (platform !== 'linux') return []
  const writers: Array<readonly [string, readonly string[]]> = []
  if (env.TERMUX_VERSION !== undefined) writers.push(['termux-clipboard-set', []])
  if (env.WAYLAND_DISPLAY !== undefined) writers.push(['wl-copy', []])
  if (env.DISPLAY !== undefined) {
    writers.push(['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']])
  }
  return writers
}

/**
 * Copy `text` to the clipboard this session can paste from.
 * @param text - the selection to copy.
 * @param ports - the injected environment, terminal, and command runner.
 * @returns `copied`, or the reason nothing landed.
 */
export async function copyToClipboard(text: string, ports: ClipboardPorts): Promise<CopyResult> {
  if (text === '') return 'copied'
  // No reachable local clipboard: a remote session pastes from the terminal,
  // and a display-less Linux has nothing to write. OSC 52 is all that is left.
  if (isRemoteSession(ports.env) || (ports.platform === 'linux' && !hasLocalClipboard(ports.env))) {
    const sequence = osc52(text)
    if (sequence === undefined) return 'too-large'
    ports.write(sequence)
    return 'copied'
  }

  // The native helper takes no process and cannot race the terminal, so it is
  // tried first. Linux is excluded: its helper only reads, because a writer
  // there has to stay alive and own the selection.
  if (ports.platform !== 'linux' && ports.native?.setText !== undefined) {
    try {
      await ports.native.setText(text)
      return 'copied'
    } catch {
      // Fall through to the platform's own writer.
    }
  }
  for (const [command, args] of platformWriters(ports.platform, ports.env)) {
    if (await ports.run(command, args, text) !== undefined) return 'copied'
  }
  if (ports.platform !== 'linux') return 'unsupported'
  return ports.env.WAYLAND_DISPLAY !== undefined ? 'wayland' : 'x11'
}

/**
 * Run one clipboard writer, feeding it `text` and waiting for it to finish.
 *
 * Clipboard tools daemonize to keep owning the selection, so the child leaves
 * this process group and gets no output pipes: a daemon that outlives the call
 * must not keep a pipe, the working directory, or Ctrl-Z delivery attached to
 * the client. It runs from `/` because a clipboard tool has no business
 * resolving a relative path.
 * @param command - the writer executable.
 * @param args - its arguments.
 * @param input - the text to hand over on stdin.
 * @returns success as an empty buffer, failure as undefined.
 */
export function runClipboardWriter(
  command: string,
  args: readonly string[],
  input?: string,
): Promise<Buffer | undefined> {
  return new Promise(resolve => {
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok ? Buffer.alloc(0) : undefined)
    }
    const child = spawn(command, [...args], {
      cwd: '/',
      detached: hostPlatform() !== 'win32',
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      child.stdin?.destroy()
      finish(false)
    }, WRITER_TIMEOUT_MS)
    child.on('error', () => finish(false))
    child.on('close', code => finish(code === 0))
    child.stdin?.on('error', () => undefined) // A daemonizing writer may exit before reading.
    child.stdin?.end(input)
  })
}

/**
 * The ports the running client uses, with OSC 52 written to its own terminal.
 * @param write - the terminal's writer, so the sequence reaches the screen the
 * user is looking at rather than whichever stream happens to be `process.stdout`.
 * @returns ports backed by this machine and its environment.
 */
export function liveClipboardPorts(write: (data: string) => void): ClipboardPorts {
  const env = process.env
  const platform = hostPlatform()
  // Loading the helper can open a display, so it is skipped where the copy
  // would never reach it: a remote session writes the terminal, and the Linux
  // helper only reads (a writer there has to own the selection itself).
  const native = platform === 'linux' || isRemoteSession(env) ? undefined : getNativeClipboard()
  return { env, platform, write, run: runClipboardWriter, native }
}

/**
 * Largest image a prompt will carry.
 *
 * The image travels as base64 inside one prompt frame, so four thirds of this is
 * what a slow link has to move. Past this the paste is refused with a reason
 * rather than accepted and then failed by the Host's own attachment limit.
 */
export const PASTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

/** Media types the prompt protocol accepts for an inline image. */
export type ClipboardImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** One image read from the clipboard, ready to attach to a prompt. */
export interface ClipboardImage {
  /** Base64 payload, which is what a prompt content part carries. */
  readonly data: string
  readonly mediaType: ClipboardImageMediaType
  /** Decoded size, so the caller can say how big the attachment is. */
  readonly bytes: number
}

/** Why a paste produced no image; the caller renders one line per reason. */
export type PasteImageProblem =
  /** The clipboard holds no image (text, or nothing at all). */
  | 'empty'
  /** The image is larger than {@link PASTE_IMAGE_MAX_BYTES}. */
  | 'too-large'
  /** The clipboard returned bytes no supported image format begins with. */
  | 'unsupported'
  /** This platform has no image reader the client knows. */
  | 'no-reader'

/** What a paste came to: an image, or the reason there is none. */
export type PasteImageResult =
  | { readonly ok: true; readonly image: ClipboardImage }
  | { readonly ok: false; readonly reason: PasteImageProblem }

/** Everything an image paste touches, injected so tests never spawn anything. */
export interface ImageReadPorts {
  /** The environment that decides which display exists. */
  readonly env: NodeJS.ProcessEnv
  readonly platform: NodeJS.Platform
  /** Run one reader and return its stdout; undefined when it could not run or failed. */
  readonly run: (command: string, args: readonly string[]) => Promise<Buffer | undefined>
  /** The native helper this build ships with, which reads the OS clipboard directly. */
  readonly native?: { readonly getImage?: () => Promise<Uint8Array | null | undefined> } | undefined
}

/** The reader commands to try for an image, in the order they own the clipboard. */
function imageReaders(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): ReadonlyArray<readonly [string, readonly string[]]> {
  if (platform !== 'linux') return []
  const readers: Array<readonly [string, readonly string[]]> = []
  if (env.WAYLAND_DISPLAY !== undefined) readers.push(['wl-paste', ['--no-newline', '--type', 'image/png']])
  if (env.DISPLAY !== undefined) readers.push(['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']])
  return readers
}

/**
 * Identify an image by its leading bytes.
 *
 * The clipboard's declared type is not trustworthy across platforms and
 * helpers, and a prompt part whose media type disagrees with its bytes is
 * rejected by the Host, so the bytes decide.
 * @param bytes - the clipboard payload.
 * @returns the media type, or undefined when no supported format matches.
 */
export function imageMediaTypeOf(bytes: Uint8Array): ClipboardImageMediaType | undefined {
  const starts = (...prefix: number[]): boolean => prefix.every((value, index) => bytes[index] === value)
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }
  return undefined
}

/** Turn raw clipboard bytes into a prompt-ready image, or explain why not. */
function imageOf(bytes: Uint8Array | undefined): PasteImageResult {
  if (bytes === undefined || bytes.length === 0) return { ok: false, reason: 'empty' }
  if (bytes.length > PASTE_IMAGE_MAX_BYTES) return { ok: false, reason: 'too-large' }
  const mediaType = imageMediaTypeOf(bytes)
  if (mediaType === undefined) return { ok: false, reason: 'unsupported' }
  return {
    ok: true,
    image: { data: Buffer.from(bytes).toString('base64'), mediaType, bytes: bytes.length },
  }
}

/**
 * Read the image on this machine's clipboard.
 *
 * The native helper is tried first because it reads the operating system's own
 * clipboard and never needs a command; Linux falls back to the display's own
 * tool, since its helper owns text selection rather than image reads. Nothing
 * is read over OSC 52: the protocol has no read direction, which is exactly why
 * the client must be the process holding the clipboard.
 * @param ports - the injected environment, platform, helper and command runner.
 * @returns the image, or the reason there is none.
 */
export async function readClipboardImage(ports: ImageReadPorts): Promise<PasteImageResult> {
  // Whether anything was actually asked for an image. A clipboard that answered
  // "no image" is empty; a platform with nothing to ask is a missing reader, and
  // the two say different things to the user.
  let asked = false
  let lastReason: PasteImageProblem | undefined
  if (ports.native?.getImage !== undefined) {
    try {
      asked = true
      const bytes = await ports.native.getImage()
      const result = imageOf(bytes ?? undefined)
      if (result.ok) return result
      // A large image is the helper's final answer: no fallback reader would
      // find a smaller one.
      if (result.reason === 'too-large') return result
      lastReason = result.reason
    } catch {
      // The helper could not read the clipboard; the platform's own tool may.
    }
  }
  for (const [command, args] of imageReaders(ports.platform, ports.env)) {
    asked = true
    const result = imageOf(await ports.run(command, args))
    if (result.ok) return result
    if (result.reason === 'too-large') return result
    lastReason = result.reason
  }
  // A reader that answered with unrecognised bytes is more specific than
  // "empty": the clipboard did hold something, just not an image we can send.
  return { ok: false, reason: lastReason ?? (asked ? 'empty' : 'no-reader') }
}

/**
 * Run one clipboard reader and collect its stdout.
 * @param command - the reader executable.
 * @param args - its arguments.
 * @returns the bytes, or undefined when it could not start or exited non-zero.
 */
export function runClipboardReader(command: string, args: readonly string[]): Promise<Buffer | undefined> {
  return new Promise(resolve => {
    let settled = false
    const finish = (value: Buffer | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const child = spawn(command, [...args], { cwd: '/', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(undefined)
    }, WRITER_TIMEOUT_MS)
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    child.on('error', () => finish(undefined))
    child.on('close', code => finish(code === 0 ? Buffer.concat(chunks) : undefined))
  })
}

/** The ports the running client uses, backed by this machine's clipboard. */
export function liveImageReadPorts(): ImageReadPorts {
  return {
    env: process.env,
    platform: hostPlatform(),
    run: runClipboardReader,
    native: getNativeClipboard(),
  }
}
