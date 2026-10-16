import { z } from 'zod'
import type { ConversationPromptInput } from '@hulala/workbench-contracts'
import type { WorkbenchPlatform } from '../types/platform'
import { PromptRequest } from './promptRequest'

const imageSchema = z.object({ uploadId: z.string().uuid(), mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), name: z.string().optional() })
const payloadSchema = z.object({ sessionId: z.string().min(1), text: z.string(), images: z.array(imageSchema).max(19), pending: z.object({ fingerprint: z.string(), id: z.string().uuid() }).optional() })
export type ComposerImage = z.infer<typeof imageSchema>
export type ConversationDraft = z.infer<typeof payloadSchema> & { id: string; revision: number }
const EDITOR = 'conversation-draft'

/** A draft belongs to this browser view, including its delivery identity and image receipts. */
export class ConversationDrafts {
  private drafts: ConversationDraft[] = []
  private selected = new Map<string, string>()
  private listeners = new Set<() => void>()
  private loading?: Promise<void>
  ready = false
  failure?: string
  constructor(private readonly viewId: string, private readonly backup: WorkbenchPlatform['backup']) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.drafts
  private emit() { this.drafts = [...this.drafts]; for (const listener of this.listeners) listener() }
  async load(): Promise<void> {
    if (!this.loading) this.loading = (async () => {
      const records = await this.backup.load()
      for (const record of records.filter(item => item.editorId === EDITOR && item.workspaceTabId === this.viewId).sort((a, b) => b.timestamp - a.timestamp)) {
        const parsed = payloadSchema.safeParse(JSON.parse(record.content))
        if (!parsed.success) throw new Error('A saved conversation draft could not be read. Its backup has been kept.')
        if (!this.drafts.some(item => item.id === record.id)) this.drafts.push({ ...parsed.data, id: record.id, revision: record.contentVersion })
      }
      this.ready = true
      this.emit()
    })().catch(error => { this.loading = undefined; throw error })
    return this.loading
  }
  current(sessionId: string): ConversationDraft | undefined {
    return this.drafts.find(item => item.id === this.selected.get(sessionId)) ?? this.drafts.find(item => item.sessionId === sessionId)
  }
  select(sessionId: string, id: string) { if (this.drafts.some(item => item.id === id && item.sessionId === sessionId)) { this.selected.set(sessionId, id); this.emit() } }
  private persist(draft: ConversationDraft) {
    draft.revision++
    const { id, revision, ...payload } = draft
    this.backup.stage({ version: 1, id, workspaceTabId: this.viewId, editorId: EDITOR, title: 'Conversation draft', content: JSON.stringify(payload), contentVersion: revision })
    this.emit()
  }
  edit(sessionId: string, change: Partial<Pick<ConversationDraft, 'text' | 'images'>>) {
    if (!this.ready) throw new Error('Conversation drafts are still loading')
    let draft = this.current(sessionId)
    if (!draft) { draft = { id: crypto.randomUUID(), revision: 0, sessionId, text: '', images: [] }; this.drafts.unshift(draft) }
    Object.assign(draft, change)
    if (!draft.text && !draft.images.length && !draft.pending) {
      const deleting = this.backup.delete({ workspaceTabId: this.viewId, id: draft.id })
      this.drafts = this.drafts.filter(item => item !== draft)
      this.emit()
      void deleting.catch(error => { this.failure = error instanceof Error ? error.message : 'Draft deletion failed'; this.emit() })
      return
    }
    this.persist(draft)
  }
  async prepare(sessionId: string, input: ConversationPromptInput): Promise<string> {
    const draft = this.current(sessionId)
    if (!draft) throw new Error('Conversation draft is missing')
    const request = new PromptRequest(draft.pending)
    const id = request.identity(sessionId, input)
    draft.pending = request.snapshot()
    this.persist(draft)
    await this.backup.flush()
    return id
  }
  async accepted(sessionId: string, submitted: { text: string; images: ComposerImage[]; id: string }) {
    const draft = this.drafts.find(item => item.sessionId === sessionId && item.id === submitted.id)
    if (!draft) return
    if (draft.text === submitted.text) draft.text = ''
    const sent = new Set(submitted.images.map(image => image.uploadId))
    draft.images = draft.images.filter(image => !sent.has(image.uploadId))
    draft.pending = undefined
    if (draft.text || draft.images.length) { this.persist(draft); return }
    const deleting = this.backup.delete({ workspaceTabId: this.viewId, id: draft.id })
    this.drafts = this.drafts.filter(item => item !== draft)
    this.emit()
    await deleting
  }
}

const journals = new Map<string, ConversationDrafts>()
export function getConversationDrafts(viewId: string): ConversationDrafts {
  let journal = journals.get(viewId)
  if (!journal) { journal = new ConversationDrafts(viewId, window.hulala!.backup); journals.set(viewId, journal) }
  return journal
}
