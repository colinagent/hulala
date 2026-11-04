import { spawn } from 'node:child_process'
export interface CommandResult { code: number; stdout: string; stderr: string }
export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>
export const runCommand: CommandRunner = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stdout = '', stderr = ''
  child.stdout?.on('data', chunk => { stdout = (stdout + String(chunk)).slice(-32768) })
  child.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-32768) })
  child.once('error', reject); child.once('exit', code => resolve({ code: code ?? 1, stdout, stderr }))
})
