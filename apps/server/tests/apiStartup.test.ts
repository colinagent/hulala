/**
 * The startup route's own rule: the MCP names it reports are the ones that will
 * mount.
 *
 * The resolution is delegated to `@colinagent/dsh-mcp`'s own roster, so what is
 * worth pinning here is that the Host passes it both documents, the Session's
 * directory and the home directory, and that the answer is names — not a
 * transport, a header or a credential that a welcome block has no business
 * printing. The merge itself is that package's test to own; one case here proves
 * the delegation is real (a project override wins) and one proves a refused
 * entry is not advertised.
 */
import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { mcpDocumentPaths, startupMcpServers } from '../src/plugins/apiStartup.ts'

const HOME = '/home/colin'
const CWD = '/work/hulala'

const userDocument = {
  mcpServers: {
    memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
    docs: { url: 'https://mcp.example.com/mcp' },
  },
}

test('a Session sees the user servers as sorted names', () => {
  expect(startupMcpServers({ user: userDocument, cwd: CWD, home: HOME })).toEqual(['docs', 'memory'])
})

test('the project document overrides a user entry by name', () => {
  const project = {
    mcpServers: {
      // Same namespace, declared here with a transport, so this entry replaces
      // the user one rather than being added beside it.
      memory: { command: 'node', args: ['server.js'] },
      'repo-graph': { command: 'graph-mcp', args: ['--root', '.'] },
    },
  }
  expect(startupMcpServers({ user: userDocument, project, cwd: CWD, home: HOME }))
    .toEqual(['docs', 'memory', 'repo-graph'])
})

test('a project toggle can take a user server away, and stay silent about it', () => {
  const project = { mcpServers: { docs: { enabled: false } } }
  expect(startupMcpServers({ user: userDocument, project, cwd: CWD, home: HOME })).toEqual(['memory'])
})

test('an entry the mounting plugin would refuse is not advertised', () => {
  const user = {
    mcpServers: {
      // The legacy transport is refused by the bundle, so its tools never mount.
      legacy: { type: 'sse', url: 'https://mcp.example.com/sse' },
      // A `bad name` cannot be a tool namespace.
      'bad name': { command: 'x' },
      good: { command: 'good-mcp' },
    },
  }
  expect(startupMcpServers({ user, cwd: CWD, home: HOME })).toEqual(['good'])
})

test('no documents is an empty list, not an error', () => {
  expect(startupMcpServers({ cwd: CWD, home: HOME })).toEqual([])
})

test('the documents are read from the bundle\'s own two locations', () => {
  expect(mcpDocumentPaths(CWD, HOME)).toEqual({
    user: join(HOME, '.agents', 'mcp.json'),
    project: join(CWD, '.agents', 'mcp.json'),
  })
})
