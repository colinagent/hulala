/**
 * Probe: what do pointer and trackpad reports do to the frame?
 *
 * Runs the built client in a pty and, after each burst, resizes the pty by one
 * column and back so the client repaints every row: text that only exists in a
 * buffer then shows up in the paint stream.
 */
const home = '/tmp/hulala-mouse-probe'
let painted = ''
const decoder = new TextDecoder()
const proc = Bun.spawn([process.execPath, 'apps/cli/src/main.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, HULALA_HOME: home, HULALA_LANG: 'en', TERM: 'xterm-256color', COLUMNS: '120', LINES: '40' },
  stderr: 'pipe',
  terminal: { cols: 120, rows: 40, data: (_terminal, chunk) => { painted += decoder.decode(chunk) } },
})
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const write = (data: string): void => { proc.terminal!.write(data) }
let cursor = 0
/** Everything painted since the last call, with escape sequences removed. */
const drain = (): string => {
  const slice = painted.slice(cursor)
  cursor = painted.length
  return slice.replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, '').replace(/\u001b\][^\u0007]*\u0007/gu, '').replace(/\u001b[()][A-Z0-9]/gu, '')
}
const reapint = async (): Promise<string> => {
  drain()
  proc.terminal!.resize(119, 40)
  await wait(120)
  proc.terminal!.resize(120, 40)
  await wait(350)
  return drain()
}
await wait(7000)
console.log('boot paint bytes', painted.length, 'exit', proc.exitCode)
if (proc.exitCode !== null) {
  console.log('stderr', JSON.stringify(await new Response(proc.stderr).text().catch(() => '')).slice(0, 600))
  process.exit(1)
}
write('hi')
await wait(300)
write('\u0015')
await wait(200)
console.log('after typing, composer has hi:', (await reapint()).includes('hi'))

const cases: Array<[string, string[]]> = [
  ['motion whole', ['\u001b[<35;10;10M', '\u001b[<35;11;10M', '\u001b[<35;12;10M']],
  ['motion split after ESC[', ['\u001b[<35;10;10M'.slice(0, 2), '\u001b[<35;10;10M'.slice(2)]],
  ['wheel over composer', ['\u001b[<64;10;35M', '\u001b[<64;10;35M', '\u001b[<65;10;35M']],
  ['wheel split', ['\u001b[<64;10;3', '5M']],
  ['drag', ['\u001b[<0;10;5M', '\u001b[<32;12;5M', '\u001b[<0;12;5m']],
]
for (const [name, reports] of cases) {
  for (const report of reports) {
    write(report)
    await wait(90)
  }
  const paint = await reapint()
  const leaked = /<\d+;\d+;\d+[Mm]/u.test(paint)
  console.log(`${name}: leaked=${leaked}`, leaked ? JSON.stringify(paint.match(/<[^ ]{0,30}/u)?.[0]) : '')
}
write('\u0011')
await wait(400)
proc.kill()
process.exit(0)
