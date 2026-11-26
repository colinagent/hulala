import { expect, test } from 'bun:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import { ApprovalOverlay, type ApprovalDecision } from '../../src/tui/view/overlays/approval.js'

const strip = (lines: readonly string[]): string[] => lines.map(line => line
  .replace(/\u001b\[[0-9;]*m/gu, '')
  .replace(/\u001b_pi:[^\u0007]*\u0007/gu, ''))

/** The Host's reason, as DSH writes it when a tool asks to leave the sandbox. */
const reason = 'escalate sandbox to danger-full-access: 部署需要写 /app/trader、/app/gateway 和 /etc/nginx 下面的文件'

function overlay(options: { reason?: string; rows?: number } = {}, decisions: ApprovalDecision[] = []): ApprovalOverlay {
  return new ApprovalOverlay({
    toolName: 'bash',
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    color: false,
    ...(options.rows === undefined ? {} : { rows: options.rows }),
    onDecide: (decision) => decisions.push(decision),
  })
}

function text(view: ApprovalOverlay, width = 72): string {
  return strip(view.render(width)).join('\n')
}

test('a long approval reason wraps instead of losing its tail', () => {
  const view = overlay({ reason })
  const frame = text(view)
  expect(frame).toContain('部署需要写 /app/trader、')
  expect(frame).toContain('/app/gateway 和 /etc/nginx 下面的文件')
  for (const line of strip(view.render(72))) expect(visibleWidth(line)).toBe(72)
})

test('a narrow window keeps the reason and every key', () => {
  const frame = text(overlay({ reason }), 40)
  expect(frame).toContain('下面的文件')
  expect(frame).toContain('[y] allow once')
  expect(frame).toContain('[Ctrl-C] cancel')
})

test('a reason too long for the terminal stops at its height and says so', () => {
  const frame = text(overlay({ reason: `${reason}。${reason}`, rows: 8 }), 72)
  const lines = frame.split('\n')
  expect(lines.length).toBeLessThanOrEqual(8)
  expect(frame).toContain('…')
  expect(frame).toContain('[y] allow once')
})

test('each key answers with the decision it names', () => {
  const decide = (input: string): ApprovalDecision[] => {
    const decisions: ApprovalDecision[] = []
    overlay({}, decisions).handleInput(input)
    return decisions
  }
  expect(decide('y')).toEqual(['allowed-once'])
  expect(decide('f')).toEqual(['full-access'])
  expect(decide('n')).toEqual(['rejected'])
  expect(decide('d')).toEqual(['delegate'])
})
