/**
 * The user's exact setup: this bundle, attached to `dev`, in a pty, with the
 * editor column open so frames are flowing while the pointer reports arrive.
 */
import { attachRemote } from './apps/cli/src/hostAttach.ts'

const home = '/tmp/hv-repro2'
let painted = ''
const decoder = new TextDecoder()
const proc = Bun.spawn([process.execPath, 'apps/cli/dist/hulala.mjs', '--remote', 'dev'], {
  cwd: process.cwd(),
  env: { ...process.env, HULALA_HOME: home, HULALA_LANG: 'en', TERM: 'xterm-ghostty', HULALA_DEBUG_CLIENT: '1' },
  terminal: { cols: 120, rows: 34, data: (_t, chunk) => { painted += decoder.decode(chunk) } },
})
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const write = (data: string): void => { proc.terminal!.write(data) }
const composer = (): string => {
  const plain = painted.replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, '\n').replace(/\u001b\][^\u0007]*\u0007/gu, '')
  return plain.split('\n').filter(row => row.includes('❯')).at(-1)?.trim() ?? '(none)'
}
await wait(14_000)
console.log('attached; composer:', JSON.stringify(composer()))
// Open the editor column: a remote grid flooding frames is what makes reads split.
write('\u0004')
await wait(6000)
for (let i = 0; i < 30; i += 1) {
  write('\u001b')
  await wait(3 + (i % 5) * 9)
  write(`[<35;${40 + (i % 12)};${20 + (i % 6)}M`)
  write(`\u001b[<35;${41};${21}M`)
  write('\u001b[')
  await wait(2 + (i % 4) * 11)
  write(`<35;${42};${22}M`)
}
await wait(1500)
console.log('composer after flood:', JSON.stringify(composer()))
write('\u0011')
await wait(600)
proc.kill()
const log = await Bun.file(`${home}/logs/tui-debug.log`).text().catch(() => '')
const bad = log.split('\n').filter(line => /^.*piece "[^"]*3\d;\d+;\d+M/.test(line) && !line.includes('\\u001b['))
console.log('suspicious pieces:', bad.length, bad.slice(0, 3).join(' | '))
process.exit(0)
