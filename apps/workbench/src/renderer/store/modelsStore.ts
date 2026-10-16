import { create } from 'zustand';

import type {
  HarnessRuntimeDescriptor,
  HarnessRuntimeModel,
  HarnessRuntimeState,
  ModelEntry,
  ModelPreference,
  ModelsConfig,
  ProviderEntry,
} from '../types/platform';
import { resolveModelReasoningControl } from '../../shared/modelReasoning';
import { buildModelKey, normalizeModelKey } from '../../shared/modelKeys';

type ModelsState = {
  config: ModelsConfig;
  runtime: string;
  runtimes: HarnessRuntimeDescriptor[];
  selection: HarnessRuntimeState['selection'];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  refreshFromHulala: () => Promise<void>;
  selectModel: (key: string, sessionId?: string) => Promise<void>;
  setModelPreference: (key: string, patch: Partial<ModelPreference>, sessionId?: string) => Promise<void>;
};

function emptyConfig(): ModelsConfig {
  return {
    version: 6,
    defaultModelKey: null,
    providers: {},
    models: [],
    updatedAt: 0,
  };
}

function normalizeLevels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const levels = [...new Set(value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean))];
  return levels.length > 0 ? levels : undefined;
}

function modelEntry(model: HarnessRuntimeModel): ModelEntry {
  const levels = normalizeLevels(model.thinkingLevels);
  return {
    key: buildModelKey(model.provider, model.id),
    id: model.id,
    label: model.name,
    enabled: true,
    provider: model.provider,
    providerLabel: model.providerName || model.provider,
    reasoning: Boolean(levels?.length),
    reasoningLevels: levels,
    reasoningControl: resolveModelReasoningControl({
      reasoning: Boolean(levels?.length),
      reasoningLevels: levels,
    }),
    updatedAt: Date.now(),
  };
}

function providerDirectory(models: ModelEntry[]): Record<string, ProviderEntry> {
  const providers: Record<string, ProviderEntry> = {};
  for (const model of models) {
    const current = providers[model.provider] || {
      label: model.providerLabel || model.provider,
      managed: true,
      models: [],
    };
    current.models.push({
      id: model.id,
      label: model.label,
      enabled: true,
      reasoning: model.reasoning,
      reasoningControl: model.reasoningControl,
      reasoningLevels: model.reasoningLevels,
    });
    providers[model.provider] = current;
  }
  return providers;
}

function configFromHarness(state: HarnessRuntimeState): ModelsConfig {
  const models = (state.models || []).map(modelEntry);
  const selectedKey = state.selection?.provider && state.selection.model
    ? buildModelKey(state.selection.provider, state.selection.model)
    : '';
  const defaultKey = normalizeModelKey(selectedKey)
    || models.find((model, index) => state.models?.[index]?.default)?.key
    || models[0]?.key
    || null;
  const selectedThinking = state.selection?.thinkingLevel?.trim();
  const modelPreferences = defaultKey && selectedThinking
    ? { [defaultKey]: { thinkingLevel: selectedThinking } }
    : undefined;
  return {
    version: 6,
    defaultModelKey: defaultKey,
    providers: providerDirectory(models),
    models,
    ...(modelPreferences ? { modelPreferences } : {}),
    updatedAt: Date.now(),
  };
}

async function loadRuntimeState(sessionId?: string): Promise<HarnessRuntimeState> {
  const api = window.hulala?.harness;
  if (!api) throw new Error('Harness Runtime is unavailable');
  return api.getRuntimeState(sessionId);
}

let loadPromise: Promise<void> | null = null;

export const useModelsStore = create<ModelsState>((set, get) => ({
  config: emptyConfig(),
  runtime: '',
  runtimes: [],
  selection: undefined,
  loading: false,
  error: null,

  load: async () => {
    if (loadPromise) return loadPromise;
    set({ loading: true, error: null });
    loadPromise = (async () => {
      try {
        const state = await loadRuntimeState();
        set({
          runtime: state.current,
          runtimes: state.runtimes || [],
          selection: state.selection,
          config: configFromHarness(state),
          error: state.modelError || null,
        });
      } catch (error) {
        set({ config: emptyConfig(), error: error instanceof Error ? error.message : String(error) });
      } finally {
        set({ loading: false });
        loadPromise = null;
      }
    })();
    return loadPromise;
  },

  refreshFromHulala: async () => get().load(),

  selectModel: async (key: string, sessionId?: string) => {
    const modelKey = normalizeModelKey(key);
    const model = get().config.models.find((candidate) => candidate.key === modelKey);
    if (!model) throw new Error(`Harness model "${modelKey}" is unavailable`);
    const preference = get().config.modelPreferences?.[modelKey];
    const api = window.hulala?.harness;
    if (!api) throw new Error('Harness Runtime is unavailable');
    await api.selectRuntime({
      runtime: get().runtime,
      provider: model.provider,
      model: model.id,
      ...(preference?.thinkingLevel ? { thinkingLevel: preference.thinkingLevel } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
    await get().load();
  },

  setModelPreference: async (key: string, patch: Partial<ModelPreference>, sessionId?: string) => {
    const modelKey = normalizeModelKey(key);
    const model = get().config.models.find((candidate) => candidate.key === modelKey);
    if (!model) throw new Error(`Harness model "${modelKey}" is unavailable`);
    const thinkingLevel = patch.thinkingLevel?.trim();
    if (!thinkingLevel) return;
    const api = window.hulala?.harness;
    if (!api) throw new Error('Harness Runtime is unavailable');
    await api.selectRuntime({
      runtime: get().runtime,
      provider: model.provider,
      model: model.id,
      thinkingLevel,
      ...(sessionId ? { sessionId } : {}),
    });
    await get().load();
  },
}));
