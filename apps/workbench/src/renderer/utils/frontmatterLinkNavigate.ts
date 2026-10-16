import { useUiStore } from '../store/uiStore';
import { parseThreadLinkTarget } from './threadLink';

async function openThreadLink(threadID: string): Promise<void> {
  useUiStore.getState().openConversation({ kind: 'session', sessionId: threadID });
}

export async function navigateFrontmatterLink(target: string): Promise<void> {
  const trimmed = target.trim();
  if (!trimmed) {
    return;
  }
  const threadLink = parseThreadLinkTarget(trimmed);
  if (threadLink) {
    await openThreadLink(threadLink.threadID);
  }
}
