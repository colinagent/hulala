import { expect, test } from 'bun:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import { CwdBar } from '../../src/tui/view/cwdBar.js'
import { StatusBar } from '../../src/tui/view/statusBar.js'
import { faintCursorSgr } from '../../src/tui/view/theme.js'
import { Transcript } from '../../src/tui/view/transcript.js'
import { RunningRow, formatRunDuration } from '../../src/tui/view/runningRow.js'
import { ResumeOverlay } from '../../src/tui/view/overlays/resume.js'
import { HelpOverlay } from '../../src/tui/view/overlays/help.js'
import { emptyMetrics } from '../../src/tui/data/viewModel.js'
import type { TranscriptItem } from '../../src/tui/data/viewModel.js'
import type { TerminalSession } from '../../src/tui/data/remote.js'

const NO_HINT = { keys: 'Ctrl-G', text: 'show or hide the Session rail' }

test('StatusBar never carries the version', () => {
  const bar = new StatusBar(() => ({
    model: { provider: 'deepseek', model: 'chat' },
    metrics: { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, decodeMs: 0 },
    disconnected: false,
  }), false, () => NO_HINT)
  const line = bar.render(80)[0] ?? ''
  expect(line).not.toContain('hulala v')
  expect(line.trimEnd().endsWith('deepseek/chat')).toBe(true)
  expect(visibleWidth(line)).toBe(80)
})

test('StatusBar names the thinking level next to the model', () => {
  const bar = new StatusBar(() => ({
    model: { provider: 'deepseek-official', model: 'deepseek-flash' },
    thinkingLevel: 'max',
    metrics: emptyMetrics(),
    disconnected: false,
  }), false, () => NO_HINT)
  const line = bar.render(100)[0] ?? ''
  expect(line.trimEnd().endsWith('deepseek-official/deepseek-flash • max')).toBe(true)
  expect(visibleWidth(line)).toBe(100)
})

test('StatusBar keeps the level visible when the row is too narrow for it', () => {
  const bar = new StatusBar(() => ({
    model: { provider: 'deepseek-official', model: 'deepseek-flash' },
    thinkingLevel: 'high',
    metrics: { inputTokens: 100, cacheReadTokens: 300, outputTokens: 80, decodeMs: 1000 },
    disconnected: false,
  }), false, () => NO_HINT)
  const line = bar.render(24)[0] ?? ''
  // The right slot keeps its tail, so the level survives the clipping…
  expect(line.trimEnd().endsWith('• high')).toBe(true)
  expect(line).toContain('…')
  // …and neither the reading nor the model runs past the band.
  expect(visibleWidth(line)).toBe(24)
})

test('StatusBar centres the readings between the hint and the model', () => {
  const bar = new StatusBar(() => ({
    model: { provider: 'deepseek', model: 'chat' },
    metrics: { inputTokens: 100, cacheReadTokens: 300, outputTokens: 80, decodeMs: 1000 },
    disconnected: false,
  }), false, () => NO_HINT)
  const line = bar.render(100)[0] ?? ''
  const at = line.indexOf('80 tok/s')
  expect(at).toBeGreaterThan(20)
  // The band is one row across the frame: the reading sits mid-terminal, not
  // under a column and not at the left edge.
  expect(Math.abs(at + '80 tok/s · 480 tok'.length / 2 - 50)).toBeLessThan(4)
  expect(line).not.toContain('~/')
  expect(line.trimEnd().endsWith('deepseek/chat')).toBe(true)
  expect(visibleWidth(line)).toBe(100)
})

test('StatusBar puts the rotating hint in the left slot', () => {
  const bar = new StatusBar(() => ({
    metrics: emptyMetrics(),
    disconnected: false,
  }), false, () => NO_HINT)
  const line = bar.render(100)[0] ?? ''
  expect(line.startsWith(' Ctrl-G — show or hide the Session rail')).toBe(true)
})

test('StatusBar paints the whole row as one band', () => {
  const bar = new StatusBar(() => ({
    model: { provider: 'deepseek', model: 'chat' },
    metrics: emptyMetrics(),
    disconnected: false,
  }), true)
  const line = bar.render(60)[0] ?? ''
  // A background of its own is the whole point: the footer needs no rule.
  expect(line).toContain('\u001b[48;')
  expect(line).toContain('\u001b[38;')
  expect(visibleWidth(line)).toBe(60)
  expect(line).toContain('deepseek/chat')
})

