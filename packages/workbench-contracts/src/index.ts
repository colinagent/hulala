import { z } from 'zod'

export const HULALA_DIRECTORY_NAMES = [
  'config',
  'desktop',
  'server',
  'runtime',
  'logs',
  'cache',
  'transfers',
  'workspace',
] as const

export type HulalaDirectoryName = typeof HULALA_DIRECTORY_NAMES[number]

export interface HulalaPaths {
  root: string
  config: string
  desktop: string
  server: string
  runtime: string
  logs: string
  cache: string
  transfers: string
  workspaceRoot: string
  workspace: string
}

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
})

export type ApiError = z.infer<typeof apiErrorSchema>

export const providerAuthorizationPromptOptionSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string().min(1).max(512),
  description: z.string().max(2_048).optional(),
})

export const providerAuthorizationPromptSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().uuid(),
    kind: z.literal('text'),
    message: z.string().min(1).max(4_096),
    placeholder: z.string().max(4_096).optional(),
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('secret'),
    message: z.string().min(1).max(4_096),
    placeholder: z.string().max(4_096).optional(),
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('select'),
    message: z.string().min(1).max(4_096),
    options: z.array(providerAuthorizationPromptOptionSchema).min(1).max(32),
  }),
])

export const providerAuthorizationAttemptSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['running', 'authorized', 'cancelled', 'failed']),
  notice: z.object({
    message: z.string().min(1).max(4_096),
    url: z.string().url().optional(),
    code: z.string().min(1).max(512).optional(),
  }).optional(),
  prompt: providerAuthorizationPromptSchema.optional(),
  error: z.string().min(1).max(4_096).optional(),
  configurationError: z.string().min(1).max(4_096).optional(),
})

export const openAICodexProviderAuthStateSchema = z.object({
  available: z.boolean(),
  configured: z.boolean(),
  writable: z.boolean(),
  providerReady: z.boolean(),
  apiKeyOverride: z.boolean(),
  label: z.string().min(1).max(512).optional(),
  methods: z.array(z.object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(512),
  })).max(16),
  attempt: providerAuthorizationAttemptSchema.optional(),
})

export type OpenAICodexProviderAuthState = z.infer<typeof openAICodexProviderAuthStateSchema>

export const providerAuthorizationAnswerInputSchema = z.object({
  attemptId: z.string().uuid(),
  promptId: z.string().uuid(),
  value: z.string().max(8_192),
})

export const providerAuthorizationCancelInputSchema = z.object({
  attemptId: z.string().uuid(),
})

export const healthSchema = z.object({
  name: z.literal('hulala-desktop-server'),
  version: z.string(),
  instanceId: z.string().min(1),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  runtime: z.object({
    state: z.enum(['disabled', 'starting', 'running', 'stopping', 'stopped', 'failed']),
    url: z.string().url().optional(),
    error: z.string().optional(),
  }),
})

export type Health = z.infer<typeof healthSchema>

export const workspaceSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
})

export type Workspace = z.infer<typeof workspaceSchema>

export const workspaceInputSchema = z.object({ path: z.string().min(1) })
export const managedWorkspaceInputSchema = z.object({ name: z.string() })
export const workspaceListSchema = z.object({ items: z.array(workspaceSchema) })

export const workspacePathInputSchema = z.object({
  workspaceId: z.string().min(1),
  path: z.string(),
})

export const fileTextInputSchema = workspacePathInputSchema.extend({
  content: z.string(),
  // null means create only; replacement must carry the version that was read.
  expectedVersion: z.string().min(1).max(4096).nullable(),
})
export const fileMoveInputSchema = z.object({
  workspaceId: z.string().min(1),
  from: z.string(),
  to: z.string(),
})

