import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeDirectoryDialogSchema } from '@hulala/workbench-contracts/browser'
import { directoryDialogCommand, NativeDirectoryPicker } from '../src/browser/native-directory'

const roots: string[] = []
const fixture = async () => { const root = await mkdtemp(join(tmpdir(), 'hulala-native-picker-')); roots.push(root); return await realpath(root) }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

test('passes quoted Unicode paths as data and returns the selected directory', async () => {
  const root = await fixture()
  const directory = join(root, process.platform === 'win32' ? '项目 spaces $(command)' : '项目 "quoted" $(command)')
  await mkdir(directory)
  const input = { title: 'Choose "项目" $(command)', defaultPath: directory }
  const picker = new NativeDirectoryPicker(root, 'darwin', async command => {
    expect(command.executable).toBe('/usr/bin/osascript')
    expect(command.args.slice(-2)).toEqual([input.title, directory])
    expect(command.args[3]).not.toContain(input.title)
    expect(command.args[3]).not.toContain(directory)
    return directory
  })
  expect(await picker.pick(input)).toEqual({ path: directory })
  await picker.stop()
})

test('cancellation releases the picker and rejects invalid selections', async () => {
  const root = await fixture()
  let result: string | null = null
  const picker = new NativeDirectoryPicker(root, 'darwin', async () => result)
  expect(await picker.pick({ title: 'Open Folder' })).toEqual({ path: null })
  const file = join(root, 'file.txt'); await writeFile(file, 'fixture')
  result = file
  await expect(picker.pick({ title: 'Open Folder' })).rejects.toMatchObject({ code: 'path_invalid' })
  result = root
  expect(await picker.pick({ title: 'Open Folder' })).toEqual({ path: root })
  await picker.stop()
})

test('only one picker can be open and shutting down cancels its process', async () => {
  const root = await fixture()
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  let aborted = false
  const picker = new NativeDirectoryPicker(root, 'darwin', async (_command, signal) => new Promise(resolve => {
    signal.addEventListener('abort', () => { aborted = true; resolve(null) }, { once: true })
    started()
  }))
  const pending = picker.pick({ title: 'First' })
  await ready
  await expect(picker.pick({ title: 'Second' })).rejects.toMatchObject({ status: 409, code: 'native_dialog_busy' })
  await picker.stop()
  expect(aborted).toBe(true)
  expect(await pending).toEqual({ path: null })
  await expect(picker.pick({ title: 'After shutdown' })).rejects.toMatchObject({ code: 'service_stopping' })
})

test('a disconnected browser cancels the picker without retaining its slot', async () => {
  const root = await fixture()
  const controller = new AbortController()
  let started!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const picker = new NativeDirectoryPicker(root, 'darwin', async (_command, signal) => new Promise(resolve => {
    signal.addEventListener('abort', () => resolve(null), { once: true }); started()
  }))
  const pending = picker.pick({ title: 'Open Folder' }, controller.signal)
  await ready; controller.abort()
  expect(await pending).toEqual({ path: null })
  const alreadyAborted = AbortSignal.abort()
  expect(await picker.pick({ title: 'Canceled' }, alreadyAborted)).toEqual({ path: null })
  await picker.stop()
})

test('validates requests and handles native Windows/Linux picker availability', () => {
  expect(nativeDirectoryDialogSchema.safeParse({ title: 'Bad\0title' }).success).toBe(false)
  expect(nativeDirectoryDialogSchema.safeParse({ title: 'Open', script: 'anything' }).success).toBe(false)
  const input = { title: 'Choose "folder"; $value' }
  const windows = directoryDialogCommand('win32', input, 'C:\\项目\\my folder')
  expect(windows.env).toEqual({ HULALA_DIALOG_TITLE: input.title, HULALA_DIALOG_DIRECTORY: 'C:\\项目\\my folder' })
  expect(windows.args.at(-1)).not.toContain(input.title)
  expect(directoryDialogCommand('linux', input, '/tmp/folder', name => name === 'kdialog' ? '/usr/bin/kdialog' : null).executable).toBe('/usr/bin/kdialog')
  expect(() => directoryDialogCommand('linux', input, '/tmp/folder', () => null)).toThrow('Zenity or KDialog')
})
