import React, { useEffect, useMemo, useState } from 'react';

import type { HarnessSettingsNamespace, HarnessSettingsSchema } from '../../types/platform';
import { mutateHarnessSettings, valueAtPath } from '../../services/harnessSettingsService';
import { useSettingsDirty } from './settingsDirtyContext';

type SchemaNode = HarnessSettingsSchema['refs'][string];

type HarnessSchemaFormProps = {
  namespace: HarnessSettingsNamespace;
  path?: string[];
  dirtyId: string;
  onSaved: (namespace: HarnessSettingsNamespace) => void;
  fieldLabels?: Record<string, string>;
};

const EMPTY_PATH: string[] = [];

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function schemaNodeAtPath(schema: HarnessSettingsSchema, path: string[]): SchemaNode | undefined {
  let node: SchemaNode | undefined = schema.refs[String(schema.uid)];
  for (const part of path) {
    if (!node) return undefined;
    if (node.type === 'object') {
      const next: number | undefined = node.dict?.[part];
      node = next === undefined ? undefined : schema.refs[String(next)];
      continue;
    }
    if (node.type === 'dict') {
      node = node.inner === undefined ? undefined : schema.refs[String(node.inner)];
      continue;
    }
    return undefined;
  }
  return node;
}

function unionOptions(schema: HarnessSettingsSchema, node: SchemaNode): unknown[] | null {
  if (node.type !== 'union' || !node.list) return null;
  const values = node.list.map((id) => schema.refs[String(id)]).filter(Boolean);
  return values.every((candidate) => candidate.type === 'const')
    ? values.map((candidate) => candidate.value)
    : null;
}

