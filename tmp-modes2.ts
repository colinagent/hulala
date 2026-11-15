const home = '/tmp/hv-modes2'
let painted = ''
const decoder = new TextDecoder()
const proc = Bun.spawn([process.execPath, 'apps/cli/dist/hulala.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, HULALA_HOME: home, HULALA_LANG: 'en', TERM: 'xterm-ghostty' },
  terminal: { cols: 100, rows: 30, data: (_t, chunk) => { painted += decoder.decode(chunk) } },
})
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const write = (data: string): void => { proc.terminal!.write(data) }
/** The composer row: text only, escapes removed entirely. */
const composer = (): string => {
  const plain = painted
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/gu, '')
    .replace(/\u001b[P_][^\u001b]*\u001b\\/gu, '')
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, '')
    .replace(/\u001b[()][A-Z0-9]/gu, '')
  return plain.split('\n').filter(row => row.includes('❯')).at(-1)?.trim() ?? '(none)'
}
await wait(13_000)
write('hello world')
await wait(600)
console.log('typed:', JSON.stringify(composer()))
write('\u001b[<0;20;28M')
await wait(150)
write('\u001b[<0;20;28m')
await wait(250)
write('XY')
await wait(600)
console.log('after click then typing:', JSON.stringify(composer()))
write('\u0011')
await wait(1500)
console.log('exited:', proc.exitCode)
console.log('disable mouse anywhere:', /\u001b\[\?1006l/u.test(painted))
console.log('disable alt screen anywhere:', /\u001b\[\?1049l/u.test(painted))
console.log('tail:', JSON.stringify(painted.slice(-160)))
proc.kill()
process.exit(0)
