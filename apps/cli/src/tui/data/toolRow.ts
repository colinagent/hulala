/**
 * Tool-call row model: name + arguments + result → the one line a transcript
 * draws.
 *
 * This mirrors the DeepSeek Harness web client's row derivation
 * (`packages/client/ui-tool/src/client/tool/models/tool-call-model.ts` at
 * 0.2.1-rc.2) so the same Session record reads the same in the terminal and in
 * the browser: the same variant classification, the same title, the same
 * argument key preference per variant, the same cwd-relative path and the same
 * lifecycle state. It is a reimplementation of those rules, not a copy of the
 * client bundle — that package is a browser plugin and cannot be imported here.
 *
 * Only the shell exit-status marker is parsed locally instead of reused from
 * `@deepseek-ai/dsh-shell`: that package's entry also carries the shell
 * executor and its subprocess dependencies, which the CLI bundle does not need
 * for twelve lines of regex.
 *
 * @module hulala-cli/tui/data/toolRow
 */
import { abbreviateHomePath, relativizeToCwd } from '@deepseek-ai/dsh-util-workspace-path'
import { type ToolStatus, stoppedByMeta } from './viewModel.js'

/** Row family selected by the tool name. */
export type ToolVariant = 'bash' | 'read' | 'write' | 'edit' | 'search' | 'code' | 'others'

/** One call as the reducer recorded it, plus the Session's display roots. */
export interface ToolRowInput {
  name: string
  /** Argument JSON exactly as the model produced it. */
  args: string
  /** Flattened result text; absent while the call is still running. */
  result?: string | undefined
  isError?: boolean | undefined
  errorCode?: string | undefined
  meta?: unknown
  /** Lifecycle state the reducer recorded; wins over the derived one. */
  status?: ToolStatus | undefined
  /** Session workspace root, used to relativize file paths. */
  cwd?: string | undefined
  /** Host account home, used to abbreviate a leftover `$HOME` prefix. */
  home?: string | undefined
}

/** Everything the transcript row needs, derived once per settled call. */
export interface ToolRow {
  variant: ToolVariant
  title: string
  /** Trailing one-line summary; empty when the arguments carry nothing useful. */
  summary: string
  /** cwd-relative file target of a file row, when the call names one. */
  filePath: string | undefined
  state: ToolStatus
  /** Shell command line of a terminal row, shown above its output. */
  command: string | undefined
  /** Expanded input body; absent for file rows and empty calls. */
  body: string | undefined
  /** Expanded output body; absent when the result carries no text. */
  output: string | undefined
  /** Shell exit status, shown as a capsule on a failed command. */
  exit: { code?: number; signal?: string } | undefined
}

/**
 * Known tool name → row family. `read_image` is a single-file read and
 * `web_fetch` lands on the read family, exactly as upstream.
 */
const VARIANTS: Readonly<Record<string, ToolVariant>> = {
  bash: 'bash',
  pwsh: 'bash',
  read: 'read',
  read_image: 'read',
  web_fetch: 'read',
  write: 'write',
  edit: 'edit',
  apply_patch: 'edit',
  grep: 'search',
  glob: 'search',
  web_search: 'search',
  run_code: 'code',
}

/** Family titles, used when the tool name has no owned title. */
const VARIANT_TITLES: Readonly<Record<ToolVariant, string>> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  search: 'Search',
  code: 'Code',
  others: 'Tool call',
}

/** Tool-owned titles that refine a family without replacing it. */
const TOOL_TITLES: Readonly<Record<string, string>> = {
  read_image: 'Read image',
  web_fetch: 'Fetch',
  web_search: 'Search',
  apply_patch: 'Apply patch',
  pwsh: 'Pwsh',
  grep: 'Grep',
  glob: 'Glob',
  todo_write: 'Update to-do list',
  ask_user_question: 'Ask question',
  job_list: 'List background jobs',
  job_output: 'Read job output',
  job_kill: 'Kill background job',
  run_code: 'Code',
}

/** Argument key preference per family; the first non-empty string wins. */
const SUMMARY_KEYS: Readonly<Record<ToolVariant, readonly string[]>> = {
  bash: ['description', 'command'],
  read: ['path', 'file_path', 'url'],
  search: ['query', 'pattern', 'url'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  code: ['description'],
  others: [],
}

/** Path keys only — never `url`, which is a fetched address rather than a file. */
const FILE_PATH_KEYS = ['path', 'file_path'] as const

/** Families whose summary is an openable workspace path. */
const FILE_VARIANTS: ReadonlySet<ToolVariant> = new Set(['read', 'write', 'edit'])

function parseArgs(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    // Mid-stream truncation or a rejected call keeps its verbatim text.
    return undefined
  }
}

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function pickString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

function summarize(variant: ToolVariant, args: Record<string, unknown> | undefined, raw: string): string {
  if (args === undefined) return firstLine(raw)
  if (variant === 'search') {
    const queries = args.queries
    if (Array.isArray(queries)) {
      const items = queries.filter((query): query is string => typeof query === 'string' && query !== '')
      if (items.length > 0) return items.map(firstLine).join(', ')
    }
  }
  const picked = pickString(args, SUMMARY_KEYS[variant])
  if (picked !== undefined) return firstLine(picked)
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value !== '') return firstLine(value)
  }
  // Tools that carry their payload in objects or arrays (todo lists, question
  // sets) have a dedicated card upstream; until this client has one, reach one
  // level in rather than printing the argument envelope at the reader.
  for (const value of Object.values(args)) {
    const nested = typeof value === 'string' ? value : nestedString(value)
    if (nested !== undefined) return firstLine(nested)
  }
  return firstLine(raw)
}