function titleForField(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

function secretForPath(namespace: HarnessSettingsNamespace, path: string[]): { set: boolean } | undefined {
  return namespace.secrets.find((entry) => entry.path.length === path.length
    && entry.path.every((part, index) => path[index] === part));
}

function inputClassName(): string {
  return 'h-9 w-full rounded-md border border-border bg-editor-bg px-3 text-sm text-editor-fg outline-none focus:border-brand';
}

export function HarnessSchemaForm({
  namespace,
  path = EMPTY_PATH,
  dirtyId,
  onSaved,
  fieldLabels = {},
}: HarnessSchemaFormProps) {
  const schemaNode = useMemo(() => schemaNodeAtPath(namespace.schema, path), [namespace.schema, path]);
  const source = useMemo(() => objectValue(valueAtPath(namespace.value, path)), [namespace.value, path]);
  const [draft, setDraft] = useState<Record<string, unknown>>(source);
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({});
  const [clearedSecrets, setClearedSecrets] = useState<Record<string, boolean>>({});
  const [jsonDraft, setJsonDraft] = useState<Record<string, string>>({});
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fields = useMemo(() => Object.entries(schemaNode?.dict || {}), [schemaNode]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(source)
    || Object.values(secretDraft).some((value) => value.length > 0)
    || Object.values(clearedSecrets).some(Boolean);
  useSettingsDirty(dirtyId, dirty);

  useEffect(() => {
    setDraft(source);
    setSecretDraft({});
    setClearedSecrets({});
    setJsonDraft({});
    setJsonErrors({});
  }, [source]);

  const update = (field: string, value: unknown) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setNotice(null);
  };

  const reset = () => {
    setDraft(source);
    setSecretDraft({});
    setClearedSecrets({});
    setJsonDraft({});
    setJsonErrors({});
    setNotice(null);
  };

  const save = async () => {
    if (Object.keys(jsonErrors).length > 0) return;
    setSaving(true);
    setNotice(null);
    try {
      const ops: Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }> = [];
      for (const [field] of fields) {
        const fieldPath = [...path, field];
        const secret = secretForPath(namespace, fieldPath);
        if (secret) {
          const value = secretDraft[field];
          if (clearedSecrets[field]) ops.push({ op: 'unset', path: fieldPath });
          else if (value) ops.push({ op: 'set', path: fieldPath, value });
          continue;
        }
        if (draft[field] === undefined || draft[field] === '') {
          ops.push({ op: 'unset', path: fieldPath });
        } else {
          ops.push({ op: 'set', path: fieldPath, value: draft[field] });
        }
      }
      const next = await mutateHarnessSettings(namespace, ops);
      onSaved(next);
      setSecretDraft({});
      setClearedSecrets({});
      setNotice('Saved');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  if (!schemaNode || schemaNode.type !== 'object') {
    return <div className="text-sm text-secondary-text">This configuration has no structured editor.</div>;
  }

  return (
    <div className="space-y-4">
      {fields.map(([field, ref]) => {
        const node = namespace.schema.refs[String(ref)];
        if (!node) return null;
        const fieldPath = [...path, field];
        const secret = secretForPath(namespace, fieldPath) || node.meta?.role === 'secret'
          ? secretForPath(namespace, fieldPath) || { set: false }
          : undefined;
        const options = unionOptions(namespace.schema, node);
        const label = fieldLabels[field] || titleForField(field);
        const value = draft[field];
        const complex = node.type === 'object' || node.type === 'array' || node.type === 'dict'
          || (node.type === 'union' && options === null);
        return (
          <label key={field} className="block space-y-1.5">
            <span className="flex items-center gap-2 text-sm font-medium text-editor-fg">
              {label}
              {secret?.set ? <span className="text-[11px] font-normal text-health-text">configured</span> : null}
            </span>
            {secret ? (
              <span className="flex gap-2">
                <input
                  className={inputClassName()}
                  type="password"
                  autoComplete="new-password"
                  value={secretDraft[field] || ''}
                  placeholder={clearedSecrets[field] ? 'Will be cleared on save' : secret.set ? 'Leave blank to keep the saved value' : 'Enter a value'}
                  onChange={(event) => {
                    setClearedSecrets((current) => ({ ...current, [field]: false }));
                    setSecretDraft((current) => ({ ...current, [field]: event.target.value }));
                  }}
                />
                {secret.set ? (
                  <button
                    type="button"
                    className="ui-pill-btn-secondary shrink-0 px-3 text-xs"
                    onClick={(event) => {
                      event.preventDefault();
                      setSecretDraft((current) => ({ ...current, [field]: '' }));
                      setClearedSecrets((current) => ({ ...current, [field]: true }));
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </span>
            ) : options ? (
              <select
                className={inputClassName()}
                value={value === undefined ? '' : String(value)}
                onChange={(event) => {
                  const selected = options.find((candidate) => String(candidate) === event.target.value);
                  update(field, selected);
                }}
              >
                <option value="">Use default</option>
                {options.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
              </select>
            ) : node.type === 'boolean' ? (
              <input
                type="checkbox"
                checked={value === true}
                onChange={(event) => update(field, event.target.checked)}
              />
            ) : node.type === 'number' ? (
              <input
                className={inputClassName()}
                type="number"
                min={typeof node.meta?.min === 'number' ? node.meta.min : undefined}
                max={typeof node.meta?.max === 'number' ? node.meta.max : undefined}
                step={typeof node.meta?.step === 'number' ? node.meta.step : 'any'}
                value={typeof value === 'number' ? value : ''}
                placeholder={node.meta?.default === undefined ? '' : String(node.meta.default)}
                onChange={(event) => update(field, event.target.value === '' ? undefined : Number(event.target.value))}
              />
            ) : complex ? (
              <>
                <textarea
                  className="min-h-28 w-full resize-y rounded-md border border-border bg-editor-bg px-3 py-2 font-mono text-xs text-editor-fg outline-none focus:border-brand"
                  value={jsonDraft[field] ?? JSON.stringify(value ?? node.meta?.default ?? (node.type === 'array' ? [] : {}), null, 2)}
                  onChange={(event) => {
                    const text = event.target.value;
                    setJsonDraft((current) => ({ ...current, [field]: text }));
                    try {
                      update(field, JSON.parse(text));
                      setJsonErrors((current) => {
                        const next = { ...current };
                        delete next[field];
                        return next;
                      });
                    } catch {
                      setJsonErrors((current) => ({ ...current, [field]: 'Invalid JSON' }));
                    }
                  }}
                />
                {jsonErrors[field] ? <span className="text-xs text-red-500">{jsonErrors[field]}</span> : null}
              </>
            ) : (
              <input
                className={inputClassName()}
                value={typeof value === 'string' ? value : ''}
                placeholder={node.meta?.default === undefined ? '' : String(node.meta.default)}
                onChange={(event) => update(field, event.target.value)}
              />
            )}
          </label>
        );
      })}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          className="ui-pill-btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
          disabled={!dirty || saving || Object.keys(jsonErrors).length > 0}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="ui-pill-btn px-4 py-1.5 text-sm" disabled={!dirty || saving} onClick={reset}>
          Reset
        </button>
        {notice ? <span className={notice === 'Saved' ? 'text-xs text-health-text' : 'text-xs text-red-500'}>{notice}</span> : null}
      </div>
    </div>
  );
}
