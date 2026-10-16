import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatMessengerPendingBadgeCount,
  getMessengerChannelPendingRequestCount,
  isPendingMessengerRequest,
  selectMessengerAgentSummaries,
  selectMessengerPendingRequestTotal,
  useMessengerStore,
  type MessengerChannelSummary,
  type MessengerMessage,
  type MessengerRecord,
} from './messengerStore.ts';

function record(overrides: Partial<MessengerRecord> = {}): MessengerRecord {
  return {
    id: 'record-id',
    channelID: 'channel-id',
    threadID: 'thread-id',
    agentID: 'agent-coder',
    sender: 'agent',
    kind: 'request',
    status: 'open',
    title: 'Request',
    body: 'Body',
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

function channel(overrides: Partial<MessengerChannelSummary> = {}): MessengerChannelSummary {
  return {
    channelID: 'channel-id',
    threadID: 'thread-id',
    agentID: 'agent-coder',
    updatedAt: '2026-07-03T00:00:00.000Z',
    ...overrides,
  };
}

test('pending messenger requests are only open non-user request records', () => {
  assert.equal(isPendingMessengerRequest(record()), true);
  assert.equal(isPendingMessengerRequest(record({ status: 'resolved' })), false);
  assert.equal(isPendingMessengerRequest(record({ status: 'archived' })), false);
  assert.equal(isPendingMessengerRequest(record({ sender: 'user' })), false);
  assert.equal(isPendingMessengerRequest(record({ kind: 'message' })), false);
  assert.equal(isPendingMessengerRequest(record({ kind: 'status' })), false);
});

test('pending messenger badge counts cap display at ninety-nine plus', () => {
  assert.equal(formatMessengerPendingBadgeCount(0), '0');
  assert.equal(formatMessengerPendingBadgeCount(99), '99');
  assert.equal(formatMessengerPendingBadgeCount(100), '99+');
  assert.equal(formatMessengerPendingBadgeCount(104), '99+');
});

test('pending request counts use records and channel summary fallback', () => {
  const pending = record({ id: 'pending', channelID: 'channel-a', threadID: 'thread-a' });
  const resolved = record({ id: 'resolved', channelID: 'channel-a', threadID: 'thread-a', status: 'resolved' });
  const openMessage = record({ id: 'message', channelID: 'channel-a', threadID: 'thread-a', kind: 'message' });
  const userRequest = record({ id: 'user', channelID: 'channel-a', threadID: 'thread-a', sender: 'user' });
  const fallbackChannel = channel({
    channelID: 'channel-b',
    threadID: 'thread-b',
    openCount: 2,
    updatedAt: '2026-07-03T00:01:00.000Z',
  });
  const helperPending = record({
    id: 'helper',
    channelID: 'channel-c',
    threadID: 'thread-c',
    agentID: 'agent-helper',
    updatedAt: '2026-07-03T00:02:00.000Z',
  });

  assert.equal(
    getMessengerChannelPendingRequestCount(channel({ channelID: 'channel-a' }), [
      pending,
      resolved,
      openMessage,
      userRequest,
    ]),
    1,
  );
  assert.equal(getMessengerChannelPendingRequestCount(fallbackChannel), 2);

  const state = {
    channels: [
      channel({ channelID: 'channel-a', threadID: 'thread-a', lastMessage: pending }),
      fallbackChannel,
      channel({
        channelID: 'channel-c',
        threadID: 'thread-c',
        agentID: 'agent-helper',
        lastMessage: helperPending,
        updatedAt: '2026-07-03T00:02:00.000Z',
      }),
    ],
    recordsByID: {
      [pending.id]: pending,
      [resolved.id]: resolved,
      [openMessage.id]: openMessage,
      [userRequest.id]: userRequest,
      [helperPending.id]: helperPending,
    },
    messages: [],
  };

  assert.equal(selectMessengerPendingRequestTotal(state), 4);
  const summaries = selectMessengerAgentSummaries(state);
  assert.equal(summaries.find((summary) => summary.agentID === 'agent-coder')?.pendingRequestCount, 3);
  assert.equal(summaries.find((summary) => summary.agentID === 'agent-helper')?.pendingRequestCount, 1);
});

test('archiveAgentPendingRequests removes only target agent pending requests', () => {
  const pending = record({ id: 'pending', channelID: 'channel-a', threadID: 'thread-a' });
  const keptMessage = record({
    id: 'message',
    channelID: 'channel-a',
    threadID: 'thread-a',
    kind: 'message',
    updatedAt: '2026-07-03T00:01:00.000Z',
  });
  const helperPending = record({
    id: 'helper',
    channelID: 'channel-b',
    threadID: 'thread-b',
    agentID: 'agent-helper',
    updatedAt: '2026-07-03T00:02:00.000Z',
  });
  const fallbackPending = record({
    id: 'fallback',
    channelID: 'channel-c',
    threadID: 'thread-c',
  });
  const messageForPending: MessengerMessage = {
    id: `record:${pending.id}`,
    severity: 'warning',
    source: pending.agentID,
    title: pending.title || 'Request',
    body: pending.body,
    createdAt: 1,
    updatedAt: 1,
    read: false,
    record: pending,
  };

  useMessengerStore.setState({
    messages: [messageForPending],
    recordsByID: {
      [pending.id]: pending,
      [keptMessage.id]: keptMessage,
      [helperPending.id]: helperPending,
    },
    channels: [
      channel({ channelID: 'channel-a', threadID: 'thread-a', lastMessage: pending, openCount: 1 }),
      channel({ channelID: 'channel-b', threadID: 'thread-b', agentID: 'agent-helper', lastMessage: helperPending, openCount: 1 }),
      channel({ channelID: 'channel-c', threadID: 'thread-c', lastMessage: fallbackPending, openCount: 1 }),
    ],
    selectedAgentID: 'agent-coder',
    selectedChannelID: 'channel-a',
    unreadCount: 1,
  });

  useMessengerStore.getState().archiveAgentPendingRequests('agent-coder');

  const state = useMessengerStore.getState();
  assert.equal(state.recordsByID[pending.id], undefined);
  assert.equal(state.recordsByID[keptMessage.id]?.id, keptMessage.id);
  assert.equal(state.recordsByID[helperPending.id]?.id, helperPending.id);
  assert.equal(state.messages.some((message) => message.record?.id === pending.id), false);
  assert.equal(state.channels.some((item) => item.channelID === 'channel-c'), false);
  assert.equal(getMessengerChannelPendingRequestCount(state.channels.find((item) => item.channelID === 'channel-a')), 0);
  assert.equal(getMessengerChannelPendingRequestCount(state.channels.find((item) => item.channelID === 'channel-b')), 1);
});

test('archiveAgentMessages removes all target agent records and channels', () => {
  const pending = record({ id: 'pending', channelID: 'channel-a', threadID: 'thread-a' });
  const keptMessage = record({
    id: 'message',
    channelID: 'channel-a',
    threadID: 'thread-a',
    kind: 'message',
    updatedAt: '2026-07-03T00:01:00.000Z',
  });
  const helperPending = record({
    id: 'helper',
    channelID: 'channel-b',
    threadID: 'thread-b',
    agentID: 'agent-helper',
    updatedAt: '2026-07-03T00:02:00.000Z',
  });
  const messageForPending: MessengerMessage = {
    id: `record:${pending.id}`,
    severity: 'warning',
    source: pending.agentID,
    title: pending.title || 'Request',
    body: pending.body,
    createdAt: 1,
    updatedAt: 1,
    read: false,
    record: pending,
  };
  const messageForKept: MessengerMessage = {
    id: `record:${keptMessage.id}`,
    severity: 'info',
    source: keptMessage.agentID,
    title: keptMessage.title || 'Message',
    body: keptMessage.body,
    createdAt: 1,
    updatedAt: 1,
    read: false,
    record: keptMessage,
  };

  useMessengerStore.setState({
    messages: [messageForPending, messageForKept],
    recordsByID: {
      [pending.id]: pending,
      [keptMessage.id]: keptMessage,
      [helperPending.id]: helperPending,
    },
    channels: [
      channel({ channelID: 'channel-a', threadID: 'thread-a', lastMessage: keptMessage }),
      channel({ channelID: 'channel-b', threadID: 'thread-b', agentID: 'agent-helper', lastMessage: helperPending }),
    ],
    selectedAgentID: 'agent-coder',
    selectedChannelID: 'channel-a',
    unreadCount: 2,
  });

  useMessengerStore.getState().archiveAgentMessages('agent-coder');

  const state = useMessengerStore.getState();
  assert.equal(state.recordsByID[pending.id], undefined);
  assert.equal(state.recordsByID[keptMessage.id], undefined);
  assert.equal(state.recordsByID[helperPending.id]?.id, helperPending.id);
  assert.equal(state.messages.some((message) => message.record?.agentID === 'agent-coder'), false);
  assert.equal(state.channels.some((item) => item.agentID === 'agent-coder'), false);
  assert.equal(state.channels.some((item) => item.channelID === 'channel-b'), true);
  assert.equal(state.selectedAgentID, 'agent-helper');
  assert.equal(state.selectedChannelID, null);
});
