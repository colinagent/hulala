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
  lock: 'https://downloads.example.invalid/hulala/web/1.2.3/runtime-package-lock.json',
  lockSha256: 'b'.repeat(64),
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

test('the installer supplies Node instead of demanding one', () => {
  // The archive carries no runtime, so the script has one job before the
  // download: use the machine's Node, reuse the one it installed earlier, or
  // offer to install one. It never edits a shell profile to expose it.
  expect(script).toContain('node_line=${HULALA_NODE_LINE:-latest-v24.x}')
  expect(script).toContain("'https://nodejs.org/dist'")
  // The floor is what DeepSeek Harness declares, not the old 22.x line.
  expect(script).toContain('Hulala needs Node.js 24.9+.')
  expect(script).toContain('SHASUMS256.txt')
  // The runtime belongs to Hulala, inside its own state root, and `hulala
  // uninstall` removes exactly that directory. Nothing edits a shell profile to
  // put it on PATH for other software.
  expect(script).toContain('node_root=${HULALA_NODE_HOME:-"$state_root/runtime/node"}')
  expect(script).toContain('node_root/bin/node')
  expect(script).toContain('node_root/CURRENT')
  expect(script).toContain('Download it for Hulala (~50 MB)?')
  expect(script).toContain('install_node_standalone')
  expect(script).not.toContain('PATH=$node_root')
  // A runtime this product installs must never become a machine-wide one: no
  // package manager, no sudo, nothing outside the state root.
  expect(script).not.toContain('install_node_with_homebrew')
  expect(script).not.toContain('apt-get install -y nodejs')
  expect(script).not.toContain('detect_node_install_method')
})

/** Run the rendered installer with the tools the version check needs. */
function versionCheck(state: string, installed: string | undefined, name: string) {
  const bin = join(mkdtempSync(join(tmpdir(), 'hulala version path ')), name)
  mkdirSync(bin)
  for (const tool of ['awk', 'cat', 'mkdir', 'mktemp', 'rmdir', 'rm', 'uname', 'head', 'sed']) {
    const resolved = Bun.which(tool)
    if (resolved !== null) Bun.spawnSync(['ln', '-s', resolved, join(bin, tool)])
  }
  if (installed !== undefined) {
    const root = join(state, '.hulala/runtime/client')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'active.json'), JSON.stringify({
      format: 1,
      current: { id: `${installed}-abcdef`, version: installed, manifestSha256: 'a'.repeat(64), dataFormat: 1 },
    }, null, 2) + '\n')
    writeFileSync(join(root, 'installation.json'), JSON.stringify({
      format: 1, product: 'hulala-install', command: join(state, 'bin/hulala'), launcherSha256: 'a'.repeat(64), createdAt: 'now',
    }, null, 2) + '\n')
    mkdirSync(join(state, 'bin'), { recursive: true })
    writeFileSync(join(state, 'bin/hulala'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  }
  const file = join(mkdtempSync(join(tmpdir(), 'hulala version script ')), 'install.sh')
  writeFileSync(file, script)
  const child = Bun.spawnSync(['/bin/sh', file], {
    stdout: 'pipe', stderr: 'pipe',
    env: { PATH: bin, HOME: state, HULALA_HOME: join(state, '.hulala'), HULALA_NO_START: '1' },
  })
  return { stdout: child.stdout.toString(), stderr: child.stderr.toString(), exitCode: child.exitCode }
}

test('re-running the installer does not download a release that is already installed', () => {
  // The script was rendered for 1.2.3, so an equal installation is current.
  const state = mkdtempSync(join(tmpdir(), 'hulala current '))
  const result = versionCheck(state, '1.2.3', 'current-bin')
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain('Hulala 1.2.3 is already installed')
  expect(result.stderr).not.toContain('Downloading')
  expect(result.stderr).not.toContain('Hulala runs on Node.js')
})

