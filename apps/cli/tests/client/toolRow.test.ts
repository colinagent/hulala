import { expect, test } from 'bun:test'
import { parseExitStatus, toolRow } from '../../src/tui/data/toolRow.js'

const CWD = '/work/hulala'
const HOME = '/Users/colin'

test('bash rows summarize the description, not the command', () => {
  const row = toolRow({
    name: 'bash',
    args: JSON.stringify({ command: 'ls -la && cat package.json', description: 'List working directory contents' }),
    result: 'README.md\n[exit code: 0]',
    cwd: CWD,
  })
  expect(row).toMatchObject({
    variant: 'bash',
    title: 'Bash',
    summary: 'List working directory contents',
    command: 'ls -la && cat package.json',
    state: 'ok',
    output: 'README.md',
    exit: undefined,
  })
})

test('bash rows fall back to the command when no description is present', () => {
  const row = toolRow({ name: 'bash', args: JSON.stringify({ command: 'pwd' }), cwd: CWD })
  expect(row.summary).toBe('pwd')
})

test('a failing exit status makes the row an error and keeps the description', () => {
  const row = toolRow({
    name: 'bash',
    args: JSON.stringify({ command: 'npm test', description: 'Run the test suite' }),
    result: '1 failing\n[exit code: 2]',
    cwd: CWD,
  })
  expect(row.state).toBe('error')
  expect(row.summary).toBe('Run the test suite')
  expect(row.exit).toEqual({ code: 2 })
  expect(row.output).toBe('1 failing')
})

test('a signalled command reports the signal', () => {
  const row = toolRow({ name: 'bash', args: JSON.stringify({ command: 'sleep 60' }), result: 'partial\n[killed by signal: SIGTERM]' })
  expect(row.exit).toEqual({ signal: 'SIGTERM' })
  expect(row.state).toBe('error')
})

test('file rows show a cwd-relative path and hide their arguments', () => {
  const row = toolRow({
    name: 'read',
    args: JSON.stringify({ file_path: '/work/hulala/trader/README.md' }),
    result: '# Trader',
    cwd: CWD,
  })
  expect(row).toMatchObject({
    variant: 'read',
    title: 'Read',
    summary: 'trader/README.md',
    filePath: 'trader/README.md',
    state: 'ok',
    body: undefined,
  })
})

test('file rows outside the workspace stay absolute and home paths abbreviate', () => {
  expect(toolRow({ name: 'read', args: JSON.stringify({ file_path: '/etc/hosts' }), cwd: CWD, home: HOME }).summary)
    .toBe('/etc/hosts')
  expect(toolRow({ name: 'read', args: JSON.stringify({ file_path: `${HOME}/notes/todo.md` }), cwd: '/elsewhere', home: HOME }).summary)
    .toBe('~/notes/todo.md')
})

test('edit rows name the file they change', () => {
  const row = toolRow({ name: 'edit', args: JSON.stringify({ file_path: '/work/hulala/src/bot.py' }), result: 'ok', cwd: CWD })
  expect(row).toMatchObject({ variant: 'edit', title: 'Edit', summary: 'src/bot.py', body: undefined })
})

test('search rows join the queries', () => {
  const row = toolRow({ name: 'grep', args: JSON.stringify({ queries: ['submit_order', 'cancel_order'] }), result: '3 matches' })
  expect(row).toMatchObject({ variant: 'search', title: 'Grep', summary: 'submit_order, cancel_order' })
})

test('a tool-owned title refines the family without changing the variant', () => {
  const row = toolRow({ name: 'web_fetch', args: JSON.stringify({ url: 'https://example.com/doc' }), result: 'body' })
  expect(row).toMatchObject({ variant: 'read', title: 'Fetch', summary: 'https://example.com/doc' })
  expect(toolRow({ name: 'todo_write', args: JSON.stringify({ todos: [] }), result: 'ok' }).title).toBe('Update to-do list')
})

test('an unknown tool leads its summary with the wire name', () => {
  const row = toolRow({ name: 'hook_xyz', args: JSON.stringify({ target: 'build' }), result: 'ok' })
  expect(row).toMatchObject({ variant: 'others', title: 'Tool call', summary: 'hook_xyz · build' })
})

test('unparsable arguments degrade to their first line', () => {
  const row = toolRow({ name: 'bash', args: '{"command": "ls', result: '', cwd: CWD })
  expect(row.summary).toBe('{"command": "ls')
  expect(row.body).toBe('{"command": "ls')
})

test('an error result replaces the summary with its first line', () => {
  const row = toolRow({
    name: 'read',
    args: JSON.stringify({ file_path: '/work/hulala/missing.md' }),
    result: 'ENOENT: no such file or directory\n  at read',
    isError: true,
    cwd: CWD,
  })
  expect(row.state).toBe('error')
  expect(row.summary).toBe('ENOENT: no such file or directory')
  expect(row.filePath).toBe('missing.md')
})

test('an interrupted call and a stopped payload both read as stopped', () => {
  expect(toolRow({ name: 'bash', args: '{"command":"sleep 9"}', result: '', errorCode: 'interrupted' }))
    .toMatchObject({ state: 'stopped', summary: 'Stopped' })
  expect(toolRow({ name: 'edit', args: '{"file_path":"/work/hulala/a.ts"}', result: 'partial', meta: { stopped: true }, cwd: CWD }))
    .toMatchObject({ state: 'stopped', summary: 'Stopped' })
})

