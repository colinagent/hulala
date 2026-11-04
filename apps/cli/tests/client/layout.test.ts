import { expect, test } from 'bun:test'
import type { Component, TUI } from '@earendil-works/pi-tui'
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js'
import { buildRailTerminalLayout, buildSideColumnsLayout, buildSplitTerminalLayout, buildTerminalLayout, railFits, railWidthFor } from '../../src/tui/view/layout.js'
import { PromptEditor } from '../../src/tui/view/promptEditor.js'
import { buildTheme } from '../../src/tui/view/theme.js'

const strip = (line: string): string => line
  .replace(/\u001b\[[0-9;]*m/gu, '')
  .replace(/\u001b\][^\u0007]*\u0007/gu, '')
  .replace(/\u001b_pi:[^\u0007]*\u0007/gu, '')

/** A component with a fixed intrinsic height, standing in for a chrome row. */
function slab(label: string, lines: number): Component {
  return {
    render: (width: number) => Array.from({ length: lines }, () => label.padEnd(width)),
    invalidate: () => undefined,
  }
}

function overflowingTranscript(lines: number): Component {
  return {
    render: (width: number) => Array.from({ length: lines }, (_, index) => `line ${index}`.padEnd(width)),
    invalidate: () => undefined,
  }
}

function editor(): PromptEditor {
  const tui = { terminal: { rows: 24, columns: 80 }, requestRender: () => undefined } as unknown as TUI
  return new PromptEditor(tui, buildTheme(false).editor, { color: false })
}

test('a long transcript never takes height away from the composer', () => {
  const layout = buildTerminalLayout({
    transcript: overflowingTranscript(500),
    pending: slab('pending', 1),
    cwdBar: slab('cwd', 1),
    editor: slab('composer', 3),
    statusBar: slab('status', 1),
  })
  const frame = renderLayoutFrame(layout.root, 60, 20, () => undefined)
  const [transcript, dock] = frame.root.children
  expect(frame.lines).toHaveLength(20)
  expect(transcript?.rect.height).toBe(14) // 20 - dock; the transcript reaches the top
  expect(dock?.rect.height).toBe(6) // pending + cwd + composer + band
  expect(dock?.children.map(child => child.rect.height)).toEqual([1, 1, 3, 1])
  expect(frame.lines.slice(-6)).toEqual([
    'pending'.padEnd(60),
    'cwd'.padEnd(60),
    'composer'.padEnd(60),
    'composer'.padEnd(60),
    'composer'.padEnd(60),
    'status'.padEnd(60),
  ])
})

test('the composer keeps both rules around the arrow when the transcript is long', () => {
  const layout = buildTerminalLayout({
    transcript: overflowingTranscript(500),
    pending: slab('pending', 1),
    cwdBar: slab('cwd', 1),
    editor: editor(),
    statusBar: slab('status', 1),
  })
  // Fill the terminal the way a few turns of a Session do.
  const frame = renderLayoutFrame(layout.root, 80, 30, () => undefined)
  const rows = frame.lines.map(strip)
  const composerRows = rows.slice(-4, -1)
  expect(composerRows).toHaveLength(3)
  // The rules stop at the body's gutter on both sides: they belong to the
  // composer, and a rule that reached the column edge would touch a divider.
  expect(composerRows[0]).toMatch(/^ {2}─+ {2}$/u)
  expect(composerRows[1]?.startsWith('❯ ')).toBe(true)
  expect(composerRows[2]).toMatch(/^ {2}─+ {2}$/u)
  expect(rows.at(-1)?.startsWith('status')).toBe(true)
})

