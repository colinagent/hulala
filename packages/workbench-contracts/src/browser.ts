import { z } from 'zod'

export const browserWorkspaceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(255),
  path: z.string().min(1).max(32768),
  kind: z.enum(['local', 'remote']),
  hostId: z.string().optional(),
  hostLabel: z.string().optional(),
  createdAt: z.string(),
})
export type BrowserWorkspace = z.infer<typeof browserWorkspaceSchema>
export const browserWorkspaceListSchema = z.object({ version: z.literal(1), items: z.array(browserWorkspaceSchema) })
export const openWorkspaceSchema = z.object({ path: z.string().min(1).max(32768) }).strict()
export const createBrowserWorkspaceSchema = z.object({ name: z.string().trim().min(1).max(128) }).strict()
export interface BrowserServiceInfo {
  version: string
  source: 'source' | 'archive' | 'standalone' | 'npm' | 'npx' | 'bun' | 'pnpm'
  updateCommand: string | null
  restartCommand: string | null
}

export interface BrowserBootstrap {
  workspace: BrowserWorkspace
  nativeWorkspace: { id: string; name: string; path: string }
  instanceId: string
  version: string
  protocol: number
  service: BrowserServiceInfo
  platform: NodeJS.Platform
  homeDir: string
  defaultDir: string
  settingsRoot: string
  remote?: { hostLabel: string; workspaceDir: string; instanceId: string; runtimeVersion: string; platform: string; arch: string }
  remoteHost?: { id: string; alias: string; hostname: string; user: string; port: string; source: string; authMethod: 'agent' | 'keyFile' | 'password' }
}
