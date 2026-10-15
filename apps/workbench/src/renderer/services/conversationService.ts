import type {
  ConversationInteractionAnswer,
  ConversationModelSelectionInput,
  ConversationOpenResult,
  ConversationPromptInput,
  ConversationQueueUpdateInput,
  ConversationSession,
  ConversationSnapshot,
} from '@hulala/workbench-contracts';
import { conversationAgentPresetsSchema } from '@hulala/workbench-contracts';

function api() {
  const conversation = window.hulala?.desktop?.conversation;
  if (!conversation) throw new Error('Hulala conversation API is unavailable');
  return conversation;
}

export function openConversation(
  tabId: string,
  path: string | undefined,
  intent: { kind: 'workspace'; preferredSessionId?: string } | { kind: 'session'; sessionId: string },
): Promise<ConversationOpenResult> {
  return api().open(tabId, path, intent);
}

export function createConversation(tabId: string, path?: string, agentPreset?: string): Promise<ConversationOpenResult> {
  return api().create(tabId, path, agentPreset);
}

export function listConversations(tabId: string, path?: string): Promise<{ items: ConversationSession[] }> {
  return api().list(tabId, path);
}

export function loadConversationHistory(
  tabId: string,
  sessionId: string,
  beforeSeq?: number,
  maxMessages = 200,
): Promise<ConversationSnapshot> {
  return api().history(tabId, sessionId, beforeSeq, maxMessages);
}

export function copyConversationSessionPath(tabId: string, sessionId: string): Promise<{ copied: true }> {
  return api().copySessionPath(tabId, sessionId);
}

export function sendConversationPrompt(tabId: string, sessionId: string, input: ConversationPromptInput): Promise<{ accepted: true }> {
  return api().send(tabId, sessionId, input);
}

export function cancelConversation(tabId: string, sessionId: string): Promise<{ accepted: true }> {
  return api().cancel(tabId, sessionId);
}

export function forkConversation(tabId: string, sessionId: string, atSeq?: number): Promise<{ sessionId: string }> {
  return api().fork(tabId, sessionId, atSeq);
}

export function renameConversation(tabId: string, sessionId: string, title: string) {
  return api().rename(tabId, sessionId, title);
}

export function archiveConversation(tabId: string, sessionId: string) {
  return api().archive(tabId, sessionId);
}

export function loadConversationModels(tabId: string, sessionId: string) {
  return api().models(tabId, sessionId);
}

export function selectConversationModel(tabId: string, sessionId: string, selection: ConversationModelSelectionInput) {
  return api().selectModel(tabId, sessionId, selection);
}

export function selectConversationAgentPreset(tabId: string, sessionId: string, agentPreset: string) {
  return api().selectAgentPreset(tabId, sessionId, agentPreset);
}

export function updateConversationQueue(tabId: string, sessionId: string, itemId: string, action: ConversationQueueUpdateInput) {
  return api().updateQueue(tabId, sessionId, itemId, action);
}

export function answerConversationInteraction(tabId: string, interactionId: string, answer: ConversationInteractionAnswer) {
  return api().answerInteraction(tabId, interactionId, answer);
}

export function loadConversationAttachment(tabId: string, sessionId: string, attachmentId: string) {
  return api().loadAttachment(tabId, sessionId, attachmentId);
}

export function listConversationSkills(tabId: string, sessionId: string) {
  return api().listSkills(tabId, sessionId);
}

export function listConversationCommands(tabId: string, sessionId: string) {
  return api().listCommands(tabId, sessionId);
}

export function executeConversationCommand(
  tabId: string,
  sessionId: string,
  line: string,
  images: Array<{ mediaType: string; uploadId: string; name?: string }> = [],
) {
  return api().executeCommand(tabId, sessionId, line, images);
}

export function listConversationSubagents(tabId: string, sessionId: string) {
  return api().listSubagents(tabId, sessionId);
}

export async function listConversationAgentPresets(tabId: string) {
  return conversationAgentPresetsSchema.parse(await api().listAgentPresets(tabId));
}
