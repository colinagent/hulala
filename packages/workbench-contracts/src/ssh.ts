import { z } from 'zod'

const safeName = z.string().trim().min(1).max(255).refine(value => !/[\x00-\x1f\x7f]/.test(value))
export const sshHostSchema = z.object({
  id: z.uuid(), alias: safeName, hostname: safeName,
  user: safeName, port: z.coerce.number().int().min(1).max(65535).default(22),
  authMethod: z.enum(['agent', 'keyFile', 'password']),
  identityFile: z.string().max(32768).optional(),
  source: z.enum(['manual', 'config']).default('manual'),
  credentialID: z.uuid().optional(),
  credentialStorage: z.enum(['system', 'session']).optional(),
  hasPassword: z.boolean().optional(), hasPassphrase: z.boolean().optional(),
  proxyConfigured: z.boolean().optional(),
})
export type SshHost = z.infer<typeof sshHostSchema>
export const saveSshHostSchema = sshHostSchema.omit({ id: true, credentialID: true, credentialStorage: true, hasPassword: true, hasPassphrase: true, source: true, proxyConfigured: true }).extend({
  id: z.uuid().optional(), password: z.string().max(65536).optional(), passphrase: z.string().max(65536).optional(),
  rememberSecret: z.boolean().default(true),
}).strict()
export type SaveSshHost = z.infer<typeof saveSshHostSchema>
export const connectSshSchema = z.object({ hostId: z.uuid(), path: z.string().min(1).max(32768).optional() }).strict()
export const trustSshSchema = z.object({ fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/) }).strict()
