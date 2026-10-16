import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { release, platform, arch } from 'node:os'
import { releaseTarget } from '@hulala/distribution/targets'

const target = releaseTarget()
if (process.env.HULALA_CI_TARGET && process.env.HULALA_CI_TARGET !== target) throw new Error('The CI runner architecture does not match its declared target')
const repository = join(import.meta.dir, '../..'), output = join(repository, 'dist/ci', target), reports = join(output, 'reports')
await mkdir(reports, { recursive: true })
await writeFile(join(reports, 'environment.json'), JSON.stringify({ platform: platform(), arch: arch(), osRelease: release(), bun: Bun.version }, null, 2))
const run = async (name: string, args: string[], env: NodeJS.ProcessEnv = process.env) => {
  console.log('Running ' + name)
  const log = join(reports, name + '.log')
  const child = Bun.spawn([process.execPath, ...args], { cwd: repository, env, stdout: Bun.file(log), stderr: 'pipe' })
  const error = new Response(child.stderr).text(), code = await child.exited
  const errors = await error
  if (errors) await Bun.write(log, await Bun.file(log).text() + '\n' + errors)
  if (code) throw new Error(name + ' failed: ' + (await Bun.file(log).text()).slice(-12000))
  return log
}
if (target === 'linux-x64') await run('public-check', ['run', 'check'])
else {
  await run('boundary', ['scripts/workbench/check-boundary.ts'])
  await run('build', ['run', 'build'])
  await run('types', ['run', 'typecheck:workbench'])
  await run('tests', ['run', 'test:workbench'])
  await run('cli-types', ['run', '--cwd', 'apps/cli', 'typecheck'])
  await run('cli-tests', ['run', '--cwd', 'apps/cli', 'test'])
}
const packageLog = await run('package', ['scripts/workbench/package.ts', '--output', join(output, 'packages')])
const packageLine = (await readFile(packageLog, 'utf8')).split('\n').findLast(line => line.startsWith('{"directory":'))
if (!packageLine) throw new Error('No packaged artifact was produced')
const pkg = JSON.parse(packageLine) as { directory: string; archive: string; version: string }
await run('installed', ['scripts/workbench/smoke-installed.ts', pkg.directory])
await run('tamper', ['scripts/workbench/smoke-package.ts', pkg.directory])
await run('install-lifecycle', ['scripts/workbench/smoke-installation.ts', pkg.directory, '--archive'])
// npm publication is separate from the standalone Web release. Its global/npx
// installation matrix can be requested explicitly when preparing that channel.
const validateNpm = process.env.HULALA_CI_VALIDATE_NPM === 'true'
if (validateNpm) {
  const npmLog = await run('npm-package', ['scripts/workbench/npm-package.ts', pkg.directory, join(output, 'npm')])
  const npmLine = (await readFile(npmLog, 'utf8')).split('\n').findLast(line => line.startsWith('{"meta":'))
  if (!npmLine) throw new Error('No npm artifacts were produced')
  await writeFile(join(reports, 'npm.json'), npmLine)
  await run('npm-installed', ['scripts/workbench/smoke-npm.ts', join(reports, 'npm.json')])
}
if (process.platform !== 'win32') await run('ssh-installed', ['test', 'apps/local-host/tests/ssh-workspaces.test.ts'], { ...process.env, HULALA_SSH_TEST_RELEASE_PACKAGE: pkg.directory })
await writeFile(join(reports, 'result.json'), JSON.stringify({ passed: true, target, version: pkg.version, native: true, npmValidation: validateNpm ? 'passed' : 'not-requested' }, null, 2))
console.log(JSON.stringify({ passed: true, target, archive: pkg.archive }))
