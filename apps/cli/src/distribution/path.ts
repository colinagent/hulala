import { spawn } from 'node:child_process'
import { access, chmod, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const exists = (file: string) => stat(file).then(() => true, () => false)

export type PathRegistration = { kind: 'profile'; files: string[]; block: string } | { kind: 'windows'; directory: string }
/** Receipts written before the switch to `files` named a single `file`. */
export type StoredPathRegistration = PathRegistration | { kind: 'profile'; file: string; block: string }
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"

/**
 * Directories that are already on PATH and belong to this user, best first. The
 * command goes into one of them, so installing never edits a shell profile and
 * never puts Hulala's private `bin` directory on PATH: that directory holds the
 * bundled `nvim` and helpers, which are not meant to shadow the user's own.
 */
export async function userPathDirectories(userHome: string, environment: NodeJS.ProcessEnv = process.env, platform = process.platform, exclude: readonly string[] = []): Promise<string[]> {
  if (platform === 'win32') return []
  const inside = (directory: string, parent: string) => directory === parent || directory.startsWith(parent.replace(/\/+$/, '') + '/')
  const entries = (environment.PATH ?? '').split(':').map(entry => entry.replace(/\/+$/, '')).filter(entry => entry !== '' && !exclude.some(parent => inside(entry, parent)))
  const preferred = [join(userHome, '.local/bin'), join(userHome, 'bin'), join(userHome, '.bin'), join(userHome, 'local/bin')].filter(directory => !exclude.some(parent => inside(directory, parent)))
  const candidates = [...preferred.filter(directory => entries.includes(directory)), ...entries.filter(entry => !preferred.includes(entry) && (entry.startsWith(userHome + '/') || existsSync(join(entry, 'brew'))))]
  const usable: string[] = []
  for (const directory of candidates) {
    if (await exists(directory)) { if (await stat(directory).then(value => value.isDirectory(), () => false) && await access(directory, constants.W_OK).then(() => true, () => false)) usable.push(directory); continue }
    // A not-yet-created directory is usable when its nearest existing parent is writable.
    let parent = dirname(directory)
    while (!await exists(parent) && dirname(parent) !== parent) parent = dirname(parent)
    if (await access(parent, constants.W_OK).then(() => true, () => false)) usable.push(directory)
  }
  return usable
}
async function saveProfile(file: string, content: string): Promise<void> {
  file = await realpath(file).catch(error => { if (error.code === 'ENOENT') return file; throw error })
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const mode = await stat(file).then(value => value.mode & 0o777).catch(error => { if (error.code === 'ENOENT') return 0o600; throw error })
  const temporary = file + '.hulala-' + randomUUID() + '.tmp'
  try { await writeFile(temporary, content, { mode: 0o600 }); await chmod(temporary, mode); await rename(temporary, file) }
  finally { await rm(temporary, { force: true }) }
}
async function windowsPath(directory: string, remove = false): Promise<boolean> {
  const script = `$ErrorActionPreference='Stop';$entry=$env:HULALA_PATH_ENTRY;$old=[Environment]::GetEnvironmentVariable('Path','User');$parts=@($old -split ';' | Where-Object { $_ });$has=@($parts | Where-Object { $_.TrimEnd('\\') -ieq $entry.TrimEnd('\\') }).Count -gt 0;${remove
    ? "if($has){[Environment]::SetEnvironmentVariable('Path',(($parts | Where-Object { $_.TrimEnd('\\') -ine $entry.TrimEnd('\\') }) -join ';'),'User')}"
    : "if(!$has){[Environment]::SetEnvironmentVariable('Path',(($parts + $entry) -join ';'),'User')}"};[Console]::Write(${remove ? '$has' : '(!$has)'})`
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, HULALA_PATH_ENTRY: directory }, windowsHide: true })
    let output = ''; child.stdout?.on('data', chunk => { output += String(chunk) }); child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve(output.trim().toLowerCase() === 'true') : reject(new Error('Could not update the current user PATH')))
  })
}
/**
 * The profile an interactive terminal reads for this shell. An installer that
 * writes a login-only file leaves `hulala` missing in editor terminals and
 * non-login shells, which is the case pi's installer avoids the same way.
 */
/**
 * Every profile an interactive terminal of this shell reads, so a new window
 * finds the command whether it starts a login shell or not.
 *
 * zsh reads `.zshrc` for every interactive shell. fish reads its config file for
 * both kinds. bash is the awkward one: a terminal on macOS starts a login shell
 * (`.bash_profile`, else `.profile`), while editor terminals and Linux usually
 * start a non-login shell (`.bashrc`), so both files are registered.
 */
async function profileFor(shell: string, userHome: string, environment: NodeJS.ProcessEnv): Promise<{ files: string[], line: (directory: string) => string } | undefined> {
  const name = basename(shell)
  const exportLine = (directory: string) => `export PATH=${quote(directory)}:"$PATH"`
  if (name === 'zsh') return { files: [join(environment.ZDOTDIR?.trim() || userHome, '.zshrc')], line: exportLine }
  if (name === 'fish') return { files: [join(environment.XDG_CONFIG_HOME?.trim() || join(userHome, '.config'), 'fish/config.fish')], line: directory => `fish_add_path ${quote(directory)}` }
  if (name === 'bash') {
    const login = await exists(join(userHome, '.bash_profile')) ? '.bash_profile' : '.profile'
    return { files: [join(userHome, '.bashrc'), join(userHome, login)], line: exportLine }
  }
  if (['sh', 'dash', 'ksh'].includes(name)) return { files: [join(userHome, '.profile')], line: exportLine }
  // An unknown shell is never guessed at: the caller prints the export line.
  return undefined
}
export async function addCommandPath(directory: string, userHome: string, shell = process.env.SHELL || '/bin/sh', platform = process.platform, environment = process.env): Promise<PathRegistration | undefined> {
  const path = environment.PATH?.split(platform === 'win32' ? ';' : ':') || []
  if (path.some(entry => platform === 'win32' ? entry.toLowerCase() === directory.toLowerCase() : entry === directory)) return
  if (platform === 'win32') return await windowsPath(directory) ? { kind: 'windows', directory } : undefined
  const profile = await profileFor(shell, userHome, environment)
  if (profile === undefined) return undefined
  const marker = createHash('sha256').update(directory).digest('hex').slice(0, 12)
  const block = `# >>> hulala ${marker}\n${profile.line(directory)}\n# <<< hulala ${marker}\n`
  const files: string[] = []
  for (const file of profile.files) {
    const before = await readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
    if (before.includes(block)) { files.push(file); continue }
    await saveProfile(file, before + (before && !before.endsWith('\n') ? '\n' : '') + block)
    files.push(file)
  }
  return { kind: 'profile', files, block }
}
export async function removeCommandPath(registration: StoredPathRegistration): Promise<void> {
  if (registration.kind === 'windows') { await windowsPath(registration.directory, true); return }
  const files = 'files' in registration ? registration.files : [registration.file]
  for (const file of files) {
    const before = await readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
    if (before.includes(registration.block)) await saveProfile(file, before.replace(registration.block, ''))
  }
}
