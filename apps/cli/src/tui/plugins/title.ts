/**
 * The terminal's window title: the product name, the Session's directory, and
 * the Session title once the Host has named it.
 *
 * A terminal tab is how a user finds the window again among a shell, an editor
 * and four Hulala Sessions, so the title says where the Session is first —
 * `Hulala - hulala-dev` — and only then which Session it is. The directory comes
 * from the Session projection rather than the launch directory, so a remote
 * workspace reads as the path the Host is working in.
 *
 * This is a listener, not a service: nothing else needs the title, and the
 * Session plugin must not know who reads its changes. The directory arrives with
 * `hulala/session-changed`, the title with the Host's `session/title` journal
 * event, which the Session plugin turns into the same announcement.
 *
 * @module hulala-cli/tui/plugins/title
 */
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

/** The name the title starts with, matching what the product calls itself. */
export const APP_TITLE = 'Hulala'

/**
 * Compose the window title.
 *
 * `app - directory` is the whole title until the Host names the Session; the
 * name is appended rather than prepended so a truncated tab still shows the
 * directory. Both parts are plain text: the terminal adapter replaces control
 * characters before the sequence is written.
 * @param cwd - the directory the open Session works in.
 * @param title - the Host's Session title, if it has one yet.
 * @param app - the product name in front.
 * @returns the title to hand the terminal.
 */
export function windowTitle(cwd: string, title?: string, app: string = APP_TITLE): string {
  const name = title?.trim() ?? ''
  const head = `${app} - ${directoryLabel(cwd)}`
  return name === '' ? head : `${head} - ${name}`
}

/**
 * The last path segment, which is what identifies a directory in a tab.
 *
 * A trailing separator names no directory of its own, so it is dropped first;
 * a path that is only a root has no segment to name and is its own label.
 * @param cwd - the path to label.
 */
function directoryLabel(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/u, '')
  if (trimmed === '') return cwd === '' ? '/' : cwd
  const name = basename(trimmed)
  return name === '' ? trimmed : name
}

/** Put the derived title on the terminal, at boot and whenever the Session moves. */
export function apply(ctx: Context): void {
  const session = ctx.hulalaSession
  const { setTitle } = ctx.hulalaTerminal
  let shown: string | undefined

  const sync = (): void => {
    const current = session.id === undefined
      ? undefined
      : session.sessions.find(candidate => candidate.sessionId === session.id)
    const next = windowTitle(session.cwd, current?.title)
    // Every list event announces a change; only a different label is worth a
    // write to the terminal's tty.
    if (next === shown) return
    shown = next
    setTitle(next)
  }

  // The Session plugin is the only thing that knows the directory, so both
  // announcements are read: `opened` when the window switches Session, `changed`
  // for everything else, including the directory following the open Session.
  ctx.on('hulala/session-opened', () => { sync() })
  ctx.on('hulala/session-changed', () => { sync() })
  sync()
}

/** Cordis object-form plugin. */
export const titlePlugin = {
  name: 'hulala-title',
  inject: ['hulalaSession', 'hulalaTerminal'],
  apply,
}
