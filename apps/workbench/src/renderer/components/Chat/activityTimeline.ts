import type { ConversationItem } from '@hulala/workbench-contracts';

type ConversationMessageItem = Extract<ConversationItem, { kind: 'message' }>;

export type ActivityTimelineEntry =
  | {
      kind: 'item';
      item: ConversationItem;
      showAvatar: boolean;
    }
  | {
      kind: 'internal-group';
      id: string;
      items: ConversationMessageItem[];
      showAvatar: boolean;
    };

function isInternalMessage(item: ConversationItem): item is ConversationMessageItem {
  return item.kind === 'message' && (item.role === 'system' || item.role === 'context');
}

function shouldShowAvatar(items: ConversationItem[], index: number): boolean {
  const current = items[index];
  if (current.kind === 'message' && current.role === 'user') return true;
  if (index === 0) return true;
  const previous = items[index - 1];
  const previousKind = previous.kind === 'message' ? previous.role : previous.kind;
  return !['assistant', 'tool'].includes(previousKind);
}

export function buildActivityTimeline(items: ConversationItem[]): ActivityTimelineEntry[] {
  const timeline: ActivityTimelineEntry[] = [];
  let index = 0;

  while (index < items.length) {
    const item = items[index];
    if (!isInternalMessage(item)) {
      timeline.push({ kind: 'item', item, showAvatar: shouldShowAvatar(items, index) });
      index += 1;
      continue;
    }

    const firstIndex = index;
    const internalItems: ConversationMessageItem[] = [];
    while (index < items.length && isInternalMessage(items[index])) {
      internalItems.push(items[index] as ConversationMessageItem);
      index += 1;
    }

    if (internalItems.length === 1) {
      timeline.push({
        kind: 'item',
        item: internalItems[0],
        showAvatar: shouldShowAvatar(items, firstIndex),
      });
      continue;
    }

    timeline.push({
      kind: 'internal-group',
      id: `internal-group:${internalItems[0].id}`,
      items: internalItems,
      showAvatar: shouldShowAvatar(items, firstIndex),
    });
  }

  return timeline;
}
