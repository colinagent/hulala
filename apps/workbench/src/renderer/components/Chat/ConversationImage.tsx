import { useEffect, useState } from 'react';
import type { ConversationContent } from '@hulala/workbench-contracts';
import { loadConversationAttachment } from '../../services/conversationService';

type ImagePart = Extract<ConversationContent, { type: 'image' }>;
type ImageProps = { tabId: string; sessionId: string; part: ImagePart };

function ImageSource({ tabId, sessionId, part }: ImageProps) {
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setSource('');
    setFailed(false);
    void (async () => {
      try {
        const source = part.attachmentId ? (await loadConversationAttachment(tabId, sessionId, part.attachmentId)).url
          : part.data ? `data:${part.mediaType};base64,${part.data}` : '';
        if (!source) throw new Error('Image data is unavailable');
        if (active) setSource(source);
      } catch {
        // IPC can throw synchronously as well as reject. Neither should escape
        // this effect and unmount the desktop's React root.
        if (active) setFailed(true);
      }
    })();
    return () => { active = false; };
  }, [part.attachmentId, part.data, part.mediaType, sessionId, tabId]);

  if (failed) return <span className="hulala-activity-image-state" role="status">Image unavailable</span>;
  if (!source) return <span className="hulala-activity-image-state" role="status">Loading image…</span>;
  return <img className="hulala-activity-image" src={source} alt={part.name || 'Conversation attachment'} onError={() => setFailed(true)} />;
}

export function ConversationImage(props: ImageProps) {
  // Message IDs and attachment positions can repeat across sessions. Reset the
  // old source immediately instead of briefly displaying another chat's image.
  return <ImageSource key={JSON.stringify([props.tabId, props.sessionId, props.part.attachmentId, props.part.mediaType])} {...props} />;
}
