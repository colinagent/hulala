import { create } from 'zustand'
import type { Dispose, InstalledPlugin, PluginUi, PluginUiContext, PluginView, PluginNavigation } from '@hulala/plugin-sdk'
import { useAppStore } from '../store/appStore'
import { useUiStore } from '../store/uiStore'
export interface LocalView extends PluginView { key: string; pluginId: string; settings: boolean }
interface Command { key: string; pluginId: string; title: string; run(): void | Promise<void> }
interface State {
  plugins: InstalledPlugin[]; views: LocalView[]; commands: Command[]; errors: Record<string, string>
  navigations: (PluginNavigation & { pluginId: string })[]
}
export const useLocalPlugins = create<State>(() => ({ plugins: [], views: [], commands: [], errors: {}, navigations: [] }))
const loaded = new Map<string, { revision: string; dispose: Dispose[] }>()
const failedRevisions = new Map<string, string>()
const listeners = new Map<string, Set<(value: unknown) => void>>()
let started = false
let refreshing: Promise<void> | undefined
let cursor = 0
const api = () => {
  const bridge = window.hulala?.localPlugins
  if (!bridge) throw new Error('Local plugin bridge unavailable')
  return bridge
}
export function openLocalPluginView(key: string) {
  const view = useLocalPlugins.getState().views.find(v => v.key === key)
  if (view) {
    useAppStore.getState().openPluginTab(key, view.title)
    if (useLocalPlugins.getState().navigations.some(navigation => navigation.pluginId === view.pluginId)) {
      useUiStore.getState().setSidebarView('plugin:' + view.pluginId as `plugin:${string}`)
    }
  }
}
async function unload(id: string) {
  const existing = loaded.get(id)
  loaded.delete(id)
  // Withdraw views first so mounted React effects dispose before their module.
  useLocalPlugins.setState(state => ({ views: state.views.filter(v => v.pluginId !== id), commands: state.commands.filter(c => c.pluginId !== id), navigations: state.navigations.filter(n => n.pluginId !== id) }))
  if (existing) for (const dispose of existing.dispose.reverse()) await Promise.resolve().then(dispose).catch(() => undefined)
}
async function load(plugin: InstalledPlugin) {
  const id = plugin.manifest.id
  const disposers: Dispose[] = []
  const add = (view: PluginView, settings: boolean) => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(view.id) || typeof view.mount !== 'function') throw new Error('Invalid plugin view')
    if (view.icon && (!Array.isArray(view.icon.paths) || view.icon.paths.length === 0 || view.icon.paths.length > 16 || view.icon.paths.some(path => typeof path !== 'string' || path.length > 2048))) throw new Error('Invalid plugin icon')
    const key = id + '/' + view.id
    if (useLocalPlugins.getState().views.some(v => v.key === key)) throw new Error('Duplicate plugin view')
    useLocalPlugins.setState(s => ({ views: [...s.views, { ...view, key, pluginId: id, settings }] }))
    const dispose = () => useLocalPlugins.setState(s => ({ views: s.views.filter(v => v.key !== key) }))
    disposers.push(dispose)
    return dispose
  }
  const context: PluginUiContext = {
    rpc: (method, input) => api().rpc(id, method, input) as Promise<never>,
    on: (topic, listener) => {
      const key = id + ':' + topic
      const set = listeners.get(key) ?? new Set()
      set.add(listener); listeners.set(key, set)
      const dispose = () => { set.delete(listener); if (!set.size) listeners.delete(key) }
      disposers.push(dispose); return dispose
    },
    registerView: view => add(view, false),
    registerSettings: view => add(view, true),
    registerNavigation: navigation => {
      if (!navigation.title?.trim() || navigation.title.length > 100 || !Array.isArray(navigation.items) || !navigation.items.length || navigation.items.length > 20) throw new Error('Invalid plugin navigation')
      if (new Set(navigation.items.map(item => item.viewId)).size !== navigation.items.length || navigation.items.some(item => !/^[a-z][a-z0-9-]{0,63}$/.test(item.viewId) || !item.title?.trim() || item.title.length > 100)) throw new Error('Invalid plugin navigation items')
      if (useLocalPlugins.getState().navigations.some(value => value.pluginId === id)) throw new Error('Duplicate plugin navigation')
      useLocalPlugins.setState(state => ({ navigations: [...state.navigations, { title: navigation.title, items: navigation.items.map(item => ({ ...item })), pluginId: id }] }))
      const app = useAppStore.getState()
      if (app.documents.find(document => document.id === app.activeTabId)?.editorId.startsWith('plugin:' + id + '/')) {
        useUiStore.getState().setSidebarView(('plugin:' + id) as import('../components/Sidebar/sidebarTabs').SidebarView)
      }
      const dispose = () => useLocalPlugins.setState(state => ({ navigations: state.navigations.filter(value => value.pluginId !== id) }))
      disposers.push(dispose)
      return dispose
    },
    registerCommand: command => {
      const key = id + '/' + command.id
      if (useLocalPlugins.getState().commands.some(c => c.key === key)) throw new Error('Duplicate plugin command')
      useLocalPlugins.setState(s => ({ commands: [...s.commands, { ...command, key, pluginId: id }] }))
      const dispose = () => useLocalPlugins.setState(s => ({ commands: s.commands.filter(c => c.key !== key) }))
      disposers.push(dispose); return dispose
    },
    openView: viewId => openLocalPluginView(id + '/' + viewId),
    openExternal: url => api().openExternal(url),
    configureSecret: name => api().configureSecret(id, name),
    unsetSecret: name => api().unsetSecret(id, name),
  }
  const assetUrl = api().assetUrl
  if (!assetUrl) throw new Error('Plugin assets require the browser Host adapter')
  loaded.set(id, { revision: plugin.revision, dispose: disposers })
  try {
    for (const style of plugin.manifest.styles ?? []) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'; link.href = assetUrl(id, plugin.revision, style)
      document.head.append(link)
      disposers.push(() => link.remove())
    }
    const module = await import(/* @vite-ignore */ assetUrl(id, plugin.revision, plugin.manifest.ui)) as PluginUi
    if (typeof module.activate !== 'function') throw new Error('UI must export activate')
    const dispose = await module.activate(context)
    if (dispose) disposers.push(dispose)
    failedRevisions.delete(id)
  } catch (error) {
    await unload(id)
    failedRevisions.set(id, plugin.revision)
    useLocalPlugins.setState(s => ({ errors: { ...s.errors, [id]: String(error) } }))
    await api().rollback(id, plugin.revision).catch(() => undefined)
  }
}
export function refreshLocalPlugins(): Promise<void> {
  return refreshing ??= (async () => {
    const plugins = await api().list()
    for (const [id, entry] of loaded) {
      if (!plugins.some(p => p.manifest.id === id && p.state === 'active' && p.revision === entry.revision)) await unload(id)
    }
    useLocalPlugins.setState({ plugins })
    for (const plugin of plugins) {
      if (plugin.state === 'active' && !loaded.has(plugin.manifest.id) && failedRevisions.get(plugin.manifest.id) !== plugin.revision) await load(plugin)
    }
    const page = await api().events(cursor)
    cursor = page.cursor
    for (const event of page.events) for (const listener of listeners.get(event.pluginId + ':' + event.topic) ?? []) {
      try { listener(event.data) } catch { /* One view cannot interrupt other subscriptions. */ }
    }
  })().finally(() => { refreshing = undefined })
}
export function startLocalPlugins(): void {
  if (started || !window.hulala?.localPlugins) return
  started = true
  void refreshLocalPlugins().catch(() => undefined)
  setInterval(() => void refreshLocalPlugins().catch(() => undefined), 2000)
}
export async function pluginAction(action: () => Promise<unknown>) {
  await action()
  failedRevisions.clear()
  useLocalPlugins.setState({ errors: {} })
  await refreshLocalPlugins()
}