export const fileStatSchema = z.object({
  version: z.string().min(1),
  path: z.string(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  isDir: z.boolean(),
  modTime: z.number(),
  mode: z.number().int(),
})

export const fileDirectorySchema = z.object({
  path: z.string(),
  entries: z.array(z.object({
    name: z.string(),
    isDir: z.boolean(),
    size: z.number().int().nonnegative(),
    modTime: z.number(),
  })),
})

export const commandInputSchema = z.object({
  workspaceId: z.string().min(1),
  command: z.union([z.array(z.string().max(100_000)).min(1).max(1000), z.string().trim().min(1).max(100_000)]),
  cwd: z.string().optional(),
  requestId: z.string().uuid().optional(),
})
export const commandWriteInputSchema = z.object({ data: z.string().max(65536) })

export const commandSnapshotSchema = z.object({
  id: z.string().uuid(), workspaceId: z.string(), command: z.array(z.string()), cwd: z.string(),
  startedAt: z.string(), finishedAt: z.string().optional(),
  state: z.enum(['running', 'stopping', 'exited', 'stopped', 'interrupted', 'failed']),
  exitCode: z.number().int().nullable().optional(), stdout: z.string().max(512 * 1024), stderr: z.string().max(512 * 1024),
  truncated: z.boolean(), error: z.string().optional(),
})
export type CommandSnapshot = z.infer<typeof commandSnapshotSchema>
export type CommandSummary = Omit<CommandSnapshot, 'stdout' | 'stderr'>

export const gitCheckoutInputSchema = z.object({
  workspaceId: z.string().min(1),
  branch: z.string().min(1),
  create: z.boolean().optional(),
})

export const cronScheduleSchema = z.object({
  cron: z.string().trim().min(1).max(256).optional(),
  every: z.string().trim().min(1).max(64).optional(),
  time: z.string().trim().min(1).max(128).optional(),
  timeZone: z.string().trim().min(1).max(128).optional(),
}).refine(value => [value.cron, value.every, value.time].filter(Boolean).length === 1, 'Choose one schedule rule')
export type CronSchedule = z.infer<typeof cronScheduleSchema>
export const cronInputSchema = z.object({
  name: z.string().trim().min(1).max(500),
  workspaceId: z.string().min(1),
  schedule: cronScheduleSchema,
  prompt: z.string().trim().min(1).max(100_000),
  description: z.string().max(10_000).optional(),
  cwd: z.string().max(32768).optional(),
  modelKey: z.string().max(1024).optional(),
  expectedRevision: z.number().int().positive().optional(),
  requestId: z.string().uuid().optional(),
  enabled: z.boolean().optional(),
})
export type CronInput = z.infer<typeof cronInputSchema>

export const messageUpdateInputSchema = z.object({ action: z.enum(['read', 'unread', 'archive', 'restore']) })
export const messageReplyInputSchema = z.object({ text: z.string().trim().min(1).max(100_000), requestId: z.string().uuid().optional() })

export const conversationSessionIdSchema = z.string().min(1).max(256)

export const conversationSessionLocationSchema = z.object({
  sessionId: conversationSessionIdSchema,
  kind: z.string().min(1).max(64),
  path: z.string().min(1),
})

export type ConversationSessionLocation = z.infer<typeof conversationSessionLocationSchema>

export const conversationIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace'), workspaceId: z.string().min(1), preferredSessionId: conversationSessionIdSchema.optional() }),
  z.object({ kind: z.literal('session'), workspaceId: z.string().min(1), sessionId: conversationSessionIdSchema }),
])

export type ConversationIntent = z.infer<typeof conversationIntentSchema>

export const conversationCreateInputSchema = z.object({
  workspaceId: z.string().min(1),
  agentPreset: z.string().min(1).optional(),
})

/** Selects the composition for a blank Harness session. */
export const conversationAgentPresetSelectionSchema = z.object({
  agentPreset: z.string().min(1),
})

export type ConversationAgentPresetSelection = z.infer<typeof conversationAgentPresetSelectionSchema>

const conversationTextContentSchema = z.object({ type: z.literal('text'), text: z.string() })

const conversationImageContentSchema = z.object({
  type: z.literal('image'),
  uploadId: z.string().uuid().optional(),
  attachmentId: z.string().min(1).optional(),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  data: z.string().optional(),
  name: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().positive().optional(),
})

export const conversationContentSchema = z.discriminatedUnion('type', [
  conversationTextContentSchema,
  conversationImageContentSchema,
])

export type ConversationContent = z.infer<typeof conversationContentSchema>

export const conversationAssistantBlockSchema = z.discriminatedUnion('type', [
  conversationTextContentSchema,
  conversationImageContentSchema,
  z.object({ type: z.literal('reasoning'), text: z.string() }),
  z.object({
    type: z.literal('tool-call'),
    callId: z.string(),
    name: z.string(),
    argumentsText: z.string(),
  }),
  z.object({ type: z.literal('unknown'), value: z.unknown() }),
])

export type ConversationAssistantBlock = z.infer<typeof conversationAssistantBlockSchema>

export const conversationAssistantChunkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text-delta'), text: z.string() }),
  z.object({ type: z.literal('reasoning-delta'), text: z.string() }),
  z.object({ type: z.literal('block-end'), block: conversationAssistantBlockSchema }),
])

export type ConversationAssistantChunk = z.infer<typeof conversationAssistantChunkSchema>