test('an installation whose command is missing is repaired, not reported as current', () => {
  const state = mkdtempSync(join(tmpdir(), 'hulala missing command '))
  const root = join(state, '.hulala/runtime/client')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'active.json'), JSON.stringify({
    format: 1,
    current: { id: '1.2.3-abcdef', version: '1.2.3', manifestSha256: 'a'.repeat(64), dataFormat: 1 },
  }, null, 2) + '\n')
  // No installation.json and no command: the record alone proves nothing.
  const result = versionCheck(state, undefined, 'missing-bin')
  expect(result.stderr).toContain('its command is missing; repairing it')
  expect(result.stdout).not.toContain('already installed')
})

test('an older installation is upgraded, and a newer one is never downgraded', () => {
  const older = versionCheck(mkdtempSync(join(tmpdir(), 'hulala older ')), '1.2.2', 'older-bin')
  expect(older.stderr).toContain('Updating Hulala 1.2.2 to 1.2.3')
  const newer = versionCheck(mkdtempSync(join(tmpdir(), 'hulala newer ')), '1.2.4', 'newer-bin')
  expect(newer.exitCode).toBe(0)
  expect(newer.stderr).toContain('newer than this installer (1.2.3)')
  expect(newer.stderr).not.toContain('Downloading')
})

/** Run the rendered installer with a PATH that holds no Node, curl or wget. */
function withoutNode(state: string, name: string): { stdout: string, stderr: string, exitCode: number } {
  const bin = join(mkdtempSync(join(tmpdir(), 'hulala limited path ')), name)
  mkdirSync(bin)
  // Exactly the tools the preflight needs; a download cannot start from here.
  for (const tool of ['cat', 'mkdir', 'mktemp', 'rmdir', 'rm', 'uname']) {
    const resolved = Bun.which(tool)
    if (resolved !== null) Bun.spawnSync(['ln', '-s', resolved, join(bin, tool)])
  }
  const target = `${process.platform}-${process.arch}`
  const file = temporary('install.sh', renderInstallScript({
    version: '1.2.3',
    cases: `  ${target}) archive='hulala-1.2.3-${target}.tar.gz' archive_sha='abc' runtime_pack_url='http://127.0.0.1:1/pack.tar.gz' runtime_pack_sha='${'c'.repeat(64)}' ;;`,
    downloadBase: 'http://127.0.0.1:1',
    githubBase: '',
    lock: 'http://127.0.0.1:1/runtime-package-lock.json',
    lockSha256: 'b'.repeat(64),
  }))
  const child = Bun.spawnSync(['/bin/sh', file], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PATH: bin, HOME: state, XDG_DATA_HOME: state, HULALA_HOME: state, HULALA_BIN: join(state, 'commands') },
  })
  return { stdout: child.stdout.toString(), stderr: child.stderr.toString(), exitCode: child.exitCode }
}

test('the installer finds the machine proxy and known Node.js mirrors', () => {
  // Chinese networks very often reach the internet only through a desktop proxy
  // that curl and npm cannot see in the environment, and they often cannot reach
  // nodejs.org at all. Both must be handled without asking the user to debug it.
  expect(script).toContain('detect_system_proxy')
  expect(script).toContain('scutil --proxy')
  expect(script).toContain('org.gnome.system.proxy')
  expect(script).toContain('ProxyAutoConfigEnable')
  expect(script).toContain('npm_config_https_proxy')
  expect(script).toContain('https://npmmirror.com/mirrors/node')
  expect(script).toContain('https://mirrors.tuna.tsinghua.edu.cn/nodejs-release')
  expect(script).toContain('https://mirrors.cloud.tencent.com/nodejs-release')
  expect(script).toContain('HULALA_NODE_BASE')
  expect(script).toContain('HULALA_NODE_LINE')
  // The checksum file decides what is valid; a mirror is only transport.
  expect(script).toContain("node_sums=''")
})

