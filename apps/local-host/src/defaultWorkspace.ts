import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const WORKSPACE_AGENTS = `# Workspace Guide

This Workspace is a persistent knowledge base shared by the user and AI agents.

## Structure and ownership

- \`raw/\` contains user-curated source material. Treat it as the source of truth. Read it, but do not edit, rename, move, or delete anything in it unless the user explicitly asks.
- \`wiki/\` contains the maintained knowledge base. The agent owns its organization and keeps its pages, links, index, and log current.
- \`AGENTS.md\` defines how the knowledge base works. Improve it with the user when their preferred workflow becomes clearer.

## Working rules

1. Read \`wiki/index.md\` before researching or answering a knowledge-base question.
2. Ground factual claims in files under \`raw/\`. Cite them with relative Markdown links. Clearly label inferences, contradictions, and open questions; never invent missing facts.
3. Update an existing page when possible instead of creating a duplicate. Keep pages focused and connect related pages with \`[[Wiki Links]]\`.
4. Keep \`wiki/index.md\` current whenever pages are added, renamed, or materially changed.
5. Append to \`wiki/log.md\` after an ingest, durable query result, or lint pass. Never rewrite earlier log entries. Use \`ingest\`, \`query\`, or \`lint\` as the operation; for example, \`## [2026-04-02] ingest | Article title\`.

## Core workflows

### Ingest

- Read the new source and identify its main claims, entities, concepts, and relationships.
- Create or update the relevant Wiki pages, linking every source-backed claim to the raw file.
- Note disagreements with existing pages instead of silently choosing a side.
- Update the index and append a concise log entry listing the source and changed pages.

### Query

- Use the index to find relevant pages, then inspect the cited raw sources when needed.
- Answer with citations and separate sourced facts from synthesis.
- If the result will be useful later, offer to save or update it as a Wiki page.

### Lint

- Check for stale or contradictory claims, broken or missing links, duplicate or orphan pages, uncited facts, and important concepts that lack a page.
- Fix safe maintenance issues directly and record the pass in the log. Ask before making judgment calls that change the Wiki's meaning.

## Page shape

Prefer a simple page unless the subject needs something else:

- one H1 title and a short summary;
- sections for the useful facts or synthesis;
- a \`Sources\` section with relative links into \`raw/\`;
- a \`Related\` section with Wiki links.
`

const WIKI_INDEX = `# Wiki

This is the home and content map for your persistent knowledge base.

## Start here

1. Add articles, notes, documents, images, or data to \`raw/\`.
2. Ask the agent to ingest one source or a small batch.
3. Review the pages it creates here and guide what should be emphasized.

The agent will keep this index updated as the Wiki grows.

## Pages

No pages have been added yet.
`

const WIKI_LOG = `# Wiki Log

Append-only history of ingests, durable query results, and lint passes.
`

async function writeFileIfMissing(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

export async function ensureDefaultWorkspace(workspacePath: string): Promise<void> {
  const rawPath = join(workspacePath, 'raw')
  const wikiPath = join(workspacePath, 'wiki')
  await Promise.all([
    mkdir(rawPath, { recursive: true, mode: 0o700 }),
    mkdir(wikiPath, { recursive: true, mode: 0o700 }),
  ])
  await Promise.all([
    writeFileIfMissing(join(workspacePath, 'AGENTS.md'), WORKSPACE_AGENTS),
    writeFileIfMissing(join(wikiPath, 'index.md'), WIKI_INDEX),
    writeFileIfMissing(join(wikiPath, 'log.md'), WIKI_LOG),
  ])
}
