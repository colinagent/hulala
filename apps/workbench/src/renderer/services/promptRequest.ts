import type { ConversationPromptInput } from '@hulala/workbench-contracts'

/** Keep one logical delivery identity until the Host acknowledges it. */
export class PromptRequest {
  constructor(private pending?: { fingerprint: string; id: string }) {}
  snapshot(): { fingerprint: string; id: string } | undefined { return this.pending }
  identity(sessionId: string, input: ConversationPromptInput): string {
    const fingerprint = JSON.stringify([sessionId, input.mode, input.content])
    if (this.pending?.fingerprint !== fingerprint) this.pending = { fingerprint, id: crypto.randomUUID() }
    return this.pending.id
  }
  accepted(id: string): void { if (this.pending?.id === id) this.pending = undefined }
}