test('the columns end on the last row above the status band', () => {
  const layout = buildRailTerminalLayout({
    transcript: overflowingTranscript(500),
    pending: slab('pending', 1),
    editor: editor(),
    statusBar: slab('status', 1),
    rail: slab('rail', 24),
    railWidth: 18,
    railDivider: slab('|', 24),
  })
  const frame = renderLayoutFrame(layout.root, 120, 24, () => undefined)
  const rows = frame.lines.map(strip)
  const [columns, status] = frame.root.children
  // The band is the only row the columns do not own.
  expect(columns?.rect.height).toBe(23)
  expect(status?.rect.height).toBe(1)
  expect(rows.at(-1)?.startsWith('status')).toBe(true)
  // There is no frame rule row: the only horizontal lines are the composer's,
  // and they are inset inside the conversation column.
  expect(rows.some(row => /^─+$/u.test(row))).toBe(false)
  expect(rows.at(-2)).toContain('  ─')
  expect(rows.at(-2)?.endsWith('  ')).toBe(true)
})

test('a short terminal drops chrome rows instead of clipping the composer', () => {
  const layout = buildTerminalLayout({
    transcript: overflowingTranscript(500),
    pending: slab('pending', 1),
    cwdBar: slab('cwd', 1),
    editor: slab('composer', 3),
    statusBar: slab('status', 1),
  })
  const frame = renderLayoutFrame(layout.root, 40, 5, () => undefined)
  const rows = frame.lines.map(strip)
  expect(frame.lines).toHaveLength(5)
  expect(rows.filter(row => row.startsWith('composer'))).toHaveLength(3)
  expect(rows[0]?.startsWith('line')).toBe(true) // nothing above the transcript
})

test('the editor column splits the width without touching the composer height', () => {
  const layout = buildSplitTerminalLayout({
    transcript: overflowingTranscript(500),
    pending: slab('pending', 1),
    cwdBar: slab('cwd', 1),
    editor: slab('composer', 3),
    statusBar: slab('status', 1),
    pane: slab('nvim', 100),
    paneWidth: 49,
    divider: slab('|', 100),
    onConversationPointer: () => undefined,
  })
  const frame = renderLayoutFrame(layout.root, 100, 24, () => undefined)
  const [columns, status] = frame.root.children
  expect(frame.lines).toHaveLength(24)
  expect(columns?.rect.height).toBe(23) // 24 - band; the editor reaches the top
  expect(status?.rect.height).toBe(1)
  // One blank column on each side of the divider, and the band spans both.
  const [conversation, , divider, , pane] = columns?.children ?? []
  expect(divider?.rect.width).toBe(1)
  expect(divider?.rect.x).toBe(50)
  expect(conversation?.rect.width).toBe(49)
  expect(pane?.rect.width).toBe(48)
  expect(pane?.rect.x).toBe(52) // a gap, the divider, a gap, then the pane
  expect(pane?.rect.height).toBe(23) // 24 - band
  // The composer keeps its three rows inside the narrower left column.
  const leftChildren = conversation?.children ?? []
  expect(leftChildren.map(child => child.rect.height)).toEqual([18, 1, 1, 3])
  const row = strip(frame.lines[5] ?? '')
  expect(row).toContain('line') // the transcript still paints the left column
  expect(row).toContain('nvim') // and the editor paints the right one
  expect(row).toContain('|') // with the drag divider between them
})

test('setPaneWidth moves the divider without rebuilding the transcript', () => {
  const layout = buildSplitTerminalLayout({
    transcript: overflowingTranscript(500),
    pending: slab('pending', 1),
    cwdBar: slab('cwd', 1),
    editor: slab('composer', 3),
    statusBar: slab('status', 1),
    pane: slab('nvim', 100),
    paneWidth: 49,
    divider: slab('|', 100),
    onConversationPointer: () => undefined,
  })
  const before = renderLayoutFrame(layout.root, 100, 24, () => undefined)
  const scrollBefore = before.root.children[0]?.children[0]?.children[0]?.component

  layout.setPaneWidth(60)
  const after = renderLayoutFrame(layout.root, 100, 24, () => undefined)
  const [conversation, , divider, , pane] = after.root.children[0]?.children ?? []
  expect(conversation?.rect.width).toBe(38)
  expect(divider?.rect.x).toBe(39)
  expect(pane?.rect.width).toBe(59)
  expect(pane?.rect.x).toBe(41)
  // The same ScrollView instance survives, so a drag never loses scroll state.
  expect(after.root.children[0]?.children[0]?.children[0]?.component).toBe(scrollBefore)
  expect(scrollBefore).toBe(layout.transcriptScroll)
})

