/** The built client, hit with a realistic 1003 motion-report burst, in every split shape. */
const home = '/tmp/hv-burst'
let painted = ''
const decoder = new TextDecoder()
const proc = Bun.spawn([process.execPath, 'apps/cli/dist/hulala.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, HULALA_HOME: home, HULALA_LANG: 'en', TERM: 'xterm-256color' },
  terminal: { cols: 110, rows: 32, data: (_t, chunk) => { painted += decoder.decode(chunk) } },
})
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const write = (data: string): void => { proc.terminal!.write(data) }
const report = (x: number, y: number): string => `\u001b[<35;${x};${y}M`
await wait(12_000)
write('hi')
await wait(300)
let cursor = painted.length
const screen = async (): Promise<string> => {
  cursor = painted.length
  proc.terminal!.resize(109, 32)
  await wait(120)
  proc.terminal!.resize(110, 32)
  await wait(350)
  return painted.slice(cursor).replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, '').replace(/\u001b\][^\u0007]*\u0007/gu, '').replace(/\u001b[()][A-Z0-9]/gu, '')
}
await screen()
for (let i = 0; i < 40; i += 1) {
  write(report(40 + (i % 10), 30 + (i % 5)))                     // whole
  write('\u001b')                                                 // escape alone
  await wait(12)
  write(`[<35;${41};${31}M`)
  write('\u001b[')                                                // escape + bracket
  await wait(12)
  write(`<35;42;31M`)
  write('\u001b[<35;4')                                           // split mid-number
  await wait(8)
  write('3;31M')
  write(`${report(44, 32)}\u001b`)                                // report then escape, one write
  await wait(12)
  write('[<35;45;32M')
}
await wait(1200)
const after = await screen()
const garbage = [...after.matchAll(/\[<3\d;/gu)].length
console.log('garbage occurrences:', garbage)
console.log('composer:', JSON.stringify(after.split('\n').filter(l => l.includes('❯')).map(l => l.trim().slice(0, 90))))
write('\u0011')
await wait(800)
proc.kill()
process.exit(0)
