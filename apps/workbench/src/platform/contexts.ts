import type { BrowserWorkspace } from '@hulala/workbench-contracts/browser'
import type { WorkbenchPlatform } from '../renderer/types/platform'

export type BrowserWorkspaceContext = { viewId: string; workspace: BrowserWorkspace; platform: WorkbenchPlatform }
const contexts = new Map<string, BrowserWorkspaceContext>()
const attachments = new Map<string, Promise<BrowserWorkspaceContext>>()
const connections = new Set<Parameters<WorkbenchPlatform['desktop']['onConnection']>[0]>()
const events = new Set<Parameters<WorkbenchPlatform['desktop']['onEvent']>[0]>()
const journals = new Map<string, WorkbenchPlatform['backup']>()

export function browserContext(viewId: string): BrowserWorkspaceContext | undefined { return contexts.get(viewId) }

export function installBrowserContext(context: BrowserWorkspaceContext): void {
  const { platform, viewId } = context
  contexts.set(viewId, context)
  platform.desktop.onConnection(event => connections.forEach(handler => handler(event)))
  platform.desktop.onEvent(event => events.forEach(handler => handler(event)))
  platform.desktop.onConnection = handler => { connections.add(handler); return () => { connections.delete(handler) } }
  platform.desktop.onEvent = handler => { events.add(handler); return () => { events.delete(handler) } }
  // These are local typed interface delegates. Every remote operation still uses
  // its named HTTP route, bound to the explicitly attached source Workspace.
  for (const name of ['connect', 'disconnect', 'workspaceContext'] as const) {
    const local = platform.desktop[name] as (...args: any[]) => any
    ;(platform.desktop as any)[name] = (target: string, ...args: any[]) => {
      const source = target !== viewId ? contexts.get(target)?.platform.desktop : undefined
      return source ? (source[name] as (...args: any[]) => any)(target, ...args) : local(target, ...args)
    }
  }
  for (const group of ['files', 'resources', 'commands', 'git', 'cron', 'messenger', 'conversation'] as const) {
    const methods = platform.desktop[group] as Record<string, (...args: any[]) => any>
    for (const [name, local] of Object.entries(methods)) methods[name] = (target: string, ...args: any[]) => {
      const source = target !== viewId ? contexts.get(target)?.platform.desktop[group] as typeof methods | undefined : undefined
      return source ? source[name]!(target, ...args) : local(target, ...args)
    }
  }
  journals.set(viewId, platform.backup)
  const own = platform.backup
  platform.backup = {
    stage: input => (journals.get(input.workspaceTabId) || own).stage(input),
    delete: identity => (journals.get(identity.workspaceTabId) || own).delete(identity),
    flush: () => Promise.all([...journals.values()].map(journal => journal.flush())),
    load: async () => (await Promise.all([...journals.values()].map(journal => journal.load()))).flat(),
  }
}

export async function attachBrowserWorkspace(workspaceId: string): Promise<BrowserWorkspaceContext> {
  const existing = [...contexts.values()].find(context => context.workspace.id === workspaceId)
  if (existing) return existing
  let pending = attachments.get(workspaceId)
  if (!pending) {
    pending = (async () => {
      const { createBrowserPlatform } = await import('./browser')
      await createBrowserPlatform({ workspaceId, reference: true })
      const context = [...contexts.values()].find(context => context.workspace.id === workspaceId)
      if (!context) throw new Error('Source Workspace could not be attached')
      return context
    })()
    attachments.set(workspaceId, pending)
    void pending.catch(() => { attachments.delete(workspaceId) })
  }
  return pending
}
