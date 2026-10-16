/** Versioned contract for explicitly installed, trusted workbench plugins. */
export const PLUGIN_API_VERSION = 1
export type Dispose = () => void | Promise<void>
export interface Validator<T> { parse(input: unknown): T }
export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: 1
  description?: string
  backend: string
  ui: string
  styles?: string[]
}
export interface InstalledPlugin {
  manifest: PluginManifest
  revision: string
  enabled: boolean
  state: 'disabled' | 'active' | 'failed'
  error?: string
}
export interface ModelIdentity { provider: string; model: string; reasoningEffort?: string }
export interface AnalysisResult { text: string; model: ModelIdentity }
export interface PluginBackendContext {
  id: string
  /** A plugin-owned directory; never a user's workspace. */
  dataDir: string
  signal: AbortSignal
  settings: { read(): Promise<unknown>; write(value: unknown): Promise<void> }
  secrets: {
    resolve(name: string): Promise<string | undefined>
    describe(name: string): Promise<{ configured: boolean }>
    set(name: string, value: string): Promise<void>
    unset(name: string): Promise<void>
  }
  ai: {
    currentModel(): Promise<ModelIdentity>
    analyze(input: { system: string; prompt: string; signal?: AbortSignal; maxTokens?: number; model?: ModelIdentity }): Promise<AnalysisResult>
  }
  rpc: {
    register<I, O>(method: string, input: Validator<I>, output: Validator<O>, handler: (input: I) => O | Promise<O>): Dispose
  }
  events: { emit<T>(topic: string, schema: Validator<T>, value: T): void }
  schedule(intervalMs: number, task: () => void | Promise<void>, immediate?: boolean): Dispose
  onDispose(dispose: Dispose): void
  log(level: 'info' | 'error', message: string): void
}
export interface PluginBackend { activate(context: PluginBackendContext): void | Dispose | Promise<void | Dispose> }
export interface PluginView {
  id: string
  title: string
  /** Stroke paths on a 24 × 24 canvas; rendered with the host icon style. */
  icon?: { paths: readonly string[] }
  /** Secondary views can be reached through plugin navigation without another rail icon. */
  showInRail?: boolean
  mount(container: HTMLElement): void | Dispose
}
export interface PluginNavigation {
  title: string
  items: readonly { viewId: string; title: string }[]
}
export interface PluginUiContext {
  rpc<T = unknown>(method: string, input?: unknown): Promise<T>
  on(topic: string, listener: (data: unknown) => void): Dispose
  registerView(view: PluginView): Dispose
  registerSettings(view: PluginView): Dispose
  registerNavigation(navigation: PluginNavigation): Dispose
  registerCommand(command: { id: string; title: string; run(): void | Promise<void> }): Dispose
  openView(id: string): void
  openExternal(url: string): Promise<void>
  /** Writes directly through the native bridge; returns presence only. */
  configureSecret(name: string): Promise<boolean>
  unsetSecret(name: string): Promise<void>
}
export interface PluginUi { activate(context: PluginUiContext): void | Dispose | Promise<void | Dispose> }
export interface PluginEvent { seq: number; pluginId: string; topic: string; data: unknown }
export interface LocalPluginBridge {
  assetUrl?(id: string, revision: string, file: string): string
  list(): Promise<InstalledPlugin[]>
  install(): Promise<InstalledPlugin | null>
  enable(id: string, enabled: boolean): Promise<void>
  uninstall(id: string): Promise<void>
  rollback(id: string, revision: string): Promise<{ restored: boolean }>
  rpc(id: string, method: string, input?: unknown): Promise<unknown>
  events(after: number): Promise<{ cursor: number; events: PluginEvent[] }>
  configureSecret(id: string, name: string): Promise<boolean>
  unsetSecret(id: string, name: string): Promise<void>
  openExternal(url: string): Promise<void>
}
