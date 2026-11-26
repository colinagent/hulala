/**
 * One link from the conversation, and the machine that has to resolve it.
 *
 * A transcript's links are the model's own text, so they arrive in every form a
 * person writes a reference in: a URL, an absolute path, a file beside the one
 * being discussed, or a bare name that only ever meant something inside the
 * directory the Session runs in. Which of those a link is decides *who* resolves
 * it, and that is the whole point of this module.
 *
 * A Session belongs to exactly one Host. The file a link names lives in that
 * Host's filesystem, under its sandbox and its workspace root, so a path is only
 * ever meaningful there — resolving it here would name a file on a machine the
 * link was never about. The Host is also the only part of this pair that can
 * tell whether the file exists, so classification stops at "a path on the Host"
 * and leaves the answering to the `workspaceFiles` Remote that already does it.
 *
 * `http`, `https` and `mailto` are the opposite: they are location-independent,
 * and the browser that opens one is the browser in front of the reader, never a
 * browser on the far side of the link. Everything else is a path.
 *
 * @module hulala-cli/tui/data/resource
 */

/** What one link names, as far as this client can tell without asking. */
export type ResourceTarget =
  /** A browser's, on the machine the reader is sitting at. */
  | { readonly kind: 'url'; readonly url: string }
  /** A path in the Host's filesystem, absolute or relative to the Session. */
  | { readonly kind: 'path'; readonly path: string }
  /** Neither: a fragment, an unknown scheme, or an empty link. */
  | { readonly kind: 'other'; readonly text: string }

/** The schemes a browser opens; the only links that are not a file. */
const BROWSER_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto'])

/** `<scheme>:` at the start of a link. */
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/u

/** A Windows drive prefix, which no link ever means as a scheme. */
const DRIVE = /^[a-zA-Z]:[\\/]/u

/**
 * Decide what one link names.
 *
 * A `file:` URL is deliberately not a URL here: it carries a path, and a path is
 * the Host's to resolve. Terminals that open `file:` themselves would open it on
 * the wrong machine the moment the attachment is remote.
 * @param href - the link's target, exactly as the markdown carried it.
 * @returns what it names.
 */
export function classifyResource(href: string): ResourceTarget {
  const text = href.trim()
  if (text === '') return { kind: 'other', text: href }
  if (DRIVE.test(text)) return { kind: 'path', path: text }
  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase()
  if (scheme !== undefined) {
    if (!BROWSER_SCHEMES.has(scheme)) return { kind: 'other', text }
    return { kind: 'url', url: text }
  }
  // A bare fragment or query addresses the page, not a file on any machine.
  if (text.startsWith('#') || text.startsWith('?')) return { kind: 'other', text }
  return { kind: 'path', path: text }
}

/**
 * What the client knows about the Host it is attached to.
 *
 * Both facts come from the Host itself — the Session's directory and the Host's
 * own home — because neither can be read off this machine: a `~` in a link is
 * the far side's home.
 */
export interface HostResolveContext {
  /** The Session's directory, as the Host reported it; empty before one runs. */
  readonly cwd: string
  /** The Host's home directory, when it reported one. */
  readonly home?: string
}

/** `<scheme>:`-less absoluteness, on either kind of Host (`/x`, `C:\\x`). */
function isAbsolute(path: string): boolean {
  return path.startsWith('/') || DRIVE.test(path)
}

/**
 * Turn a link's path into the absolute path the Host should be asked about.
 *
 * A relative link is relative to the Session's directory, which is where the
 * model's tools ran and therefore where the name was written from. A `~` is
 * expanded against the Host's home, never this machine's.
 *
 * Nothing is normalized here: `workspaceFiles.stat` resolves the path against the
 * real filesystem and answers with the canonical `absolutePath`, which is what the
 * editor column opens. A client that folded `.` and `..` itself would be guessing
 * at a filesystem it cannot see, and symlinks would make the guess wrong.
 * @param context - the Host's own coordinates for this Session.
 * @param path - the path as the link wrote it.
 * @returns an absolute path, or the path as written when there is no base.
 */
export function hostPath(context: HostResolveContext, path: string): string {
  const text = path.trim()
  if (text === '~' || text.startsWith('~/')) {
    const home = context.home
    return home === undefined || home === '' ? text : `${home}${text.slice(1)}`
  }
  if (isAbsolute(text)) return text
  // No Session directory (before the first one opens): the Host still gets the
  // name as written, and its refusal names the path the link carried.
  return context.cwd === '' ? text : `${context.cwd}/${text}`
}

/** `code/kind:` — the prefix a Remote failure carries in front of its reason. */
const REMOTE_CODE = /^[a-z0-9-]+\/[a-z0-9-]+:\s*/u

/**
 * The reason a Host refused something, without the Remote code in front of it.
 *
 * The code (`workspace-files/missing`) is for a program to branch on; a reader
 * deciding whether the file was deleted or the Host is too old needs the
 * sentence behind it.
 * @param caught - whatever the Remote call threw.
 * @returns one line, always non-empty.
 */
export function hostReason(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught)
  const reason = message.replace(REMOTE_CODE, '').trim()
  return reason === '' ? 'the Host refused the request' : reason
}
