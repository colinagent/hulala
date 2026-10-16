/** Sparse stage messages work in terminals, redirected logs and CI without ANSI redraws. */
export async function withProgress<T>(label: string, action: () => Promise<T>, enabled = true): Promise<T> {
  if (!enabled) return action()
  const started = Date.now()
  console.error(label + '...')
  const timer = setInterval(() => console.error(`${label}... ${Math.floor((Date.now() - started) / 1000)}s elapsed.`), 5000)
  try { return await action() } finally { clearInterval(timer) }
}
export function showStartupProgress(args: string[]): boolean {
  return args.length === 0 || ['--no-open', '--foreground', 'install', 'update', 'rollback'].includes(args[0]!)
    || (args[0] === 'service' && ['start', 'restart'].includes(args[1]!))
}