test('the side columns fill the frame when the conversation is put away', () => {
  const rail = { component: slab('rail', 24), width: 18, divider: slab('|', 24) }
  const pane = { component: slab('nvim', 24), width: 40, divider: slab('|', 24) }
  const frame = renderLayoutFrame(buildSideColumnsLayout({
    rail,
    pane,
    statusBar: slab('status', 1),
  }).root, 100, 24, () => undefined)
  const [columns, status] = frame.root.children
  expect(status?.rect.height).toBe(1)
  // The pane keeps its width and the rail absorbs the rest of the frame.
  const [railBox, , divider, , paneBox] = columns?.children ?? []
  expect(railBox?.rect).toMatchObject({ x: 0, width: 58 })
  expect(divider?.rect).toMatchObject({ x: 59, width: 1 })
  expect(paneBox?.rect).toMatchObject({ x: 61, width: 39 })
  expect(frame.lines[3]).toContain('rail')
  expect(frame.lines[3]).toContain('nvim')
  // With the conversation put away the footer spans the frame: there is no
  // conversation edge for the readings to line up with.
  expect(frame.lines.at(-1)).toStartWith('status')
})

test('a lone side column owns the whole frame', () => {
  const railOnly = buildSideColumnsLayout({ rail: { component: slab('rail', 24), width: 18, divider: slab('|', 24) }, statusBar: slab('status', 1) })
  const railFrame = renderLayoutFrame(railOnly.root, 80, 24, () => undefined)
  expect(railFrame.root.children[0]?.children).toHaveLength(1)
  expect(railFrame.root.children[0]?.children?.[0]?.rect.width).toBe(80)

  const paneOnly = buildSideColumnsLayout({ pane: { component: slab('nvim', 24), width: 40, divider: slab('|', 24) }, statusBar: slab('status', 1) })
  const paneFrame = renderLayoutFrame(paneOnly.root, 80, 24, () => undefined)
  expect(paneFrame.root.children[0]?.children).toHaveLength(1)
  expect(paneFrame.root.children[0]?.children?.[0]?.rect.width).toBe(80)

  // Dragging is meaningless without a second column to trade width against.
  railOnly.setPaneWidth(20)
  const after = renderLayoutFrame(railOnly.root, 80, 24, () => undefined)
  expect(after.root.children[0]?.children?.[0]?.rect.width).toBe(80)
})

test('the side columns still resize the editor divider', () => {
  const layout = buildSideColumnsLayout({
    rail: { component: slab('rail', 24), width: 18, divider: slab('|', 24) },
    pane: { component: slab('nvim', 24), width: 40, divider: slab('|', 24) },
    statusBar: slab('status', 1),
  })
  layout.setPaneWidth(50)
  const frame = renderLayoutFrame(layout.root, 100, 24, () => undefined)
  const [railBox, , divider, , paneBox] = frame.root.children[0]?.children ?? []
  expect(railBox?.rect.width).toBe(47)
  expect(divider?.rect.x).toBe(48)
  expect(paneBox?.rect).toMatchObject({ x: 50, width: 50 })
})

test('the rail keeps a narrow share and yields to the editor on a narrow terminal', () => {
  expect(railWidthFor(80)).toBe(18)
  expect(railWidthFor(120)).toBe(18)
  expect(railWidthFor(160)).toBe(24)
  // Rail + conversation need 53 columns; adding the editor needs 86.
  expect(railFits(52, false)).toBe(false)
  expect(railFits(53, false)).toBe(true)
  expect(railFits(85, true)).toBe(false)
  expect(railFits(86, true)).toBe(true)
})

