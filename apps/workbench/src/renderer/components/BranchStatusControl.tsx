import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useToastStore } from '../store/toastStore';
import { useTabManagerStore } from '../store/tabManagerStore';
import { CheckTinyIcon, ChevronDownIcon, GitBranchIcon, PlusIcon, SearchIcon } from './Icons';
import { useBlockingModal } from '../utils/useBlockingModal';

function CreateBranchDialog(props: {
  open: boolean;
  value: string;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { open, value, busy, disabled, error, onChange, onClose, onSubmit } = props;
  useBlockingModal(open);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onMouseDown={onClose} />
      <div
        className="relative w-[420px] max-w-[calc(100vw-32px)] rounded border border-border bg-editor-bg p-4 shadow-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="text-sm font-semibold text-prime-text">Create Branch</div>
        <div className="mt-2 text-sm text-secondary-text">Create and checkout a new local branch.</div>
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled && !busy) {
              onSubmit();
            }
          }}
        >
          <input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded border border-border bg-editor-bg px-3 py-2 text-sm text-prime-text outline-none focus:border-active-border"
            placeholder="feature/my-branch"
            autoFocus
          />
        </form>
        {error ? <div className="mt-2 text-sm text-accent whitespace-pre-wrap">{error}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="dialog-action-btn"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ui-pill-btn-primary op-sg-capsule op-sg--on-editor px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onSubmit}
            disabled={disabled || busy}
          >
            {busy ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function BranchStatusControl() {
  const currentDir = useAppStore((state) => state.currentDir);
  const connectionState = useAppStore((state) => state.connectionState);
  const gitInfo = useAppStore((state) => state.gitInfo);
  const documents = useAppStore((state) => state.documents);
  const refreshGitInfo = useAppStore((state) => state.refreshGitInfo);
  const checkoutGitBranch = useAppStore((state) => state.checkoutGitBranch);
  const activeTabId = useTabManagerStore((state) => state.activeTabId);
  const pushToast = useToastStore((state) => state.pushToast);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (connectionState === 'connected' && currentDir) {
      void refreshGitInfo(currentDir);
      return;
    }
    setOpen(false);
    setCreateOpen(false);
  }, [activeTabId, connectionState, currentDir, refreshGitInfo]);

  useEffect(() => {
    setOpen(false);
    setCreateOpen(false);
    setQuery('');
  }, [activeTabId]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCreateOpen(false);
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const filteredBranches = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return gitInfo.branches;
    }
    return gitInfo.branches.filter((branch) => branch.name.toLowerCase().includes(keyword));
  }, [gitInfo.branches, query]);

  const hasDirtyTabs = documents.some((tab) => tab.isDirty);
  const blockedReason = hasDirtyTabs
    ? 'Please save all modified editor tabs before switching branches.'
    : gitInfo.dirty.hasChanges
      ? 'Please commit or discard Git changes before switching branches.'
      : null;

  const toggleOpen = () => {
    if (submitting) {
      return;
    }
    setOpen((value) => !value);
  };

  const handleCheckout = async (branch: string, create?: boolean) => {
    if (blockedReason || submitting) {
      return;
    }
    setSubmitting(true);
    const result = await checkoutGitBranch(branch, { create });
    setSubmitting(false);
    if (!result.success) {
      const message = result.error || 'Failed to switch branch';
      if (create) {
        setCreateError(message);
      }
      pushToast(message);
      return;
    }
    setOpen(false);
    setCreateOpen(false);
    setQuery('');
    setNewBranchName('');
    setCreateError(null);
    pushToast(`${create ? 'Created and switched to' : 'Switched to'} ${result.currentBranch || branch}`);
  };

  if (connectionState !== 'connected' || !gitInfo.isRepo || gitInfo.error || !gitInfo.currentBranch) {
    return null;
  }

  return (
    <>
      <div className="relative no-drag" ref={menuRef}>
        <button
          type="button"
          className="ui-statusbar-control max-w-[220px]"
          onClick={toggleOpen}
          title={gitInfo.repoRoot || undefined}
        >
          <GitBranchIcon className="h-3.5 w-3.5" />
          <span className="max-w-[180px] truncate">{gitInfo.currentBranch}</span>
          <ChevronDownIcon className="h-3.5 w-3.5" />
        </button>

        {open && (
          <div
            className="absolute bottom-full right-0 z-[60] mb-2 w-[420px] max-w-[calc(100vw-16px)] max-h-[70vh] overflow-hidden rounded-lg border border-border bg-overlay-bg shadow-xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="border-b border-border p-3">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-text" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full rounded border border-border bg-editor-bg py-2 pl-9 pr-3 text-sm text-prime-text outline-none focus:border-active-border"
                  placeholder="Search branches"
                  autoFocus
                />
              </div>
            </div>

            <div className="px-4 py-3 text-sm font-medium text-secondary-text">Branches</div>

            {blockedReason ? (
              <div className="px-4 pb-2 text-sm text-accent">{blockedReason}</div>
            ) : null}

            <div className="max-h-[44vh] overflow-auto px-2 pb-2">
              {filteredBranches.length === 0 ? (
                <div className="px-3 py-6 text-sm text-secondary-text">No branches found.</div>
              ) : (
                filteredBranches.map((branch) => {
                  const isCurrent = branch.current;
                  return (
                    <button
                      key={branch.name}
                      type="button"
                      className="flex w-full items-start gap-3 rounded px-3 py-2 text-left text-sm text-prime-text hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        if (!isCurrent) {
                          void handleCheckout(branch.name, false);
                        } else {
                          setOpen(false);
                        }
                      }}
                      disabled={!!blockedReason || submitting}
                    >
                      <GitBranchIcon className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{branch.name}</div>
                        {isCurrent && gitInfo.dirty.hasChanges ? (
                          <div className="mt-1 text-xs text-secondary-text">
                            Uncommitted: {gitInfo.dirty.changedFiles} files{' '}
                            <span className="text-health-text">+{gitInfo.dirty.addedLines}</span>{' '}
                            <span className="text-accent">-{gitInfo.dirty.deletedLines}</span>
                          </div>
                        ) : null}
                      </div>
                      {isCurrent ? <CheckTinyIcon className="mt-1 h-4 w-4 shrink-0" /> : null}
                    </button>
                  );
                })
              )}
            </div>

            <div className="border-t border-border p-2">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-prime-text hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  setCreateError(null);
                  setCreateOpen(true);
                }}
                disabled={!!blockedReason || submitting}
              >
                <PlusIcon className="h-4 w-4" />
                <span>Create and checkout new branch...</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <CreateBranchDialog
        open={createOpen}
        value={newBranchName}
        busy={submitting}
        disabled={!!blockedReason || !newBranchName.trim()}
        error={createError}
        onChange={(value) => {
          setNewBranchName(value);
          setCreateError(null);
        }}
        onClose={() => {
          if (submitting) {
            return;
          }
          setCreateOpen(false);
          setCreateError(null);
        }}
        onSubmit={() => {
          void handleCheckout(newBranchName.trim(), true);
        }}
      />
    </>
  );
}