test('a call without a result is still running', () => {
  expect(toolRow({ name: 'bash', args: '{"command":"sleep 3","description":"Wait"}' }))
    .toMatchObject({ state: 'running', summary: 'Wait', output: undefined })
})

test('run_code shows the program as its body', () => {
  const row = toolRow({ name: 'run_code', args: JSON.stringify({ code: 'console.log(1)', description: 'Probe' }), result: '1' })
  expect(row).toMatchObject({ variant: 'code', title: 'Code', summary: 'Probe', body: 'console.log(1)' })
})

test('parseExitStatus reads both markers and defaults to success', () => {
  expect(parseExitStatus('out\n[exit code: 0]')).toEqual({ body: 'out', code: 0 })
  expect(parseExitStatus('out\n[exit code: 127]')).toEqual({ body: 'out', code: 127 })
  expect(parseExitStatus('out\n[killed by signal: SIGKILL]')).toEqual({ body: 'out', signal: 'SIGKILL' })
  expect(parseExitStatus('out')).toEqual({ body: 'out', code: 0 })
})

test('tools whose payload is a list still say something readable', () => {
  expect(toolRow({
    name: 'todo_write',
    args: JSON.stringify({ todos: [{ content: 'Ship the transcript rows', status: 'in_progress' }] }),
    result: 'ok',
  }).summary).toBe('Ship the transcript rows')
  expect(toolRow({
    name: 'ask_user_question',
    args: JSON.stringify({ questions: [{ id: 'q1', question: 'Which branch?' }] }),
    result: 'answered',
  }).summary).toBe('Which branch?')
})

test('a settled edit carries its applied change as diff rows', () => {
  const path = '/work/hulala/src/app.ts'
  const row = toolRow({
    name: 'edit',
    args: JSON.stringify({ file_path: path, old_string: 'b', new_string: 'B' }),
    result: 'Edited src/app.ts',
    meta: { path, diffs: [{ path, oldText: 'a\nb\nc', newText: 'a\nB\nc' }] },
    cwd: CWD,
  })
  expect(row.diff?.stats).toEqual({ added: 1, removed: 1 })
  expect(row.diff?.rows.filter(entry => entry.kind === 'context').map(entry => entry.text)).toEqual(['a', 'c'])
  expect(row.diff?.rows).toContainEqual({ kind: 'del', text: 'b' })
  expect(row.diff?.rows).toContainEqual({ kind: 'add', text: 'B' })
})

test('a running edit previews the change its arguments already describe', () => {
  const row = toolRow({
    name: 'edit',
    args: JSON.stringify({ file_path: '/work/hulala/a.ts', old_string: 'one', new_string: 'two' }),
    cwd: CWD,
  })
  expect(row.state).toBe('running')
  expect(row.diff?.stats).toEqual({ added: 1, removed: 1 })
})

test('a write waits for its result: only then does the applied change exist', () => {
  const path = '/work/hulala/new.ts'
  const running = toolRow({ name: 'write', args: JSON.stringify({ file_path: path, content: 'a\nb' }), cwd: CWD })
  expect(running.diff).toBeUndefined()

  const settled = toolRow({
    name: 'write',
    args: JSON.stringify({ file_path: path, content: 'a\nb' }),
    result: 'Wrote new.ts',
    meta: { operation: 'create', diffs: [{ path, oldText: null, newText: 'a\nb' }] },
    cwd: CWD,
  })
  expect(settled.diff?.stats).toEqual({ added: 2, removed: 0 })
})

test('apply_patch draws one header per changed file', () => {
  const row = toolRow({
    name: 'apply_patch',
    args: JSON.stringify({ patch: '*** Begin Patch' }),
    result: 'patched',
    meta: {
      stopped: false,
      diffs: [
        { path: '/work/hulala/a.ts', oldText: null, newText: 'a' },
        { path: '/work/hulala/b.ts', oldText: 'b', newText: 'B' },
      ],
    },
    cwd: CWD,
  })
  // Each header is shown the way the row's own path is: relative to the root.
  expect(row.diff?.rows.filter(entry => entry.kind === 'path').map(entry => entry.text))
    .toEqual(['a.ts', 'b.ts'])
  expect(row.diff?.stats).toEqual({ added: 2, removed: 1 })
})

test('a read result loses its envelope and names the window it asked for', () => {
  const row = toolRow({
    name: 'read',
    args: JSON.stringify({ file_path: '/work/hulala/a.ts', offset: 10, limit: 5 }),
    result: '<path>a.ts</path>\n<type>file</type>\n<content>\nconst x = 1\n</content>',
    cwd: CWD,
  })
  expect(row.output).toBe('const x = 1')
  expect(row.summary).toBe('a.ts (10-14)')
  expect(toolRow({
    name: 'read',
    args: JSON.stringify({ file_path: '/work/hulala/a.ts', offset: 10 }),
    result: 'body',
    cwd: CWD,
  }).summary).toBe('a.ts (from 10)')
})

test('an error result never turns into a diff', () => {
  const row = toolRow({
    name: 'edit',
    args: JSON.stringify({ file_path: '/work/hulala/a.ts', old_string: 'a', new_string: 'b' }),
    result: 'ENOENT: no such file',
    isError: true,
    meta: { path: '/work/hulala/a.ts' },
    cwd: CWD,
  })
  // A failed edit changed nothing, so it must not read as a patch.
  expect(row.diff).toBeUndefined()
  expect(row.summary).toBe('ENOENT: no such file')
})
