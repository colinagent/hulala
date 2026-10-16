import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { verifyPackage } from './package-manifest'

const argument = process.argv[2]
if (!argument) throw new Error('Pass a staged Hulala package directory')
const source = resolve(argument)
const manifest = await verifyPackage(source)
const temporary = await mkdtemp(join(tmpdir(), 'hulala install smoke '))
try {
  const installed = join(temporary, 'installed app')
  await cp(source, installed, { recursive: true })
  const executable = join(installed, manifest.entrypoint)
  const env = {
    PATH: '',
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    HULALA_HOME: join(temporary, 'state'),
    HULALA_WORKSPACE_ROOT: join(temporary, 'workspaces'),
  }
  const run = async (flag: string) => {
    const child = Bun.spawn([executable, flag], { cwd: temporary, env, stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, stdout, stderr }
  }
  const version = await run('--version')
  if (version.code !== 0 || version.stdout.trim() !== manifest.version) throw new Error('Installed version failed')
  const checked = await run('--check-package')
  if (checked.code !== 0 || JSON.parse(checked.stdout).valid !== true) throw new Error(`Installed check failed: ${checked.stderr}`)
  await writeFile(join(installed, 'web/index.html'), 'tampered')
  const tampered = await run('--check-package')
  if (tampered.code === 0 || !tampered.stderr.includes('Integrity mismatch')) throw new Error('Installed executable accepted a tampered asset')
  console.log(JSON.stringify({ installed: true, target: manifest.target, version: manifest.version, emptyPath: true, relocated: true, tamperRejected: true }))
} finally {
  await rm(temporary, { recursive: true, force: true })
}
