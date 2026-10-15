#!/usr/bin/env bun
import { parseServerConfig } from './config.ts'
import { writePrivateJson } from './config.ts'
import { rm } from 'node:fs/promises'
import { createDesktopHost } from './host.ts'

async function main(): Promise<void> {
  const config = parseServerConfig()
  if (config.runtimeHostModule === undefined) throw new Error('Hulala Host requires --runtime-host-module')
  const handle = await createDesktopHost(config)
  const descriptorIndex = process.argv.indexOf('--descriptor-file')
  const descriptorFile = descriptorIndex < 0 ? undefined : process.argv[descriptorIndex + 1]
  if (descriptorFile) await writePrivateJson(descriptorFile, { ...handle.descriptor, pid: process.pid, version: config.version })
  else console.log(JSON.stringify({ type: 'hulala-server-ready', ...handle.descriptor }))

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await handle.stop()
    if (descriptorFile) await rm(descriptorFile, { force: true })
    process.exit(0)
  }
  process.once('SIGINT', () => void stop())
  process.once('SIGTERM', () => void stop())
}

void main().catch(error => {
  console.error(error)
  process.exit(1)
})
