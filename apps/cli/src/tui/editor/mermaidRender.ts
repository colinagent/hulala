/**
 * Mermaid rendering for the editor column, run as a short-lived child process.
 *
 * The editor has no renderer of its own and no browser, and Hulala already ships
 * one Mermaid engine for the conversation. Reusing it here is what keeps the two
 * places looking the same: the client passes the command that runs this module
 * (`--mermaid-render`) through `HULALA_NVIM_MERMAID`, and Neovim sends one batch
 * of blocks per change and gets rows back.
 *
 * The protocol is one JSON object each way, because the caller is Lua:
 *
 * ```json
 * { "width": 80, "sources": ["flowchart LR\n  A --> B"] }
 * { "arts": [["┌───┐", "│ A │", "└───┘"]] }
 * ```
 *
 * A `null` entry means "not a diagram this renderer draws" (unknown type,
 * syntax error, refused because it is too large) and the caller keeps the
 * source. Art wider than `width` is already replaced by a framed copy of the
 * source here, so the caller never has to know about the fallback.
 *
 * @module hulala-cli/tui/editor/mermaidRender
 */
import { render, sourceBox } from 'grok-mermaid'

/** One batch: the columns available and the block sources to draw. */
export interface MermaidRequest {
  readonly width: number
  readonly sources: readonly string[]
}

/** One entry per source: rows to show, or null to keep the source. */
export interface MermaidResult {
  readonly arts: (string[] | null)[]
}

/** A batch larger than this is not a document anyone is reading. */
const MAX_SOURCES = 32
/** Single blocks beyond this are treated as not-a-diagram, not drawn. */
const MAX_SOURCE_BYTES = 16 * 1024
const MIN_WIDTH = 24

/**
 * Draw a batch of Mermaid sources.
 * @param request - width and sources, as the editor sends them.
 * @returns one row list (or null) per source, in order.
 */
export function renderMermaid(request: MermaidRequest): MermaidResult {
  const width = Number.isFinite(request.width) ? Math.max(MIN_WIDTH, Math.trunc(request.width)) : 80
  const sources = Array.isArray(request.sources) ? request.sources.slice(0, MAX_SOURCES) : []
  const arts = sources.map((source): string[] | null => {
    if (typeof source !== 'string' || source.length > MAX_SOURCE_BYTES) return null
    const art = render(source)
    if (art === null) return null
    // Too wide for the window: show the source framed, which says why it is not
    // a picture, instead of leaving the reader with a broken edge.
    return art.width > width ? sourceBox(source, width).plain : art.plain
  })
  return { arts }
}

async function readInput(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Entry point for `hulala --mermaid-render`: one JSON request in, one out.
 * @returns the process exit code.
 */
export async function mermaidRenderMain(): Promise<number> {
  // A terminal would wait for a request nobody is sending.
  if (process.stdin.isTTY === true) {
    process.stderr.write('hulala: --mermaid-render reads one JSON request from stdin\n')
    return 1
  }
  try {
    const request = JSON.parse(await readInput()) as MermaidRequest
    if (request === null || typeof request !== 'object' || !Array.isArray(request.sources)) {
      throw new Error('expected { width, sources }')
    }
    process.stdout.write(JSON.stringify(renderMermaid(request)))
    return 0
  } catch (error) {
    process.stderr.write(`hulala: mermaid render failed: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