test('StatusBar keeps the update hint after a reading arrives', () => {
  const bar = new StatusBar(() => ({
    model: { provider: 'deepseek', model: 'chat' },
    metrics: { inputTokens: 100, cacheReadTokens: 300, outputTokens: 80, decodeMs: 1000 },
    disconnected: false,
    update: '0.1.9',
  }), false)
  const line = bar.render(80)[0] ?? ''
  expect(line).toContain('update 0.1.9')
  expect(line.trimEnd().endsWith('deepseek/chat')).toBe(true)
  expect(visibleWidth(line)).toBe(80)
})

test('StatusBar shows the context percentage over the window', () => {
  const bar = new StatusBar(() => ({
    metrics: { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, decodeMs: 0, contextTokens: 142_000, contextLimit: 1_000_000 },
    disconnected: false,
  }), false)
  const line = bar.render(80)[0] ?? ''
  expect(line).toContain('14.2%/1.0M')
  // Centred: the reading starts left of the middle and crosses it.
  const at = line.indexOf('14.2%/1.0M')
  expect(at).toBeLessThan(40)
  expect(at + '14.2%/1.0M'.length).toBeGreaterThan(40)
})

test('StatusBar shows disconnected state on the left', () => {
  const bar = new StatusBar(() => ({ metrics: emptyMetrics(), disconnected: true }), false)
  const line = bar.render(80)[0] ?? ''
  expect(line).toContain('disconnected')
  expect(line).not.toContain('hulala v')
})

test('HelpOverlay keeps its close hint inside the terminal height', () => {
  const help = (rows: number): string[] => new HelpOverlay({
    color: false,
    rows: () => rows,
    onClose: () => undefined,
  }).render(74)
  const tall = help(40).join('\n')
  expect(tall).toContain('/thinking [level]')
  expect(tall).toContain('Click the ▸')
  const short = help(24)
  // pi-tui clamps a modal to the terminal height and drops its last lines, so
  // the panel gives up trailing detail rows instead of its close hint.
  expect(short.slice(0, 24).join('\n')).toContain('any key closes')
  expect(short.join('\n')).not.toContain('Click the ▸')
})

test('CwdBar renders just the working directory (no hint)', () => {
  const bar = new CwdBar(() => ({ cwd: '/work/hulala', hidden: false }), false)
  const line = bar.render(80)[0] ?? ''
  expect(line.startsWith('/work/hulala')).toBe(true)
  expect(line).not.toContain('Ctrl-C')
})

test('CwdBar shortens a long cwd', () => {
  const bar = new CwdBar(() => ({ cwd: '/a/very/deep/directory/tree/that/is/extremely/long/hulala', hidden: false }), false)
  const line = bar.render(40)[0] ?? ''
  expect(visibleWidth(line)).toBe(40)
  expect(line.startsWith('…')).toBe(true) // cwd truncated from the left
})

test('CwdBar takes no row while the completion menu is open', () => {
  const bar = new CwdBar(() => ({ cwd: '/work/hulala', hidden: true }), false)
  expect(bar.render(80)).toEqual([])
})

test('Transcript renders user, assistant markdown, and error items', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work' }))
  transcript.setItems([
    { kind: 'user', text: 'hello', time: 0 },
    { kind: 'assistant', text: '**bold** world', streaming: false, time: 0 },
    { kind: 'error', message: 'boom', time: 0 },
  ])
  const lines = transcript.render(40)
  expect(lines.some(line => line.includes('❯ hello'))).toBe(true)
  expect(lines.some(line => line.includes('bold'))).toBe(true)
  expect(lines.some(line => line.includes('! boom'))).toBe(true)
})

test('a streaming assistant item rewrites its markdown as it grows and settles', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work' }))
  const item: TranscriptItem = { kind: 'assistant', text: '你', streaming: true, time: 0 }
  transcript.setItems([item])
  expect(transcript.render(60)[0]).toContain('你▌')

  // Deltas mutate the same item object; the cached Markdown has to follow it.
  item.text = '你问的应该是 Ghostty 的标签页切换。'
  expect(transcript.render(60)[0]).toContain('你问的应该是 Ghostty 的标签页切换。▌')

  // The durable message settles the same item with the complete answer.
  item.text = '你问的应该是 **Ghostty**（终端模拟器）的标签页切换。'
  item.streaming = false
  const settled = transcript.render(60).join('\n')
  expect(settled).toContain('Ghostty')
  expect(settled).not.toContain('▌')
})