test('a system proxy is exported for every download, and an environment proxy wins', () => {
  const section = /^detect_system_proxy\(\) \{[\s\S]*?^\}/m.exec(script)?.[0]
  expect(section).toBeDefined()
  const directory = join(mkdtempSync(join(tmpdir(), 'hulala proxy ')), 'fakebin')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'scutil'), `#!/bin/sh
cat <<'X'
<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
}
X
`)
  chmodSync(join(directory, 'scutil'), 0o755)
  const run = (extra: Record<string, string>) => Bun.spawnSync(['/bin/sh', '-c', `${section}\ndetect_system_proxy\nprintf '%s|%s' "\${https_proxy:-}" "\${npm_config_https_proxy:-}"`], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { PATH: `${directory}:${process.env.PATH}`, ...extra },
  })
  const detected = run({})
  expect(detected.stdout.toString()).toBe('http://127.0.0.1:7890|http://127.0.0.1:7890')
  expect(detected.stderr.toString()).toContain('Using the system proxy')
  // An explicit environment proxy is the user's decision and is never replaced.
  const explicit = run({ HTTPS_PROXY: 'http://corporate.invalid:3128' })
  expect(explicit.stdout.toString()).toBe('|')
  expect(explicit.stderr.toString()).toBe('')
})

test('a machine without Node is told what it needs, and nothing is downloaded', () => {
  const state = join(mkdtempSync(join(tmpdir(), 'hulala no node ')), 'state')
  const result = withoutNode(state, 'no-node-bin')
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain('Hulala runs on Node.js 24.9 or newer')
  expect(result.stderr).not.toContain('Downloading from')
})

test('a Node this installer installed earlier is reused without asking', () => {
  const state = join(mkdtempSync(join(tmpdir(), 'hulala reuse node ')), 'state')
  const nodeRoot = join(state, 'runtime/node')
  mkdirSync(join(nodeRoot, 'node-test/bin'), { recursive: true })
  writeFileSync(join(nodeRoot, 'node-test/bin/node'), '#!/bin/sh\ncase "$1" in --version) echo v24.9.0 ;; esac\n')
  chmodSync(join(nodeRoot, 'node-test/bin/node'), 0o755)
  mkdirSync(join(nodeRoot, 'bin'), { recursive: true })
  writeFileSync(join(nodeRoot, 'bin/node'), '#!/bin/sh\nexec "' + join(nodeRoot, 'node-test/bin/node') + '" "$@"\n')
  chmodSync(join(nodeRoot, 'bin/node'), 0o755)
  writeFileSync(join(nodeRoot, 'CURRENT'), 'node-test\n')
  const result = withoutNode(state, 'stored-node-bin')
  // No prompt and no requirement error: it moved on to the download, which this
  // fixture cannot reach because the limited PATH has no curl or wget.
  expect(result.stderr).not.toContain('Hulala runs on Node.js 24.9 or newer')
  expect(result.stderr).toContain('Downloading from official source')
})

