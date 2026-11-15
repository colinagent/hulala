/** A: does a click in the composer move the caret?  B: does exit restore the terminal? */
const home = '/tmp/hv-modes'
let painted = ''
const decoder = new TextDecoder()
const proc = Bun.spawn([process.execPath, 'apps/cli/dist/hulala.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, HULALA_HOME: home, HULALA_LANG: 'en', TERM: 'xterm-ghostty' },
  terminal: { cols: 100, rows: 30, data: (_t, chunk) => { painted += decoder.decode(chunk) } },
})
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const write = (data: string): void => { proc.terminal!.write(data) }
const composer = (): string => {
  const plain = painted.replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, '\n').replace(/\u001b\][^\u0007]*\u0007/gu, '')
  return plain.split('\n').filter(row => row.includes('❯')).at(-1)?.trim() ?? '(none)'
}
await wait(13_000)
write('hello world')
await wait(500)
console.log('typed:', JSON.stringify(composer()))
// A click far to the left of the text (what a trackpad tap produces).
write('\u001b[<0;20;28M')
await wait(200)
write('\u001b[<0;20;28m')
await wait(300)
write('XY')
await wait(500)
console.log('after a left click then typing:', JSON.stringify(composer()))
// Motion only (1003), no buttons.
write('\u001b[<35;22;28M\u001b[<35;30;28M')
await wait(300)
console.log('after motion:', JSON.stringify(composer()))
write('\u0011')
await wait(1200)
const tail = painted.slice(-4000)
console.log('restores mouse off on exit:', /\u001b\[\?1006l/.test(tail), '| alt screen off:', /\u001b\[\?1049l/.test(tail), '| cursor mode:', /\u001b\[\?25h/.test(tail))
proc.kill()
process.exit(0)
