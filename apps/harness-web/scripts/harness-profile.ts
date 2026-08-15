import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function plugin(repositoryRoot: string, packageDirectory: string): string {
  return pathToFileURL(resolve(repositoryRoot, 'packages', packageDirectory, 'lib', 'index.js')).href
}

/** Build a location-independent DeepSeek Harness overlay for this checkout. */
export function createHarnessPatch(repositoryRoot: string): unknown[] {
  const networkProxy = plugin(repositoryRoot, 'network-proxy')
  const selector = plugin(repositoryRoot, 'agent-loop-selector')
  const pi = plugin(repositoryRoot, 'agent-loop-pi')
  const codex = plugin(repositoryRoot, 'agent-loop-codex')
  const claude = plugin(repositoryRoot, 'agent-loop-claude')

  return [
    { id: 'agent-loop', disabled: true },
    {
      insert: [
        { id: 'loopwithai-network', name: networkProxy },
        { id: 'agent-loop-runtime', name: pi },
        {
          id: 'agent-loop-selector',
          name: selector,
          config: {
            defaultRuntime: 'pi',
            entryId: 'agent-loop-runtime',
            runtimes: {
              pi: { name: 'Pi', package: pi },
              deepseek: { name: 'DeepSeek', package: '@deepseek-ai/dsh-agent-loop' },
              codex: { name: 'Codex', package: codex },
              claude: { name: 'Claude Code', package: claude },
            },
          },
        },
      ],
    },
  ]
}
