import type { ServerEvent, TransportCursor } from '@hulala/workbench-contracts'

export interface EventSocketData {
  kind: 'events'
}

export class EventHub {
  private readonly clients = new Set<Bun.ServerWebSocket<EventSocketData>>()
  private readonly epoch = crypto.randomUUID()
  private sequence = 0
  private readonly listeners = new Set<(event: ServerEvent) => void>()

  subscribe(listener: (event: ServerEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  cursor(): TransportCursor { return { epoch: this.epoch, seq: this.sequence } }

  add(socket: Bun.ServerWebSocket<EventSocketData>): void {
    this.clients.add(socket)
    socket.send(JSON.stringify({ type: 'conversation.reset', reason: 'reconnected', transportCursor: this.cursor() }))
  }

  remove(socket: Bun.ServerWebSocket<EventSocketData>): void {
    this.clients.delete(socket)
  }

  emit(event: ServerEvent): void {
    for (const listener of this.listeners) listener(event)
    const payload = JSON.stringify({ ...event, transportCursor: { epoch: this.epoch, seq: ++this.sequence } })
    for (const client of this.clients) {
      try {
        if (client.getBufferedAmount() > 8 * 1024 * 1024 || client.send(payload) === 0) {
          client.close(1013, 'Reconnect to refresh the current state')
          this.clients.delete(client)
        }
      } catch {
        this.clients.delete(client)
      }
    }
  }
}
