/**
 * Reproduce the garbage composer against a healthy local Host.
 *
 * Every write is one `stdin` chunk, exactly what a terminal's write becomes, and
 * the composer row is read back out of the painted frame (not guessed at).
 */
const home = '/tmp/hv-repro'
let painted = ''
const decoder = new TextDecoder()
const proc = Bun.spawn([process.execPath, 'apps/cli/dist/hulala.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, HULALA_HOME: home, HULALA_LANG: 'en', TERM: 'xterm-256color' },
  terminal: { cols: 110, rows: 30, data: (_t, chunk) => { painted += decoder.decode(chunk) } },
})
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const write = (data: string): void => { proc.terminal!.write(data) }

/** The composer row as the terminal last painted it, with SGR removed. */
const composer = (): string => {
  const plain = painted
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, '\n')
    .replace(/\u001b\][^\u0007]*\u0007/gu, '')
    .replace(/\u001b[()][A-Z0-9]/gu, '')
  const rows = plain.split('\n').filter(row => row.includes('❯'))
  return rows.at(-1)?.trim() ?? '(no composer row)'
}
await wait(13_000)
write('hi')
await wait(600)
console.log('baseline composer:', JSON.stringify(composer()))

const cases: Array<[string, string, number]> = [
  ['two reports in one write', '\u001b[<35;57;23M\u001b[<35;69;15M', 0],
  ['report + partial next', '\u001b[<35;56;28M\u001b[<35;', 0],
  ['escape alone then tail', null as never, 0],
]
for (const [name, data, gap] of cases.slice(0, 2)) {
  const before = composer()
  write(data)
  await wait(500)
  const after = composer()
  void gap
  const changed = after !== before
  console.log(`${name}: typed=${changed}`, changed ? JSON.stringify(after.slice(-40)) : '')
}
// The split the user's terminal produced.
write('\u001b')
await wait(45)
write('[<35;57;23M')
await wait(600)
console.log('escape alone then tail: typed=', composer().includes('35;'))
write('\u0011')
await wait(800)
proc.kill()
process.exit(0)