test('ResumeOverlay marks running sessions and hides blank sessions on empty query', () => {
  const sessions: TerminalSession[] = [
    { sessionId: 'aaaaaaaa-1111', updatedAt: 200, running: true, blank: false, cwd: '/work' },
    { sessionId: 'dddddddd-4444', updatedAt: 50, running: false, blank: true, cwd: '/work' },
  ]
  const overlay = new ResumeOverlay({
    sessions,
    cwd: '/work',
    color: false,
    onSearch: async () => ({ items: [], hasMore: false }),
    onResolve: () => undefined,
  })
  const lines = overlay.render(80)
  expect(lines.some(line => line.includes('● running'))).toBe(true)
  expect(lines.some(line => line.includes('dddddddd…4444'))).toBe(false)
})

test('a tool call folds to one line with its title and summary', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([
    {
      kind: 'tool',
      name: 'bash',
      args: JSON.stringify({ command: 'ls -la && cat package.json', description: 'List working directory contents' }),
      result: 'total 1328\ndrwxr-xr-x@ 23 colin staff\n[exit code: 0]',
      status: 'ok',
      time: 0,
      durationMs: 120,
    },
  ])
  const lines = transcript.render(120)
  expect(lines).toHaveLength(1)
  expect(lines[0]).toBe('  >_ Bash · List working directory contents')
  expect(lines[0]).not.toContain('{')
  expect(lines[0]).not.toContain('total 1328')
})

test('expanding a tool call shows the command, the output, and the hidden count', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  const output = Array.from({ length: 26 }, (_, index) => `line ${index + 1}`).join('\n')
  transcript.setItems([
    {
      kind: 'tool',
      name: 'bash',
      args: JSON.stringify({ command: 'ls -la', description: 'List files' }),
      result: `${output}\n[exit code: 0]`,
      status: 'ok',
      time: 0,
      durationMs: 120,
    },
  ])
  transcript.toggleExpandAll()
  const lines = transcript.render(80)
  expect(lines[0]).toBe('▾ >_ Bash · List files  0.1s')
  expect(lines[1]).toBe('  ❯ ls -la')
  expect(lines[2]).toBe('    line 1')
  expect(lines.at(-1)).toBe('    … +6 lines')
})

test('a failed call keeps its summary and shows the exit capsule', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([
    {
      kind: 'tool',
      name: 'bash',
      args: JSON.stringify({ command: 'npm test', description: 'Run tests' }),
      result: '1 failing\n[exit code: 2]',
      status: 'error',
      time: 0,
    },
  ])
  expect(transcript.render(80)[0]).toBe('  >_ Bash · Run tests  exit 2')
})

test('a stopped call reads as stopped', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([
    { kind: 'tool', name: 'edit', args: JSON.stringify({ file_path: '/work/hulala/a.ts' }), result: '', status: 'stopped', time: 0 },
  ])
  expect(transcript.render(80)[0]).toBe('  ✎  Edit · Stopped')
})

test('reasoning folds to its latest complete paragraph while streaming', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([
    { kind: 'reasoning', text: 'First thought here\nwrapped\n\nSecond thought\nstill typing', streaming: true, time: 0 },
  ])
  expect(transcript.render(120)[0]).toBe('  ✳  Think · Second thought')
})

test('reasoning cycles summary, full text, and hidden', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([{ kind: 'reasoning', text: 'Check the repo\nSecond line', streaming: false, time: 0 }])
  expect(transcript.reasoning).toBe('summary')
  expect(transcript.render(120)[0]).toBe('  ✳  Think · Check the repo')
  expect(transcript.cycleReasoning()).toBe('full')
  expect(transcript.render(120).join('\n')).toContain('Second line')
  expect(transcript.cycleReasoning()).toBe('hidden')
  expect(transcript.render(120)).toEqual([])
})

test('reasoning hides itself when it only carries a provider signature', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([{ kind: 'reasoning', text: '<signature>b64payload</signature>\n\nreal thought', streaming: false, time: 0 }])
  expect(transcript.render(120)[0]).toBe('  ✳  Think · real thought')
})

test('the running indicator counts the elapsed turn', () => {
  const row = new RunningRow(() => ({ startedAt: Date.now() - 12_000, now: Date.now() }), false)
  expect(row.render(80)[0]).toBe('  ✷  Deep diving for 12s ···')
  expect(new RunningRow(() => ({}), false).render(80)[0]).toBe('  ✷  Deep diving ···')
  expect(formatRunDuration(80_000)).toBe('1m 20s')
  expect(formatRunDuration(3_930_000)).toBe('1h 5m')
})

