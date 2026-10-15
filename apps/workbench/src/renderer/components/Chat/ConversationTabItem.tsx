import React from 'react';
import { CloseButton, LoaderIcon } from '../Icons';
import {
  TAB_CLOSE_BUTTON_DELAYED_REVEAL_CLASS,
  TAB_ITEM_FLEX_STYLE,
  getTabCloseButtonClassName,
  getTabShellClassName,
} from '../tabLayout';

export type HarnessConversationRunStatus = 'idle' | 'running' | 'complete' | 'waiting';

function ConversationStatusLight({ status }: { status: HarnessConversationRunStatus }) {
  if (status === 'idle') return <span className="conversation-status-light-slot" aria-hidden="true" />;
  return (
    <span
      className="conversation-status-light-slot"
      title={status === 'running' ? 'Conversation running' : status === 'waiting' ? 'Conversation waiting for your input' : 'AI response complete'}
      role="img"
      aria-label={status === 'running' ? 'Conversation running' : status === 'waiting' ? 'Conversation waiting for your input' : 'AI response complete'}
    >
      {status === 'running'
        ? <LoaderIcon className="conversation-status-spinner" />
        : <span className="conversation-status-light" data-status={status === 'waiting' ? 'awaiting_user' : 'complete'} />}
    </span>
  );
}

export function ConversationTabItem({
  title,
  buttonTitle,
  closeLabel,
  isSelected,
  status,
  onSelect,
  onClose,
  onContextMenu,
}: {
  title: string;
  buttonTitle: string;
  closeLabel: string;
  isSelected: boolean;
  status: HarnessConversationRunStatus;
  onSelect: () => void;
  onClose: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const shellClassName = getTabShellClassName(false, isSelected ? 'conversation-tab-selected' : '');
  const titleClassName = [
    'min-w-0 flex-1 truncate',
    isSelected ? 'conversation-tab-selected-title' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={shellClassName} style={TAB_ITEM_FLEX_STYLE} onContextMenu={onContextMenu}>
      <button type="button" className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-sm" onClick={onSelect} title={buttonTitle}>
        <ConversationStatusLight status={status} />
        <span className={titleClassName}>{title}</span>
      </button>
      <CloseButton
        className={getTabCloseButtonClassName('bg-editor-bg', TAB_CLOSE_BUTTON_DELAYED_REVEAL_CLASS)}
        onClick={onClose}
        aria-label={closeLabel}
        variant="inline"
      />
    </div>
  );
}