test('the standalone Node install leaves one entry point that follows CURRENT', async () => {
  // Regression: the installer wrote CURRENT but never bin/node, although both the
  // installer and the installed command look exactly there. Every run downloaded
  // ~50 MB of Node, then claimed Node was still missing.
  const target = `${process.platform}-${process.arch}`
  const root = await mkdtemp(join(tmpdir(), 'hulala standalone node '))
  const name = `node-v24.9.0-${target}`
  const mirror = join(root, 'mirror')
  mkdirSync(join(mirror, name, 'bin'), { recursive: true })
  await writeFile(join(mirror, name, 'bin/node'), '#!/bin/sh\ncase "$1" in --version) echo v24.9.0 ;; *) echo stub ;; esac\n', { mode: 0o755 })
  // The downloader strips what Hulala does not run but keeps the npm tree the
  // release install needs; the npm symlink becomes a real script.
  await writeFile(join(mirror, name, 'bin/npm'), '#!/bin/sh\necho npm\n', { mode: 0o755 })
  mkdirSync(join(mirror, name, 'lib/node_modules/npm/bin'), { recursive: true })
  await writeFile(join(mirror, name, 'lib/node_modules/npm/bin/npm-cli.js'), 'console.log("npm-cli")\n')
  await writeFile(join(mirror, name, 'CHANGELOG.md'), 'changelog')
  const archive = join(mirror, `${name}.tar.gz`)
  expect(Bun.spawnSync(['tar', '-czf', archive, '-C', mirror, name]).exitCode).toBe(0)
  const bytes = new Uint8Array(await Bun.file(archive).arrayBuffer())
  const sums = `${createHash('sha256').update(bytes).digest('hex')}  ${name}.tar.gz\n`
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch: request => new URL(request.url).pathname.endsWith('SHASUMS256.txt')
      ? new Response(sums)
      : new Response(bytes),
  })
  try {
    const nodeRoot = join(root, 'state/runtime/node')
    // Only the writer is under test, so the prompt and the release download are
    // out of the picture: `main` is removed and the function is called directly.
    const driver = script.replace(/\nmain "\$@"\n$/, '\n') + '\nnode_root=$1\nnode_line=latest-v24.x\ninstall_node_standalone\n'
    const result = await run(['/bin/sh', '-c', driver, 'hulala-node', nodeRoot], {
      ...process.env, HULALA_NODE_BASE: `http://127.0.0.1:${server.port}`,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('Node.js 24.9.0 installed for Hulala')
    expect(result.stderr).toContain('other tools need their own')
    expect(readFileSync(join(nodeRoot, 'CURRENT'), 'utf8')).toBe(name + '\n')
    const entry = join(nodeRoot, 'bin/node')
    expect(lstatSync(entry).isSymbolicLink()).toBe(false)
    expect(statSync(entry).mode & 0o111).not.toBe(0)
    // The entry point names no version, so a later CURRENT change keeps working.
    expect(readFileSync(entry, 'utf8')).not.toContain(name)
    expect((await run([entry, '--version'], { ...process.env })).stdout.trim()).toBe('v24.9.0')
    // The version directory's npm symlink is gone; a real script next to bin/node
    // runs the npm the release install needs for `npm ci`.
    expect(existsSync(join(nodeRoot, name, 'bin/npm'))).toBe(false)
    const npm = join(nodeRoot, 'bin/npm')
    expect(lstatSync(npm).isSymbolicLink()).toBe(false)
    expect(statSync(npm).mode & 0o111).not.toBe(0)
    expect(readFileSync(npm, 'utf8')).toContain('lib/node_modules/npm/bin/npm-cli.js')
    expect(existsSync(join(nodeRoot, name, 'lib/node_modules/npm/bin/npm-cli.js'))).toBe(true)
    expect(existsSync(join(nodeRoot, name, 'include'))).toBe(false)
  } finally {
    server.stop(true)
  }
}, 60_000)

test('the installer hands the package to its own install command', () => {
  // One versioned layout: `hulala install` writes versions/<id>, active.json,
  // installation.json and the launcher, which is what `hulala update` replaces.
  expect(script).toContain('release_command "$package"')
  expect(script).toContain('"$package/bin/hulala" install --from "$package" --root "$install_root" --bin "$command_bin" --version "$version" $runtime_auth')
  // The archive carries no dependency tree: the installer hands over the lock and
  // the pack so `hulala install` can fetch one.
  expect(script).toContain("runtime_lock_url='https://downloads.example.invalid/hulala/web/1.2.3/runtime-package-lock.json'")
  expect(script).toContain('--runtime-lock-url $runtime_lock_url')
  expect(script).toContain('--runtime-pack-url $runtime_pack_url')
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
      cases: `  ${target}) archive='${basename(archive)}' archive_sha='${sha256}' runtime_pack_url='http://127.0.0.1:1/pack.tar.gz' runtime_pack_sha='${'c'.repeat(64)}' ;;`,
      downloadBase: `http://127.0.0.1:${server.port}`,
      githubBase: '',
      lock: `http://127.0.0.1:${server.port}/runtime-package-lock.json`,
      lockSha256: 'b'.repeat(64),
    }))
    const home = join(root, 'home'), bin = join(root, 'bin')
    mkdirSync(bin, { recursive: true })
    // Async spawn: the mirror in this process must keep serving during the run.
    // HOME points at the fixture so shell profile registration stays inside it,
    // and the command directory is already on PATH so installing edits no profile
    // (the opt-out path is `--no-add-to-path`; a missing directory is registered).
    const result = await run(['sh', installer], {
      ...process.env, HOME: home, HULALA_HOME: home, HULALA_BIN: bin,
      PATH: `${bin}:${process.env.PATH}`,
    })
    expect(result.stderr).not.toContain('not changed')
    expect(result.exitCode).toBe(0)
    // The last thing the user reads is how to start it.
    expect(result.stdout).toContain('Start it with:  hulala')

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