/** Payload keys that read as the sentence a row should lead with. */
const NESTED_TEXT_KEYS = ['content', 'question', 'text', 'label', 'title', 'description', 'prompt'] as const

/** First readable string inside a one-level array or object payload. */
function nestedString(value: unknown): string | undefined {
  const objects: Array<Record<string, unknown>> = []
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item !== '') return item
      if (item !== null && typeof item === 'object') objects.push(item as Record<string, unknown>)
    }
  } else if (value !== null && typeof value === 'object') {
    objects.push(value as Record<string, unknown>)
  }
  for (const record of objects) {
    const preferred = pickString(record, NESTED_TEXT_KEYS)
    if (preferred !== undefined) return preferred
  }
  for (const record of objects) {
    for (const inner of Object.values(record)) {
      if (typeof inner === 'string' && inner !== '') return inner
    }
  }
  return undefined
}

/** Display form of one file target: relative to the Session root, then `~`. */
function displayPath(path: string, cwd: string | undefined, home: string | undefined): string {
  return abbreviateHomePath(relativizeToCwd(firstLine(path), cwd), home)
}

/**
 * The shell tools terminate their rendered result with an exit-status marker:
 * `[exit code: N]`, or `[killed by signal: X]` when the process was signalled.
 * Mirrors `@deepseek-ai/dsh-shell`'s `parseExitStatus`.
 */
export function parseExitStatus(text: string): { body: string; code?: number; signal?: string } {
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/u.exec(text)
  if (signal?.[1] !== undefined) return { body: text.slice(0, signal.index), signal: signal[1] }
  const exit = /\n\[exit code: (\d+)\]$/u.exec(text)
  if (exit?.[1] !== undefined) return { body: text.slice(0, exit.index), code: Number(exit[1]) }
  return { body: text, code: 0 }
}

function bodyOf(variant: ToolVariant, args: Record<string, unknown> | undefined, raw: string): string | undefined {
  if (FILE_VARIANTS.has(variant)) return undefined
  if (raw === '') return undefined
  if (args === undefined) return raw
  if (variant === 'code') {
    const code = args.code
    if (typeof code === 'string' && code !== '') return code
  }
  return JSON.stringify(args, null, 2)
}

/**
 * Derive the collapsed row for one recorded call.
 * @param input - the recorded call plus the Session's display roots.
 * @returns title, summary, path, state, and the expanded bodies.
 */
export function toolRow(input: ToolRowInput): ToolRow {
  const variant = VARIANTS[input.name] ?? 'others'
  const title = TOOL_TITLES[input.name] ?? VARIANT_TITLES[variant]
  const args = parseArgs(input.args)
  const base = summarize(variant, args, input.args)

  const path = FILE_VARIANTS.has(variant) && args !== undefined ? pickString(args, FILE_PATH_KEYS) : undefined
  const filePath = path === undefined ? undefined : displayPath(path, input.cwd, input.home)

  const rawOutput = input.result === undefined || input.result === '' ? undefined : input.result
  const settledExit = variant === 'bash' && rawOutput !== undefined ? parseExitStatus(rawOutput) : undefined
  // The tools terminate their rendered result with a marker line, so the body
  // keeps the newline that preceded it; drop the blank tail it would draw.
  const output = settledExit === undefined ? rawOutput : settledExit.body.replace(/\n+$/u, '')
  const failedExit = settledExit !== undefined
    && (settledExit.signal !== undefined || (settledExit.code ?? 0) !== 0)

  const derived: ToolStatus = input.errorCode === 'interrupted' || stoppedByMeta(input.meta)
    ? 'stopped'
    : input.isError === true ? 'error'
      : input.result === undefined ? 'running'
        : 'ok'
  const settled = input.status ?? derived
  // A shell command that exits non-zero settles without `isError`, so the exit
  // marker is the only failure signal the row has.
  const state: ToolStatus = settled === 'ok' && failedExit ? 'error' : settled

  // The generic title cannot identify the tool, so the wire name leads the
  // summary instead — the same trade the web client makes.
  const summary = filePath ?? (title === VARIANT_TITLES.others
    ? [input.name, base].filter(part => part !== '').join(' · ')
    : base)

  const exit = failedExit && settledExit !== undefined
    ? {
        ...settledExit.signal === undefined ? {} : { signal: settledExit.signal },
        ...settledExit.code === undefined ? {} : { code: settledExit.code },
      }
    : undefined

  const command = variant === 'bash' && args !== undefined ? pickString(args, ['command']) : undefined

  return {
    variant,
    title,
    summary: state === 'stopped' ? 'Stopped'
      : state === 'error' && !failedExit && output !== undefined ? firstLine(output)
        : summary,
    filePath,
    state,
    command,
    // A terminal row shows its command line instead of the argument envelope.
    body: command === undefined ? bodyOf(variant, args, input.args) : undefined,
    output,
    exit,
  }
}
