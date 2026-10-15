import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DISPLAY_LOCALES,
  LOCALE_LABELS,
  normalizeDisplayLocale,
  type DisplayLocale,
} from '../../../i18n/locales';
import { setRendererI18nLocale } from '../../../i18n/renderer';
import { SYSTEM_THEME_ID } from '../../../shared/themePreference';
import { buildModelKey } from '../../../shared/modelKeys';
import {
  listHarnessAgentPresets,
  mutateHarnessSettings,
  namespaceById,
  type HarnessAgentPreset,
} from '../../services/harnessSettingsService';
import { useModelsStore } from '../../store/modelsStore';
import { useUiStore } from '../../store/uiStore';
import { DesktopSettingsEditor } from './DesktopSettingsEditor';
import { HarnessSchemaForm } from './HarnessSchemaForm';
import { SettingsError, SettingsLoading, SettingsSectionCard } from './SettingsPrimitives';
import { useHarnessSettingsDescription } from './useHarnessSettings';
import type { BrowserServiceInfo } from '../../types/platform';

function selectClassName(): string {
  return 'h-9 min-w-48 rounded-md border border-border bg-editor-bg px-3 text-sm text-editor-fg outline-none focus:border-brand disabled:opacity-50';
}

function settingsValue(namespace: ReturnType<typeof namespaceById>, field: string): string {
  const value = namespace?.value && typeof namespace.value === 'object'
    ? (namespace.value as Record<string, unknown>)[field]
    : undefined;
  return typeof value === 'string' ? value : '';
}

