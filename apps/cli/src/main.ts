/**
 * The terminal client's entry.
 *
 * `--mermaid-render` is the editor column's renderer, not a user command: the
 * editor spawns this same build, feeds it a batch of Mermaid blocks on stdin and
 * reads rows back. It is handled before the client graph is imported so that a
 * diagram costs one small process, not a whole terminal client start.
 */
try {
  if (process.argv[2] === '--mermaid-render') {
    const { mermaidRenderMain } = await import('./tui/editor/mermaidRender.js')
    process.exitCode = await mermaidRenderMain()
  } else {
    const { runCli } = await import('./cli.js')
    process.exitCode = await runCli()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
