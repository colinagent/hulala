/** The exact bundle the user runs, hit with reports split at every awkward place. */
const home = '/tmp/hv-term-probe'
let painted = ''
const decoder = new TextDecoder()
const proc = Bun.spawn([process.execPath, 'apps/cli/dist/hulala.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, HULALA_HOME: home, HULALA_LANG: 'en', TERM: 'xterm-256color' },
  terminal: { cols: 110, rows: 32, data: (_t, chunk) => { painted += decoder.decode(chunk) } },
})
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const write = (data: string): void => { proc.terminal!.write(data) }
await wait(12_000)
write('hi')
await wait(300)
let cursor = painted.length
const screen = async (): Promise<string> => {
  cursor = painted.length
  proc.terminal!.resize(109, 32)
  await wait(150)
  proc.terminal!.resize(110, 32)
  await wait(400)
  return painted.slice(cursor).replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, '').replace(/\u001b\][^\u0007]*\u0007/gu, '').replace(/\u001b[()][A-Z0-9]/gu, '')
}
await screen()
const shapes: Array<[string, number]> = [
  ['\u001b', 0],
  ['[', 40],
  ['<35;57;23M', 0],
  ['\u001b', 0],
  ['[<', 40],
  ['35;69;15M', 0],
  ['\u001b[<', 40],
  ['35;56;28M', 0],
  ['\u001b[', 40],
  ['<35;44;42M', 0],
  ['\u001b', 400],
  ['[<35;67;41M', 0],
]
for (let round = 0; round < 6; round += 1) {
  for (const [data, gap] of shapes) {
    write(data)
    if (gap > 0) await wait(gap)
  }
}
await wait(1500)
const after = await screen()
const composerLine = after.split('\n').find(line => line.includes('❯')) ?? ''
console.log('garbage in composer:', /3\d;\d\d;[0-9]+M/u.test(composerLine), '|', JSON.stringify(composerLine.trim().slice(0, 90)))
write('\u0011')
await wait(800)
proc.kill()
process.exit(0)