export const conversationSessionSchema = z.object({
  sessionId: conversationSessionIdSchema,
  workspaceId: z.string().min(1).optional(),
  title: z.string(),
  cwd: z.string().optional(),
  updatedAt: z.number(),
  running: z.boolean(),
  blank: z.boolean(),
  archived: z.boolean(),
  agentPreset: z.string().optional(),
  parentSessionId: conversationSessionIdSchema.optional(),
  origin: z.literal('subagent').optional(),
})

export type ConversationSession = z.infer<typeof conversationSessionSchema>

const conversationItemBaseSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  time: z.number(),
})

export const conversationMessageItemSchema = conversationItemBaseSchema.extend({
  kind: z.literal('message'),
  role: z.enum(['user', 'system', 'context']),
  turn: z.number().int().nonnegative().optional(),
  step: z.number().int().nonnegative().optional(),
  content: z.array(conversationContentSchema),
  sourceLabel: z.string().optional(),
})

export const conversationAssistantItemSchema = conversationItemBaseSchema.extend({
  kind: z.literal('assistant'),
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  messageId: z.string().min(1).optional(),
  blocks: z.array(conversationAssistantBlockSchema),
  status: z.enum(['running', 'settled', 'interrupted']),
})

export const conversationToolItemSchema = conversationItemBaseSchema.extend({
  kind: z.literal('tool'),
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  callId: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(['running', 'done', 'error', 'interrupted']),
  argumentsText: z.string(),
  resultText: z.string().optional(),
  view: z.unknown().optional(),
})

export const conversationNoticeItemSchema = conversationItemBaseSchema.extend({
  kind: z.literal('notice'),
  tone: z.enum(['neutral', 'warning', 'error', 'success']),
  label: z.string(),
  detail: z.string().optional(),
  eventType: z.string().optional(),
})

export const conversationItemSchema = z.discriminatedUnion('kind', [
  conversationMessageItemSchema,
  conversationAssistantItemSchema,
  conversationToolItemSchema,
  conversationNoticeItemSchema,
])

export type ConversationItem = z.infer<typeof conversationItemSchema>

export const conversationModelSelectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
})

export const conversationModelGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  models: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    reasoning: z.object({
      efforts: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string().optional() })),
      defaultEffort: z.string().optional(),
    }).optional(),
  })),
})

export const conversationProjectionSchema = z.object({
  asOfSeq: z.number().int().min(-1),
  values: z.record(z.string(), z.unknown()),
})

export type ConversationProjection = z.infer<typeof conversationProjectionSchema>

export const conversationQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  header: z.string().optional(),
  detail: z.string().optional(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })).optional(),
  multiSelect: z.boolean().optional(),
  intent: z.object({ kind: z.literal('plan-review'), approve: z.string() }).optional(),
})

export const pendingInteractionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('approval'),
    interactionId: z.string().min(1),
    sessionId: conversationSessionIdSchema,
    toolName: z.string(),
    callId: z.string().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal('question'),
    interactionId: z.string().min(1),
    sessionId: conversationSessionIdSchema,
    questions: z.array(conversationQuestionSchema).min(1),
  }),
])

export type PendingInteraction = z.infer<typeof pendingInteractionSchema>

export const conversationQueueItemSchema = z.object({
  id: z.string().min(1),
  placement: z.enum(['queued', 'steering', 'context']),
  content: z.array(conversationContentSchema),
})

export type ConversationQueueItem = z.infer<typeof conversationQueueItemSchema>

export const transportCursorSchema = z.object({ epoch: z.string().min(1).max(128), seq: z.number().int().nonnegative() })
export type TransportCursor = z.infer<typeof transportCursorSchema>

export const conversationSnapshotSchema = z.object({
  transportCursor: transportCursorSchema.optional(),
  session: conversationSessionSchema,
  items: z.array(conversationItemSchema),
  hasMore: z.boolean(),
  firstSeq: z.number().int().nonnegative().nullable(),
  lastSeq: z.number().int().min(-1),
  queue: z.array(conversationQueueItemSchema),
  pendingInteractions: z.array(pendingInteractionSchema),
  projections: conversationProjectionSchema,
})

export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>

export const conversationOpenResultSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  sessionId: conversationSessionIdSchema,
  sessions: z.array(conversationSessionSchema),
  snapshot: conversationSnapshotSchema,
})

export type ConversationOpenResult = z.infer<typeof conversationOpenResultSchema>

export const conversationHistoryQuerySchema = z.object({
  beforeSeq: z.number().int().nonnegative().optional(),
  maxMessages: z.number().int().positive().max(400).default(200),
})

