import { LocalPluginsSettings } from '../Plugins/LocalPluginsSettings';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  listHarnessPlugins,
  namespaceById,
  openHarnessSettingsDocument,
  type HarnessPluginEntry,
} from '../../services/harnessSettingsService';
import { HarnessSchemaForm } from './HarnessSchemaForm';
import { SettingsError, SettingsLoading, SettingsSectionCard } from './SettingsPrimitives';
import { useHarnessSettingsDescription } from './useHarnessSettings';

const CONFIGURABLE_PLUGIN_NAMESPACES = ['agent-loop', 'shell', 'web-search-deepseek'] as const;

function pluginLabel(namespace: string): string {
  switch (namespace) {
    case 'agent-loop': return 'Agent Loop';
    case 'shell': return 'Shell';
    case 'web-search-deepseek': return 'DeepSeek Web Search';
    default: return namespace;
  }
}
export function PluginsSettingsPanel() {
  const { t } = useTranslation(['settings']);
  const { description, loading, error, reload, replaceNamespace } = useHarnessSettingsDescription();
  const [selectedNamespace, setSelectedNamespace] = useState<string>('agent-loop');
  const [plugins, setPlugins] = useState<HarnessPluginEntry[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let disposed = false;
    setInventoryLoading(true);
    void listHarnessPlugins()
      .then((entries) => { if (!disposed) setPlugins(entries); })
      .catch((reason) => { if (!disposed) setInventoryError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!disposed) setInventoryLoading(false); });
    return () => { disposed = true; };
  }, []);

  const configurable = CONFIGURABLE_PLUGIN_NAMESPACES
    .map((namespace) => namespaceById(description, namespace))
    .filter((namespace): namespace is NonNullable<typeof namespace> => Boolean(namespace));
  const selected = configurable.find((namespace) => namespace.ns === selectedNamespace) || configurable[0];
  const filteredPlugins = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return plugins;
    return plugins.filter((plugin) => `${plugin.entryId} ${plugin.moduleName}`.toLowerCase().includes(normalized));
  }, [plugins, query]);

  return (
    <div className="space-y-5 pb-8">
      <LocalPluginsSettings />
      <SettingsSectionCard title={t('unified.pluginConfiguration')} description={t('unified.pluginConfigurationHint')}>
        {loading ? <SettingsLoading /> : error ? <SettingsError message={error} onRetry={() => void reload()} /> : configurable.length === 0 ? (
          <div className="text-sm text-secondary-text">{t('unified.noConfigurablePlugins')}</div>
        ) : (
          <div className="grid gap-5 md:grid-cols-[200px_minmax(0,1fr)]">
            <div className="space-y-1">
              {configurable.map((namespace) => (
                <button
                  key={namespace.ns}
                  type="button"
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-hover-bg ${selected?.ns === namespace.ns ? 'text-highlight' : 'text-secondary-text hover:text-editor-fg'}`}
                  onClick={() => setSelectedNamespace(namespace.ns)}
                >
                  {pluginLabel(namespace.ns)}
                </button>
              ))}
            </div>
            <div className="min-w-0">
              {selected ? (
                <>
                  <div className="mb-4">
                    <div className="text-base font-semibold">{pluginLabel(selected.ns)}</div>
                    <div className="mt-1 text-xs text-secondary-text">{selected.ns} · {selected.applies === 'restart' ? t('unified.restartRequired') : t('unified.appliesImmediately')}</div>
                  </div>
                  <HarnessSchemaForm
                    namespace={selected}
                    dirtyId={`plugin-${selected.ns}`}
                    onSaved={replaceNamespace}
                  />
                </>
              ) : null}
            </div>
          </div>
        )}
        <div className="mt-4 border-t border-border pt-4 text-right">
          <button type="button" className="text-xs text-secondary-text hover:text-editor-fg hover:underline" onClick={() => void openHarnessSettingsDocument()}>{t('unified.openHarnessConfig')}</button>
        </div>
      </SettingsSectionCard>

      <SettingsSectionCard title={t('unified.pluginInventory')} description={t('unified.pluginInventoryHint')}>
        <input
          className="mb-4 h-9 w-full rounded-md border border-border bg-editor-bg px-3 text-sm outline-none focus:border-brand"
          type="search"
          value={query}
          placeholder={t('unified.searchPlugins')}
          onChange={(event) => setQuery(event.target.value)}
        />
        {inventoryLoading ? <SettingsLoading /> : inventoryError ? <SettingsError message={inventoryError} /> : (
          <div className="max-h-[480px] divide-y divide-border overflow-auto rounded-lg border border-border">
            {filteredPlugins.map((plugin) => (
              <div key={plugin.entryId} className="flex items-start gap-3 px-3 py-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${plugin.enabled && plugin.fiberPhase === 'active' ? 'bg-health-text' : plugin.fiberPhase === 'failed' ? 'bg-red-500' : 'bg-secondary-text/40'}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{plugin.entryId}</div>
                  <div className="mt-0.5 truncate text-xs text-secondary-text" title={plugin.moduleName}>{plugin.moduleName}</div>
                </div>
                <div className="shrink-0 text-xs text-secondary-text">{plugin.enabled ? plugin.fiberPhase : t('unified.disabled')}</div>
              </div>
            ))}
            {filteredPlugins.length === 0 ? <div className="px-3 py-8 text-center text-sm text-secondary-text">{t('unified.noPlugins')}</div> : null}
          </div>
        )}
      </SettingsSectionCard>
    </div>
  );
}
