import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useUiStore, type UnifiedSettingsSection } from '../../store/uiStore';
import { useBlockingModal } from '../../utils/useBlockingModal';
import { AgentBotIcon, AgentBrainIcon, CloseIcon, SettingsIcon, SkillPuzzleIcon } from '../Icons';
import { AgentPresetsSettingsPanel } from './AgentPresetsSettingsPanel';
import { GeneralSettingsPanel } from './GeneralSettingsPanel';
import { ModelsSettingsPanel } from './ModelsSettingsPanel';
import { PluginsSettingsPanel } from './PluginsSettingsPanel';
import { SettingsDirtyContext } from './settingsDirtyContext';

const SECTIONS: Array<{
  id: UnifiedSettingsSection;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'general', labelKey: 'unified.general', icon: SettingsIcon },
  { id: 'models', labelKey: 'unified.models', icon: AgentBrainIcon },
  { id: 'plugins', labelKey: 'unified.plugins', icon: SkillPuzzleIcon },
  { id: 'agent-presets', labelKey: 'unified.agentPresets', icon: AgentBotIcon },
];

export function UnifiedSettingsModal() {
  const { t } = useTranslation(['settings']);
  const open = useUiStore((state) => state.settingsOpen);
  const section = useUiStore((state) => state.settingsSection);
  const closeSettings = useUiStore((state) => state.closeSettings);
  const setSettingsSection = useUiStore((state) => state.setSettingsSection);
  const dirtyIdsRef = useRef(new Set<string>());
  const dialogRef = useRef<HTMLDivElement>(null);
  const [dirtyCount, setDirtyCount] = useState(0);
  useBlockingModal(open);

  const requestClose = useCallback(() => {
    if (dirtyIdsRef.current.size > 0 && !window.confirm(t('unified.unsavedConfirm'))) return false;
    dirtyIdsRef.current.clear();
    setDirtyCount(0);
    closeSettings();
    return true;
  }, [closeSettings, t]);

  const dirtyRegistry = useMemo(() => ({
    requestClose,
    setDirty(id: string, dirty: boolean) {
      if (dirty) dirtyIdsRef.current.add(id);
      else dirtyIdsRef.current.delete(id);
      setDirtyCount(dirtyIdsRef.current.size);
    },
  }), [requestClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector<HTMLButtonElement>('nav button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, [open, requestClose]);

  if (!open) return null;

  return createPortal(
    <SettingsDirtyContext.Provider value={dirtyRegistry}>
      <div className="fixed inset-0 z-[10000] flex p-4" role="presentation">
        <button type="button" className="absolute inset-0 cursor-default bg-black/45" aria-label={t('unified.close')} onClick={requestClose} />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="unified-settings-title"
          onKeyDown={event => {
            if (event.key !== 'Tab') return;
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')].filter(control => control.getClientRects().length);
            const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1) : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : undefined;
            if (target) { event.preventDefault(); target.focus(); }
          }}
          className="relative m-auto flex h-[min(820px,calc(100vh-32px))] w-[min(1180px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-border bg-editor-bg text-editor-fg shadow-2xl"
        >
          <aside className="flex w-[130px] sm:w-[180px] lg:w-[230px] shrink-0 flex-col border-r border-border bg-titlebar-bg/60 p-2 lg:p-5">
            <h2 id="unified-settings-title" className="px-2 text-xl font-semibold">{t('unified.title')}</h2>
            <nav className="mt-8 space-y-1" aria-label={t('unified.title')}>
              {SECTIONS.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors hover:bg-hover-bg ${active ? 'text-highlight' : 'text-secondary-text hover:text-editor-fg'}`}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setSettingsSection(item.id)}
                  >
                    <Icon className="h-5 w-5" />
                    <span>{t(item.labelKey)}</span>
                  </button>
                );
              })}
            </nav>
            {dirtyCount > 0 ? <div className="mt-auto px-2 text-xs text-accent">{t('unified.unsavedCount', { count: dirtyCount })}</div> : null}
          </aside>

          <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 lg:px-7">
              <div>
                <div className="text-lg font-semibold">{t(SECTIONS.find((item) => item.id === section)?.labelKey || 'unified.general')}</div>
                <div className="text-xs text-secondary-text">{t(`unified.sectionHint.${section}`)}</div>
              </div>
              <button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg text-secondary-text hover:bg-hover-bg hover:text-editor-fg" aria-label={t('unified.close')} onClick={requestClose}>
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-3 py-6 lg:px-7">
              <div className={section === 'general' ? '' : 'hidden'}><GeneralSettingsPanel /></div>
              <div className={section === 'models' ? '' : 'hidden'}><ModelsSettingsPanel /></div>
              <div className={section === 'plugins' ? '' : 'hidden'}><PluginsSettingsPanel /></div>
              <div className={section === 'agent-presets' ? '' : 'hidden'}><AgentPresetsSettingsPanel /></div>
            </div>
          </main>
        </div>
      </div>
    </SettingsDirtyContext.Provider>,
    document.body,
  );
}
