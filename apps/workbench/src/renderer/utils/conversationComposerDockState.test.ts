import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getConversationPrimaryButtonMode,
  hasConversationSubmissionContent,
  resolveConversationSubmitIntent,
} from './conversationComposerDockState';

test('primary button stays on send when the selected target is idle', () => {
  assert.equal(
    getConversationPrimaryButtonMode({
      isCommandMode: false,
      isSelectedTargetInProgress: false,
      canContinueSelectedThread: false,
      hasSubmissionContent: true,
    }),
    'send',
  );
});

test('primary button switches to queue only for the running conversation', () => {
  assert.equal(
    getConversationPrimaryButtonMode({
      isCommandMode: false,
      isSelectedTargetInProgress: true,
      canContinueSelectedThread: false,
      hasSubmissionContent: true,
    }),
    'queue',
  );
});

test('primary button stays on stop for a running chat without submission content', () => {
  assert.equal(
    getConversationPrimaryButtonMode({
      isCommandMode: false,
      isSelectedTargetInProgress: true,
      canContinueSelectedThread: true,
      hasSubmissionContent: false,
    }),
    'stop',
  );
});

test('primary button switches to continue for idle continuable thread without submission content', () => {
  assert.equal(
    getConversationPrimaryButtonMode({
      isCommandMode: false,
      isSelectedTargetInProgress: false,
      canContinueSelectedThread: true,
      hasSubmissionContent: false,
    }),
    'continue',
  );
});

test('primary button stays on send when idle continuable thread also has submission content', () => {
  assert.equal(
    getConversationPrimaryButtonMode({
      isCommandMode: false,
      isSelectedTargetInProgress: false,
      canContinueSelectedThread: true,
      hasSubmissionContent: true,
    }),
    'send',
  );
});

test('submit intent queues steering when running chat receives new submission content', () => {
  assert.equal(
    resolveConversationSubmitIntent({
      isCommandMode: false,
      isSelectedTargetInProgress: true,
      canContinueSelectedThread: false,
      hasSubmissionContent: true,
    }),
    'queue_steering',
  );
});

test('submit intent continues idle thread only when no submission content exists', () => {
  assert.equal(
    resolveConversationSubmitIntent({
      isCommandMode: false,
      isSelectedTargetInProgress: false,
      canContinueSelectedThread: true,
      hasSubmissionContent: false,
    }),
    'continue_thread',
  );
});

test('submit intent treats provided submission content as a prompt', () => {
  assert.equal(
    resolveConversationSubmitIntent({
      isCommandMode: false,
      isSelectedTargetInProgress: false,
      canContinueSelectedThread: true,
      hasSubmissionContent: true,
    }),
    'submit_prompt',
  );
});

test('ordinary selected skills still require user text', () => {
  assert.equal(
    hasConversationSubmissionContent({
      draft: '',
      selectedSkillSlug: 'agent-browser-search',
    }),
    false,
  );
  assert.equal(
    hasConversationSubmissionContent({
      draft: 'latest OpenAI news',
      selectedSkillSlug: 'agent-browser-search',
    }),
    true,
  );
});

test('plan skill can submit without typed text', () => {
  assert.equal(
    hasConversationSubmissionContent({
      draft: ' \n\t ',
      selectedSkillSlug: 'Plan',
    }),
    true,
  );
});
