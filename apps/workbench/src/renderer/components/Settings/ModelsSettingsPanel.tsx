import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildModelKey } from '../../../shared/modelKeys';
import {
  describeHarnessCredentials,
  discoverHarnessModels,
  harnessCredentialRef,
  listHarnessProviders,
  mutateHarnessSettings,
  namespaceById,
  openHarnessSettingsDocument,
  setHarnessCredential,
  unsetHarnessCredential,
  type HarnessCredentialState,
  type HarnessProvider,
} from '../../services/harnessSettingsService';
import { useModelsStore } from '../../store/modelsStore';
import { HarnessSchemaForm } from './HarnessSchemaForm';
import { OpenAICodexAccountCard } from './OpenAICodexAccountCard';
import { SettingsError, SettingsLoading, SettingsSectionCard } from './SettingsPrimitives';
import { useHarnessSettingsDescription } from './useHarnessSettings';
import { useSettingsDirty } from './settingsDirtyContext';

function credentialRefFor(provider: HarnessProvider, namespaceValue: ReturnType<typeof namespaceById>): string {
  const configured = namespaceValue
    ? harnessCredentialRef(namespaceValue, [...provider.settingsPath, 'apiKeyEnv'])
    : undefined;
  if (configured) return configured;
  if (provider.provider === 'deepseek-official') return 'DEEPSEEK_API_KEY';
  return `${provider.provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
}

function selectClassName(): string {
  return 'h-9 w-full rounded-md border border-border bg-editor-bg px-3 text-sm text-editor-fg outline-none focus:border-brand disabled:opacity-50';
}

export function ModelsSettingsPanel() {
  const { t } = useTranslation(['settings']);
  const { description, loading, error, reload, replaceNamespace } = useHarnessSettingsDescription();
  const [providers, setProviders] = useState<HarnessProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providerLoading, setProviderLoading] = useState(true);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [credentialStates, setCredentialStates] = useState<Record<string, HarnessCredentialState>>({});
  const [apiKey, setApiKey] = useState('');
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [credentialNotice, setCredentialNotice] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<Array<{ id: string; name?: string; contextWindow?: number; maxTokens?: number }>>([]);
  useSettingsDirty('models-api-key', apiKey.length > 0);

  const config = useModelsStore((state) => state.config);
  const selection = useModelsStore((state) => state.selection);
  const modelLoading = useModelsStore((state) => state.loading);
  const modelError = useModelsStore((state) => state.error);
  const loadModels = useModelsStore((state) => state.load);
  const selectModel = useModelsStore((state) => state.selectModel);
  const setModelPreference = useModelsStore((state) => state.setModelPreference);

  const refreshProvidersAndModels = useCallback(async () => {
    const [items] = await Promise.all([listHarnessProviders(), loadModels(), reload()]);
    setProviders(items);
  }, [loadModels, reload]);

  useEffect(() => {
    void loadModels();
    let disposed = false;
    setProviderLoading(true);
    void listHarnessProviders()
      .then((items) => {
        if (disposed) return;
        setProviders(items);
        setSelectedProviderId((current) => current || items.find((item) => item.active)?.provider || items[0]?.provider || '');
      })
      .catch((reason) => {
        if (!disposed) setProviderError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!disposed) setProviderLoading(false);
      });
    return () => { disposed = true; };
  }, [loadModels]);

  const selectedProvider = providers.find((provider) => provider.provider === selectedProviderId);
  const providerNamespace = selectedProvider ? namespaceById(description, selectedProvider.settingsNs) : undefined;
  const credentialRef = selectedProvider ? credentialRefFor(selectedProvider, providerNamespace) : '';
  const credential = credentialStates[credentialRef];

  useEffect(() => {
    if (!credentialRef) return;
    let disposed = false;
    void describeHarnessCredentials([credentialRef])
      .then((states) => { if (!disposed) setCredentialStates((current) => ({ ...current, ...states })); })
      .catch(() => {});
    return () => { disposed = true; };
  }, [credentialRef]);

  useEffect(() => {
    setApiKey('');
    setCredentialNotice(null);
    setDiscoveredModels([]);
  }, [selectedProviderId]);

  const selectedModelKey = selection?.provider && selection.model
    ? buildModelKey(selection.provider, selection.model)
    : config.defaultModelKey || '';
  const selectedModel = config.models.find((model) => model.key === selectedModelKey);
  const modelGroups = useMemo(() => {
    const groups = new Map<string, typeof config.models>();
    for (const model of config.models) {
      const values = groups.get(model.provider) || [];
      values.push(model);
      groups.set(model.provider, values);
    }
    return [...groups.entries()];
  }, [config.models]);

  const saveCredential = async () => {
    if (!credentialRef || !apiKey) return;
    setCredentialBusy(true);
    setCredentialNotice(null);
    try {
      if (providerNamespace && selectedProvider && !harnessCredentialRef(providerNamespace, [...selectedProvider.settingsPath, 'apiKeyEnv'])) {
        replaceNamespace(await mutateHarnessSettings(providerNamespace, [{
          op: 'set',
          path: [...selectedProvider.settingsPath, 'apiKeyEnv'],
          value: credentialRef,
        }]));
      }
      await setHarnessCredential(credentialRef, apiKey);
      setApiKey('');
      setCredentialStates((current) => ({
        ...current,
        [credentialRef]: { configured: true, writable: true, source: 'credential store' },
      }));
      setCredentialNotice(t('unified.credentialSaved'));
    } catch (reason) {
      setCredentialNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCredentialBusy(false);
    }
  };

  const clearCredential = async () => {
    if (!credentialRef || !window.confirm(t('unified.clearCredentialConfirm'))) return;
    setCredentialBusy(true);
    setCredentialNotice(null);
    try {
      await unsetHarnessCredential(credentialRef);
      setApiKey('');
      setCredentialStates((current) => ({
        ...current,
        [credentialRef]: { configured: false, writable: true },
      }));
      setCredentialNotice(t('unified.credentialCleared'));
    } catch (reason) {
      setCredentialNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCredentialBusy(false);
    }
  };

  const discover = async () => {
    if (!selectedProvider?.settingsNs) return;
    setDiscovering(true);
    setProviderError(null);
    try {
      setDiscoveredModels(await discoverHarnessModels({
        settingsNs: selectedProvider.settingsNs,
        provider: selectedProvider.provider,
        ...(apiKey ? { apiKey } : {}),
      }));
    } catch (reason) {
      setProviderError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      <SettingsSectionCard title={t('unified.defaultModel')} description={t('unified.modelDefaultHint')}>
        {modelLoading && config.models.length === 0 ? <SettingsLoading /> : (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">{t('unified.defaultModel')}</span>
              <select className={selectClassName()} value={selectedModelKey} onChange={(event) => void selectModel(event.target.value)}>
                {modelGroups.map(([provider, models]) => (
                  <optgroup key={provider} label={models[0]?.providerLabel || provider}>
                    {models.map((model) => <option key={model.key} value={model.key}>{model.label || model.id}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            {selectedModel?.reasoningLevels?.length ? (
              <label className="space-y-1.5 text-sm">
                <span className="block font-medium">Thinking</span>
                <select className={selectClassName()} value={selection?.thinkingLevel || selectedModel.reasoningLevels[0]} onChange={(event) => void setModelPreference(selectedModelKey, { thinkingLevel: event.target.value })}>
                  {selectedModel.reasoningLevels.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </label>
            ) : null}
          </div>
        )}
        {modelError ? <div className="mt-3 text-xs text-red-500">{modelError}</div> : null}
      </SettingsSectionCard>

      <SettingsSectionCard title={t('unified.providers')} description={t('unified.providersHint')}>
        {providerLoading || loading ? <SettingsLoading /> : error ? <SettingsError message={error} onRetry={() => void reload()} /> : providerError && providers.length === 0 ? <SettingsError message={providerError} /> : (
          <div className="grid min-h-[420px] gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="max-h-[520px] space-y-1 overflow-auto pr-1">
              {providers.map((provider) => (
                <button
                  key={provider.provider}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-hover-bg ${selectedProviderId === provider.provider ? 'text-highlight' : 'text-secondary-text hover:text-editor-fg'}`}
                  onClick={() => setSelectedProviderId(provider.provider)}
                >
                  <span className="truncate">{provider.displayName}</span>
                  <span className={`h-2 w-2 rounded-full ${provider.active ? 'bg-health-text' : 'bg-secondary-text/30'}`} />
                </button>
              ))}
            </div>
            <div className="min-w-0 space-y-5">
              {selectedProvider ? (
                <>
                  <div>
                    <div className="text-base font-semibold">{selectedProvider.displayName}</div>
                    <div className="mt-1 text-xs text-secondary-text">{selectedProvider.provider} · {selectedProvider.active ? t('unified.active') : t('unified.inactive')}</div>
                  </div>

                  {selectedProvider.provider === 'openai-codex' ? (
                    <OpenAICodexAccountCard onProviderChanged={refreshProvidersAndModels} />
                  ) : selectedProvider.settingsNs ? (
                    <div className="space-y-3 border-b border-border pb-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">API key</div>
                          <div className="mt-1 text-xs text-secondary-text">{credentialRef}{credential?.configured ? ` · ${t('unified.configured')}` : ''}</div>
                        </div>
                        {credential?.configured && credential.writable ? (
                          <button type="button" className="text-xs text-red-500 hover:underline" disabled={credentialBusy} onClick={() => void clearCredential()}>{t('unified.clear')}</button>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <input
                          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-editor-bg px-3 text-sm outline-none focus:border-brand"
                          type="password"
                          autoComplete="new-password"
                          value={apiKey}
                          placeholder={credential?.configured ? t('unified.keepCredential') : t('unified.enterCredential')}
                          onChange={(event) => setApiKey(event.target.value)}
                        />
                        <button type="button" className="ui-pill-btn-primary px-4 text-sm disabled:opacity-50" disabled={!apiKey || credentialBusy} onClick={() => void saveCredential()}>{credentialBusy ? t('unified.saving') : t('unified.save')}</button>
                      </div>
                      {credentialNotice ? <div className="text-xs text-secondary-text">{credentialNotice}</div> : null}
                    </div>
                  ) : null}

                  {providerNamespace ? (
                    <HarnessSchemaForm
                      namespace={providerNamespace}
                      path={selectedProvider.settingsPath}
                      dirtyId={`provider-${selectedProvider.provider}`}
                      onSaved={replaceNamespace}
                    />
                  ) : (
                    <div className="text-sm text-secondary-text">{t('unified.noStructuredProvider')}</div>
                  )}

                  {selectedProvider.settingsNs ? (
                    <div className="space-y-3 border-t border-border pt-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{t('unified.discoverModels')}</div>
                          <div className="mt-1 text-xs text-secondary-text">{t('unified.discoverModelsHint')}</div>
                        </div>
                        <button type="button" className="ui-pill-btn-secondary px-3 py-1.5 text-xs disabled:opacity-50" disabled={discovering} onClick={() => void discover()}>{discovering ? t('unified.discovering') : t('unified.discover')}</button>
                      </div>
                      {providerError ? <div className="text-xs text-red-500">{providerError}</div> : null}
                      {discoveredModels.length > 0 ? (
                        <div className="max-h-56 divide-y divide-border overflow-auto rounded-lg border border-border">
                          {discoveredModels.map((model) => (
                            <div key={model.id} className="px-3 py-2">
                              <div className="text-sm">{model.name || model.id}</div>
                              <div className="text-xs text-secondary-text">{model.id}{model.contextWindow ? ` · ${model.contextWindow.toLocaleString()} context` : ''}</div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        )}
        <div className="mt-4 border-t border-border pt-4 text-right">
          <button type="button" className="text-xs text-secondary-text hover:text-editor-fg hover:underline" onClick={() => void openHarnessSettingsDocument()}>{t('unified.openHarnessConfig')}</button>
        </div>
      </SettingsSectionCard>
    </div>
  );
}
