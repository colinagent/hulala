import { runCli } from './cli.js'

try {
  process.exitCode = await runCli()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
