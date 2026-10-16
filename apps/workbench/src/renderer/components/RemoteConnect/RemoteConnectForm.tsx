import React, { useState } from 'react';
import type { ManualSshHostPayload, SshHostPayload } from '../../types/platform';

type SshHost = SshHostPayload;

type FormState = {
  id?: string;
  alias: string;
  hostname: string;
  user: string;
  port: string;
  authMethod: 'password' | 'keyFile';
  identityFile: string;
  password: string;
  passphrase: string;
  keepExistingSecret: boolean;
  rememberSecret: boolean;
};

type RemoteConnectFormProps = {
  host?: SshHost;
  onCancel: () => void;
  onSaved: (host: SshHost) => void;
};

const emptyForm: FormState = {
  alias: '',
  hostname: '',
  user: '',
  port: '22',
  authMethod: 'password',
  identityFile: '',
  password: '',
  passphrase: '',
  keepExistingSecret: false,
  rememberSecret: true,
};

function toForm(host?: SshHost): FormState {
  if (!host) {
    return { ...emptyForm };
  }
  return {
    id: host.id,
    alias: host.alias,
    hostname: host.hostname || '',
    user: host.user || '',
    port: host.port || '22',
    authMethod: host.authMethod === 'keyFile' ? 'keyFile' : 'password',
    identityFile: host.identityFile || '',
    password: '',
    passphrase: '',
    keepExistingSecret: Boolean(host.hasPassword || host.hasPassphrase),
    rememberSecret: host.credentialStorage !== 'session',
  };
}

function validateForm(form: FormState): string | null {
  if (!form.alias.trim()) {
    return 'Alias is required';
  }
  if (!form.hostname.trim()) {
    return 'Host is required';
  }
  if (!form.user.trim()) {
    return 'User is required';
  }
  if (form.port.trim() && !/^\d+$/.test(form.port.trim())) {
    return 'Port must be a number';
  }
  if (form.authMethod === 'password' && !form.keepExistingSecret && !form.password) {
    return 'Password is required';
  }
  if (form.authMethod === 'keyFile' && !form.identityFile.trim()) {
    return 'Private key file is required';
  }
  return null;
}

