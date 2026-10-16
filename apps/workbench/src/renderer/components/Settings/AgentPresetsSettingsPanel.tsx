import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  copyHarnessAgentPreset,
  listHarnessAgentPresets,
  mutateHarnessSettings,
  namespaceById,
  openHarnessAgentPreset,
  readHarnessAgentPreset,
  removeHarnessAgentPreset,
  type HarnessAgentPreset,
} from '../../services/harnessSettingsService';
import { SettingsError, SettingsLoading, SettingsSectionCard } from './SettingsPrimitives';
import { useHarnessSettingsDescription } from './useHarnessSettings';
import { useSettingsDirty } from './settingsDirtyContext';

export function AgentPresetsSettingsPanel() {
  const { t } = useTranslation(['settings']);
  const { description, replaceNamespace } = useHarnessSettingsDescription();
  const [presets, setPresets] = useState<HarnessAgentPreset[]>([]);
  const [authorable, setAuthorable] = useState(false);
  const [hasDocument, setHasDocument] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyId, setCopyId] = useState('');
  const [copyName, setCopyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useSettingsDirty('agent-preset-copy', copyOpen && (copyId.length > 0 || copyName.length > 0));

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const value = await listHarnessAgentPresets();
      setPresets(value.presets);
      setAuthorable(value.authorable);
      setHasDocument(value.hasDocument);
      setSelectedId((current) => value.presets.some((preset) => preset.id === current)
        ? current
        : value.presets.find((preset) => preset.isDefault)?.id || value.presets[0]?.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setContent(null);
      return;
    }
    let disposed = false;
    setContentLoading(true);
    setContent(null);
    void readHarnessAgentPreset(selectedId)
      .then((value) => { if (!disposed) setContent(value.content); })
      .catch((reason) => { if (!disposed) setContent(`# ${reason instanceof Error ? reason.message : String(reason)}`); })
      .finally(() => { if (!disposed) setContentLoading(false); });
    return () => { disposed = true; };
  }, [selectedId]);

  const selected = presets.find((preset) => preset.id === selectedId);

  const setDefault = async (preset: HarnessAgentPreset) => {
    const namespace = namespaceById(description, 'agent-presets');
    if (!namespace) return;
    setBusy(true);
    setNotice(null);
    try {
      replaceNamespace(await mutateHarnessSettings(namespace, [{ op: 'set', path: ['default'], value: preset.id }]));
      setPresets((current) => current.map((item) => ({ ...item, isDefault: item.id === preset.id })));
      setNotice(t('unified.saved'));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!selected || !copyId.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      await copyHarnessAgentPreset(selected.id, copyId.trim(), copyName);
      setCopyOpen(false);
      setCopyId('');
      setCopyName('');
      await load();
      setSelectedId(copyId.trim());
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (preset: HarnessAgentPreset) => {
    if (preset.trust !== 'user' || !window.confirm(t('unified.removePresetConfirm', { name: preset.name || preset.id }))) return;
    setBusy(true);
    setNotice(null);
    try {
      await removeHarnessAgentPreset(preset.id);
      await load();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      <SettingsSectionCard title={t('unified.agentPresets')} description={t('unified.agentPresetsHint')}>
        {loading ? <SettingsLoading /> : error ? <SettingsError message={error} onRetry={() => void load()} /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="min-h-36 rounded-xl border border-border p-4 text-left transition-colors hover:bg-hover-bg"
                onClick={() => setSelectedId(preset.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className={`text-base font-semibold ${selectedId === preset.id ? 'text-highlight' : ''}`}>{preset.name || preset.id}</div>
                  <div className="flex gap-1.5">
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-secondary-text">{preset.trust === 'system' ? t('unified.builtIn') : t('unified.userPreset')}</span>
                    {preset.isDefault ? <span className="rounded-full bg-editor-fg px-2 py-0.5 text-[10px] text-editor-bg">{t('unified.inUse')}</span> : null}
                  </div>
                </div>
                <div className="mt-3 line-clamp-3 text-xs leading-5 text-secondary-text">{preset.broken || preset.description || preset.id}</div>
              </button>
            ))}
          </div>
        )}
      </SettingsSectionCard>

      {selected ? (
        <SettingsSectionCard title={selected.name || selected.id} description={selected.description || selected.id}>
          <div className="mb-4 flex flex-wrap gap-2">
            {!selected.isDefault ? <button type="button" className="ui-pill-btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => void setDefault(selected)}>{t('unified.setDefault')}</button> : null}
            {authorable ? <button type="button" className="ui-pill-btn-secondary px-3 py-1.5 text-xs" disabled={busy} onClick={() => setCopyOpen((open) => !open)}>{t('unified.copy')}</button> : null}
            {hasDocument ? <button type="button" className="ui-pill-btn-secondary px-3 py-1.5 text-xs" disabled={busy} onClick={() => void openHarnessAgentPreset(selected.id)}>{t('unified.openFile')}</button> : null}
            {selected.trust === 'user' ? <button type="button" className="px-3 py-1.5 text-xs text-red-500 hover:underline" disabled={busy} onClick={() => void remove(selected)}>{t('unified.remove')}</button> : null}
          </div>

          {copyOpen ? (
            <div className="mb-4 grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="block text-secondary-text">{t('unified.presetId')}</span>
                <input className="h-9 w-full rounded-md border border-border bg-editor-bg px-3 text-sm outline-none focus:border-brand" value={copyId} onChange={(event) => setCopyId(event.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))} />
              </label>
              <label className="space-y-1 text-xs">
                <span className="block text-secondary-text">{t('unified.presetName')}</span>
                <input className="h-9 w-full rounded-md border border-border bg-editor-bg px-3 text-sm outline-none focus:border-brand" value={copyName} onChange={(event) => setCopyName(event.target.value)} />
              </label>
              <div className="sm:col-span-2 flex gap-2">
                <button type="button" className="ui-pill-btn-primary px-3 py-1.5 text-xs disabled:opacity-50" disabled={!copyId || busy} onClick={() => void copy()}>{t('unified.createCopy')}</button>
                <button type="button" className="ui-pill-btn px-3 py-1.5 text-xs" onClick={() => { setCopyOpen(false); setCopyId(''); setCopyName(''); }}>{t('unified.cancel')}</button>
              </div>
            </div>
          ) : null}

          {contentLoading ? <SettingsLoading /> : (
            <pre className="max-h-[440px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-editor-bg p-4 text-xs leading-5 text-secondary-text">{content || t('unified.noPresetContent')}</pre>
          )}
          {notice ? <div className="mt-3 text-xs text-secondary-text">{notice}</div> : null}
        </SettingsSectionCard>
      ) : null}
    </div>
  );
}