export const conversationPromptInputSchema = z.object({
  requestId: z.string().uuid().optional(),
  mode: z.enum(['queue', 'steer']).default('queue'),
  content: z.array(conversationContentSchema).min(1).max(20),
  clientTimeZone: z.string().max(128).optional(),
})

export type ConversationPromptInput = z.infer<typeof conversationPromptInputSchema>

export const conversationQueueUpdateInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('edit'), content: z.array(conversationContentSchema).min(1).max(20) }),
  z.object({ kind: z.literal('remove') }),
  z.object({ kind: z.literal('steer') }),
])

export type ConversationQueueUpdateInput = z.infer<typeof conversationQueueUpdateInputSchema>

export const conversationModelSelectionInputSchema = conversationModelSelectionSchema
export type ConversationModelSelectionInput = z.infer<typeof conversationModelSelectionInputSchema>
export const conversationRenameInputSchema = z.object({ title: z.string().trim().min(1).max(500) })
export const conversationForkInputSchema = z.object({ atSeq: z.number().int().nonnegative().optional() })

export const conversationInteractionAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approval'), outcome: z.enum(['allowed-once', 'rejected']) }),
  z.object({
    kind: z.literal('question'),
    answer: z.object({
      answers: z.array(z.object({ id: z.string(), selected: z.array(z.string()), custom: z.string().optional() })),
    }),
  }),
  z.object({ kind: z.literal('cancel') }),
])

export type ConversationInteractionAnswer = z.infer<typeof conversationInteractionAnswerSchema>

export const conversationModelsSchema = z.object({
  current: conversationModelSelectionSchema,
  routable: z.boolean(),
  groups: z.array(conversationModelGroupSchema),
  failures: z.array(z.object({ id: z.string(), name: z.string(), message: z.string() })),
})

export const conversationSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  modelInvocable: z.boolean().optional(),
})

export const conversationCommandSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  input: z.object({ hint: z.string(), images: z.boolean().optional() }).optional(),
})

export type ConversationCommand = z.infer<typeof conversationCommandSchema>

export const conversationAgentPresetsSchema = z.object({
  presets: z.array(z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
    broken: z.string().optional(),
    isDefault: z.boolean().optional(),
  })),
})

export const conversationCommandInputSchema = z.object({
  line: z.string().trim().min(1).max(100_000),
  images: z.array(z.object({
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    uploadId: z.string().uuid(),
    name: z.string().optional(),
  })).max(20).default([]),
})

export const conversationSubagentSchema = z.union([
  z.object({
    kind: z.literal('child'),
    id: conversationSessionIdSchema,
    mode: z.enum(['one-shot', 'continuable']),
    activity: z.enum(['running', 'inactive']),
    hasChildren: z.boolean(),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal('diagnostic'),
    id: conversationSessionIdSchema,
    reason: z.enum(['corrupt', 'unsupported', 'unavailable']),
  }),
])

// Bound the private display's indexed block storage before allocating it.
export const MAX_CONVERSATION_BLOCKS = 4096
export const conversationBlockIndexSchema = z.number().int().nonnegative().max(MAX_CONVERSATION_BLOCKS - 1)

export const conversationDeltaSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('upsert'), item: conversationItemSchema }),
  z.object({ op: z.literal('remove'), id: z.string().min(1) }),
  z.object({
    op: z.literal('assistant-chunk'),
    id: z.string().min(1),
    anchorSeq: z.number().int().nonnegative(),
    anchorTime: z.number(),
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    index: conversationBlockIndexSchema,
    chunk: conversationAssistantChunkSchema,
  }),
])

export type ConversationDelta = z.infer<typeof conversationDeltaSchema>

/** Fold one normalized conversation delta into an identity-keyed read model. */
export function applyConversationDelta(
  items: Map<string, ConversationItem>,
  change: ConversationDelta,
): void {
  if (change.op === 'upsert') {
    items.set(change.item.id, change.item)
    return
  }
  if (change.op === 'remove') {
    items.delete(change.id)
    return
  }
  conversationBlockIndexSchema.parse(change.index)
  const previous = items.get(change.id)
  const previousBlocks = previous?.kind === 'assistant' ? previous.blocks : []
  // Harness may omit silent blocks, such as empty reasoning before text at
  // index 1. Reserve their positions with invisible text blocks. Sparse arrays
  // become explicit undefined entries when spread and break renderer previews
  // (and the conversation schema); filtering them would shift later indices.
  const blocks: ConversationAssistantBlock[] = Array.from(
    { length: Math.max(previousBlocks.length, change.index + 1) },
    (_, index) => previousBlocks[index] ?? { type: 'text', text: '' },
  )
  const current = blocks[change.index]
  if (change.chunk.type === 'text-delta') {
    blocks[change.index] = {
      type: 'text',
      text: (current?.type === 'text' ? current.text : '') + change.chunk.text,
    }
  } else if (change.chunk.type === 'reasoning-delta') {
    blocks[change.index] = {
      type: 'reasoning',
      text: (current?.type === 'reasoning' ? current.text : '') + change.chunk.text,
    }
  } else {
    blocks[change.index] = change.chunk.block
  }
  items.set(change.id, {
    kind: 'assistant',
    id: change.id,
    seq: change.anchorSeq,
    time: change.anchorTime,
    turn: change.turn,
    step: change.step,
    blocks,
    status: 'running',
  })
}