export const RemoteConnectForm: React.FC<RemoteConnectFormProps> = ({ host, onCancel, onSaved }) => {
  const [form, setForm] = useState<FormState>(() => toForm(host));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveHost = async () => {
    const validation = validateForm(form);
    if (validation) {
      setError(validation);
      return;
    }
    const payload: ManualSshHostPayload = {
      id: form.id,
      alias: form.alias.trim(),
      hostname: form.hostname.trim(),
      user: form.user.trim(),
      port: form.port.trim() || undefined,
      authMethod: form.authMethod,
      identityFile: form.authMethod === 'keyFile' ? form.identityFile.trim() : undefined,
      password: form.authMethod === 'password' && form.password ? form.password : undefined,
      passphrase: form.authMethod === 'keyFile' && form.passphrase ? form.passphrase : undefined,
      rememberSecret: form.rememberSecret,
    };
    setSaving(true);
    setError(null);
    try {
      const saved = await window.hulala?.ssh?.saveHost?.(payload);
      if (saved) {
        setForm(current => ({ ...current, password: '', passphrase: '' }));
        onSaved(saved);
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to save SSH host');
    } finally {
      setSaving(false);
    }
  };

  const pickIdentityFile = async () => {
    const result = await window.hulala?.ssh?.pickIdentityFile?.();
    if (result && !result.canceled && result.path) {
      setForm((current) => ({ ...current, identityFile: result.path || '' }));
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-secondary-text">
          <span>Alias</span>
          <input
            className="w-full bg-editor-bg border border-border rounded px-2 py-1 text-sm text-editor-fg"
            value={form.alias}
            onChange={(event) => setForm((current) => ({ ...current, alias: event.target.value }))}
            autoFocus
          />
        </label>
        <label className="space-y-1 text-xs text-secondary-text">
          <span>User</span>
          <input
            className="w-full bg-editor-bg border border-border rounded px-2 py-1 text-sm text-editor-fg"
            value={form.user}
            onChange={(event) => setForm((current) => ({ ...current, user: event.target.value }))}
          />
        </label>
      </div>
      <div className="grid grid-cols-[1fr_96px] gap-3">
        <label className="space-y-1 text-xs text-secondary-text">
          <span>Host</span>
          <input
            className="w-full bg-editor-bg border border-border rounded px-2 py-1 text-sm text-editor-fg"
            value={form.hostname}
            onChange={(event) => setForm((current) => ({ ...current, hostname: event.target.value }))}
          />
        </label>
        <label className="space-y-1 text-xs text-secondary-text">
          <span>Port</span>
          <input
            className="w-full bg-editor-bg border border-border rounded px-2 py-1 text-sm text-editor-fg"
            value={form.port}
            onChange={(event) => setForm((current) => ({ ...current, port: event.target.value }))}
          />
        </label>
      </div>
      <div className="flex rounded border border-border overflow-hidden text-sm">
        <button
          className={`flex-1 px-3 py-1.5 ${form.authMethod === 'password' ? 'text-highlight' : 'text-secondary-text'}`}
          onClick={() => setForm((current) => ({
            ...current,
            authMethod: 'password',
            keepExistingSecret: Boolean(current.id && current.authMethod === 'password' && current.keepExistingSecret),
          }))}
          type="button"
        >
          Password
        </button>
        <button
          className={`flex-1 px-3 py-1.5 border-l border-border ${form.authMethod === 'keyFile' ? 'text-highlight' : 'text-secondary-text'}`}
          onClick={() => setForm((current) => ({
            ...current,
            authMethod: 'keyFile',
            keepExistingSecret: Boolean(current.id && current.authMethod === 'keyFile' && current.keepExistingSecret),
          }))}
          type="button"
        >
          Private Key
        </button>
      </div>
      {form.authMethod === 'password' ? (
        <label className="space-y-1 text-xs text-secondary-text">
          <span>Password{form.keepExistingSecret ? ' (leave blank to keep saved password)' : ''}</span>
          <input
            className="w-full bg-editor-bg border border-border rounded px-2 py-1 text-sm text-editor-fg"
            type="password"
            value={form.password}
            onChange={(event) => {
              const password = event.target.value;
              setForm((current) => ({ ...current, password, keepExistingSecret: current.id ? !password : false }));
            }}
          />
        </label>
      ) : (
        <>
          <label className="space-y-1 text-xs text-secondary-text">
            <span>Private key</span>
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 bg-editor-bg border border-border rounded px-2 py-1 text-sm text-editor-fg"
                value={form.identityFile}
                onChange={(event) => setForm((current) => ({ ...current, identityFile: event.target.value }))}
              />
              <button className="dialog-text-btn" type="button" onClick={() => void pickIdentityFile()}>
                Choose
              </button>
            </div>
          </label>
          <label className="space-y-1 text-xs text-secondary-text">
            <span>Passphrase{form.keepExistingSecret ? ' (leave blank to keep saved passphrase)' : ' (optional)'}</span>
            <input
              className="w-full bg-editor-bg border border-border rounded px-2 py-1 text-sm text-editor-fg"
              type="password"
              value={form.passphrase}
              onChange={(event) => {
                const passphrase = event.target.value;
                setForm((current) => ({ ...current, passphrase, keepExistingSecret: current.id ? !passphrase : false }));
              }}
            />
          </label>
        </>
      )}
      <label className="flex items-center gap-2 text-xs text-secondary-text"><input type="checkbox" checked={form.rememberSecret} onChange={event => setForm(current => ({ ...current, rememberSecret: event.target.checked }))} />Remember secret in the system credential store</label>
      {!form.rememberSecret ? <p className="text-xs text-secondary-text">The secret will be available only until the local Hulala service stops.</p> : null}
      {error ? <div role="alert" className="text-xs text-accent">{error}</div> : null}
      <div className="flex justify-end gap-2 pt-1">
        <button className="dialog-text-btn" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="ui-pill-btn-primary op-sg-capsule op-sg--on-editor px-3 py-1.5 text-sm disabled:opacity-60"
          disabled={saving}
          onClick={() => void saveHost()}
          type="button"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
};