test('the rail, the conversation and the editor each get their columns', () => {
  const pane = {
    component: slab('nvim', 24),
    width: 32,
    divider: slab('|', 24),
    onConversationPointer: () => undefined,
  }
  const shared = {
    transcript: overflowingTranscript(100),
    pending: slab('pending', 1),
    cwdBar: slab('cwd', 1),
    editor: slab('composer', 3),
    statusBar: slab('status', 1),
    rail: slab('rail', 24),
    railWidth: 18,
    railDivider: slab('|', 24),
  }
  const withEditor = renderLayoutFrame(buildRailTerminalLayout({ ...shared, pane }).root, 120, 24, () => undefined)
  // rail | gap | divider | gap | conversation | gap | divider | gap | editor
  const [rail, , railDivider, , conversation, , divider, , editor] = withEditor.root.children[0]?.children ?? []
  expect(rail?.rect).toMatchObject({ x: 0, width: 18 })
  expect(railDivider?.rect).toMatchObject({ x: 19, width: 1 })
  expect(conversation?.rect.width).toBe(64)
  expect(divider?.rect.x).toBe(86)
  expect(editor?.rect).toMatchObject({ x: 88, width: 32 })
  // The band is one surface across the whole frame, from the first column to the
  // last, and it is one row tall.
  const footer = withEditor.root.children[1]
  expect(footer?.rect).toMatchObject({ x: 0, width: 120, y: 23, height: 1 })
  const statusLine = strip(withEditor.lines.at(-1) ?? '')
  expect(statusLine.trim()).toStartWith('status')

  // Without the editor the conversation takes everything the rail leaves.
  const alone = renderLayoutFrame(buildRailTerminalLayout(shared).root, 120, 24, () => undefined)
  expect(alone.root.children[0]?.children?.map(child => child.rect.width)).toEqual([18, 1, 1, 1, 99])
})

test('the rail layout still resizes the editor divider', () => {
  const shared = {
    transcript: overflowingTranscript(100),
    pending: slab('pending', 1),
    cwdBar: slab('cwd', 1),
    editor: slab('composer', 3),
    statusBar: slab('status', 1),
    rail: slab('rail', 24),
    railWidth: 18,
    railDivider: slab('|', 24),
  }
  const layout = buildRailTerminalLayout({
    ...shared,
    pane: { component: slab('nvim', 24), width: 32, divider: slab('|', 24), onConversationPointer: () => undefined },
  })
  layout.setPaneWidth(40)
  const frame = renderLayoutFrame(layout.root, 120, 24, () => undefined)
  const pane = frame.root.children[0]?.children?.at(-1)
  expect(pane?.rect).toMatchObject({ x: 81, width: 39 })
})

test('the rail carries the path instead of the row above the composer', () => {
  const shared = {
    transcript: overflowingTranscript(100),
    pending: slab('pending', 1),
    editor: slab('composer', 3),
    statusBar: slab('status', 1),
    rail: slab('rail', 24),
    railWidth: 18,
    railDivider: slab('|', 24),
  }
  const withBar = renderLayoutFrame(buildRailTerminalLayout({ ...shared, cwdBar: slab('cwd', 1) }).root, 120, 20, () => undefined)
  const withoutBar = renderLayoutFrame(buildRailTerminalLayout(shared).root, 120, 20, () => undefined)
  expect(withBar.lines.some(line => line.includes('cwd'))).toBe(true)
  expect(withoutBar.lines.some(line => line.includes('cwd'))).toBe(false)
  const conversation = (frame: typeof withBar) => frame.root.children[0]?.children?.[4]?.children ?? []
  // transcript, pending, (cwd), composer
  expect(conversation(withBar)).toHaveLength(4)
  expect(conversation(withoutBar)).toHaveLength(3)
  expect(conversation(withoutBar).at(-1)?.rect.height).toBe(3)
})
