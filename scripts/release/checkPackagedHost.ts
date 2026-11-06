/**
 * Boot the Host out of a packaged tree and wait for its ready line.
 *
 * Packaging prunes runtime packages Hulala does not ship (the LibreOffice engine
 * behind `dsh-office-to-pdf`), so this proves the remaining dependency tree still
 * boots DeepSeek Harness. It runs against the staging directory before the
 * archive is created: a DSH release that starts loading a pruned package fails
 * packaging instead of the first install.
 *
 * @module hulala/release/check-packaged-host
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const staging = argument('--package')
if (staging === undefined) throw new Error('usage: checkPackagedHost.ts --package <staging directory> [--node <node>]')
const directory = resolve(staging)
// The shipped Host runs on Node.js (the `hulala` command picks it and the Host is
// spawned with it), so the probe must not accidentally boot it under Bun.
const node = argument('--node') ?? Bun.which('node')
if (node === null) throw new Error('no node on PATH to boot the packaged Host with')
const timeout = Number(argument('--timeout') ?? '120')
const root = await mkdtemp(join(tmpdir(), 'hulala packaged host '))
const state = join(root, 'state'), workspace = join(root, 'workspace')

try {
  const child = Bun.spawn([
    node,
    join(directory, 'runtime', 'host.mjs'),
    '--hulala-home', state,
    '--workspace-root', workspace,
    '--port', '0',
  ], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, HULALA_HOME: state, HULALA_WORKSPACE_ROOT: workspace, HULALA_HOST_DAEMON: '' },
  })
  const completed = (async () => {
    let stdout = ''
    let stderr = ''
    const ready = new Promise<string>((resolve, reject) => {
      const decoder = new TextDecoder()
      const timer = setTimeout(() => reject(new Error(`the packaged Host did not report ready within ${timeout}s\nstdout:\n${stdout.slice(-4000)}\nstderr:\n${stderr.slice(-4000)}`)), timeout * 1000)
      const pump = async (): Promise<void> => {
        for await (const chunk of child.stdout) {
          stdout += decoder.decode(chunk, { stream: true })
          if (stdout.includes('hulala-server-ready')) { clearTimeout(timer); resolve(stdout); return }
        }
      }
      void pump()
      void (async () => { for await (const chunk of child.stderr) stderr += decoder.decode(chunk, { stream: true }) })()
      void child.exited.then(code => {
        if (!stdout.includes('hulala-server-ready')) {
          clearTimeout(timer)
          reject(new Error(`the packaged Host exited with ${code} before reporting ready\nstdout:\n${stdout.slice(-4000)}\nstderr:\n${stderr.slice(-4000)}`))
        }
      })
    })
    try {
      const line = await ready
      const payload = line.split('\n').find(value => value.includes('hulala-server-ready'))
      child.kill('SIGTERM')
      const code = await Promise.race([child.exited, Bun.sleep(15000).then(() => 'timeout')])
      if (code !== 0) throw new Error(`the packaged Host did not stop cleanly on SIGTERM (${String(code)})`)
      return JSON.parse(payload ?? '{}') as unknown
    } finally {
      child.kill('SIGKILL')
    }
  })()
  const descriptor = await completed
  console.log(JSON.stringify({ package: directory, node, ready: true, descriptor }, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
