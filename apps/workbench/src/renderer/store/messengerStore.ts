import { create } from 'zustand';

export type MessengerSeverity = 'info' | 'warning' | 'error';
export type MessengerAction = 'open-cron' | 'open-sync';

export type MessengerRecordAction = {
  id: string;
  label: string;
  tone?: 'primary' | 'danger';
};

export type MessengerRecordQuestionOption = {
  id: string;
  label: string;
};

export type MessengerRecordQuestion = {
  id: string;
  question: string;
  options?: MessengerRecordQuestionOption[];
};

export type MessengerRecordAnswer = {
  questionID: string;
  optionID?: string;
  label?: string;
  other?: boolean;
  text?: string;
};

export type MessengerRecord = {
  id: string;
  channelID: string;
  threadID: string;
  agentID: string;
  sender: 'user' | 'agent' | 'system';
  kind: 'message' | 'request' | 'status';
  status: 'open' | 'resolved' | 'archived';
  title?: string;
  body: string;
  actions?: MessengerRecordAction[];
  questions?: MessengerRecordQuestion[];
  replyToMessageID?: string;
  actionID?: string;
  answers?: MessengerRecordAnswer[];
  createdAt: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
};

export type MessengerChannelSummary = {
  channelID: string;
  threadID: string;
  agentID: string;
  title?: string;
  lastMessage?: MessengerRecord;
  openCount?: number;
  unreadUserCount?: number;
  updatedAt?: string;
};

export type MessengerMessage = {
  id: string;
  severity: MessengerSeverity;
  source: string;
  title: string;
  body: string;
  workspaceID?: string | null;
  workspacePath?: string | null;
  action?: MessengerAction | null;
  createdAt: number;
  updatedAt: number;
  read: boolean;
  record?: MessengerRecord | null;
};

export type MessengerAgentSummary = {
  agentID: string;
  title: string;
  subtitle: string;
  lastBody: string;
  lastUpdatedAt: number;
  unreadCount: number;
  openCount: number;
  pendingRequestCount: number;
  channelCount: number;
  latestChannelID: string | null;
  latestRecordID: string | null;
  workspacePath?: string | null;
};

type MessengerInput = Omit<MessengerMessage, 'createdAt' | 'updatedAt' | 'read' | 'record'>;

export type MessengerState = {
  messages: MessengerMessage[];
  recordsByID: Record<string, MessengerRecord>;
  channels: MessengerChannelSummary[];
  selectedChannelID: string | null;
  selectedAgentID: string | null;
  unreadCount: number;
  upsertMessage: (message: MessengerInput) => void;
  upsertRecord: (record: MessengerRecord) => void;
  setList: (channels: MessengerChannelSummary[], records?: MessengerRecord[]) => void;
  setChannelMessages: (channelID: string, records: MessengerRecord[]) => void;
  selectChannel: (channelID: string | null) => void;
  selectAgent: (agentID: string | null) => void;
  markAllRead: () => void;
  markAgentRead: (agentID: string) => void;
  removeMessage: (id: string) => void;
  archiveAgentPendingRequests: (agentID: string) => void;
  archiveAgentMessages: (agentID: string) => void;
  archiveChannel: (channelID: string) => void;
};

const MAX_MESSAGES = 80;

