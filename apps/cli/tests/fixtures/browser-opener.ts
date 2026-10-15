// A native test opener verifies readiness without taking over the user's browser.
import { writeFile } from 'node:fs/promises'
const url = process.argv.at(-1)!
const healthUrl = new URL('/api/hulala/health', url)
healthUrl.hostname = '127.0.0.1'
const response = await fetch(healthUrl)
const health = await response.json() as { version: string; workbench?: { state: string } }
await writeFile(process.env.HULALA_TEST_BROWSER_LOG!, JSON.stringify({ url, ready: response.ok && health.workbench?.state === 'running', version: health.version }))
