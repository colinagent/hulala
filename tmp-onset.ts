/** In the user's TERM, which mouse modes does the client turn on? */
import { TuiAltScreen } from '@earendil-works/pi-tui'
import { StreamTerminal } from './apps/cli/src/tui/terminal.ts'
import { PassThrough } from 'node:stream'
const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => undefined, setEncoding: () => undefined })
const output = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 })
let written = ''
output.on('data', chunk => { written += String(chunk) })
const terminal = new StreamTerminal({ input, output } as never, {})
const ui = new TuiAltScreen(terminal, true)
ui.start()
console.log('TERM=xterm-ghostty enables 1003:', written.includes('\u001b[?1003h'))
console.log('observed:', JSON.stringify(written.slice(0, 120)))
process.exit(0)
