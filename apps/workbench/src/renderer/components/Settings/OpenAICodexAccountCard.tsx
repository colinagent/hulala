import type { OpenAICodexProviderAuthState } from '@hulala/workbench-contracts';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  answerOpenAICodexAuthorization,
  cancelOpenAICodexAuthorization,
  describeOpenAICodexAuthorization,
  enableOpenAICodexProvider,
  signOutOpenAICodexAuthorization,
  startOpenAICodexAuthorization,
} from '../../services/harnessSettingsService';
import {
  OP_SG_CAPSULE,
  OP_SG_ON_EDITOR,
  UI_PILL_BTN_PRIMARY,
} from '../staticGlassCapsule';

type Props = {
  onProviderChanged(): void | Promise<void>;
};

export function OpenAICodexAccountCard({ onProviderChanged }: Props) {
  const { t } = useTranslation(['settings']);
  const [state, setState] = useState<OpenAICodexProviderAuthState | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningAttempt = useRef<string | null>(null);
  const openedAuthorizationPage = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void describeOpenAICodexAuthorization().then(
      value => { if (!disposed) setState(value); },
      reason => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); },
    );
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (state?.attempt?.status !== 'running') return;
    const timer = window.setInterval(() => {
      void describeOpenAICodexAuthorization().then(setState, reason => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    }, 750);
    return () => window.clearInterval(timer);
  }, [state?.attempt?.status]);

  useEffect(() => {
    setAnswer(state?.attempt?.prompt?.kind === 'select'
      ? state.attempt.prompt.options[0]?.id || ''
      : '');
  }, [state?.attempt?.prompt?.id]);

  useEffect(() => {
    const attempt = state?.attempt;
    const url = attempt?.notice?.url;
    // Browsers open this link from the explicit button below, preserving user
    // activation when an authorization URL arrives after an asynchronous prompt.
    if (window.hulala?.kind === 'browser') return;
    if (attempt?.status !== 'running' || !url) return;
    const pageKey = `${attempt.id}:${url}`;
    if (openedAuthorizationPage.current === pageKey) return;
    openedAuthorizationPage.current = pageKey;
    void window.hulala?.harness?.providerAuth.openOpenAICodexAuthorizationPage(url).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [state?.attempt?.id, state?.attempt?.notice?.url, state?.attempt?.status]);

  useEffect(() => {
    if (state?.attempt?.status === 'running') {
      runningAttempt.current = state.attempt.id;
      return;
    }
    if (!state?.providerReady || state.attempt?.status !== 'authorized' || runningAttempt.current !== state.attempt.id) return;
    runningAttempt.current = null;
    void onProviderChanged();
  }, [onProviderChanged, state?.attempt?.status, state?.providerReady]);

  const run = async (operation: () => Promise<OpenAICodexProviderAuthState>) => {
    setBusy(true);
    setError(null);
    try {
      const previousReady = state?.providerReady === true;
      const next = await operation();
      setState(next);
      if (!previousReady && next.providerReady && next.attempt?.status !== 'running') {
        runningAttempt.current = null;
        void onProviderChanged();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const attempt = state?.attempt;
  const prompt = attempt?.prompt;
  const connected = state?.configured === true;

  return (
    <div className="space-y-3 border-b border-border pb-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium">{t('unified.codexAccount')}</div>
          <div className="mt-1 text-xs leading-relaxed text-secondary-text">
            {connected
              ? state.providerReady ? t('unified.codexConnected') : t('unified.codexConnectedNeedsEnable')
              : t('unified.codexAccountHint')}
          </div>
        </div>
        {connected ? (
          <button
            type="button"
            className="shrink-0 text-xs text-red-500 hover:underline disabled:opacity-50"
            disabled={busy || !state?.writable}
            onClick={() => {
              if (window.confirm(t('unified.codexSignOutConfirm'))) void run(signOutOpenAICodexAuthorization);
            }}
          >
            {t('unified.signOut')}
          </button>
        ) : (
          <button
            type="button"
            className={`${UI_PILL_BTN_PRIMARY} ${OP_SG_CAPSULE} ${OP_SG_ON_EDITOR} shrink-0 px-4 py-1.5 text-sm disabled:opacity-50`}
            disabled={busy || state === null || !state.available || !state.writable || attempt?.status === 'running'}
            onClick={() => void run(startOpenAICodexAuthorization)}
          >
            {busy ? t('unified.connecting') : t('unified.signInCodex')}
          </button>
        )}
      </div>

      {state !== null && !state.available ? (
        <div className="text-xs text-red-500">{t('unified.codexAuthorizationUnavailable')}</div>
      ) : null}
      {state?.apiKeyOverride ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-secondary-text">
          {t('unified.codexApiKeyOverride')}
        </div>
      ) : null}

      {attempt?.notice ? (
        <div className="space-y-2 rounded-md border border-border bg-editor-bg/60 px-3 py-2 text-xs">
          <div className="text-secondary-text">{attempt.notice.message}</div>
          <div className="flex flex-wrap items-center gap-2">
            {attempt.notice.url ? (
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() => {
                  const url = attempt.notice?.url;
                  if (url) void window.hulala?.harness?.providerAuth.openOpenAICodexAuthorizationPage(url);
                }}
              >
                {t('unified.openAuthorizationPage')}
              </button>
            ) : null}
            {attempt.notice.code ? (
              <>
                <code className="rounded bg-hover-bg px-2 py-1 text-sm font-semibold text-editor-fg">{attempt.notice.code}</code>
                <button
                  type="button"
                  className="text-secondary-text hover:text-editor-fg hover:underline"
                  onClick={() => window.hulala?.clipboard?.writeText(attempt.notice!.code || '')}
                >
                  {t('unified.copyCode')}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {attempt?.status === 'running' && prompt ? (
        <div className="space-y-2 rounded-md border border-border px-3 py-3">
          <div className="text-xs text-secondary-text">{prompt.message}</div>
          <div className="flex gap-2">
            {prompt.kind === 'select' ? (
              <select className="h-9 min-w-0 flex-1 rounded-md border border-border bg-editor-bg px-3 text-sm" value={answer} onChange={event => setAnswer(event.target.value)}>
                {prompt.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            ) : (
              <input
                className="h-9 min-w-0 flex-1 rounded-md border border-border bg-editor-bg px-3 text-sm outline-none focus:border-brand"
                type={prompt.kind === 'secret' ? 'password' : 'text'}
                value={answer}
                placeholder={prompt.placeholder}
                onChange={event => setAnswer(event.target.value)}
              />
            )}
            <button
              type="button"
              className="ui-pill-btn-primary px-4 text-sm disabled:opacity-50"
              disabled={busy || !answer}
              onClick={() => void run(() => answerOpenAICodexAuthorization(attempt.id, prompt.id, answer))}
            >
              {t('unified.continue')}
            </button>
          </div>
        </div>
      ) : null}

      {attempt?.status === 'running' ? (
        <button type="button" className="text-xs text-secondary-text hover:text-editor-fg hover:underline" disabled={busy} onClick={() => void run(() => cancelOpenAICodexAuthorization(attempt.id))}>
          {t('unified.cancelSignIn')}
        </button>
      ) : null}
      {attempt?.status === 'failed' && attempt.error ? <div className="text-xs text-red-500">{attempt.error}</div> : null}
      {attempt?.configurationError ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <span className="text-secondary-text">{attempt.configurationError}</span>
          <button type="button" className="shrink-0 text-brand hover:underline" disabled={busy} onClick={() => void run(enableOpenAICodexProvider)}>
            {t('unified.retryEnable')}
          </button>
        </div>
      ) : null}
      {error ? <div className="text-xs text-red-500">{error}</div> : null}
    </div>
  );
}
