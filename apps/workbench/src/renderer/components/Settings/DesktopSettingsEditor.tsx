import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IdleSleepPolicy } from '../../../platform/settingsTypes';

type NoticeState = { tone: 'success' | 'error'; text: string } | null;
const IDLE_SLEEP_POLICIES: IdleSleepPolicy[] = ['off', 'whileAppRunning'];

function readIdleSleepPolicy(settings: unknown): IdleSleepPolicy {
  const value = settings && typeof settings === 'object'
    ? (settings as { system?: { power?: { idleSleepPolicy?: unknown } } }).system?.power?.idleSleepPolicy
    : undefined;
  return value === 'whileAppRunning' ? value : 'off';
}

export const DesktopSettingsEditor: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { t } = useTranslation('settings');
  const [idleSleepPolicy, setIdleSleepPolicy] = useState<IdleSleepPolicy>('off');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [power, setPower] = useState<{ supported: boolean; active: boolean; error?: string }>();

  useEffect(() => {
    let disposed = false;
    const apply = (settings: unknown) => {
      if (disposed || !settings || typeof settings !== 'object') return;
      if ('system' in settings) setIdleSleepPolicy(readIdleSleepPolicy(settings));
      const capability = (settings as { browserPower?: { supported: boolean; active: boolean; error?: string } }).browserPower;
      if (capability) setPower(capability);
    };
    void window.hulala?.settings?.get().then(apply);
    const unsubscribe = window.hulala?.settings?.onChanged?.(apply);
    return () => { disposed = true; unsubscribe?.(); };
  }, []);

  const save = async (policy: IdleSleepPolicy) => {
    setBusy(true);
    setNotice(null);
    try {
      await window.hulala?.settings?.set({ system: { power: { idleSleepPolicy: policy } } });
      setIdleSleepPolicy(policy);
      setNotice({ tone: 'success', text: t('desktop.saved') });
    } catch (error) {
      setNotice({ tone: 'error', text: `${t('desktop.saveFailed')}: ${(error as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? 'text-editor-fg' : 'flex h-full flex-col overflow-auto bg-editor-bg p-4 text-editor-fg'}>
      <div className="space-y-3">
        <div className="text-sm font-medium">{t('desktop.idleSleepPolicyLabel')}</div>
        {IDLE_SLEEP_POLICIES.map(policy => (
          <label key={policy} className="flex cursor-pointer items-start gap-3">
            <input type="radio" name="idleSleepPolicy" className="mt-1" checked={idleSleepPolicy === policy} disabled={busy || (policy === 'whileAppRunning' && power?.supported === false)} onChange={() => void save(policy)} />
            <span className="space-y-1">
              <span className="block text-sm">{t(policy === 'whileAppRunning' ? 'desktop.idleSleepWhileAppRunning' : 'desktop.idleSleepOff')}</span>
              <span className="block text-xs text-secondary-text">{t(policy === 'whileAppRunning' ? 'desktop.idleSleepWhileAppRunningHint' : 'desktop.idleSleepOffHint')}</span>
            </span>
          </label>
        ))}
        {power?.active ? <p className="text-xs text-health-text">{t('browser.sleepActive')}</p> : null}
        {power?.supported === false ? <p className="text-xs text-secondary-text">{t('browser.sleepUnsupported')}</p> : null}
        {power?.error ? <p role="alert" className="text-xs text-error-text">{power.error}</p> : null}
        {notice ? <div className={`text-xs ${notice.tone === 'error' ? 'text-error-text' : 'text-secondary-text'}`}>{notice.text}</div> : null}
      </div>
    </div>
  );
};
