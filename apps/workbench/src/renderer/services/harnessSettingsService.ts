import type { OpenAICodexProviderAuthState } from '@hulala/workbench-contracts';
import type { HarnessSettingsNamespace } from '../types/platform';

export type HarnessSettingsDescription = {
  writable: boolean;
  hasDocument: boolean;
  namespaces: HarnessSettingsNamespace[];
};

export type HarnessProvider = {
  provider: string;
  displayName: string;
  settingsNs: string;
  settingsPath: string[];
  active: boolean;
  declared?: boolean;
};

export type HarnessCredentialState = {
  configured: boolean;
  source?: string;
  writable: boolean;
};

export type HarnessAgentPreset = {
  id: string;
  trust: 'system' | 'user';
  isDefault: boolean;
  name?: string;
  description?: string;
  broken?: string;
};

export type HarnessPluginEntry = {
  entryId: string;
  moduleName: string;
  enabled: boolean;
  fiberPhase: string;
};

type SettingsPathOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] };

function api() {
  const harness = window.hulala?.harness;
  if (!harness) throw new Error('Harness Runtime is unavailable');
  return harness;
}

export async function describeHarnessSettings(): Promise<HarnessSettingsDescription> {
  return api().settings.describe() as Promise<HarnessSettingsDescription>;
}

export async function mutateHarnessSettings(
  namespace: HarnessSettingsNamespace,
  ops: SettingsPathOp[],
): Promise<HarnessSettingsNamespace> {
  return api().settings.mutate({
    ns: namespace.ns,
    ops,
    expectedRevision: namespace.revision,
  }) as Promise<HarnessSettingsNamespace>;
}

export async function openHarnessSettingsDocument(): Promise<void> {
  await api().settings.openDocument();
}

export async function listHarnessProviders(): Promise<HarnessProvider[]> {
  const value = await api().llm.providers() as { providers: HarnessProvider[] };
  return orderHarnessProviders(value.providers);
}

export function orderHarnessProviders(providers: HarnessProvider[]): HarnessProvider[] {
  const codexIndex = providers.findIndex(provider => provider.provider === 'openai-codex');
  if (codexIndex < 0 || codexIndex === 1 || providers.length < 2) return providers;
  const codex = providers[codexIndex];
  const ordered = providers.filter((_provider, index) => index !== codexIndex);
  ordered.splice(1, 0, codex);
  return ordered;
}

export async function describeOpenAICodexAuthorization(): Promise<OpenAICodexProviderAuthState> {
  return api().providerAuth.describeOpenAICodex();
}

export async function startOpenAICodexAuthorization(): Promise<OpenAICodexProviderAuthState> {
  return api().providerAuth.startOpenAICodex();
}

export async function answerOpenAICodexAuthorization(
  attemptId: string,
  promptId: string,
  value: string,
): Promise<OpenAICodexProviderAuthState> {
  return api().providerAuth.answerOpenAICodex(attemptId, promptId, value);
}

export async function cancelOpenAICodexAuthorization(attemptId: string): Promise<OpenAICodexProviderAuthState> {
  return api().providerAuth.cancelOpenAICodex(attemptId);
}

export async function enableOpenAICodexProvider(): Promise<OpenAICodexProviderAuthState> {
  return api().providerAuth.enableOpenAICodex();
}

export async function signOutOpenAICodexAuthorization(): Promise<OpenAICodexProviderAuthState> {
  return api().providerAuth.signOutOpenAICodex();
}

export async function describeHarnessCredentials(refs: string[]): Promise<Record<string, HarnessCredentialState>> {
  if (refs.length === 0) return {};
  const value = await api().credentials.describe([...new Set(refs)].slice(0, 64)) as { credentials: Record<string, HarnessCredentialState> };
  return value.credentials;
}

export async function setHarnessCredential(ref: string, value: string): Promise<void> {
  await api().credentials.set(ref, value);
}

export async function unsetHarnessCredential(ref: string): Promise<void> {
  await api().credentials.unset(ref);
}

export async function discoverHarnessModels(input: {
  settingsNs: string;
  provider?: string;
  baseURL?: string;
  api?: string;
  apiKey?: string;
}): Promise<Array<{ id: string; name?: string; contextWindow?: number; maxTokens?: number }>> {
  const value = await api().llm.discoverModels(input) as {
    models: Array<{ id: string; name?: string; contextWindow?: number; maxTokens?: number }>;
  };
  return value.models;
}

export async function listHarnessAgentPresets(): Promise<{
  presets: HarnessAgentPreset[];
  authorable: boolean;
  hasDocument: boolean;
}> {
  return api().agentPresets.list() as Promise<{ presets: HarnessAgentPreset[]; authorable: boolean; hasDocument: boolean }>;
}

export async function readHarnessAgentPreset(agentPreset: string): Promise<{
  agentPreset: string;
  trust: 'system' | 'user';
  content: string;
  name?: string;
  description?: string;
}> {
  return api().agentPresets.read(agentPreset) as Promise<{ agentPreset: string; trust: 'system' | 'user'; content: string; name?: string; description?: string }>;
}

export async function copyHarnessAgentPreset(from: string, agentPreset: string, name?: string): Promise<void> {
  await api().agentPresets.copy(from, agentPreset, name?.trim() || undefined);
}

export async function openHarnessAgentPreset(agentPreset: string): Promise<void> {
  await api().agentPresets.openDocument(agentPreset);
}

export async function removeHarnessAgentPreset(agentPreset: string): Promise<void> {
  await api().agentPresets.remove(agentPreset);
}

export async function listHarnessPlugins(): Promise<HarnessPluginEntry[]> {
  const value = await api().listPlugins();
  return value.entries;
}

export function namespaceById(
  description: HarnessSettingsDescription | null,
  namespace: string,
): HarnessSettingsNamespace | undefined {
  return description?.namespaces.find((candidate) => candidate.ns === namespace);
}

export function valueAtPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function harnessCredentialRef(namespace: HarnessSettingsNamespace, path: string[]): string | undefined {
  const value = valueAtPath(namespace.value, path);
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : undefined;
}

export async function syncHarnessPresentation(theme: 'light' | 'dark', locale: 'en' | 'zh'): Promise<void> {
  const description = await describeHarnessSettings();
  const themeNamespace = namespaceById(description, 'ui-theme');
  const localeNamespace = namespaceById(description, 'locale');
  const writes: Promise<unknown>[] = [];
  if (themeNamespace && valueAtPath(themeNamespace.value, ['preference']) !== theme) {
    writes.push(mutateHarnessSettings(themeNamespace, [{ op: 'set', path: ['preference'], value: theme }]));
  }
  if (localeNamespace && valueAtPath(localeNamespace.value, ['preference']) !== locale) {
    writes.push(mutateHarnessSettings(localeNamespace, [{ op: 'set', path: ['preference'], value: locale }]));
  }
  await Promise.all(writes);
}
