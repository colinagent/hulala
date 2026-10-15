import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { SshHostPayload } from '../../types/platform';
import { useBlockingModal } from '../../utils/useBlockingModal';
import { RemoteConnectForm } from './RemoteConnectForm';

type SshHost = SshHostPayload;

type RemoteConnectModalProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (host: SshHost) => void;
};

function describeHost(host: SshHost) {
  return [
    host.user && host.hostname ? `${host.user}@${host.hostname}` : host.hostname,
    host.port ? `:${host.port}` : '',
  ]
    .filter(Boolean)
    .join('');
}

export const RemoteConnectModal: React.FC<RemoteConnectModalProps> = ({
  open,
  onClose,
  onSelect,
}) => {
  useBlockingModal(open);

  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [editingHost, setEditingHost] = useState<SshHost | undefined>();
  const [error, setError] = useState<string | null>(null);

  const loadHosts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.hulala?.ssh?.listHosts?.();
      setHosts(result || []);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load SSH hosts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    setMode('list');
    setEditingHost(undefined);
    setError(null);
    void loadHosts();
  }, [loadHosts, open]);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) {
      return hosts;
    }
    return hosts.filter((host) => (
      host.alias.toLowerCase().includes(value) ||
      host.hostname?.toLowerCase().includes(value) ||
      host.user?.toLowerCase().includes(value)
    ));
  }, [hosts, query]);

  const startAdd = () => {
    setEditingHost(undefined);
    setError(null);
    setMode('form');
  };

  const startEdit = (host: SshHost) => {
    setEditingHost(host);
    setError(null);
    setMode('form');
  };

  const deleteHost = async (host: SshHost) => {
    if (!host.id) {
      return;
    }
    setError(null);
    try {
      await window.hulala?.ssh?.deleteHost?.(host.id);
      await loadHosts();
    } catch (err) {
      setError((err as Error).message || 'Failed to delete SSH host');
    }
  };

  const handleSaved = async (host: SshHost) => {
    await loadHosts();
    setMode('list');
    setQuery(host.alias);
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center z-50">
      <div className="bg-editor-bg border border-border rounded w-[560px] max-h-[78vh] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-titlebar-bg">
          <span className="text-sm font-semibold text-sidebar-fg">Remote SSH</span>
          <div className="flex items-center gap-2">
            {mode === 'list' ? (
              <button className="dialog-text-btn" onClick={startAdd}>
                Add
              </button>
            ) : (
              <button className="dialog-text-btn" onClick={() => setMode('list')}>
                Back
              </button>
            )}
            <button className="dialog-text-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {mode === 'list' ? (
          <>
            <div className="p-3 border-b border-border">
              <input
                className="w-full bg-editor-bg border border-border rounded px-2 py-1 text-sm"
                placeholder="Search host..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
              />
              {error ? <div className="mt-2 text-xs text-accent">{error}</div> : null}
            </div>
            <div className="max-h-[54vh] overflow-auto">
              {loading ? (
                <div className="p-4 text-sm text-secondary-text">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-sm text-secondary-text">No hosts found</div>
              ) : (
                filtered.map((host) => {
                  const isManual = host.source === 'manual';
                  return (
                    <div
                      key={`${host.source || 'config'}:${host.id || host.alias}`}
                      className="group flex items-center border-b border-border hover:text-link-text-hover"
                    >
                      <button
                        className="min-w-0 flex-1 text-left px-4 py-2 rounded hover:text-link-text-hover"
                        onClick={() => onSelect(host)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-editor-fg group-hover:text-link-text-hover truncate">
                            {host.alias}
                          </span>
                          {isManual ? (
                            <span className="text-[11px] text-secondary-text group-hover:text-link-text-hover">
                              {host.authMethod === 'keyFile' ? 'key' : 'password'}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-secondary-text group-hover:text-link-text-hover truncate">
                          {describeHost(host) || host.source || ''}
                        </div>
                      </button>
                      {isManual ? (
                        <div className="flex shrink-0 items-center gap-1 pr-3">
                          <button className="dialog-text-btn" onClick={() => startEdit(host)}>
                            Edit
                          </button>
                          <button className="dialog-text-btn" onClick={() => void deleteHost(host)}>
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <RemoteConnectForm
            key={editingHost?.id || 'new'}
            host={editingHost}
            onCancel={() => setMode('list')}
            onSaved={(host) => void handleSaved(host)}
          />
        )}
      </div>
    </div>
  );
};