function parseRecordTime(value: string | undefined, fallback = Date.now()): number {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeID(value: string | null | undefined): string {
  return (value || '').trim();
}

function normalizeCount(value: number | null | undefined): number {
  return Number.isFinite(value) && value != null && value > 0
    ? Math.floor(value)
    : 0;
}

export function getMessengerAgentTitle(agentID: string | null | undefined): string {
  const normalized = normalizeID(agentID);
  if (!normalized) {
    return 'Agent';
  }
  const parts = normalized.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function severityForRecord(record: MessengerRecord): MessengerSeverity {
  if (record.status === 'archived' || record.status === 'resolved') {
    return 'info';
  }
  return record.kind === 'request' ? 'warning' : 'info';
}

export function isPendingMessengerRequest(record: MessengerRecord | null | undefined): boolean {
  return Boolean(
    record
      && record.kind === 'request'
      && record.status === 'open'
      && record.sender !== 'user',
  );
}

export function formatMessengerPendingBadgeCount(count: number): string {
  return normalizeCount(count) > 99 ? '99+' : String(normalizeCount(count));
}

function messageFromRecord(record: MessengerRecord, existing?: MessengerMessage): MessengerMessage {
  const updatedAt = parseRecordTime(record.updatedAt, existing?.updatedAt ?? Date.now());
  const createdAt = parseRecordTime(record.createdAt, existing?.createdAt ?? updatedAt);
  const title = (record.title || '').trim()
    || (record.kind === 'request' ? 'Agent request' : 'Agent message');
  return {
    id: `record:${record.id}`,
    severity: severityForRecord(record),
    source: record.agentID || 'Agent',
    title,
    body: record.body || '',
    workspaceID: typeof record.meta?.workspaceID === 'string' ? record.meta.workspaceID : null,
    workspacePath: typeof record.meta?.workspacePath === 'string' ? record.meta.workspacePath : null,
    action: null,
    createdAt,
    updatedAt,
    read: record.sender === 'user' ? true : (existing?.read ?? false),
    record,
  };
}

function rebuildUnread(messages: MessengerMessage[]): number {
  return messages.filter((message) => !message.read).length;
}

function sortMessages(messages: MessengerMessage[]): MessengerMessage[] {
  return [...messages]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_MESSAGES);
}

function upsertMessageInList(messages: MessengerMessage[], nextMessage: MessengerMessage): MessengerMessage[] {
  return sortMessages([
    nextMessage,
    ...messages.filter((item) => item.id !== nextMessage.id),
  ]);
}

function upsertChannel(channels: MessengerChannelSummary[], record: MessengerRecord): MessengerChannelSummary[] {
  const channelID = (record.channelID || '').trim();
  if (!channelID) {
    return channels;
  }
  const existing = channels.find((channel) => channel.channelID === channelID);
  const next: MessengerChannelSummary = {
    ...existing,
    channelID,
    threadID: record.threadID,
    agentID: record.agentID,
    title: existing?.title || record.title || undefined,
    lastMessage: record,
    openCount: isPendingMessengerRequest(record)
      ? Math.max(1, existing?.openCount ?? 0)
      : 0,
    unreadUserCount: existing?.unreadUserCount ?? 0,
    updatedAt: record.updatedAt,
  };
  return [next, ...channels.filter((channel) => channel.channelID !== channelID)]
    .sort((a, b) => parseRecordTime(b.updatedAt) - parseRecordTime(a.updatedAt));
}

function visibleChannels(channels: MessengerChannelSummary[]): MessengerChannelSummary[] {
  return channels
    .filter((channel) => normalizeID(channel.channelID) && normalizeID(channel.agentID))
    .sort((a, b) => parseRecordTime(b.updatedAt || b.lastMessage?.updatedAt) - parseRecordTime(a.updatedAt || a.lastMessage?.updatedAt));
}

function visibleRecords(recordsByID: Record<string, MessengerRecord>): MessengerRecord[] {
  return Object.values(recordsByID)
    .filter((record) => record?.id && record.status !== 'archived' && normalizeID(record.agentID))
    .sort((a, b) => parseRecordTime(a.createdAt || a.updatedAt) - parseRecordTime(b.createdAt || b.updatedAt));
}

function latestRecord(records: MessengerRecord[]): MessengerRecord | null {
  return records
    .filter((record) => record.status !== 'archived')
    .sort((a, b) => parseRecordTime(b.updatedAt || b.createdAt) - parseRecordTime(a.updatedAt || a.createdAt))[0] || null;
}

function uniqueRecords(records: MessengerRecord[]): MessengerRecord[] {
  const seen = new Set<string>();
  const result: MessengerRecord[] = [];
  for (const record of records) {
    const id = normalizeID(record.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(record);
  }
  return result;
}

function recordsByChannel(records: MessengerRecord[]): Record<string, MessengerRecord[]> {
  return records.reduce<Record<string, MessengerRecord[]>>((acc, record) => {
    const channelID = normalizeID(record.channelID);
    if (!channelID) {
      return acc;
    }
    acc[channelID] = acc[channelID] || [];
    acc[channelID].push(record);
    return acc;
  }, {});
}

function channelFromRecords(
  existing: MessengerChannelSummary | undefined,
  records: MessengerRecord[],
): MessengerChannelSummary | null {
  const last = latestRecord(records);
  if (!last) {
    return null;
  }
  return {
    ...existing,
    channelID: normalizeID(existing?.channelID) || normalizeID(last.channelID),
    threadID: normalizeID(last.threadID) || normalizeID(existing?.threadID),
    agentID: normalizeID(last.agentID) || normalizeID(existing?.agentID),
    title: existing?.title || last.title || undefined,
    lastMessage: last,
    openCount: records.filter(isPendingMessengerRequest).length,
    unreadUserCount: existing?.unreadUserCount ?? 0,
    updatedAt: last.updatedAt || existing?.updatedAt,
  };
}

function rebuildChannelsForAffected(
  channels: MessengerChannelSummary[],
  recordsByID: Record<string, MessengerRecord>,
  affectedChannelIDs: Set<string>,
): MessengerChannelSummary[] {
  if (affectedChannelIDs.size === 0) {
    return visibleChannels(channels);
  }
  const visible = visibleRecords(recordsByID);
  const grouped = recordsByChannel(visible);
  const nextByID = new Map<string, MessengerChannelSummary>();
  for (const channel of channels) {
    const channelID = normalizeID(channel.channelID);
    if (!channelID) {
      continue;
    }
    if (!affectedChannelIDs.has(channelID)) {
      nextByID.set(channelID, channel);
      continue;
    }
    const rebuilt = channelFromRecords(channel, grouped[channelID] || []);
    if (rebuilt) {
      nextByID.set(channelID, rebuilt);
    } else {
      nextByID.delete(channelID);
    }
  }
  for (const channelID of affectedChannelIDs) {
    if (nextByID.has(channelID)) {
      continue;
    }
    const rebuilt = channelFromRecords(undefined, grouped[channelID] || []);
    if (rebuilt) {
      nextByID.set(channelID, rebuilt);
    }
  }
  return visibleChannels(Array.from(nextByID.values()));
}

export function getMessengerChannelPendingRequestCount(
  channel: MessengerChannelSummary | null | undefined,
  records: MessengerRecord[] = [],
): number {
  if (!channel) {
    return 0;
  }
  const candidateRecords = uniqueRecords([
    ...records,
    ...(channel.lastMessage && channel.lastMessage.status !== 'archived' ? [channel.lastMessage] : []),
  ]);
  const recordCount = candidateRecords.filter(isPendingMessengerRequest).length;
  return Math.max(recordCount, normalizeCount(channel.openCount));
}

export function selectMessengerPendingRequestTotal(
  state: Pick<MessengerState, 'channels' | 'recordsByID'>,
): number {
  const records = visibleRecords(state.recordsByID);
  const recordsByChannelID = records.reduce<Record<string, MessengerRecord[]>>((acc, record) => {
    const channelID = normalizeID(record.channelID);
    if (!channelID) {
      return acc;
    }
    acc[channelID] = acc[channelID] || [];
    acc[channelID].push(record);
    return acc;
  }, {});

  return visibleChannels(state.channels).reduce((count, channel) => {
    const channelID = normalizeID(channel.channelID);
    return count + getMessengerChannelPendingRequestCount(
      channel,
      channelID ? (recordsByChannelID[channelID] || []) : [],
    );
  }, 0);
}

export function selectMessengerChannelsForAgent(
  state: Pick<MessengerState, 'channels'>,
  agentID: string | null | undefined,
): MessengerChannelSummary[] {
  const normalizedAgentID = normalizeID(agentID);
  if (!normalizedAgentID) {
    return [];
  }
  return visibleChannels(state.channels)
    .filter((channel) => normalizeID(channel.agentID) === normalizedAgentID);
}

export function selectMessengerRecordsForAgent(
  state: Pick<MessengerState, 'recordsByID'>,
  agentID: string | null | undefined,
): MessengerRecord[] {
  const normalizedAgentID = normalizeID(agentID);
  if (!normalizedAgentID) {
    return [];
  }
  return visibleRecords(state.recordsByID)
    .filter((record) => normalizeID(record.agentID) === normalizedAgentID);
}

export function selectMessengerAgentSummaries(
  state: Pick<MessengerState, 'channels' | 'recordsByID' | 'messages'>,
): MessengerAgentSummary[] {
  const records = visibleRecords(state.recordsByID);
  const messagesByRecordID = new Map(
    state.messages
      .filter((message) => message.record?.id)
      .map((message) => [message.record?.id || '', message]),
  );
  const recordsByChannelID = records.reduce<Record<string, MessengerRecord[]>>((acc, record) => {
    const channelID = normalizeID(record.channelID);
    if (!channelID) {
      return acc;
    }
    acc[channelID] = acc[channelID] || [];
    acc[channelID].push(record);
    return acc;
  }, {});
  const summariesByAgent = new Map<string, MessengerAgentSummary>();

  for (const channel of visibleChannels(state.channels)) {
    const agentID = normalizeID(channel.agentID);
    const channelID = normalizeID(channel.channelID);
    if (!agentID || !channelID) {
      continue;
    }
    const candidateRecords = uniqueRecords([
      ...(recordsByChannelID[channelID] || []),
      ...(channel.lastMessage && channel.lastMessage.status !== 'archived' ? [channel.lastMessage] : []),
    ]);
    const last = latestRecord(candidateRecords);
    const lastUpdatedAt = parseRecordTime(channel.updatedAt || last?.updatedAt || last?.createdAt, 0);
    const unreadCount = candidateRecords.reduce((count, record) => {
      if (record.sender === 'user') {
        return count;
      }
      const message = messagesByRecordID.get(record.id);
      return message && !message.read ? count + 1 : count;
    }, 0);
    const pendingRequestCount = getMessengerChannelPendingRequestCount(channel, candidateRecords);
    const openCount = channel.openCount ?? candidateRecords.filter((record) => record.status === 'open' && record.sender !== 'user').length;
    const existing = summariesByAgent.get(agentID);
    const nextLastUpdatedAt = Math.max(existing?.lastUpdatedAt ?? 0, lastUpdatedAt);
    const useLast = !existing || lastUpdatedAt >= existing.lastUpdatedAt;
    summariesByAgent.set(agentID, {
      agentID,
      title: getMessengerAgentTitle(agentID),
      subtitle: useLast
        ? (channel.title || last?.title || 'Agent conversation')
        : (existing?.subtitle || 'Agent conversation'),
      lastBody: useLast
        ? (last?.body || channel.title || '')
        : (existing?.lastBody || ''),
      lastUpdatedAt: nextLastUpdatedAt,
      unreadCount: (existing?.unreadCount ?? 0) + unreadCount,
      openCount: (existing?.openCount ?? 0) + openCount,
      pendingRequestCount: (existing?.pendingRequestCount ?? 0) + pendingRequestCount,
      channelCount: (existing?.channelCount ?? 0) + 1,
      latestChannelID: useLast ? channelID : (existing?.latestChannelID || null),
      latestRecordID: useLast ? (last?.id || null) : (existing?.latestRecordID || null),
      workspacePath: useLast
        ? (typeof last?.meta?.workspacePath === 'string' ? last.meta.workspacePath : null)
        : existing?.workspacePath,
    });
  }

  return Array.from(summariesByAgent.values())
    .sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
}

function nextSelectedAgentID(
  state: Pick<MessengerState, 'channels' | 'recordsByID' | 'messages'>,
  currentAgentID: string | null,
): string | null {
  const normalizedCurrent = normalizeID(currentAgentID);
  const summaries = selectMessengerAgentSummaries(state);
  if (normalizedCurrent && summaries.some((summary) => summary.agentID === normalizedCurrent)) {
    return normalizedCurrent;
  }
  return summaries[0]?.agentID ?? null;
}

export const useMessengerStore = create<MessengerState>((set) => ({
  messages: [],
  recordsByID: {},
  channels: [],
  selectedChannelID: null,
  selectedAgentID: null,
  unreadCount: 0,
  upsertMessage: (message) => set((state) => {
    const now = Date.now();
    const existing = state.messages.find((item) => item.id === message.id);
    const nextMessage: MessengerMessage = existing
      ? {
        ...existing,
        ...message,
        updatedAt: now,
        read: false,
      }
      : {
        ...message,
        createdAt: now,
        updatedAt: now,
        read: false,
        record: null,
      };
    const messages = upsertMessageInList(state.messages, nextMessage);
    return {
      messages,
      unreadCount: rebuildUnread(messages),
    };
  }),
  upsertRecord: (record) => set((state) => {
    if (!record?.id || !record.channelID || record.status === 'archived') {
      const archivedID = record?.id ? `record:${record.id}` : '';
      const nextRecordsByID = { ...state.recordsByID };
      if (record?.id) {
        delete nextRecordsByID[record.id];
      }
      const messages = archivedID
        ? state.messages.filter((message) => message.id !== archivedID)
        : state.messages;
      const affectedChannelIDs = new Set<string>();
      const archivedChannelID = normalizeID(record?.channelID);
      if (archivedChannelID) {
        affectedChannelIDs.add(archivedChannelID);
      }
      const channels = rebuildChannelsForAffected(state.channels, nextRecordsByID, affectedChannelIDs);
      return {
        recordsByID: nextRecordsByID,
        messages,
        channels,
        selectedAgentID: nextSelectedAgentID({
          channels,
          recordsByID: nextRecordsByID,
          messages,
        }, state.selectedAgentID),
        selectedChannelID: state.selectedChannelID && channels.some((channel) => channel.channelID === state.selectedChannelID)
          ? state.selectedChannelID
          : null,
        unreadCount: rebuildUnread(messages),
      };
    }
    const existingMessage = state.messages.find((item) => item.id === `record:${record.id}`);
    const nextMessage = messageFromRecord(record, existingMessage);
    const messages = upsertMessageInList(state.messages, nextMessage);
    const nextRecordsByID = {
      ...state.recordsByID,
      [record.id]: record,
    };
    const affectedChannelIDs = new Set([normalizeID(record.channelID)].filter(Boolean));
    const nextState = {
      recordsByID: nextRecordsByID,
      channels: rebuildChannelsForAffected(upsertChannel(state.channels, record), nextRecordsByID, affectedChannelIDs),
      messages,
    };
    return {
      ...nextState,
      selectedAgentID: nextSelectedAgentID(nextState, state.selectedAgentID),
      unreadCount: rebuildUnread(messages),
    };
  }),
  setList: (channels, records = []) => set((state) => {
    const visibleRecordIDs = new Set(records
      .filter((record) => record?.id && record.status !== 'archived')
      .map((record) => record.id));
    const recordsByID: Record<string, MessengerRecord> = {};
    let messages = state.messages.filter((message) => {
      const recordID = message.record?.id;
      return !recordID || visibleRecordIDs.has(recordID);
    });
    for (const record of records) {
      if (!record?.id || record.status === 'archived') {
        continue;
      }
      recordsByID[record.id] = record;
      messages = upsertMessageInList(messages, messageFromRecord(
        record,
        messages.find((message) => message.id === `record:${record.id}`),
      ));
    }
    const nextChannels = visibleChannels(channels);
    const nextState = {
      channels: nextChannels,
      recordsByID,
      messages,
    };
    const selectedAgentID = nextSelectedAgentID(nextState, state.selectedAgentID);
    const selectedChannelID = state.selectedChannelID && nextChannels.some((channel) => channel.channelID === state.selectedChannelID)
      ? state.selectedChannelID
      : nextChannels.find((channel) => channel.agentID === selectedAgentID)?.channelID ?? null;
    return {
      ...nextState,
      selectedAgentID,
      selectedChannelID,
      unreadCount: rebuildUnread(messages),
    };
  }),
  setChannelMessages: (channelID, records) => set((state) => {
    const recordsByID = { ...state.recordsByID };
    let messages = state.messages;
    let channels = state.channels;
    for (const record of records) {
      if (!record?.id || record.status === 'archived') {
        continue;
      }
      recordsByID[record.id] = record;
      messages = upsertMessageInList(messages, messageFromRecord(
        record,
        messages.find((message) => message.id === `record:${record.id}`),
      ));
    }
    const latest = latestRecord(records);
    if (latest?.channelID) {
      channels = upsertChannel(channels, latest);
    }
    const selectedAgentID = records.find((record) => normalizeID(record.agentID))?.agentID || state.selectedAgentID;
    return {
      selectedChannelID: channelID || state.selectedChannelID,
      selectedAgentID,
      channels,
      recordsByID,
      messages,
      unreadCount: rebuildUnread(messages),
    };
  }),
  selectChannel: (channelID) => set({ selectedChannelID: channelID }),
  selectAgent: (agentID) => set((state) => {
    const selectedAgentID = normalizeID(agentID) || null;
    const selectedChannelID = selectedAgentID
      ? selectMessengerChannelsForAgent(state, selectedAgentID)[0]?.channelID ?? state.selectedChannelID
      : null;
    return {
      selectedAgentID,
      selectedChannelID,
    };
  }),
  markAllRead: () => set((state) => {
    const messages = state.messages.map((message) => (
      message.read ? message : { ...message, read: true }
    ));
    return { messages, unreadCount: 0 };
  }),
  markAgentRead: (agentID) => set((state) => {
    const normalizedAgentID = normalizeID(agentID);
    if (!normalizedAgentID) {
      return {};
    }
    const messages = state.messages.map((message) => (
      message.record?.agentID === normalizedAgentID && !message.read
        ? { ...message, read: true }
        : message
    ));
    return {
      messages,
      unreadCount: rebuildUnread(messages),
    };
  }),
  removeMessage: (id) => set((state) => {
    const messages = state.messages.filter((message) => message.id !== id);
    return {
      messages,
      unreadCount: rebuildUnread(messages),
    };
  }),
  archiveAgentPendingRequests: (agentID) => set((state) => {
    const normalizedAgentID = normalizeID(agentID);
    if (!normalizedAgentID) {
      return {};
    }
    const archivedIDs = new Set<string>();
    const affectedChannelIDs = new Set<string>();
    for (const record of Object.values(state.recordsByID)) {
      if (normalizeID(record.agentID) !== normalizedAgentID || !isPendingMessengerRequest(record)) {
        continue;
      }
      archivedIDs.add(record.id);
      const channelID = normalizeID(record.channelID);
      if (channelID) {
        affectedChannelIDs.add(channelID);
      }
    }
    const nextRecordsByID = { ...state.recordsByID };
    for (const id of archivedIDs) {
      delete nextRecordsByID[id];
    }
    const channelsWithClearedFallback = state.channels.flatMap((channel) => {
      if (normalizeID(channel.agentID) !== normalizedAgentID) {
        return [channel];
      }
      const channelID = normalizeID(channel.channelID);
      if (channelID) {
        affectedChannelIDs.add(channelID);
      }
      if (channel.lastMessage && isPendingMessengerRequest(channel.lastMessage)) {
        return [];
      }
      return [{ ...channel, openCount: 0 }];
    });
    const messages = state.messages.filter((message) => {
      const recordID = message.record?.id;
      return !recordID || !archivedIDs.has(recordID);
    });
    const channels = rebuildChannelsForAffected(channelsWithClearedFallback, nextRecordsByID, affectedChannelIDs);
    const nextState = {
      channels,
      recordsByID: nextRecordsByID,
      messages,
    };
    return {
      ...nextState,
      selectedAgentID: nextSelectedAgentID(nextState, state.selectedAgentID),
      selectedChannelID: state.selectedChannelID && channels.some((channel) => channel.channelID === state.selectedChannelID)
        ? state.selectedChannelID
        : null,
      unreadCount: rebuildUnread(messages),
    };
  }),
  archiveAgentMessages: (agentID) => set((state) => {
    const normalizedAgentID = normalizeID(agentID);
    if (!normalizedAgentID) {
      return {};
    }
    const archivedIDs = new Set<string>();
    for (const record of Object.values(state.recordsByID)) {
      if (normalizeID(record.agentID) === normalizedAgentID) {
        archivedIDs.add(record.id);
      }
    }
    const nextRecordsByID = { ...state.recordsByID };
    for (const id of archivedIDs) {
      delete nextRecordsByID[id];
    }
    const channels = state.channels.filter((channel) => normalizeID(channel.agentID) !== normalizedAgentID);
    const messages = state.messages.filter((message) => normalizeID(message.record?.agentID) !== normalizedAgentID);
    const nextState = {
      channels,
      recordsByID: nextRecordsByID,
      messages,
    };
    return {
      ...nextState,
      selectedAgentID: nextSelectedAgentID(nextState, state.selectedAgentID),
      selectedChannelID: state.selectedChannelID && channels.some((channel) => channel.channelID === state.selectedChannelID)
        ? state.selectedChannelID
        : null,
      unreadCount: rebuildUnread(messages),
    };
  }),
  archiveChannel: (channelID) => set((state) => {
    const messages = state.messages.filter((message) => message.record?.channelID !== channelID);
    const channels = state.channels.filter((channel) => channel.channelID !== channelID);
    const recordsByID = { ...state.recordsByID };
    for (const record of Object.values(recordsByID)) {
      if (record.channelID === channelID) {
        delete recordsByID[record.id];
      }
    }
    const nextState = {
      channels,
      recordsByID,
      messages,
    };
    const selectedAgentID = nextSelectedAgentID(nextState, state.selectedAgentID);
    return {
      messages,
      channels,
      recordsByID,
      selectedChannelID: state.selectedChannelID === channelID ? null : state.selectedChannelID,
      selectedAgentID,
      unreadCount: rebuildUnread(messages),
    };
  }),
}));
