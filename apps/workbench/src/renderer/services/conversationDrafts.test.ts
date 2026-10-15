import { expect, test } from 'bun:test'
import { ConversationDrafts } from './conversationDrafts'
import type { RecoveryBackupRecord } from '../../shared/recoveryBackup'
import type { WorkbenchPlatform } from '../types/platform'

function fixture(initial: RecoveryBackupRecord[] = []) {
  const records = new Map(initial.map(record => [record.id, record]))
  const backup: WorkbenchPlatform['backup'] = {
    load: async () => [...records.values()], stage: input => { records.set(input.id, { ...input, timestamp: Date.now() }) },
    flush: async () => ({}), delete: async input => { records.delete(input.id) },
  }
  return { records, backup }
}
test('reload retains image receipts and the exact request identity until acknowledgement', async () => {
  const { backup, records } = fixture()
  const journal = new ConversationDrafts('view', backup)
  await journal.load()
  const image = { uploadId: crypto.randomUUID(), mediaType: 'image/png' as const, name: '图片.png' }
  journal.edit('chat', { text: '中文 draft', images: [image] })
  const input = { mode: 'queue' as const, content: [{ type: 'text' as const, text: '中文 draft' }, { type: 'image' as const, ...image }] }
  const requestId = await journal.prepare('chat', input)
  const reloaded = new ConversationDrafts('view', backup)
  await reloaded.load()
  expect(reloaded.current('chat')?.images).toEqual([image])
  expect(await reloaded.prepare('chat', input)).toBe(requestId)
  const submitted = structuredClone(reloaded.current('chat')!)
  reloaded.edit('chat', { text: 'New text typed during send' })
  await reloaded.accepted('chat', submitted)
  expect(reloaded.current('chat')).toMatchObject({ text: 'New text typed during send', images: [], pending: undefined })
  await reloaded.accepted('chat', structuredClone(reloaded.current('chat')!))
  expect(records.size).toBe(0)
  expect(reloaded.current('chat')).toBeUndefined()
})
test('distinct recovered drafts of the same conversation remain selectable without merging or deletion', async () => {
  const { backup, records } = fixture()
  const journal = new ConversationDrafts('view', backup)
  for (const [id, text] of [['a', 'first'], ['b', 'second']]) backup.stage({ version: 1, id, workspaceTabId: 'view', editorId: 'conversation-draft', title: 'Draft', content: JSON.stringify({ sessionId: 'chat', text, images: [] }), contentVersion: 3 })
  backup.stage({ version: 1, id: 'foreign', workspaceTabId: 'other', editorId: 'conversation-draft', title: 'Draft', content: JSON.stringify({ sessionId: 'chat', text: 'other tab', images: [] }), contentVersion: 1 })
  await journal.load()
  expect(journal.snapshot()).toHaveLength(2)
  journal.select('chat', 'b')
  expect(journal.current('chat')?.text).toBe('second')
  expect(records.size).toBe(3)
})
