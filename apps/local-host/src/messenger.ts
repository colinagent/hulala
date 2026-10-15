import type { ServerDatabase } from './database.ts'
import type { EventHub } from './events.ts'
import { HttpError } from './http.ts'
import { createHash } from 'node:crypto'

export interface MessageRecord {
  id: string
  workspaceId: string
  threadId: string | null
  kind: string
  title: string
  body: string
  readAt: string | null
  archivedAt: string | null
  createdAt: string
}

interface MessageRow {
  id: string
  workspace_id: string
  thread_id: string | null
  kind: string
  title: string
  body: string
  read_at: string | null
  archived_at: string | null
  created_at: string
}

function record(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    threadId: row.thread_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    readAt: row.read_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  }
}

export class MessengerService {
  private readonly replies = new Map<string, { fingerprint: string; promise: Promise<{ record: MessageRecord; resolved: MessageRecord }> }>()
  constructor(private readonly database: ServerDatabase, private readonly events: EventHub) {}

  list(options: { workspaceId?: string; includeArchived?: boolean } = {}): MessageRecord[] {
    const clauses: string[] = []
    const values: string[] = []
    if (options.workspaceId) { clauses.push('workspace_id = ?'); values.push(options.workspaceId) }
    if (!options.includeArchived) clauses.push('archived_at IS NULL')
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    return (this.database.db.query(`SELECT * FROM messages${where} ORDER BY created_at DESC LIMIT 500`).all(...values) as MessageRow[]).map(record)
  }

  get(id: string): MessageRecord {
    const row = this.database.db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | null
    if (!row) throw new HttpError(404, 'message_not_found', `message not found: ${id}`)
    return record(row)
  }

  create(input: { workspaceId: string; threadId?: string; kind: string; title: string; body: string }): MessageRecord {
    const now = new Date().toISOString()
    const message: MessageRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      threadId: input.threadId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body,
      readAt: null,
      archivedAt: null,
      createdAt: now,
    }
    this.database.db.query(`
      INSERT INTO messages (id, workspace_id, thread_id, kind, title, body, read_at, archived_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(message.id, message.workspaceId, message.threadId, message.kind, message.title, message.body, null, null, now)
    this.events.emit({ type: 'messenger.changed', messageId: message.id })
    return message
  }

  update(id: string, action: 'read' | 'unread' | 'archive' | 'restore'): MessageRecord {
    const existing = this.get(id)
    if ((action === 'read' && existing.readAt) || (action === 'unread' && !existing.readAt) || (action === 'archive' && existing.archivedAt) || (action === 'restore' && !existing.archivedAt)) return existing
    const now = new Date().toISOString()
    const assignment = action === 'read' ? ['read_at', now]
      : action === 'unread' ? ['read_at', null]
        : action === 'archive' ? ['archived_at', now]
          : ['archived_at', null]
    const result = this.database.db.query(`UPDATE messages SET ${assignment[0]} = ? WHERE id = ?`).run(assignment[1], id)
    if (result.changes === 0) throw new HttpError(404, 'message_not_found', `message not found: ${id}`)
    const row = this.database.db.query('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow
    this.events.emit({ type: 'messenger.changed', messageId: id })
    return record(row)
  }

  async reply(id: string, text: string, requestId: string, deliver: (sessionId: string, text: string, requestId: string) => Promise<unknown>): Promise<{ record: MessageRecord; resolved: MessageRecord }> {
    const fingerprint = createHash('sha256').update(text).digest('hex')
    const pending = this.replies.get(id)
    if (pending) {
      if (pending.fingerprint !== fingerprint) throw new HttpError(409, 'message_already_replied', 'A different reply is already being sent. Continue in the conversation.')
      return pending.promise
    }
    const promise = this.deliverReply(id, text, requestId, fingerprint, deliver)
    this.replies.set(id, { fingerprint, promise })
    try { return await promise } finally { this.replies.delete(id) }
  }
  private async deliverReply(id: string, text: string, requestId: string, fingerprint: string, deliver: (sessionId: string, text: string, requestId: string) => Promise<unknown>) {
    const target = this.get(id)
    if (!target.threadId || target.kind === 'user-reply') throw new HttpError(409, 'message_not_replyable', 'Open the conversation to continue')
    const row = this.database.db.query('SELECT * FROM message_replies WHERE message_id = ?').get(id) as { request_id: string; fingerprint: string; state: string; reply_message_id: string | null } | null
    if (row && row.fingerprint !== fingerprint) throw new HttpError(409, 'message_already_replied', 'This message already has a different reply. Continue in the conversation.')
    if (row?.state === 'accepted') return { record: row.reply_message_id ? this.get(row.reply_message_id) : target, resolved: this.get(id) }
    if (!row) this.database.db.query("INSERT INTO message_replies (message_id, request_id, fingerprint, state) VALUES (?, ?, ?, 'pending')").run(id, requestId, fingerprint)
    // A restart or lost HTTP response reuses the native prompt's durable identity.
    await deliver(target.threadId, text, row?.request_id || requestId)
    return this.database.db.transaction(() => {
      const reply = this.create({ workspaceId: target.workspaceId, threadId: target.threadId!, kind: 'user-reply', title: target.title, body: text })
      this.database.db.query("UPDATE message_replies SET state = 'accepted', reply_message_id = ? WHERE message_id = ?").run(reply.id, id)
      return { record: this.update(reply.id, 'read'), resolved: this.update(id, 'read') }
    })()
  }
}
