import { spawn } from 'node:child_process'
import { access, chmod, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const exists = (file: string) => stat(file).then(() => true, () => false)

export type PathRegistration = { kind: 'profile'; file: string; block: string } | { kind: 'windows'; directory: string }
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
async function profileFor(shell: string, userHome: string, environment: NodeJS.ProcessEnv): Promise<{ file: string, line: (directory: string) => string } | undefined> {
  const name = basename(shell)
  if (name === 'zsh') return { file: join(environment.ZDOTDIR?.trim() || userHome, '.zshrc'), line: directory => `export PATH=${quote(directory)}:"$PATH"` }
  if (name === 'fish') return { file: join(userHome, '.config/fish/config.fish'), line: directory => `fish_add_path ${quote(directory)}` }
  if (name === 'bash') {
    const line = (directory: string) => `export PATH=${quote(directory)}:"$PATH"`
    if (await exists(join(userHome, '.bashrc'))) return { file: join(userHome, '.bashrc'), line }
    if (await exists(join(userHome, '.bash_profile'))) return { file: join(userHome, '.bash_profile'), line }
    return { file: join(userHome, '.profile'), line }
  }
  if (['sh', 'dash', 'ksh'].includes(name)) return { file: join(userHome, '.profile'), line: directory => `export PATH=${quote(directory)}:"$PATH"` }
  return undefined
}
export async function addCommandPath(directory: string, userHome: string, shell = process.env.SHELL || '/bin/sh', platform = process.platform, environment = process.env): Promise<PathRegistration | undefined> {
  const path = environment.PATH?.split(platform === 'win32' ? ';' : ':') || []
  if (path.some(entry => platform === 'win32' ? entry.toLowerCase() === directory.toLowerCase() : entry === directory)) return
  if (platform === 'win32') return await windowsPath(directory) ? { kind: 'windows', directory } : undefined
  const profile = await profileFor(shell, userHome, environment)
  if (profile === undefined) throw new Error('Add this directory to your shell PATH manually: ' + directory)
  const marker = createHash('sha256').update(directory).digest('hex').slice(0, 12)
  const block = `# >>> hulala ${marker}\n${profile.line(directory)}\n# <<< hulala ${marker}\n`
  const before = await readFile(profile.file, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
  if (before.includes(block)) return { kind: 'profile', file: profile.file, block }
  await saveProfile(profile.file, before + (before && !before.endsWith('\n') ? '\n' : '') + block)
  return { kind: 'profile', file: profile.file, block }
}
export async function removeCommandPath(registration: PathRegistration): Promise<void> {
  if (registration.kind === 'windows') { await windowsPath(registration.directory, true); return }
  const before = await readFile(registration.file, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
  if (before.includes(registration.block)) await saveProfile(registration.file, before.replace(registration.block, ''))
}
