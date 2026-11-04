/**
 * Regenerate `src/brand/logoPng.ts` from the canonical brand PNG.
 *
 * The bytes go inside the bundle rather than next to `dist/cli.js`, so every way
 * of running the client (npm package, standalone binary, `bun src/main.ts`)
 * carries the exact same bitmap with no filesystem lookup at runtime.
 *
 * Run after touching `assets/brand/logo-mark-terminal.png`:
 *   bun apps/cli/scripts/embedLogo.ts
 */
import { readFile, writeFile } from 'node:fs/promises'

const source = new URL('../../../assets/brand/logo-mark-terminal.png', import.meta.url)
const target = new URL('../src/brand/logoPng.ts', import.meta.url)

const png = await readFile(source)
const base64 = png.toString('base64')
const wrapped = base64.replace(/(.{96})/g, "$1' +\n  '")

await writeFile(target, `/**
 * GENERATED - do not edit. Produced by \`bun apps/cli/scripts/embedLogo.ts\` from
 * \`assets/brand/logo-mark-terminal.png\` (${png.length} bytes, ${base64.length} base64).
 *
 * The Hulala pinwheel as PNG bytes, for terminals that speak a graphics protocol.
 * Regenerate it whenever the brand PNG changes.
 *
 * @module hulala-cli/brand/logoPng
 */
export const LOGO_PNG_BASE64 =
  '${wrapped}'
`)

console.log(`wrote ${target.pathname} (${png.length} bytes png, ${base64.length} base64)`)
