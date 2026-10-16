import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'
import type { NativeDirectoryDialogInput, NativeDirectoryDialogResult } from '@hulala/workbench-contracts/browser'
import { HttpError } from '../http'

// User text is passed as arguments/environment, never interpolated into scripts.
const MAC_PICKER = `ObjC.import('AppKit'); ObjC.import('Foundation');
function run(argv) {
  var app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  var panel = $.NSOpenPanel.openPanel;
  panel.title = argv[0]; panel.prompt = 'Open';
  panel.canChooseFiles = false; panel.canChooseDirectories = true;
  panel.allowsMultipleSelection = false; panel.canCreateDirectories = true;
  panel.directoryURL = $.NSURL.fileURLWithPath(argv[1]);
  app.activateIgnoringOtherApps(true);
  return panel.runModal === $.NSModalResponseOK ? ObjC.unwrap(panel.URL.path) : '';
}`
const WINDOWS_PICKER = `Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $env:HULALA_DIALOG_TITLE
$dialog.SelectedPath = $env:HULALA_DIALOG_DIRECTORY
$dialog.ShowNewFolderButton = $true
try { if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) } }
finally { $dialog.Dispose() }`

export interface NativeDialogCommand {
  executable: string
  args: string[]
  env?: Record<string, string>
  cancelExitCode?: number
}
type Runner = (command: NativeDialogCommand, signal: AbortSignal) => Promise<string | null>

export function directoryDialogCommand(platform: NodeJS.Platform, input: NativeDirectoryDialogInput, directory: string, which = Bun.which): NativeDialogCommand {
  if (platform === 'darwin') return { executable: '/usr/bin/osascript', args: ['-l', 'JavaScript', '-e', MAC_PICKER, input.title, directory] }
  if (platform === 'win32') return {
    executable: join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_PICKER],
    env: { HULALA_DIALOG_TITLE: input.title, HULALA_DIALOG_DIRECTORY: directory },
  }
  if (platform === 'linux') {
    const zenity = which('zenity')
    if (zenity) return { executable: zenity, args: ['--file-selection', '--directory', '--title=' + input.title, '--filename=' + directory + sep], cancelExitCode: 1 }
    const kdialog = which('kdialog')
    if (kdialog) return { executable: kdialog, args: ['--getexistingdirectory', directory, '--title', input.title], cancelExitCode: 1 }
    throw new HttpError(503, 'native_dialog_unavailable', 'The system folder picker needs Zenity or KDialog and a desktop session on this computer.')
  }
  throw new HttpError(503, 'native_dialog_unavailable', 'This system does not provide a supported folder picker.')
}

const runDialog: Runner = (command, signal) => new Promise((resolve, reject) => {
  execFile(command.executable, command.args, {
    encoding: 'utf8', signal, timeout: 15 * 60_000, maxBuffer: 64 * 1024,
    env: { ...process.env, ...command.env }, windowsHide: true,
  }, (error, stdout) => {
    if (signal.aborted) { resolve(null); return }
    if (error) {
      if (command.cancelExitCode !== undefined && error.code === command.cancelExitCode) { resolve(null); return }
      reject(new HttpError(503, 'native_dialog_failed', 'Could not open the system folder picker. Check that this computer has an unlocked desktop session.'))
      return
    }
    resolve(stdout.replace(/\r?\n$/, '') || null)
  })
})

/** One native dialog per local service, including requests from multiple tabs. */
export class NativeDirectoryPicker {
  private active?: { controller: AbortController; task: Promise<NativeDirectoryDialogResult> }
  private stopped = false
  constructor(private defaultDirectory: string, private platform: NodeJS.Platform = process.platform, private run: Runner = runDialog) {}

  pick(input: NativeDirectoryDialogInput, signal?: AbortSignal): Promise<NativeDirectoryDialogResult> {
    if (this.stopped) return Promise.reject(new HttpError(503, 'service_stopping', 'The local service is stopping.'))
    if (this.active) return Promise.reject(new HttpError(409, 'native_dialog_busy', 'A system folder picker is already open. Complete or cancel it first.'))
    const controller = new AbortController()
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
    const task = this.select(input, combined)
    this.active = { controller, task }
    return task.finally(() => { if (this.active?.task === task) this.active = undefined })
  }

  private async select(input: NativeDirectoryDialogInput, signal: AbortSignal): Promise<NativeDirectoryDialogResult> {
    const requested = input.defaultPath || this.defaultDirectory
    if (!isAbsolute(requested) || requested.includes('\0')) throw new HttpError(400, 'path_invalid', 'An absolute directory path is required.')
    const directory = await realpath(requested)
    if (!(await stat(directory)).isDirectory()) throw new HttpError(400, 'path_invalid', 'Choose an existing directory.')
    if (signal.aborted) return { path: null }
    const selected = await this.run(directoryDialogCommand(this.platform, input, directory), signal)
    if (!selected || signal.aborted) return { path: null }
    if (!isAbsolute(selected) || selected.includes('\0')) throw new HttpError(400, 'path_invalid', 'The system picker returned an invalid directory.')
    const path = await realpath(selected)
    if (!(await stat(path)).isDirectory()) throw new HttpError(400, 'path_invalid', 'Choose an existing directory.')
    return { path }
  }

  async stop(): Promise<void> {
    this.stopped = true
    const active = this.active
    active?.controller.abort()
    await active?.task.catch(() => undefined)
  }
}