test('the transcript appends the running indicator after the last item', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([{ kind: 'user', text: 'hello', time: 0 }])
  transcript.setRunning(Date.now() - 3_000)
  const lines = transcript.render(80)
  expect(lines.at(-1)?.startsWith('  ✷  Deep diving for 3s')).toBe(true)
  transcript.setRunning(undefined)
  expect(transcript.render(80).at(-1)).not.toContain('Deep diving')
})

test('an expanded call leaves no blank line behind the exit marker', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([
    {
      kind: 'tool',
      name: 'bash',
      args: JSON.stringify({ command: 'pwd', description: 'Show the directory' }),
      result: '/work/hulala\n[exit code: 0]',
      status: 'ok',
      time: 0,
    },
  ])
  transcript.toggleExpandAll()
  expect(transcript.render(80)).toEqual(['▾ >_ Bash · Show the directory', '  ❯ pwd', '    /work/hulala'])
})

function clickEvent(y: number, type: 'press' | 'click' = 'click'): Parameters<Transcript['handleMouse']>[0] {
  return {
    type,
    button: 'left',
    x: 4,
    y,
    screenX: 4,
    screenY: y,
    width: 80,
    height: 1,
    shift: false,
    alt: false,
    ctrl: false,
  }
}

test('a click on a row header folds and unfolds that row alone', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([
    { kind: 'tool', name: 'bash', args: JSON.stringify({ command: 'pwd', description: 'Show the directory' }), result: '/work/hulala', status: 'ok', time: 0 },
    { kind: 'tool', name: 'read', args: JSON.stringify({ file_path: '/work/hulala/a.ts' }), result: 'code', status: 'ok', time: 0 },
  ])
  expect(transcript.render(80)).toHaveLength(2)

  // The alternate screen only emits `click` for a component that took `press`.
  expect(transcript.handleMouse(clickEvent(0, 'press'))).toEqual({ handled: true })
  expect(transcript.handleMouse(clickEvent(0))).toEqual({ handled: true, render: true })
  const opened = transcript.render(80)
  expect(opened[0]).toBe('▾ >_ Bash · Show the directory')
  expect(opened).toHaveLength(4) // header + command line + output, then the read row
  expect(opened.at(-1)).toBe('  ▤  Read · a.ts')

  transcript.handleMouse(clickEvent(0))
  expect(transcript.render(80)[0]).toBe('  >_ Bash · Show the directory')
})

test('the row body is not a click target, so its text stays selectable', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([
    { kind: 'tool', name: 'bash', args: JSON.stringify({ command: 'pwd', description: 'Show the directory' }), result: '/work/hulala', status: 'ok', time: 0 },
  ])
  transcript.toggleExpandAll()
  expect(transcript.render(80)).toHaveLength(3)
  expect(transcript.handleMouse(clickEvent(1, 'press'))).toBeUndefined()
  expect(transcript.handleMouse(clickEvent(1))).toBeUndefined()
  expect(transcript.handleMouse(clickEvent(2))).toBeUndefined()
})

test('a click unfolds reasoning past its summary line', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([{ kind: 'reasoning', text: 'First thought\nSecond line', streaming: false, time: 0 }])
  expect(transcript.render(80)).toEqual(['  ✳  Think · First thought'])
  transcript.handleMouse(clickEvent(0, 'press'))
  transcript.handleMouse(clickEvent(0))
  const opened = transcript.render(80)
  expect(opened[0]).toBe('▾ ✳  Think · First thought')
  expect(opened.join('\n')).toContain('Second line')
})

test('rows that fold nothing ignore the pointer', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([
    { kind: 'user', text: 'hello', time: 0 },
    { kind: 'assistant', text: 'hi', streaming: false, time: 0 },
  ])
  const lines = transcript.render(80)
  for (let y = 0; y < lines.length; y += 1) {
    expect(transcript.handleMouse(clickEvent(y, 'press'))).toBeUndefined()
    expect(transcript.handleMouse(clickEvent(y))).toBeUndefined()
  }
})

