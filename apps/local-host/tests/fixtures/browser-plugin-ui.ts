import type { PluginUiContext } from '@hulala/plugin-sdk'
export function activate(context: PluginUiContext) {
  const mount = (container: HTMLElement) => {
    const root = document.createElement('section'); root.style.padding = '24px'
    const title = document.createElement('h2'); title.textContent = 'Plugin QA'
    const status = document.createElement('p'); status.setAttribute('role', 'status')
    const result = document.createElement('p'); result.setAttribute('role', 'status')
    const refresh = async () => { const state = await context.rpc<{ starts: number; ticks: number; credential: { configured: boolean } }>('status'); status.textContent = `Activations: ${state.starts} · Ticks: ${state.ticks} · Credential: ${state.credential.configured}` }
    const button = (label: string, action: () => Promise<unknown>) => {
      const item = document.createElement('button'); item.textContent = label; item.style.marginRight = '16px'
      item.onclick = () => { void action().catch(error => { result.textContent = error instanceof Error ? error.message : String(error) }) }
      return item
    }
    root.append(title, status, button('Refresh plugin status', refresh), button('Configure test credential', async () => { const saved = await context.configureSecret('token'); result.textContent = saved ? 'Credential saved' : 'Cancelled'; await refresh() }), button('Check secret guard', async () => { await context.rpc('secret-test') }), result)
    container.append(root)
    void refresh()
    const off = context.on('tick', () => { void refresh() })
    return () => { off(); root.remove() }
  }
  context.registerView({ id: 'qa', title: 'Plugin QA', mount })
  context.registerSettings({ id: 'preferences', title: 'Plugin preferences', mount })
}