export function GeneralSettingsPanel() {
  const { t, i18n } = useTranslation(['settings']);
  const { description, loading, error, reload, replaceNamespace } = useHarnessSettingsDescription();
  const [agentSaving, setAgentSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [service, setService] = useState<BrowserServiceInfo>();
  useEffect(() => {
    const api = window.hulala?.serviceInfo;
    void api?.get().then(setService).catch(() => undefined);
    return api?.onChanged(setService);
  }, []);
  const [presets, setPresets] = useState<HarnessAgentPreset[]>([]);
  const [defaultWorkspace, setDefaultWorkspace] = useState<{
    configuredPath: string | null;
    defaultPath: string;
    effectivePath: string;
  } | null>(null);
  const [defaultWorkspaceBusy, setDefaultWorkspaceBusy] = useState(false);
  const [defaultWorkspaceNotice, setDefaultWorkspaceNotice] = useState<string | null>(null);

  const availableThemes = useUiStore((state) => state.availableThemes);
  const themePreference = useUiStore((state) => state.themePreference);
  const resolvedThemeLabel = useUiStore((state) => state.theme.label);
  const setThemeId = useUiStore((state) => state.setThemeId);
  const displayLocale = normalizeDisplayLocale(i18n.language);

  const runtime = useModelsStore((state) => state.runtime);
  const runtimes = useModelsStore((state) => state.runtimes);
  const config = useModelsStore((state) => state.config);
  const selection = useModelsStore((state) => state.selection);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const loadModels = useModelsStore((state) => state.load);
  const selectModel = useModelsStore((state) => state.selectModel);
  const setModelPreference = useModelsStore((state) => state.setModelPreference);

  const permission = namespaceById(description, 'permission');
  const conversation = namespaceById(description, 'ui-conversation');
  const network = namespaceById(description, 'hulala-network');
  const presetSettings = namespaceById(description, 'agent-presets');
  const localeSettings = namespaceById(description, 'locale');
  const themeSettings = namespaceById(description, 'ui-theme');

  const selectedModelKey = selection?.provider && selection.model
    ? buildModelKey(selection.provider, selection.model)
    : config.defaultModelKey || '';
  const selectedModel = config.models.find((model) => model.key === selectedModelKey);
  const thinkingLevels = selectedModel?.reasoningLevels || [];

  useEffect(() => {
    void loadModels();
    void listHarnessAgentPresets().then((value) => setPresets(value.presets)).catch(() => setPresets([]));
  }, [loadModels]);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const value = await window.hulala?.settings?.getDefaultWorkspace?.();
      if (!disposed && value) setDefaultWorkspace(value);
    };
    void refresh();
    const unsubscribe = window.hulala?.settings?.onChanged?.(() => { void refresh(); });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const chooseDefaultWorkspace = async () => {
    setDefaultWorkspaceBusy(true);
    setDefaultWorkspaceNotice(null);
    try {
      const selected = await window.hulala?.settings?.pickDefaultWorkspace?.();
      if (!selected || selected.canceled || !selected.path) return;
      await window.hulala?.settings?.set({ user: { defaultWorkspacePath: selected.path } });
      const next = await window.hulala?.settings?.getDefaultWorkspace?.();
      if (next) setDefaultWorkspace(next);
      setDefaultWorkspaceNotice(t('unified.saved'));
    } catch (reason) {
      setDefaultWorkspaceNotice(`${t('unified.defaultWorkspaceSaveFailed')}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setDefaultWorkspaceBusy(false);
    }
  };

  const resetDefaultWorkspace = async () => {
    setDefaultWorkspaceBusy(true);
    setDefaultWorkspaceNotice(null);
    try {
      await window.hulala?.settings?.set({ user: { defaultWorkspacePath: null } });
      const next = await window.hulala?.settings?.getDefaultWorkspace?.();
      if (next) setDefaultWorkspace(next);
      setDefaultWorkspaceNotice(t('unified.defaultWorkspaceResetDone'));
    } catch (reason) {
      setDefaultWorkspaceNotice(`${t('unified.defaultWorkspaceSaveFailed')}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setDefaultWorkspaceBusy(false);
    }
  };

  const mutateField = async (namespace: NonNullable<typeof permission>, field: string, value: unknown) => {
    setAgentSaving(true);
    setNotice(null);
    try {
      replaceNamespace(await mutateHarnessSettings(namespace, [{ op: 'set', path: [field], value }]));
      setNotice(t('unified.saved'));
    } catch (reason) {
      setNotice(`${t('unified.notRemembered')}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setAgentSaving(false);
    }
  };

  const changeTheme = async (nextPreference: string) => {
    setThemeId(nextPreference);
    const resolvedScheme = useUiStore.getState().theme.scheme;
    await window.hulala?.settings?.set({ ui: { themeId: nextPreference } });
    if (themeSettings) {
      try {
        replaceNamespace(await mutateHarnessSettings(themeSettings, [{
          op: 'set',
          path: ['preference'],
          value: resolvedScheme === 'dark' ? 'dark' : 'light',
        }]));
      } catch {
        // Desktop remains authoritative even when the embedded surface cannot persist the mirror.
      }
    }
  };

  const changeLocale = async (locale: DisplayLocale) => {
    await setRendererI18nLocale(locale);
    await window.hulala?.settings?.set({ ui: { displayLocale: locale } });
    if (localeSettings) {
      try {
        replaceNamespace(await mutateHarnessSettings(localeSettings, [{
          op: 'set',
          path: ['preference'],
          value: locale.startsWith('zh') ? 'zh' : 'en',
        }]));
      } catch {
        // Desktop remains authoritative even when the embedded surface cannot persist the mirror.
      }
    }
  };

  const changeRuntime = async (nextRuntime: string) => {
    const harness = window.hulala?.harness;
    if (!harness) return;
    setAgentSaving(true);
    setNotice(null);
    try {
      await harness.selectRuntime({ runtime: nextRuntime });
      await loadModels();
      setNotice(t('unified.saved'));
    } catch (reason) {
      setNotice(`${t('unified.notRemembered')}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setAgentSaving(false);
    }
  };

  const modelGroups = useMemo(() => {
    const groups = new Map<string, typeof config.models>();
    for (const model of config.models) {
      const current = groups.get(model.provider) || [];
      current.push(model);
      groups.set(model.provider, current);
    }
    return [...groups.entries()];
  }, [config.models]);

  return (
    <div className="space-y-5 pb-8">
      <SettingsSectionCard title={t('unified.appearance')} description={t('unified.appearanceHint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="block font-medium">{t('unified.theme')}</span>
            <select className={selectClassName()} value={themePreference} onChange={(event) => void changeTheme(event.target.value)}>
              <option value={SYSTEM_THEME_ID}>{t('unified.themeFollowSystem')}</option>
              {availableThemes.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
            </select>
            {themePreference === SYSTEM_THEME_ID ? (
              <span className="block text-xs text-secondary-text">
                {t('unified.themeFollowSystemHint', { theme: resolvedThemeLabel })}
              </span>
            ) : null}
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="block font-medium">{t('unified.language')}</span>
            <select className={selectClassName()} value={displayLocale} onChange={(event) => void changeLocale(event.target.value as DisplayLocale)}>
              {DISPLAY_LOCALES.map((locale) => <option key={locale} value={locale}>{LOCALE_LABELS[locale]}</option>)}
            </select>
          </label>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title={t('unified.defaultWorkspace')} description={t('unified.defaultWorkspaceHint')}>
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-editor-bg px-3 py-2 text-xs text-editor-fg break-all">
            {defaultWorkspace?.effectivePath || t('unified.defaultWorkspaceLoading')}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="ui-pill-btn-primary op-sg-capsule op-sg--on-editor px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={defaultWorkspaceBusy}
              onClick={() => void chooseDefaultWorkspace()}
            >
              {t('unified.defaultWorkspaceChoose')}
            </button>
            <button
              type="button"
              className="dialog-action-btn"
              disabled={defaultWorkspaceBusy || !defaultWorkspace?.configuredPath}
              onClick={() => void resetDefaultWorkspace()}
            >
              {t('unified.defaultWorkspaceReset')}
            </button>
          </div>
          <div className="text-xs text-secondary-text">
            {defaultWorkspace?.configuredPath
              ? t('unified.defaultWorkspaceCustom')
              : t('unified.defaultWorkspaceBuiltIn', { path: defaultWorkspace?.defaultPath || '~/hulala-workspace/workspace' })}
          </div>
          {defaultWorkspaceNotice ? <div className="text-xs text-secondary-text">{defaultWorkspaceNotice}</div> : null}
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title={t('unified.agentDefaults')} description={t('unified.agentDefaultsHint')}>
        {modelsLoading && !runtime ? <SettingsLoading /> : (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Runtime</span>
              <select className={selectClassName()} value={runtime} disabled={agentSaving} onChange={(event) => void changeRuntime(event.target.value)}>
                {runtimes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">{t('unified.defaultModel')}</span>
              <select className={selectClassName()} value={selectedModelKey} disabled={agentSaving || config.models.length === 0} onChange={(event) => void selectModel(event.target.value)}>
                {modelGroups.map(([provider, models]) => (
                  <optgroup key={provider} label={models[0]?.providerLabel || provider}>
                    {models.map((model) => <option key={model.key} value={model.key}>{model.label || model.id}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            {thinkingLevels.length > 0 ? (
              <label className="space-y-1.5 text-sm">
                <span className="block font-medium">Thinking</span>
                <select className={selectClassName()} value={selection?.thinkingLevel || thinkingLevels[0]} disabled={agentSaving} onChange={(event) => void setModelPreference(selectedModelKey, { thinkingLevel: event.target.value })}>
                  {thinkingLevels.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </label>
            ) : null}
            {presetSettings ? (
              <label className="space-y-1.5 text-sm">
                <span className="block font-medium">{t('unified.defaultPreset')}</span>
                <select className={selectClassName()} value={settingsValue(presetSettings, 'default')} disabled={agentSaving} onChange={(event) => void mutateField(presetSettings, 'default', event.target.value)}>
                  {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name || preset.id}</option>)}
                </select>
              </label>
            ) : null}
            {permission ? (
              <label className="space-y-1.5 text-sm">
                <span className="block font-medium">{t('unified.defaultPermission')}</span>
                <select
                  className={selectClassName()}
                  value={settingsValue(permission, 'defaultPreset')}
                  disabled={agentSaving}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value !== 'danger-full-access' || window.confirm(t('unified.fullAccessConfirm'))) {
                      void mutateField(permission, 'defaultPreset', value);
                    }
                  }}
                >
                  <option value="read-only">Read only</option>
                  <option value="workspace-write">Workspace write</option>
                  <option value="danger-full-access">Full access</option>
                </select>
              </label>
            ) : null}
            {conversation ? (
              <label className="space-y-1.5 text-sm">
                <span className="block font-medium">{t('unified.busyEnter')}</span>
                <select className={selectClassName()} value={settingsValue(conversation, 'busyEnter')} disabled={agentSaving} onChange={(event) => void mutateField(conversation, 'busyEnter', event.target.value)}>
                  <option value="queue">Queue message</option>
                  <option value="steer">Steer running agent</option>
                </select>
              </label>
            ) : null}
          </div>
        )}
        {modelsError ? <div className="mt-3 text-xs text-red-500">{modelsError}</div> : null}
        {notice ? <div className={notice.startsWith(t('unified.notRemembered')) ? 'mt-3 text-xs text-red-500' : 'mt-3 text-xs text-health-text'}>{notice}</div> : null}
      </SettingsSectionCard>

      {loading ? <SettingsLoading /> : error ? <SettingsError message={error} onRetry={() => void reload()} /> : network ? (
        <SettingsSectionCard title={t('unified.network')} description={t('unified.networkHint')}>
          <HarnessSchemaForm
            namespace={network}
            dirtyId="general-network"
            onSaved={replaceNamespace}
            fieldLabels={{ mode: t('unified.proxyMode'), proxyUrl: t('unified.proxyUrl') }}
          />
        </SettingsSectionCard>
      ) : null}

      <SettingsSectionCard title={t('desktop.title')} description={t('desktop.subtitle')}>
        <DesktopSettingsEditor embedded />
        {service ? <div className="mt-5 space-y-2 text-xs text-secondary-text">
          <p>{t('browser.hostVersion', { version: service.version })} · {t('browser.sources.' + service.source)}</p>
          {service.updateCommand ? <><p>{t(service.source === 'archive' ? 'browser.archiveInstallHint' : 'browser.updateUsingSource')}</p><pre className="select-text whitespace-pre-wrap">{service.updateCommand}</pre></> : <p>{t('browser.sourcePreviewHint')}</p>}
          {service.restartCommand ? <><p>{t('browser.restartHint')}</p><pre className="select-text whitespace-pre-wrap">{service.restartCommand}</pre></> : null}
        </div> : null}
      </SettingsSectionCard>
    </div>
  );
}
