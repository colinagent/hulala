export type ConversationPrimaryButtonMode = 'continue' | 'send' | 'queue' | 'stop';
export type ConversationSubmitIntent = 'noop' | 'command' | 'queue_steering' | 'submit_prompt' | 'continue_thread';

export function supportsSkillOnlySubmission(skillSlug: string | null | undefined): boolean {
  return (skillSlug || '').trim().toLowerCase() === 'plan';
}

export function hasConversationSubmissionContent(input: {
  draft: string;
  selectedSkillSlug?: string | null;
}): boolean {
  return input.draft.trim().length > 0 || supportsSkillOnlySubmission(input.selectedSkillSlug);
}

export function resolveConversationSubmitIntent(input: {
  isCommandMode: boolean;
  isSelectedTargetInProgress: boolean;
  hasSubmissionContent: boolean;
  canContinueSelectedThread: boolean;
}): ConversationSubmitIntent {
  const {
    isCommandMode,
    isSelectedTargetInProgress,
    hasSubmissionContent,
    canContinueSelectedThread,
  } = input;

  if (isCommandMode) {
    return isSelectedTargetInProgress ? 'noop' : 'command';
  }
  if (isSelectedTargetInProgress) {
    return hasSubmissionContent ? 'queue_steering' : 'noop';
  }
  if (hasSubmissionContent) {
    return 'submit_prompt';
  }
  if (canContinueSelectedThread) {
    return 'continue_thread';
  }
  return 'noop';
}

export function getConversationPrimaryButtonMode(input: {
  isCommandMode: boolean;
  isSelectedTargetInProgress: boolean;
  hasSubmissionContent: boolean;
  canContinueSelectedThread: boolean;
}): ConversationPrimaryButtonMode {
  const {
    isCommandMode,
    isSelectedTargetInProgress,
    hasSubmissionContent,
    canContinueSelectedThread,
  } = input;

  if (isCommandMode) {
    return isSelectedTargetInProgress ? 'stop' : 'send';
  }
  if (isSelectedTargetInProgress) {
    return hasSubmissionContent ? 'queue' : 'stop';
  }
  if (hasSubmissionContent) {
    return 'send';
  }
  if (canContinueSelectedThread) {
    return 'continue';
  }
  return 'send';
}
