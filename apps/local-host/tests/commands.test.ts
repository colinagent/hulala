import { afterEach, expect, test } from 'bun:test'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CommandService, shellCommand } from '../src/commands'
import { EventHub } from '../src/events'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hulala-command-test-'))
  const context = new Context()
  await context.plugin(LocalSubprocessRuntime)
  const directory = join(root, 'records')
  const service = new CommandService(new EventHub(), context.get('subprocess'), directory)
  await service.initialize()
  cleanups.push(() => rm(root, { recursive: true, force: true }), () => context.fiber.dispose(), () => service.stopAll())
  return { root, directory, service, workspace: { id: 'test-workspace', name: 'Test', path: root } }
}
async function settled(service: CommandService, id: string) {
  const deadline = Date.now() + 5000
  while (['running', 'stopping'].includes(service.snapshot(id).state)) {
    if (Date.now() > deadline) throw new Error('Command did not finish')
    await Bun.sleep(10)
  }
  return service.snapshot(id)
}
test('native command output is bounded, independently readable, and survives a Host restart', async () => {
  const { service, workspace, directory } = await fixture()
  const argv = [process.execPath, '--eval', 'process.stdout.write("x".repeat(600000)+"END");process.stderr.write("ERR")']
  const requestId = crypto.randomUUID()
  const [first, duplicate] = await Promise.all([service.start(workspace, argv, '.', requestId), service.start(workspace, argv, '.', requestId)])
  expect(first).toEqual(duplicate)
  const output = await settled(service, first.id)
  expect(output.stdout).toEndWith('END')
  expect(Buffer.byteLength(output.stdout)).toBeLessThanOrEqual(256 * 1024)
  expect(output.stderr).toBe('ERR')
  expect(output.truncated).toBeTrue()
  expect(service.snapshot(first.id)).toEqual(output)
  expect(service.list(workspace.id)).toHaveLength(1)
  await expect(service.start(workspace, ['another'], '.', requestId)).rejects.toMatchObject({ status: 409 })
  await service.stopAll()
  const reopened = new CommandService(new EventHub(), undefined, directory)
  await reopened.initialize()
  cleanups.push(() => reopened.stopAll())
  expect(reopened.snapshot(first.id)).toEqual(output)
  expect(await reopened.start(workspace, argv, '.', requestId)).toEqual(first)
  expect(JSON.parse(await readFile(join(directory, 'commands.json'), 'utf8'))).toHaveLength(1)
})
test('line input and stopping are owned by the Host, with bounded Workspace cwd', async () => {
  const { service, workspace } = await fixture()
  const first = await service.start(workspace, [process.execPath, '--eval', 'process.stdin.once("data", data => { process.stdout.write("received:"+data); process.exit(0) })'])
  await service.write(first.id, '输入\n')
  expect((await settled(service, first.id)).stdout).toBe('received:输入\n')
  const second = await service.start(workspace, [process.execPath, '--eval', 'setInterval(() => {},1000)'])
  await expect(service.start(workspace, ['anything'], '..')).rejects.toMatchObject({ status: 403 })
  service.stop(second.id)
  expect((await settled(service, second.id)).state).toBe('stopped')
  service.stop(second.id)
})
test('command text remains a single shell argument on both platform families', () => {
  const command = 'printf "space ; value"'
  expect(shellCommand(command, 'darwin', '/bin/sh')).toEqual(['/bin/sh', '-lc', command])
  expect(shellCommand(command, 'win32').slice(1)).toEqual(['/d', '/s', '/c', command])
})
