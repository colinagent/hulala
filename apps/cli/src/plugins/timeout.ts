/**
 * How long one plugin call may take before the client gives up on it.
 *
 * A plugin that never settles would otherwise hang the window before its first
 * frame — or `hulala plugin check`, with no output at all — and the user would
 * have no way to see which plugin did it. The limit is generous: `activate`
 * registers things, it does not do work.
 */
export const PLUGIN_ACTIVATE_TIMEOUT_MS = 5_000

/**
 * Await a plugin's `activate`, but not forever.
 * @param work - the plugin's activation.
 * @param label - what to name in the failure message.
 * @param timeoutMs - how long it may take.
 * @returns whatever `activate` resolved to.
 * @throws when the plugin did not settle in time.
 */
export async function withPluginTimeout<T>(
  work: Promise<T> | T,
  label?: string,
  timeoutMs = PLUGIN_ACTIVATE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const reason = `activate() did not finish within ${timeoutMs}ms`
      reject(new Error(label === undefined ? reason : `${label}: ${reason}`))
    }, timeoutMs)
    // A hung plugin must not be the thing keeping the process alive.
    timer.unref?.()
  })
  try {
    return await Promise.race([Promise.resolve(work), deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
