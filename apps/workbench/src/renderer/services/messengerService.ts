import { toMessengerRecord, type DesktopConnection } from './desktopConnection';
import type {
  MessengerChannelSummary,
  MessengerRecordAnswer,
  MessengerRecord,
} from '../store/messengerStore';

export type MessengerListResult = {
  channels?: MessengerChannelSummary[];
  messages?: MessengerRecord[];
};

export type MessengerChannelResult = {
  channelID?: string;
  threadID?: string;
  agentID?: string;
  messages?: MessengerRecord[];
};

export type MessengerReplyInput = {
  channelID: string;
  replyToMessageID?: string;
  text?: string;
  actionID?: string;
  answers?: MessengerRecordAnswer[];
  modelKey?: string;
  thinkingLevel?: string;
  contextWindow?: number;
  serviceTier?: string;
};

export type MessengerReplyResult = {
  record: MessengerRecord;
  resolved?: MessengerRecord | null;
};

export type MessengerArchiveInput = {
  channelID?: string;
  messageID?: string;
  agentID?: string;
  pendingRequestsOnly?: boolean;
};

export class MessengerService {
  constructor(private connection: DesktopConnection) {}
  private readonly requests = new Map<string, { text: string; id: string }>();

  private async records(includeArchived = false): Promise<MessengerRecord[]> {
    const result = await window.hulala!.desktop.messenger.list(this.connection.tabId, includeArchived) as { items?: Array<any> };
    return (result.items || []).map(toMessengerRecord) as MessengerRecord[];
  }

  async list(params: { threadID?: string; agentID?: string; limit?: number } = {}): Promise<MessengerListResult> {
    const messages = await this.records();
    const filtered = messages.filter((message) => !params.threadID || message.threadID === params.threadID);
    const channels = [...new Map([...filtered].reverse()
      .filter((message) => message.threadID)
      .map((message) => [message.channelID, {
        channelID: message.channelID,
        threadID: message.threadID,
        agentID: message.agentID,
        title: message.title,
        lastMessage: message,
        updatedAt: message.updatedAt,
      }])).values()];
    return { channels, messages: filtered };
  }

  async channel(params: {
    channelID?: string;
    threadID?: string;
    agentID?: string;
    pendingOnly?: boolean;
    limit?: number;
  }): Promise<MessengerChannelResult> {
    const messages = await this.records();
    return { channelID: params.channelID, threadID: params.threadID, agentID: params.agentID, messages: messages.filter((message) => !params.channelID || message.channelID === params.channelID) };
  }

  async reply(input: MessengerReplyInput): Promise<MessengerReplyResult> {
    const messages = await this.records(true);
    const target = input.replyToMessageID ? messages.find(message => message.id === input.replyToMessageID)
      : messages.find((message) => message.sender !== 'user' && (message.channelID === input.channelID || message.id === input.channelID));
    if (!target) throw new Error('Message channel not found');
    const text = input.text || '';
    if (this.requests.get(target.id)?.text !== text) this.requests.set(target.id, { text, id: crypto.randomUUID() });
    const result = await window.hulala!.desktop.messenger.reply(this.connection.tabId, target.id, text, this.requests.get(target.id)!.id) as { record: Parameters<typeof toMessengerRecord>[0]; resolved: Parameters<typeof toMessengerRecord>[0] };
    this.requests.delete(target.id);
    return { record: toMessengerRecord(result.record), resolved: toMessengerRecord(result.resolved) };
  }

  async markRead(input: {
    channelID?: string;
    threadID?: string;
    agentID?: string;
    messageIDs?: string[];
  }): Promise<{ acked: number }> {
    const messages = await this.records(true);
    const targets = messages.filter((message) =>
      input.messageIDs?.includes(message.id)
      || (input.channelID && message.channelID === input.channelID)
      || (input.threadID && message.threadID === input.threadID));
    await Promise.all(targets.map((message) => window.hulala!.desktop.messenger.update(this.connection.tabId, message.id, 'read')));
    return { acked: targets.length };
  }

  async archive(input: MessengerArchiveInput): Promise<{ archived: number }> {
    const messages = await this.records(true);
    const targets = messages.filter((message) =>
      (input.messageID && message.id === input.messageID)
      || (input.channelID && message.channelID === input.channelID)
      || (input.agentID && message.agentID === input.agentID));
    await Promise.all(targets.map((message) => window.hulala!.desktop.messenger.update(this.connection.tabId, message.id, 'archive')));
    return { archived: targets.length };
  }
}

export function createMessengerService(connection: DesktopConnection): MessengerService {
  return new MessengerService(connection);
}
