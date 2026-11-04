import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { renderInstallScript } from '../../../scripts/release/installScriptTemplate'

const script = renderInstallScript({
  version: '1.2.3',
  cases: "  darwin-arm64) archive='hulala-1.2.3-darwin-arm64.tar.gz' archive_sha='abc' ;;",
  downloadBase: 'https://downloads.example.invalid/hulala/web/1.2.3',
  githubBase: 'https://github.example.invalid/releases/download/hulala-v1.2.3',
})

async function run(command: string[], env: Record<string, string | undefined> = process.env): Promise<{ stdout: string, stderr: string, exitCode: number }> {
  const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe', env })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

function temporary(name: string, content: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'hulala-install-script-')), name)
  writeFileSync(file, content)
  return file
}

test('the installer is valid POSIX shell and carries the release values', () => {
  const file = temporary('install.sh', script)
  expect(Bun.spawnSync(['sh', '-n', file]).exitCode).toBe(0)
  expect(script).toContain("version='1.2.3'")
  expect(script).toContain('https://downloads.example.invalid/hulala/web/1.2.3')
  expect(script).toContain("darwin-arm64) archive='hulala-1.2.3-darwin-arm64.tar.gz'")
})

test('the installer publishes real binaries and never symlinks', () => {
  expect(script).not.toMatch(/\bln\s+-[a-z]*s/)
  expect(script).toContain('bin_root="$state_root/bin"')
  expect(script).toContain('cp -f "$binary" "$bin_root/$name"')
  expect(script).toContain('chmod 755 "$bin_root/$name"')
})

test('the installer hands the package to its own install command', () => {
  // One versioned layout: `hulala install` writes versions/<id>, active.json,
  // installation.json and the launcher, which is what `hulala update` replaces.
  expect(script).toContain('release_command "$package"')
  expect(script).toContain('"$package/bin/hulala" install --from "$package" --root "$install_root" --bin "$command_bin" --version "$version"')
  expect(script).not.toContain('<<LAUNCHER')
  expect(script).not.toContain('target="$install_root/$version"')
})

/** `hulala install` verifies this file by running it, so it must report a version. */
function packageEntries(root: string): Array<{ path: string, size: number, sha256: string, mode: number }> {
  const files = [
    { path: 'bin/hulala', mode: 0o755 },
    { path: 'bin/nvim', mode: 0o755 },
    { path: 'server/hulala-host.mjs', mode: 0o644 },
    { path: 'runtime/host.mjs', mode: 0o644 },
    { path: 'runtime/package.json', mode: 0o644 },
    { path: 'LICENSE', mode: 0o644 },
    { path: 'THIRD_PARTY_NOTICES.md', mode: 0o644 },
  ]
  return files.map(({ path, mode }) => {
    const file = join(root, path)
    const bytes = readFileSync(file)
    return { path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mode }
  })
}

test('the rendered installer produces an installation that hulala can update and run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala install e2e '))
  const repository = new URL('../../../', import.meta.url).pathname
  const version = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8')).version as string
  const target = `${process.platform}-${process.arch}`
  const directory = `hulala-${version}-${target}`
  const packageRoot = join(root, directory)
  mkdirSync(join(packageRoot, 'bin'), { recursive: true })
  // The package's own executable is the CLI this checkout builds.
  await writeFile(join(packageRoot, 'bin/hulala'), `#!/bin/sh\nexec "${process.execPath}" "${join(repository, 'apps/cli/src/main.ts')}" "$@"\n`)
  chmodSync(join(packageRoot, 'bin/hulala'), 0o755)
  await writeFile(join(packageRoot, 'bin/nvim'), 'editor binary')
  chmodSync(join(packageRoot, 'bin/nvim'), 0o755)
  for (const file of ['server/hulala-host.mjs', 'runtime/host.mjs', 'runtime/package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    mkdirSync(join(packageRoot, file, '..'), { recursive: true })
    await writeFile(join(packageRoot, file), 'fixture ' + file)
  }
  await writeFile(join(packageRoot, 'manifest.json'), JSON.stringify({
    format: 1,
    product: 'hulala',
    stage: 'workbench',
    version,
    target,
    protocol: 1,
    dataFormat: 1,
    lockSha256: '0'.repeat(64),
    entrypoint: 'bin/hulala',
    files: packageEntries(packageRoot),
  }))

  const archive = join(root, `${directory}.tar.gz`)
  expect(Bun.spawnSync(['tar', '-czf', archive, '-C', root, directory]).exitCode).toBe(0)
  const bytes = await readFile(archive)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response(bytes),
  })
  try {
    const installer = join(root, 'install.sh')
    await writeFile(installer, renderInstallScript({
      version,
      cases: `  ${target}) archive='${basename(archive)}' archive_sha='${sha256}' ;;`,
      downloadBase: `http://127.0.0.1:${server.port}`,
      githubBase: '',
    }))
    const home = join(root, 'home'), bin = join(root, 'bin')
    // Async spawn: the mirror in this process must keep serving during the run.
    // HOME points at the fixture so shell profile registration stays inside it.
    const result = await run(['sh', installer], { ...process.env, HOME: home, HULALA_HOME: home, HULALA_BIN: bin })
    expect(result.stderr).not.toContain('not changed')
    expect(result.exitCode).toBe(0)

    // The installer produced the versioned layout `hulala update` replaces.
    const installation = join(home, 'runtime/client')
    expect(await readdir(installation)).toEqual(expect.arrayContaining(['active.json', 'installation.json', 'versions']))
    const active = JSON.parse(await readFile(join(installation, 'active.json'), 'utf8'))
    expect(active.current.version).toBe(version)
    // The real command lives in Hulala's own bin directory; the PATH directory
    // the user already has holds one symlink to it, so installing never edits a
    // shell profile.
    const real = join(home, 'bin/hulala')
    expect(statSync(real).isFile()).toBe(true)
    expect(lstatSync(real).isSymbolicLink()).toBe(false)
    expect(readFileSync(real, 'utf8')).toContain('hulala-launcher')
    expect(lstatSync(join(bin, 'hulala')).isSymbolicLink()).toBe(true)
    expect(realpathSync(join(bin, 'hulala'))).toBe(realpathSync(real))
    expect(existsSync(join(bin, '.hulala-launcher.json'))).toBe(false)
    expect(existsSync(join(home, '.zshrc'))).toBe(false)
    expect(existsSync(join(home, '.profile'))).toBe(false)

    // Editing the package never leaves the editor without its binary.
    expect(statSync(join(home, 'bin/nvim')).isFile()).toBe(true)
    expect(lstatSync(join(home, 'bin/nvim')).isSymbolicLink()).toBe(false)

    const exited = await run([join(bin, 'hulala'), '--version'])
    expect(exited.stderr).toBe('')
    expect(exited.exitCode).toBe(0)
    expect(exited.stdout.trim()).toBe(version)
  } finally {
    server.stop(true)
  }
}, 60_000)
