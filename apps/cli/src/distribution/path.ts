import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export type PathRegistration = { kind: 'profile'; file: string; block: string } | { kind: 'windows'; directory: string }
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
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
export async function addCommandPath(directory: string, userHome: string, shell = process.env.SHELL || '/bin/sh', platform = process.platform): Promise<PathRegistration | undefined> {
  const path = process.env.PATH?.split(platform === 'win32' ? ';' : ':') || []
  if (path.some(entry => platform === 'win32' ? entry.toLowerCase() === directory.toLowerCase() : entry === directory)) return
  if (platform === 'win32') return await windowsPath(directory) ? { kind: 'windows', directory } : undefined
  const name = basename(shell)
  if (!['sh', 'bash', 'zsh'].includes(name)) throw new Error('Add this directory to your shell PATH manually: ' + directory)
  const file = join(userHome, name === 'zsh' ? '.zprofile' : name === 'bash' && platform === 'darwin' ? '.bash_profile' : '.profile')
  const marker = createHash('sha256').update(directory).digest('hex').slice(0, 12)
  const block = `# >>> hulala ${marker}\nexport PATH=${quote(directory)}:"$PATH"\n# <<< hulala ${marker}\n`
  const before = await readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
  if (before.includes(block)) return { kind: 'profile', file, block }
  await saveProfile(file, before + (before && !before.endsWith('\n') ? '\n' : '') + block)
  return { kind: 'profile', file, block }
}
export async function removeCommandPath(registration: PathRegistration): Promise<void> {
  if (registration.kind === 'windows') { await windowsPath(registration.directory, true); return }
  const before = await readFile(registration.file, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
  if (before.includes(registration.block)) await saveProfile(registration.file, before.replace(registration.block, ''))
}