test('hover marks the row the pointer is on without moving the text', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([
    { kind: 'tool', name: 'bash', args: JSON.stringify({ command: 'pwd', description: 'Show the directory' }), result: '/work/hulala', status: 'ok', time: 0 },
    { kind: 'tool', name: 'read', args: JSON.stringify({ file_path: '/work/hulala/a.ts' }), result: 'x', status: 'ok', time: 0 },
  ])
  const flat = transcript.render(80)
  expect(transcript.handleMouse({ ...clickEvent(0, 'press'), type: 'move', button: 'none' }))
    .toEqual({ handled: true, render: true })
  const hovered = transcript.render(80)
  expect(hovered[0]).toBe('▸ >_ Bash · Show the directory')
  expect(hovered[1]).toBe(flat[1])
  expect(transcript.handleMouse({ ...clickEvent(0, 'press'), type: 'move', button: 'none' })).toBeUndefined()
  expect(transcript.handleMouse({ ...clickEvent(1, 'press'), type: 'move', button: 'none' }))
    .toEqual({ handled: true, render: true })
  expect(transcript.render(80)[0]).toBe('  >_ Bash · Show the directory')
})

test('Ctrl-O still flips every row and a click flips one back', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([
    { kind: 'tool', name: 'bash', args: JSON.stringify({ command: 'pwd', description: 'Show the directory' }), result: '/work/hulala', status: 'ok', time: 0 },
    { kind: 'tool', name: 'read', args: JSON.stringify({ file_path: '/work/hulala/a.ts' }), result: 'x', status: 'ok', time: 0 },
  ])
  transcript.toggleExpandAll()
  expect(transcript.render(80)[0]).toBe('▾ >_ Bash · Show the directory')
  transcript.handleMouse(clickEvent(0, 'press'))
  transcript.handleMouse(clickEvent(0))
  const lines = transcript.render(80)
  expect(lines[0]).toBe('  >_ Bash · Show the directory')
  expect(lines[1]).toBe('▾ ▤  Read · a.ts')
})

test('every step row starts its title in the same column', () => {
  const transcript = new Transcript(false, () => ({ cwd: '/work/hulala' }))
  transcript.setItems([
    { kind: 'reasoning', text: 'A thought', streaming: false, time: 0 },
    { kind: 'tool', name: 'bash', args: JSON.stringify({ command: 'ls', description: 'List files' }), result: 'ok', status: 'ok', time: 0 },
    { kind: 'tool', name: 'read', args: JSON.stringify({ file_path: '/work/hulala/a.ts' }), result: 'x', status: 'ok', time: 0 },
    { kind: 'tool', name: 'grep', args: JSON.stringify({ queries: ['x'] }), result: 'y', status: 'ok', time: 0 },
    { kind: 'tool', name: 'run_code', args: JSON.stringify({ description: 'Probe' }), result: 'z', status: 'ok', time: 0 },
    { kind: 'tool', name: 'hook_xyz', args: JSON.stringify({ target: 'build' }), result: 'w', status: 'ok', time: 0 },
  ])
  const lines = transcript.render(120)
  const titles = ['Think', 'Bash', 'Read', 'Grep', 'Code', 'Tool call']
  const columns = new Set(lines.map((line, index) => line.indexOf(titles[index] ?? '')))
  expect([...columns]).toEqual([5])
  expect(lines[0]).toBe('  ✳  Think · A thought')
  expect(lines[1]).toBe('  >_ Bash · List files')

  // The live turn clock is a step row too, so its label lands in that column.
  transcript.setRunning(Date.now() - 4_000)
  expect(transcript.render(120).at(-1)?.indexOf('Deep diving')).toBe(5)
})

test('an unfocused cursor is a ghost of the background, not a half-visible block', () => {
  // Dark background, light foreground: the unfocused block must sit much closer
  // to the background than to the foreground, or it reads as a live cursor.
  const sgr = faintCursorSgr(true, '#1e1e1e', '#d8d8d8')
  const match = /\u001b\[48;2;(\d+);(\d+);(\d+)m/u.exec(sgr)
  expect(match).not.toBeNull()
  const [r, g, b] = [Number(match?.[1]), Number(match?.[2]), Number(match?.[3])]
  const bg = 0x1e
  const fg = 0xd8
  const midpoint = (bg + fg) / 2
  expect(r).toBeLessThan(midpoint) // significantly darker than the 50% blend
  expect(r).toBeGreaterThan(bg) // still above the background, so it is findable
  expect(Math.abs(r - bg)).toBeLessThan(Math.abs(fg - r))
  expect([g, b]).toEqual([r, r])
  expect(faintCursorSgr(false, '#1e1e1e', '#d8d8d8')).toBe('')
})