export const resourceHandleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
})
export const transferSchema = z.object({ id: z.string().uuid() })
export const transferCommitInputSchema = workspacePathInputSchema.extend({ expectedVersion: z.string().min(1).max(4096).nullable().default(null) })
export const transferCommitResultSchema = z.object({
  ok: z.literal(true),
  resource: resourceHandleSchema,
})
export type TransferCommitResult = z.infer<typeof transferCommitResultSchema>
export const resourceImportResultSchema = transferCommitResultSchema
export type ResourceImportResult = z.infer<typeof resourceImportResultSchema>

export const archiveInputSchema = z.object({
  workspaceId: z.string().min(1),
  olderThanDays: z.number().int().positive().max(3650),
  execute: z.boolean(),
})

export const fileEntrySchema: z.ZodType<FileEntry> = z.lazy(() => z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(['file', 'directory', 'symlink']),
  size: z.number().int().nonnegative().optional(),
  modifiedAt: z.string().datetime().optional(),
  children: z.array(fileEntrySchema).optional(),
}))

export interface FileEntry {
  name: string
  path: string
  kind: 'file' | 'directory' | 'symlink'
  size?: number
  modifiedAt?: string
  children?: FileEntry[]
}

const serverEventBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('filesystem.changed'), workspaceId: z.string(), paths: z.array(z.string()) }),
  z.object({ type: z.literal('command.changed'), commandId: z.string() }),
  z.object({ type: z.literal('conversation.turnEnded'), sessionId: z.string(), outcome: z.enum(['completed', 'failed', 'stopped', 'blocked']) }),
  z.object({ type: z.literal('command.exited'), commandId: z.string(), exitCode: z.number().nullable() }),
  z.object({ type: z.literal('cron.changed'), cronId: z.string() }),
  z.object({ type: z.literal('messenger.changed'), messageId: z.string() }),
  z.object({ type: z.literal('runtime.changed'), state: healthSchema.shape.runtime }),
  z.object({
    type: z.literal('conversation.delta'),
    transient: z.literal(true).optional(),
    sessionId: conversationSessionIdSchema,
    seq: z.number().int().nonnegative(),
    changes: z.array(conversationDeltaSchema),
  }),
  z.object({
    type: z.literal('conversation.status'),
    sessionId: conversationSessionIdSchema,
    running: z.boolean(),
    blank: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('conversation.queue'),
    sessionId: conversationSessionIdSchema,
    items: z.array(conversationQueueItemSchema),
  }),
  z.object({
    type: z.literal('conversation.interaction'),
    sessionId: conversationSessionIdSchema,
    interaction: pendingInteractionSchema.nullable(),
    resolvedInteractionId: z.string().optional(),
  }),
  z.object({
    type: z.literal('conversation.projection'),
    sessionId: conversationSessionIdSchema,
    key: z.string().min(1),
    value: z.unknown(),
    seq: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('conversation.sessionsChanged'),
    sessionId: conversationSessionIdSchema.optional(),
  }),
  z.object({
    type: z.literal('conversation.reset'),
    sessionId: conversationSessionIdSchema.optional(),
    reason: z.enum(['connected', 'reconnected', 'gap', 'runtime-changed', 'stream-error']),
  }),
])

export const serverEventSchema = z.intersection(serverEventBodySchema, z.object({ transportCursor: transportCursorSchema.optional() }))
export type ServerEvent = z.infer<typeof serverEventSchema>

export const connectionDescriptorSchema = z.object({
  httpUrl: z.string().url(),
  eventsUrl: z.string().url(),
  token: z.string().min(32),
  instanceId: z.string().min(1),
  authCookieName: z.string().regex(/^hulala_[A-Za-z0-9_]+$/),
})

export type ConnectionDescriptor = z.infer<typeof connectionDescriptorSchema>

export const API_PREFIX = '/api/desktop/v1'
export const CONNECTION_TOKEN_HEADER = 'x-hulala-token'
