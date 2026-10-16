import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DocumentHeaderRenameResult } from '../../utils/documentHeaderState';

type DocumentHeaderProps = {
  title: string;
  modifiedLabel: string | null;
  onRenameTitle?: (title: string) => Promise<DocumentHeaderRenameResult>;
};

export function DocumentHeader({ title, modifiedLabel, onRenameTitle }: DocumentHeaderProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const cancelledRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(title);
      setError(null);
    }
  }, [editing, title]);

  useEffect(() => {
    if (!editing) {
      return;
    }
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [editing]);

  const beginEditing = () => {
    if (!onRenameTitle || busy) {
      return;
    }
    cancelledRef.current = false;
    setDraft(title);
    setError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    if (submittingRef.current) {
      return;
    }
    cancelledRef.current = true;
    submittingRef.current = false;
    setBusy(false);
    setDraft(title);
    setError(null);
    setEditing(false);
  };

  const submitEditing = async () => {
    if (!onRenameTitle || submittingRef.current || cancelledRef.current) {
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await onRenameTitle(draft);
      if (result.success) {
        setEditing(false);
        return;
      }
      setError(result.error);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (renameError) {
      setError(renameError instanceof Error
        ? renameError.message
        : t('documentTitleRenameFailed'));
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <header className="op-md-document-header" aria-label={title}>
      <h1 className="op-md-document-header-title">
        {editing ? (
          <input
            ref={inputRef}
            className="op-md-document-header-title-input"
            value={draft}
            readOnly={busy}
            aria-busy={busy ? 'true' : undefined}
            aria-label={t('documentTitleEditLabel')}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              void submitEditing();
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                void submitEditing();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancelEditing();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="op-md-document-header-title-button"
            aria-label={t('documentTitleEditLabel')}
            onClick={beginEditing}
          >
            {title}
          </button>
        )}
      </h1>
      {error ? (
        <p className="op-md-document-header-error" role="alert">{error}</p>
      ) : null}
      {modifiedLabel ? (
        <p className="op-md-document-header-meta">{modifiedLabel}</p>
      ) : null}
    </header>
  );
}
