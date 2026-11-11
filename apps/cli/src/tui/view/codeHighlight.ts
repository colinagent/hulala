/**
 * Syntax highlighting for code blocks in the conversation.
 *
 * pi-tui's `Markdown` prints a code block's lines through `highlightCode`, which
 * is a hook rather than an implementation: the library ships no tokenizer. This
 * module is that tokenizer's owner — the grammars come from
 * `@speed-highlight/core` (CC0, no dependencies, one small module per language),
 * the colours come from `../view/theme`, and the wrapping happens here too.
 *
 * Wrapping belongs here because it needs the same two facts highlighting does:
 * the lines and the width. `Markdown` pastes whatever this returns into the
 * block, so a line folded to the available width is a line the alt-screen has
 * nothing left to cut: an over-long `JSON` blob used to be truncated silently.
 *
 * @module hulala-cli/tui/view/codeHighlight
 */
import { wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { tokenizeWith } from '@speed-highlight/core/tokenize'
import type { ShjLanguageData } from '@speed-highlight/core/tokenize'
import bash from '@speed-highlight/core/languages/bash.js'
import c from '@speed-highlight/core/languages/c.js'
import css from '@speed-highlight/core/languages/css.js'
import diff from '@speed-highlight/core/languages/diff.js'
import docker from '@speed-highlight/core/languages/docker.js'
import go from '@speed-highlight/core/languages/go.js'
import html from '@speed-highlight/core/languages/html.js'
import ini from '@speed-highlight/core/languages/ini.js'
import java from '@speed-highlight/core/languages/java.js'
import js from '@speed-highlight/core/languages/js.js'
import json from '@speed-highlight/core/languages/json.js'
import lua from '@speed-highlight/core/languages/lua.js'
import md from '@speed-highlight/core/languages/md.js'
import py from '@speed-highlight/core/languages/py.js'
import rs from '@speed-highlight/core/languages/rs.js'
import sql from '@speed-highlight/core/languages/sql.js'
import toml from '@speed-highlight/core/languages/toml.js'
import ts from '@speed-highlight/core/languages/ts.js'
import xml from '@speed-highlight/core/languages/xml.js'
import yaml from '@speed-highlight/core/languages/yaml.js'

/**
 * The grammars a fence can name, by the name it most likely uses.
 *
 * Deliberately a short list: a language that is not here still renders, just
 * without colour, so an unlisted fence costs nothing but a quiet block.
 */
// The dialects declare every optional rule as `| undefined`, which this
// repository's `exactOptionalPropertyTypes` refuses; the values are grammar
// tables either way, so they are kept opaque here and cast at the one call site.
const GRAMMARS: Readonly<Record<string, unknown>> = {
  bash, c, css, diff, docker, go, html, ini, java, js, json, lua, md, py, rs, sql, toml, ts, xml, yaml,
}

/** Fence names and file extensions that mean one of {@link GRAMMARS}. */
const ALIASES: Readonly<Record<string, string>> = {
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', shellscript: 'bash',
  typescript: 'ts', tsx: 'ts', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
  python: 'py', python3: 'py',
  golang: 'go',
  rust: 'rs',
  yml: 'yaml',
  patch: 'diff',
  dockerfile: 'docker', containerfile: 'docker',
  htm: 'html', xhtml: 'html',
  svg: 'xml',
  cfg: 'ini', conf: 'ini', properties: 'ini',
  text: '', txt: '', plain: '', plaintext: '',
}

/**
 * Columns a code line cannot use: two of block indent, plus the two the
 * component keeps on each side, which `Markdown` wraps every printed line into
 * (it measures the line after the indent is already in it).
 */
const CODE_INSET = 6
/** Narrowest column a wrapped code line is allowed to fold into. */
const MIN_WIDTH = 8
/** Blocks kept after their last render; a conversation holds far fewer at once. */
const CACHE_LIMIT = 128

/** Colour one token; the theme's owner decides what a token type looks like. */
export type TokenInk = (type: string, text: string) => string

/**
 * A highlighter for one transcript.
 * @param ink - how a token type is drawn.
 * @param width - the column width the block is rendered into, read per call.
 * @param plain - how a block without a language is drawn; leaves it as it is by default.
 * @returns `highlightCode` as `Markdown` expects it: the block's lines.
 */
export function codeHighlighter(
  ink: TokenInk,
  width: () => number,
  plain?: (text: string) => string,
): (code: string, language?: string) => string[] {
  const cache = new Map<string, string[]>()
  return (code: string, language?: string): string[] => {
    const available = Math.max(MIN_WIDTH, width() - CODE_INSET)
    const key = `${language ?? ''}\u0000${available}\u0000${plain === undefined ? 'raw' : 'ink'}\u0000${code}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const lines = colourLines(code, language, ink, plain)
      .flatMap((line) => wrapTextWithAnsi(line, available))
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
    cache.set(key, lines)
    return lines
  }
}

/**
 * Colour a block's lines without folding them.
 *
 * A tool row wraps its own output and needs the coloured lines before the fold;
 * the transcript's code blocks go through {@link codeHighlighter}, which folds.
 * @param code - the block's source.
 * @param language - the name the fence or the file path gave.
 * @param ink - how a token type is drawn.
 * @param plain - how a block without a language is drawn.
 * @returns one entry per source line, coloured.
 */
export function colourLines(
  code: string,
  language: string | undefined,
  ink: TokenInk,
  plain?: (text: string) => string,
): string[] {
  const grammar = grammarFor(language)
  const paint = grammar === undefined ? plain : undefined
  const lines: string[] = []
  if (grammar === undefined) {
    for (const line of code.split('\n')) lines.push(paint === undefined ? line : paint(line))
    return lines
  }
  // A token may span lines (a block comment, a template literal), so the chunks
  // are appended to the line being built rather than assumed line-shaped.
  let current = ''
  const flush = (): void => {
    lines.push(current)
    current = ''
  }
  tokenizeWith(code, grammar as ShjLanguageData, (text: string, type?: string) => {
    const parts = text.split('\n')
    for (const [index, part] of parts.entries()) {
      if (index > 0) flush()
      if (part !== '') current += type === undefined ? part : ink(type, part)
    }
  })
  if (current !== '') flush()
  return lines
}

/**
 * The language a file path names, for a tool row's own output.
 *
 * The extensions are the ones a session actually reads and writes; a path that
 * names nothing on the list leaves its output uncoloured rather than guessed at.
 * @param path - the path the tool call named, relative or absolute.
 * @returns a name {@link grammarFor} resolves, or `undefined`.
 */
export function languageForPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  const name = /[^./\\]+$/.exec(path)?.[0]?.toLowerCase()
  if (name === undefined) return undefined
  return EXTENSIONS[name] ?? (GRAMMARS[name] === undefined ? undefined : name)
}

/** Extension to fence name, for the file types a session actually reads. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json', md: 'md', markdown: 'md',
  py: 'py', pyi: 'py', rs: 'rs', go: 'go', java: 'java',
  c: 'c', h: 'c', cc: 'c', cpp: 'c', cxx: 'c', hpp: 'c', hh: 'c',
  sh: 'bash', bash: 'bash', zsh: 'bash', ksh: 'bash',
  sql: 'sql', lua: 'lua',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini',
  css: 'css', html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  diff: 'diff', patch: 'diff', dockerfile: 'docker', containerfile: 'docker',
}

/**
 * The grammar a fence's language names, if it names one.
 * @param language - the fence's info string, as written.
 * @returns the grammar, or `undefined` when the block stays plain.
 */
export function grammarFor(language: string | undefined): unknown {
  if (language === undefined) return undefined
  const name = language.trim().toLowerCase().split(/\s+/, 1)[0] ?? ''
  if (name === '') return undefined
  const alias = ALIASES[name]
  if (alias !== undefined) return alias === '' ? undefined : GRAMMARS[alias]
  return GRAMMARS[name]
}
