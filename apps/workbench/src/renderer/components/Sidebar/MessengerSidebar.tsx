import React, { useEffect, useMemo } from 'react';

import { useAppStore } from '../../store/appStore';
import { useMessengerStore } from '../../store/messengerStore';
import { useUiStore } from '../../store/uiStore';
import { useToastStore } from '../../store/toastStore';

function formatTime(value?: string): string {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function MessengerSidebar() {
  const refresh = useAppStore((state) => state.refreshMessenger);
  const loadChannel = useAppStore((state) => state.loadMessengerChannel);
  const archiveChannel = useAppStore((state) => state.archiveMessengerChannel);
  const channels = useMessengerStore((state) => state.channels);
  const messages = useMessengerStore((state) => state.messages);
  const openConversation = useUiStore((state) => state.openConversation);
  const pushToast = useToastStore((state) => state.pushToast);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sessions = useMemo(() => channels
    .filter((channel) => channel.threadID)
    .sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || '')), [channels]);
  const unattached = useMemo(() => messages.filter((message) => !message.record?.threadID), [messages]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar-bg">
      <div className="ui-tabbar sidebar-root-header flex shrink-0 items-center border-b border-border px-3">
        <div className="truncate text-sm font-medium text-prime-text">Messenger</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {sessions.length === 0 && unattached.length === 0 ? (
          <div className="px-3 py-6 text-sm text-secondary-text">No messages</div>
        ) : null}
        {sessions.map((session) => (
          <div key={session.channelID} className="group flex items-start gap-1 px-2 py-1">
            <button
              type="button"
              className="min-w-0 flex-1 rounded px-2 py-2 text-left hover:bg-hover-bg"
              onClick={() => {
                void loadChannel(session.channelID).catch((error) => pushToast(error instanceof Error ? error.message : 'Failed to load messages'));
                openConversation({ kind: 'session', sessionId: session.threadID });
              }}
            >
              <span className="block truncate text-sm text-prime-text">{session.title || session.threadID}</span>
              <span className="mt-0.5 block truncate text-xs text-secondary-text">{session.lastMessage?.body || session.threadID}</span>
              <span className="mt-1 block text-[10px] text-secondary-text">{formatTime(session.updatedAt)}</span>
            </button>
            <button
              type="button"
              className="mt-2 rounded px-1.5 py-1 text-xs text-secondary-text opacity-0 hover:text-prime-text group-hover:opacity-100"
              aria-label="Archive message"
              onClick={() => void archiveChannel(session.channelID).catch((error) => pushToast(error instanceof Error ? error.message : 'Failed to archive message'))}
            >
              ×
            </button>
          </div>
        ))}
        {unattached.map((message) => (
          <div key={message.id} className="mx-2 my-1 rounded border border-border px-2 py-2">
            <div className="truncate text-sm text-prime-text">{message.title}</div>
            <div className="mt-1 whitespace-pre-wrap text-xs text-secondary-text">{message.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
