/**
 * File-change rows: the hunks a mutation tool reports (or an edit's own
 * arguments) turned into the `-`/`+`/context lines a transcript draws.
 *
 * DeepSeek Harness already computes the applied change: `edit`, `write` and
 * `apply_patch` put `diffs` on their `tool/result` `meta`, one entry per hunk
 * with three lines of context on each side. This module narrows that opaque
 * payload and splits each hunk into rows with the same rules the web client's
 * diff card uses (`packages/client/ui-primitives/src/DiffBlock.tsx`): a file
 * path header per file, `⋯` between fragments, and `structuredPatch` with a
 * bounded edit length, falling back to a whole-fragment replacement when the
 * comparison is too large.
 *
 * Line numbers stay out: a `FileDiff` carries the two texts, not their offsets,
 * so neither this client nor the web card can number the rows.
 *
 * @module hulala-cli/tui/data/diffRow
 */
import { structuredPatch } from 'diff'

/** One applied change, as a mutation tool reports it on its result metadata. */
export interface FileDiff {
  /** The changed file, in the tool's model-facing spelling. */
  path: string
  /** Prior content including context; `null` when there was no prior content. */
  oldText: string | null
  /** Content after the change, including the same shared context. */
  newText: string
}

/** What one drawn row is: the file header, a change, context, or a fold gap. */
export type DiffRowKind = 'path' | 'del' | 'add' | 'context' | 'gap'

/** One drawn line; `text` never carries the leading marker. */
export interface DiffRow {
  kind: DiffRowKind
  text: string
}

/** How many lines a change adds and removes. */
export interface DiffStats {
  added: number
  removed: number
}

/** Context lines `structuredPatch` keeps on each side of a change. */
const DIFF_CONTEXT = 3
/** Edits one hunk may need before the comparison falls back to a whole replacement. */
const MAX_EDIT_LENGTH = 256

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function narrowHunks(value: unknown): FileDiff[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const diffs: FileDiff[] = []
  for (const hunk of value) {
    if (!isRecord(hunk)) return undefined
    const { path, oldText, newText } = hunk
    if (typeof path !== 'string') return undefined
    if (oldText !== null && typeof oldText !== 'string') return undefined
    if (typeof newText !== 'string') return undefined
    diffs.push({ path, oldText, newText })
  }
  return diffs
}

/**
 * Read the applied change a mutation tool attached to its result metadata.
 * @param meta - the opaque `tool/result` metadata.
 * @returns the validated hunks, or `undefined` when the payload is absent or malformed.
 */
export function fileDiffs(meta: unknown): FileDiff[] | undefined {
  if (!isRecord(meta)) return undefined
  return narrowHunks(meta.diffs)
}

/**
 * The change an `edit` call already describes, so it can be drawn while the
 * call runs and before any result metadata exists.
 *
 * A `write` is deliberately absent: its arguments carry the whole new file and
 * no prior content, so drawing them as a diff would paint every line as an
 * insertion, which is what a create looks like but not what an overwrite does.
 * A write waits for its result metadata instead.
 *
 * @param name - the tool name the call reported.
 * @param args - the parsed call arguments.
 * @returns one hunk, or `undefined` when the arguments do not describe a change.
 */
export function intendedDiff(name: string, args: Record<string, unknown> | undefined): FileDiff | undefined {
  if (args === undefined || name !== 'edit') return undefined
  const path = typeof args.file_path === 'string' ? args.file_path : args.path
  const oldText = args.old_string
  const newText = args.new_string
  if (typeof path !== 'string' || path === '') return undefined
  if (typeof oldText !== 'string' || typeof newText !== 'string') return undefined
  // An empty search text means "insert into an empty file": nothing to remove.
  return { path, oldText: oldText === '' ? null : oldText, newText }
}

/**
 * Content lines of one side, on the terminator rule the web card uses: empty
 * text is zero lines, and one trailing newline ends the last line rather than
 * opening an empty one.
 */
function contentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

interface Hunk {
  lines: string[]
}

/**
 * Split one hunk into patch lines.
 *
 * `maxEditLength` keeps a pathological comparison from blocking a frame; past
 * it the hunk becomes a whole replacement, exactly as the web card degrades.
 */
function localHunks(diff: FileDiff): Hunk[] {
  const oldLines = contentLines(diff.oldText ?? '')
  const newLines = contentLines(diff.newText)
  const normalize = (lines: readonly string[]): string => lines.map(line => `${line}\n`).join('')
  return structuredPatch(
    '',
    '',
    normalize(oldLines),
    normalize(newLines),
    undefined,
    undefined,
    { context: DIFF_CONTEXT, maxEditLength: MAX_EDIT_LENGTH },
  )?.hunks
    ?? [{ lines: [...oldLines.map(line => `-${line}`), ...newLines.map(line => `+${line}`)] }]
}

/**
 * Flatten hunks into drawn rows.
 * @param diffs - one entry per applied hunk, in file order.
 * @returns the rows: a path header per file, a `⋯` row between fragments, then the lines.
 */
export function diffRows(diffs: readonly FileDiff[]): DiffRow[] {
  const rows: DiffRow[] = []
  let previousPath: string | undefined
  for (const diff of diffs) {
    if (diff.path !== previousPath) rows.push({ kind: 'path', text: diff.path })
    else rows.push({ kind: 'gap', text: '⋯' })
    previousPath = diff.path
    const hunks = localHunks(diff)
    for (const [index, hunk] of hunks.entries()) {
      if (index > 0) rows.push({ kind: 'gap', text: '⋯' })
      for (const line of hunk.lines) {
        // `\ No newline at end of file` is a marker, not content.
        if (line.startsWith('\\')) continue
        const marker = line[0]
        const kind = marker === '-' ? 'del' : marker === '+' ? 'add' : 'context'
        rows.push({ kind, text: line.slice(1) })
      }
    }
  }
  return rows
}

/**
 * Count the added and removed lines of a change.
 * @param rows - rows from {@link diffRows}.
 * @returns the totals the row header shows.
 */
export function diffStats(rows: readonly DiffRow[]): DiffStats {
  let added = 0
  let removed = 0
  for (const row of rows) {
    if (row.kind === 'add') added += 1
    else if (row.kind === 'del') removed += 1
  }
  return { added, removed }
}
