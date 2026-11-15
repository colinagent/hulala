/** The terminal must come back even when the client is killed. */
const home = '/tmp/hv-guard'
let painted = ''
const decoder = new TextDecoder()
const proc = Bun.spawn([process.execPath, 'apps/cli/dist/hulala.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, HULALA_HOME: home, HULALA_LANG: 'en', TERM: 'xterm-ghostty' },
  terminal: { cols: 100, rows: 30, data: (_t, chunk) => { painted += decoder.decode(chunk) } },
})
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
await wait(13_000)
console.log('motion off asked for:', painted.includes('\u001b[?1003l'))
console.log('1003 turned on then off:', painted.includes('\u001b[?1003h'), painted.lastIndexOf('\u001b[?1003l') > painted.indexOf('\u001b[?1003h'))
const before = painted.length
proc.kill('SIGTERM')
await wait(1200)
const tail = painted.slice(before)
console.log('exit code:', proc.exitCode)
console.log('restores after SIGTERM:', JSON.stringify(tail.slice(-180)))
process.exit(0)
