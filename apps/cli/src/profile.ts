import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

function plugin(packageDirectory: string): string {
  return pathToFileURL(fileURLToPath(new URL(`./plugins/${packageDirectory}/index.js`, import.meta.url))).href
}

export function createPackagedHarnessPatch(): unknown[] {
  const networkProxy = plugin('network-proxy')
  const selector = plugin('agent-loop-selector')
  const pi = plugin('agent-loop-pi')
  const codex = plugin('agent-loop-codex')
  const claude = plugin('agent-loop-claude')

  return [
    { id: 'agent-loop', disabled: true },
    {
      insert: [
        { id: 'hulala-network', name: networkProxy },
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
