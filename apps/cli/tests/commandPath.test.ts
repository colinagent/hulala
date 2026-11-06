import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addCommandPath, removeCommandPath, userPathDirectories } from '../src/distribution/path.js'

test('the command directory is added to the shell profile once and removed again', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hulala path '))
  try {
    const directory = join(home, '.hulala/bin'), profile = join(home, '.zshrc')
    await writeFile(profile, 'export EDITOR=vim\n')
    const registration = await addCommandPath(directory, home, '/bin/zsh', 'darwin')
    expect(registration?.kind).toBe('profile')
    const text = await readFile(profile, 'utf8')
    expect(text).toStartWith('export EDITOR=vim\n')
    expect(text).toContain(`export PATH='${directory}':"$PATH"`)

    // A second install of the same directory must not add a second block.
    await addCommandPath(directory, home, '/bin/zsh', 'darwin')
    expect(await readFile(profile, 'utf8')).toBe(text)

    // A directory that is already on PATH needs no profile edit at all.
    const onPath = process.env.PATH!.split(':').find(entry => entry !== '' && entry !== directory)!
    expect(await addCommandPath(onPath, home, '/bin/zsh', 'darwin')).toBeUndefined()

    await removeCommandPath(registration!)
    expect(await readFile(profile, 'utf8')).toBe('export EDITOR=vim\n')

    // Each shell reads a different profile: zsh configDir/.zshrc, fish gets
    // fish_add_path, and bash is registered in both the non-login file and the
    // login file, because a macOS terminal starts a login shell while an editor
    // terminal does not.
    const health: NodeJS.ProcessEnv = { ...process.env, PATH: '/usr/bin' }
    const configDir = join(home, 'zdot')
    const profilesOf = async (shell: string, environment = health) => {
      const registration = await addCommandPath(directory, home, shell, 'darwin', environment)
      if (registration?.kind !== 'profile') throw new Error('expected a profile registration')
      return registration.files
    }
    expect(await profilesOf('/bin/zsh', { ...health, ZDOTDIR: configDir })).toEqual([join(configDir, '.zshrc')])
    await writeFile(join(home, '.bashrc'), '')
    await writeFile(join(home, '.bash_profile'), '')
    expect(await profilesOf('/bin/bash')).toEqual([join(home, '.bashrc'), join(home, '.bash_profile')])
    expect(await readFile(join(home, '.bash_profile'), 'utf8')).toContain(`export PATH='${directory}':"$PATH"`)
    expect(await profilesOf('/usr/bin/fish')).toEqual([join(home, '.config/fish/config.fish')])
    expect(await readFile(join(home, '.config/fish/config.fish'), 'utf8')).toContain(`fish_add_path '${directory}'`)
    // fish follows XDG_CONFIG_HOME when the user set one.
    expect(await profilesOf('/usr/local/bin/fish', { ...health, XDG_CONFIG_HOME: join(home, 'xdg') })).toEqual([join(home, 'xdg/fish/config.fish')])
    // An unknown shell is never guessed at; the caller prints the export line.
    expect(await addCommandPath(directory, home, '/usr/bin/pwsh', 'darwin', health)).toBeUndefined()
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('the command goes into a user directory that is already on PATH', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hulala path choice '))
  try {
    const local = join(home, '.local/bin'), other = join(home, 'brew/bin'), outside = join(tmpdir(), 'not-the-users')
    for (const directory of [local, other, outside]) await mkdir(directory, { recursive: true })
    const environment: NodeJS.ProcessEnv = { PATH: [other, outside, local].join(':') }
    // A user directory on PATH wins over a directory outside the home, and the
    // user's own `~/.local/bin` wins over the others.
    expect(await userPathDirectories(home, environment, 'darwin')).toEqual([local, other])
    // A private state-root bin directory is never a candidate: it holds the
    // bundled nvim and helpers, which must not shadow the user's own commands.
    expect(await userPathDirectories(home, { PATH: join(home, '.hulala/bin') }, 'darwin', [join(home, '.hulala')])).toEqual([])
  } finally { await rm(home, { recursive: true, force: true }) }
})
