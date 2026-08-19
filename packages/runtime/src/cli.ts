#!/usr/bin/env bun
import { fileURLToPath } from 'node:url'
import { createRepositoryHarnessPatch, resolveRuntimePaths, startHarnessRuntime } from './index'

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  const repositoryRoot = option('--repository-root')
    ?? fileURLToPath(new URL('../../../', import.meta.url))
  const portValue = option('--port')
  const paths = resolveRuntimePaths({ root: option('--lwa-home') })

  const runtime = await startHarnessRuntime({
    host: '127.0.0.1',
    port: portValue ? Number(portValue) : undefined,
    paths,
    patch: createRepositoryHarnessPatch(repositoryRoot),
  })

  console.log(JSON.stringify({ url: runtime.url, pid: process.pid, paths: runtime.paths }))
  const stop = () => void runtime.stop()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  await runtime.exited
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
