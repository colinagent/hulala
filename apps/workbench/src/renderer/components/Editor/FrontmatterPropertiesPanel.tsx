import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FrontmatterEntry } from '../../utils/frontmatterYaml';
import {
  inferPropertyKind,
  normalizeListValue,
  normalizeObjectEntries,
  normalizeTagsValue,
  patchObjectEntry,
  scalarToString,
  summarizeComplexValue,
  formatRunCommand,
  parseRunCommand,
  inferRunEndpointMode,
  switchRunEndpointMode,
  pruneRunObject,
  type FrontmatterObjectEntry,
  type PropertyKind,
  type RunEndpointMode,
} from '../../utils/frontmatterProperties';
import { buildThreadLinkTarget } from '../../utils/threadLink';
import { navigateFrontmatterLink } from '../../utils/frontmatterLinkNavigate';
import { SelectMenu } from '../SelectMenu';
import { UI_TAG_PILL, tagPillStyle } from '../../utils/tagPill';

const RUN_PLUG_ICON_PATH = 'M158.288,50.264h-17.631V7.5c0-4.143-3.357-7.5-7.5-7.5c-4.143,0-7.5,3.357-7.5,7.5v42.764H90.393V7.5c0-4.143-3.356-7.5-7.5-7.5c-4.142,0-7.5,3.357-7.5,7.5v42.764h-17.63c-4.143,0-7.5,3.357-7.5,7.5v50.262c0,29.307,21.946,53.568,50.265,57.259v43.267c0,4.143,3.356,7.5,7.5,7.5c4.142,0,7.5-3.357,7.5-7.5v-43.267c28.316-3.69,50.261-27.952,50.261-57.259V57.764C165.788,53.621,162.431,50.264,158.288,50.264z M150.788,108.025c0,23.579-19.183,42.762-42.761,42.762c-23.581,0-42.765-19.183-42.765-42.762V65.264h85.525V108.025z';

function focusEditableAtEnd(element: HTMLInputElement | HTMLTextAreaElement | null | undefined): void {
  if (!element) {
    return;
  }
  element.focus();
  const end = element.value.length;
  element.setSelectionRange(end, end);
}

type FrontmatterPropertiesPanelProps = {
  entries: FrontmatterEntry[];
  readOnly?: boolean;
  onPatch: (key: string, value: unknown) => void;
  onDeleteKey: (key: string) => void;
  onOpenSource: () => void;
};

type PropertyPath = string[];

const RUN_ENDPOINT_OPTIONS = [
  { value: 'command' as const, label: 'command' },
  { value: 'url' as const, label: 'url' },
];

function isExternalLinkTarget(value: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(value.trim());
}

function isRunPath(path: PropertyPath): boolean {
  return path.length === 1 && path[0] === 'run';
}

function isRunHeaderPath(path: PropertyPath): boolean {
  return path.length === 2 && path[0] === 'run' && path[1] === 'header';
}

function isRunCommandPath(path: PropertyPath): boolean {
  return path.length >= 2 && path[0] === 'run' && path[path.length - 1] === 'command';
}

function isRunDaemonPath(path: PropertyPath): boolean {
  return path.length === 2 && path[0] === 'run' && path[1] === 'daemon';
}

function buildPropertyLinkTarget(path: PropertyPath, value: string): string | null {
  const text = value.trim();
  if (!text) {
    return null;
  }
  if (path.length === 1 && (path[0] === 'thread' || path[0] === 'parent_thread')) {
    return buildThreadLinkTarget(text);
  }
  if (isExternalLinkTarget(text)) {
    return text;
  }
  return null;
}

function navigatePropertyLink(target: string): void {
  if (isExternalLinkTarget(target)) {
    window.open(target, '_blank');
    return;
  }
  void navigateFrontmatterLink(target);
}

function hasNonEmptyFrontmatterValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return normalizeObjectEntries(value).some((entry) => hasNonEmptyFrontmatterValue(entry.value));
  }
  return true;
}

function hasObjectEntries(value: unknown): boolean {
  return normalizeObjectEntries(value).length > 0;
}

function pruneEmptyObject(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const entries = normalizeObjectEntries(value);
  const next: Record<string, unknown> = {};
  for (const entry of entries) {
    const pruned = pruneEmptyObject(entry.value);
    if (hasNonEmptyFrontmatterValue(pruned)) {
      next[entry.key] = pruned;
    }
  }
  return next;
}

function normalizeTextPatchValue(next: string): string | undefined {
  const trimmed = next.trim();
  return trimmed || undefined;
}

function patchRunConfig(
  currentValue: unknown,
  key: string,
  nextValue: unknown,
  path: PropertyPath,
): unknown {
  if (isRunPath(path)) {
    const nextRun = patchObjectEntry(currentValue, key, nextValue);
    if (key === 'command' && nextValue !== undefined) {
      delete nextRun.url;
      delete nextRun.header;
    }
    if ((key === 'url' || key === 'header') && nextValue !== undefined) {
      delete nextRun.command;
    }
    const pruned = pruneRunObject(nextRun);
    if (key === 'header' && nextValue !== undefined && hasObjectEntries(nextValue)) {
      return {
        ...((pruned && typeof pruned === 'object' && !Array.isArray(pruned)) ? pruned : {}),
        header: nextValue,
      };
    }
    return pruned;
  }

  return patchObjectEntry(currentValue, key, nextValue);
}

function patchNestedFrontmatterObject(
  currentValue: unknown,
  key: string,
  nextValue: unknown,
  path: PropertyPath,
): unknown {
  if (!path.length || path[0] !== 'run') {
    return patchObjectEntry(currentValue, key, nextValue);
  }

  const nextObject = patchRunConfig(currentValue, key, nextValue, path);
  if (!isRunPath(path)) {
    return nextObject;
  }
  if (!nextObject || typeof nextObject !== 'object' || Array.isArray(nextObject)) {
    return nextObject;
  }
  return pruneRunObject(nextObject);
}

function FrontmatterSourceButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="op-md-frontmatter-properties-source"
      aria-label="Show frontmatter source"
      title="Show frontmatter source"
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="m5.25 3.75-3 4.25 3 4.25" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m10.75 3.75 3 4.25-3 4.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function PropertyIcon({ kind }: { kind: PropertyKind }) {
  const className = 'op-md-frontmatter-property-icon';
  if (kind === 'tags') {
    return (
      <svg
        className={`${className} op-md-frontmatter-property-icon--tags`}
        viewBox="-21 -21 682 682.66669"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="m274.667969 640c-.015625 0-.035157 0-.054688 0-20.027343-.015625-38.859375-7.828125-53.015625-22.007812l-199.390625-199.675782c-29.164062-29.21875-29.164062-76.761718 0-105.976562l268.78125-269.296875c27.699219-27.753907 64.554688-43.042969 103.773438-43.042969h170.527343c41.351563 0 75 33.640625 75 75v170.003906c0 39.191406-15.273437 76.03125-43 103.726563l-269.617187 269.335937c-14.164063 14.144532-32.988281 21.933594-53.003906 21.933594zm120.09375-590c-25.84375 0-50.128907 10.074219-68.382813 28.363281l-268.785156 269.296875c-9.722656 9.742188-9.722656 25.585938 0 35.328125l199.390625 199.675781c4.714844 4.722657 10.988281 7.332032 17.667969 7.335938h.019531c6.671875 0 12.945313-2.597656 17.664063-7.308594l269.617187-269.332031c18.273437-18.25 28.335937-42.53125 28.335937-68.355469v-170.003906c0-13.785156-11.214843-25-25-25zm64.273437 203.75c-41.355468 0-75-33.640625-75-75s33.644532-75 75-75c41.355469 0 75 33.640625 75 75s-33.644531 75-75 75zm0-100c-13.785156 0-25 11.214844-25 25s11.214844 25 25 25c13.789063 0 25-11.214844 25-25s-11.210937-25-25-25zm0 0" />
      </svg>
    );
  }
  if (kind === 'list') {
    return (
      <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M3 4.5h10M3 8h10M3 11.5h10" />
        <circle cx="1.5" cy="4.5" r="0.75" fill="currentColor" stroke="none" />
        <circle cx="1.5" cy="8" r="0.75" fill="currentColor" stroke="none" />
        <circle cx="1.5" cy="11.5" r="0.75" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === 'run') {
    return (
      <svg className={className} viewBox="0 0 216.051 216.051" fill="currentColor" aria-hidden="true">
        <path d={RUN_PLUG_ICON_PATH} />
      </svg>
    );
  }
  if (kind === 'object' || kind === 'object-list') {
    return (
      <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="2.75" y="3" width="10.5" height="10" rx="1.75" />
        <path d="M5.5 6h5M5.5 9h5M5.5 12h3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 4.5h10M3 8h10M3 11.5h7" />
    </svg>
  );
}

function InlineTextEdit({
  value,
  readOnly,
  onCommit,
  multiline = false,
  className,
}: {
  value: string;
  readOnly?: boolean;
  onCommit: (next: string) => void;
  multiline?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const multilineClassName = multiline ? 'op-md-frontmatter-property-value-multiline' : undefined;
  const mergedClassName = [className, multilineClassName].filter(Boolean).join(' ') || undefined;
  const valueClassName = mergedClassName
    ? `op-md-frontmatter-property-value ${mergedClassName}`
    : 'op-md-frontmatter-property-value';
  const valueButtonClassName = mergedClassName
    ? `op-md-frontmatter-property-value op-md-frontmatter-property-value-button ${mergedClassName}`
    : 'op-md-frontmatter-property-value op-md-frontmatter-property-value-button';
  const inputClassName = mergedClassName
    ? `op-md-frontmatter-property-input ${mergedClassName}`
    : 'op-md-frontmatter-property-input';

  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [editing, value]);

  useEffect(() => {
    if (editing) {
      focusEditableAtEnd(inputRef.current);
    }
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    if (draft !== value) {
      onCommit(draft);
    }
  }, [draft, onCommit, value]);

  if (readOnly) {
    return <span className={valueClassName}>{value}</span>;
  }

  if (!editing && !value) {
    return <AddValueButton onClick={() => setEditing(true)} />;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={valueButtonClassName}
        onClick={() => setEditing(true)}
      >
        {value}
      </button>
    );
  }

  if (multiline) {
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        className={`${inputClassName} op-md-frontmatter-property-input-multiline`}
        value={draft}
        rows={3}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      className={inputClassName}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}

function AddValueButton({
  onClick,
  label = 'Add value',
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="op-md-frontmatter-add-value"
      aria-label={label}
      onClick={onClick}
    >
      +
    </button>
  );
}

function BooleanPropertyValue({
  value,
  readOnly,
  onPatch,
}: {
  value: boolean;
  readOnly?: boolean;
  onPatch: (next: boolean) => void;
}) {
  const label = value ? 'true' : 'false';
  return (
    <label className="op-md-frontmatter-property-boolean">
      <input
        type="checkbox"
        checked={value}
        disabled={readOnly}
        onChange={(event) => onPatch(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function ChipRemoveButton({
  label,
  onClick,
  readOnly,
}: {
  label: string;
  onClick: () => void;
  readOnly?: boolean;
}) {
  if (readOnly) {
    return null;
  }
  return (
    <button
      type="button"
      className="op-md-frontmatter-chip-remove"
      aria-label={`Remove ${label}`}
      onClick={onClick}
    >
      ×
    </button>
  );
}

function TagChip({
  label,
  readOnly,
  onRemove,
}: {
  label: string;
  readOnly?: boolean;
  onRemove: () => void;
}) {
  return (
    <span className={`${UI_TAG_PILL} op-md-frontmatter-tag-chip`} style={tagPillStyle(label)}>
      <span>{label}</span>
      <ChipRemoveButton label={label} readOnly={readOnly} onClick={onRemove} />
    </span>
  );
}

function ListChip({
  label,
  readOnly,
  onRemove,
  linkTarget,
}: {
  label: string;
  readOnly?: boolean;
  onRemove: () => void;
  linkTarget?: string | null;
}) {
  const content = linkTarget ? (
    <button
      type="button"
      className="op-md-frontmatter-link-chip"
      data-md-link={linkTarget}
      onClick={() => {
        navigatePropertyLink(linkTarget);
      }}
    >
      {label}
    </button>
  ) : (
    <span>{label}</span>
  );

  return (
    <span className="ui-capsule-pill op-md-frontmatter-list-chip">
      {content}
      <ChipRemoveButton label={label} readOnly={readOnly} onClick={onRemove} />
    </span>
  );
}

function FrontmatterValueLink({
  value,
  target,
  readOnly,
  onCommit,
}: {
  value: string;
  target: string | null;
  readOnly?: boolean;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [editing, value]);

  useEffect(() => {
    if (editing) {
      focusEditableAtEnd(inputRef.current);
    }
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    if (draft !== value) {
      onCommit(draft);
    }
  }, [draft, onCommit, value]);

  if (!target) {
    return <InlineTextEdit value={value} readOnly={readOnly} onCommit={onCommit} />;
  }

  if (!readOnly && !editing && !value) {
    return <AddValueButton onClick={() => setEditing(true)} />;
  }

  if (!readOnly && editing) {
    return (
      <input
        ref={inputRef}
        className="op-md-frontmatter-property-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="op-md-frontmatter-property-value-link"
      data-md-link={target}
      onClick={() => {
        navigatePropertyLink(target);
      }}
      onDoubleClick={(event) => {
        if (readOnly) {
          return;
        }
        event.preventDefault();
        setEditing(true);
      }}
    >
      {value}
    </button>
  );
}

function AddChipInput({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (value: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [active, setActive] = useState(false);

  if (!active) {
    return (
      <button
        type="button"
        className="op-md-frontmatter-add-chip"
        onClick={() => setActive(true)}
      >
        +
      </button>
    );
  }

  return (
    <input
      className="op-md-frontmatter-add-chip-input"
      placeholder={placeholder}
      value={draft}
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        if (trimmed) {
          onAdd(trimmed);
        }
        setDraft('');
        setActive(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const trimmed = draft.trim();
          if (trimmed) {
            onAdd(trimmed);
          }
          setDraft('');
          setActive(false);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setDraft('');
          setActive(false);
        }
      }}
    />
  );
}

function RunEndpointModeSelect({
  mode,
  readOnly,
  onChange,
}: {
  mode: RunEndpointMode;
  readOnly?: boolean;
  onChange: (mode: RunEndpointMode) => void;
}) {
  if (readOnly) {
    return <span className="op-md-frontmatter-run-mode-readonly">{mode}</span>;
  }
  return (
    <SelectMenu
      ariaLabel="Run endpoint type"
      options={RUN_ENDPOINT_OPTIONS}
      value={mode}
      onChange={onChange}
      className="op-md-frontmatter-run-mode-select"
      triggerClassName="op-md-frontmatter-run-mode-trigger"
      menuClassName="min-w-[7rem]"
    />
  );
}

function RunPropertyEditor({
  path,
  value,
  readOnly,
  onPatch,
}: {
  path: PropertyPath;
  value: unknown;
  readOnly?: boolean;
  onPatch: (next: unknown) => void;
}) {
  const mode = inferRunEndpointMode(value);
  const valueByKey = useMemo(
    () => new Map(normalizeObjectEntries(value).map((entry) => [entry.key, entry.value])),
    [value],
  );
  const endpointStashRef = useRef<{ command?: unknown; url?: unknown; header?: unknown }>({});

  const patchKey = useCallback((key: string, next: unknown) => {
    onPatch(patchNestedFrontmatterObject(value, key, next, path));
  }, [onPatch, path, value]);

  const switchEndpointMode = useCallback((nextMode: RunEndpointMode) => {
    const currentMode = inferRunEndpointMode(value);
    if (currentMode === 'command' && valueByKey.has('command')) {
      endpointStashRef.current.command = valueByKey.get('command');
    }
    if (currentMode === 'url') {
      if (valueByKey.has('url')) {
        endpointStashRef.current.url = valueByKey.get('url');
      }
      if (valueByKey.has('header')) {
        endpointStashRef.current.header = valueByKey.get('header');
      }
    }

    let next = switchRunEndpointMode(value, nextMode);
    if (nextMode === 'command' && endpointStashRef.current.command !== undefined) {
      next = patchNestedFrontmatterObject(next, 'command', endpointStashRef.current.command, path);
    }
    if (nextMode === 'url') {
      if (endpointStashRef.current.url !== undefined) {
        next = patchNestedFrontmatterObject(next, 'url', endpointStashRef.current.url, path);
      }
      if (endpointStashRef.current.header !== undefined) {
        next = patchNestedFrontmatterObject(next, 'header', endpointStashRef.current.header, path);
      }
    }
    onPatch(next);
  }, [onPatch, path, value, valueByKey]);

  return (
    <div className="op-md-frontmatter-object">
    <div className="op-md-frontmatter-property-row op-md-frontmatter-property-row-nested op-md-frontmatter-run-endpoint-row">
      <div className="op-md-frontmatter-property-label op-md-frontmatter-property-label-nested">
        <RunEndpointModeSelect
            mode={mode}
            readOnly={readOnly}
            onChange={switchEndpointMode}
          />
        </div>
        <div className="op-md-frontmatter-property-content">
          {mode === 'command' ? (
            <RunCommandEditor
              value={valueByKey.get('command')}
              readOnly={readOnly}
              onPatch={(next) => patchKey('command', next)}
            />
          ) : (
            <InlineTextEdit
              value={scalarToString(valueByKey.get('url'))}
              readOnly={readOnly}
              onCommit={(next) => patchKey('url', normalizeTextPatchValue(next))}
            />
          )}
        </div>
      </div>
      {mode === 'url' ? (
        <NestedPropertyRow
          entry={{ key: 'header', value: valueByKey.get('header') }}
          path={[...path, 'header']}
          readOnly={readOnly}
          alignRunLabel
          onPatch={(next) => patchKey('header', next)}
          onDeleteKey={() => patchKey('header', undefined)}
        />
      ) : null}
      <NestedPropertyRow
        entry={{ key: 'daemon', value: valueByKey.get('daemon') }}
        path={[...path, 'daemon']}
        readOnly={readOnly}
        alignRunLabel
        onPatch={(next) => patchKey('daemon', next)}
        onDeleteKey={() => patchKey('daemon', undefined)}
      />
    </div>
  );
}

function RunCommandEditor({
  value,
  readOnly,
  onPatch,
}: {
  value: unknown;
  readOnly?: boolean;
  onPatch: (next: unknown) => void;
}) {
  const display = useMemo(() => formatRunCommand(normalizeListValue(value)), [value]);

  return (
    <InlineTextEdit
      value={display}
      readOnly={readOnly}
      className="op-md-frontmatter-property-value-command"
      onCommit={(next) => {
        const trimmed = next.trim();
        if (!trimmed) {
          onPatch(undefined);
          return;
        }
        onPatch(parseRunCommand(trimmed));
      }}
    />
  );
}

function PropertyChipListEditor({
  value,
  readOnly,
  onPatch,
}: {
  value: unknown;
  readOnly?: boolean;
  onPatch: (next: unknown) => void;
}) {
  const items = normalizeListValue(value);

  return (
    <div className="op-md-frontmatter-chip-row">
      {items.map((item, index) => (
        <ListChip
          key={`${item}-${index}`}
          label={item}
          readOnly={readOnly}
          onRemove={() => {
            onPatch(items.filter((_, itemIndex) => itemIndex !== index));
          }}
        />
      ))}
      {!readOnly ? (
        <AddChipInput
          placeholder="Add item"
          onAdd={(next) => {
            const trimmed = next.trim();
            if (!trimmed || items.includes(trimmed)) {
              return;
            }
            onPatch([...items, trimmed]);
          }}
        />
      ) : null}
    </div>
  );
}

function PropertyValueEditor({
  entry,
  path,
  readOnly,
  onPatch,
}: {
  entry: FrontmatterEntry | FrontmatterObjectEntry;
  path: PropertyPath;
  readOnly?: boolean;
  onPatch: (value: unknown) => void;
}) {
  const kind = inferPropertyKind(entry.key, entry.value);
  const target = useMemo(
    () => buildPropertyLinkTarget(path, scalarToString(entry.value)),
    [entry.value, path],
  );

  if (isRunCommandPath(path)) {
    return (
      <RunCommandEditor
        value={entry.value}
        readOnly={readOnly}
        onPatch={onPatch}
      />
    );
  }

  if (isRunHeaderPath(path)) {
    return (
      <RunHeaderEditor
        path={path}
        value={entry.value}
        readOnly={readOnly}
        onPatch={onPatch}
      />
    );
  }

  if (kind === 'object' || kind === 'run') {
    return (
      <ObjectPropertyEditor
        path={path}
        value={entry.value}
        readOnly={readOnly}
        onPatch={onPatch}
      />
    );
  }

  if (kind === 'object-list') {
    return (
      <ObjectListPropertyEditor
        path={path}
        value={entry.value}
        readOnly={readOnly}
        onPatch={onPatch}
      />
    );
  }

  if (kind === 'complex') {
    return (
      <div className="op-md-frontmatter-property-complex">
        <code>{summarizeComplexValue(entry.value)}</code>
      </div>
    );
  }

  if (kind === 'tags') {
    const tags = normalizeTagsValue(entry.value);
    return (
      <div className="op-md-frontmatter-chip-row">
        {tags.map((tag, index) => (
          <TagChip
            key={`${tag}-${index}`}
            label={tag}
            readOnly={readOnly}
            onRemove={() => {
              onPatch(tags.filter((_, itemIndex) => itemIndex !== index));
            }}
          />
        ))}
        {!readOnly ? (
          <AddChipInput
            placeholder="Add tag"
            onAdd={(next) => {
              const trimmed = next.trim();
              if (!trimmed || tags.includes(trimmed)) {
                return;
              }
              onPatch([...tags, trimmed]);
            }}
          />
        ) : null}
      </div>
    );
  }

  if (kind === 'list') {
    return (
      <PropertyChipListEditor
        value={entry.value}
        readOnly={readOnly}
        onPatch={onPatch}
      />
    );
  }

  if (isRunDaemonPath(path)) {
    if (!readOnly && (entry.value === null || entry.value === undefined)) {
      return <AddValueButton label="Add daemon" onClick={() => onPatch(true)} />;
    }
    return (
      <BooleanPropertyValue
        value={entry.value === true}
        readOnly={readOnly}
        onPatch={onPatch}
      />
    );
  }

  if (kind === 'boolean') {
    return (
      <BooleanPropertyValue
        value={Boolean(entry.value)}
        readOnly={readOnly}
        onPatch={onPatch}
      />
    );
  }

  if (kind === 'link-thread' || target) {
    return (
      <FrontmatterValueLink
        value={scalarToString(entry.value)}
        target={target}
        readOnly={readOnly}
        onCommit={(next) => {
          if (kind === 'number') {
            const parsed = Number(next);
            onPatch(Number.isFinite(parsed) ? parsed : normalizeTextPatchValue(next));
            return;
          }
          onPatch(normalizeTextPatchValue(next));
        }}
      />
    );
  }

  return (
    <InlineTextEdit
      value={scalarToString(entry.value)}
      readOnly={readOnly}
      multiline={entry.key.toLowerCase() === 'description'}
      onCommit={(next) => {
        if (kind === 'number') {
          const parsed = Number(next);
          onPatch(Number.isFinite(parsed) ? parsed : next);
          return;
        }
        onPatch(normalizeTextPatchValue(next));
      }}
    />
  );
}

function NestedPropertyRow({
  entry,
  path,
  readOnly,
  alignRunLabel,
  onPatch,
  onDeleteKey,
}: {
  entry: FrontmatterObjectEntry;
  path: PropertyPath;
  readOnly?: boolean;
  alignRunLabel?: boolean;
  onPatch: (value: unknown) => void;
  onDeleteKey: () => void;
}) {
  return (
    <div className="op-md-frontmatter-property-row op-md-frontmatter-property-row-nested">
      <div className="op-md-frontmatter-property-label op-md-frontmatter-property-label-nested">
        <span className={alignRunLabel ? 'op-md-frontmatter-run-nested-label' : undefined}>{entry.key}</span>
        {!readOnly ? (
          <button
            type="button"
            className="op-md-frontmatter-property-delete"
            aria-label={`Remove ${entry.key}`}
            onClick={onDeleteKey}
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="op-md-frontmatter-property-content">
        <PropertyValueEditor
          entry={entry}
          path={path}
          readOnly={readOnly}
          onPatch={onPatch}
        />
      </div>
    </div>
  );
}

function RunHeaderEditor({
  path,
  value,
  readOnly,
  onPatch,
}: {
  path: PropertyPath;
  value: unknown;
  readOnly?: boolean;
  onPatch: (next: unknown) => void;
}) {
  const entries = normalizeObjectEntries(value);
  const [adding, setAdding] = useState(false);
  const [newHeaderName, setNewHeaderName] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (adding) {
      inputRef.current?.focus();
    }
  }, [adding]);

  const patchHeaderEntry = useCallback((key: string, next: unknown) => {
    const nextHeader = patchObjectEntry(value, key, next);
    onPatch(hasObjectEntries(nextHeader) ? nextHeader : undefined);
  }, [onPatch, value]);

  const commitNewHeader = useCallback(() => {
    const trimmed = newHeaderName.trim();
    if (trimmed && !entries.some((entry) => entry.key === trimmed)) {
      onPatch(patchObjectEntry(value, trimmed, ''));
    }
    setNewHeaderName('');
    setAdding(false);
  }, [entries, newHeaderName, onPatch, value]);

  return (
    <div className="op-md-frontmatter-object">
      {entries.map((childEntry) => (
        <NestedPropertyRow
          key={childEntry.key}
          entry={childEntry}
          path={[...path, childEntry.key]}
          readOnly={readOnly}
          onPatch={(next) => patchHeaderEntry(childEntry.key, next)}
          onDeleteKey={() => patchHeaderEntry(childEntry.key, undefined)}
        />
      ))}
      {!readOnly ? (
        adding ? (
          <input
            ref={inputRef}
            className="op-md-frontmatter-property-input"
            placeholder="Header name"
            value={newHeaderName}
            onChange={(event) => setNewHeaderName(event.target.value)}
            onBlur={commitNewHeader}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitNewHeader();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setNewHeaderName('');
                setAdding(false);
              }
            }}
          />
        ) : (
          <AddValueButton label="Add header" onClick={() => setAdding(true)} />
        )
      ) : null}
    </div>
  );
}

function ObjectPropertyEditor({
  path,
  value,
  readOnly,
  onPatch,
}: {
  path: PropertyPath;
  value: unknown;
  readOnly?: boolean;
  onPatch: (next: unknown) => void;
}) {
  if (isRunPath(path)) {
    return (
      <RunPropertyEditor
        path={path}
        value={value}
        readOnly={readOnly}
        onPatch={onPatch}
      />
    );
  }

  const entries = normalizeObjectEntries(value);
  if (!entries.length) {
    return <span className="op-md-frontmatter-property-value" />;
  }

  return (
    <div className="op-md-frontmatter-object">
      {entries.map((childEntry) => (
        <NestedPropertyRow
          key={childEntry.key}
          entry={childEntry}
          path={[...path, childEntry.key]}
          readOnly={readOnly}
          onPatch={(next) => {
            onPatch(patchNestedFrontmatterObject(value, childEntry.key, next, path));
          }}
          onDeleteKey={() => {
            onPatch(patchNestedFrontmatterObject(value, childEntry.key, undefined, path));
          }}
        />
      ))}
    </div>
  );
}

function ObjectListPropertyEditor({
  path,
  value,
  readOnly,
  onPatch,
}: {
  path: PropertyPath;
  value: unknown;
  readOnly?: boolean;
  onPatch: (next: unknown) => void;
}) {
  const items = Array.isArray(value) ? value : [];

  if (!items.length) {
    return <span className="op-md-frontmatter-property-value" />;
  }

  return (
    <div className="op-md-frontmatter-object-list">
      {items.map((item, index) => (
        <div key={index} className="op-md-frontmatter-object-group">
          <div className="op-md-frontmatter-object-group-header">
            <span className="op-md-frontmatter-object-group-index">{index + 1}</span>
            {!readOnly ? (
              <button
                type="button"
                className="op-md-frontmatter-property-delete op-md-frontmatter-object-group-delete"
                aria-label={`Remove ${path[path.length - 1]} item ${index + 1}`}
                onClick={() => {
                  onPatch(items.filter((_, itemIndex) => itemIndex !== index));
                }}
              >
                ×
              </button>
            ) : null}
          </div>
          <ObjectPropertyEditor
            path={[...path, String(index)]}
            value={item}
            readOnly={readOnly}
            onPatch={(next) => {
              const nextItems = items.map((current, itemIndex) => (itemIndex === index ? next : current));
              onPatch(nextItems);
            }}
          />
        </div>
      ))}
    </div>
  );
}

function PropertyRow({
  entry,
  readOnly,
  onPatch,
  onDeleteKey,
}: {
  entry: FrontmatterEntry;
  readOnly?: boolean;
  onPatch: (value: unknown) => void;
  onDeleteKey: () => void;
}) {
  const kind = inferPropertyKind(entry.key, entry.value);
  return (
    <div className="op-md-frontmatter-property-row">
      <div className="op-md-frontmatter-property-label">
        <PropertyIcon kind={kind} />
        <span>{entry.key}</span>
        {!readOnly ? (
          <button
            type="button"
            className="op-md-frontmatter-property-delete"
            aria-label={`Remove ${entry.key}`}
            onClick={onDeleteKey}
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="op-md-frontmatter-property-content">
        <PropertyValueEditor
          entry={entry}
          path={[entry.key]}
          readOnly={readOnly}
          onPatch={onPatch}
        />
      </div>
    </div>
  );
}

export function FrontmatterPropertiesPanel({
  entries,
  readOnly = false,
  onPatch,
  onDeleteKey,
  onOpenSource,
}: FrontmatterPropertiesPanelProps) {
  const [addingProperty, setAddingProperty] = useState(false);
  const [newPropertyKey, setNewPropertyKey] = useState('');
  const addInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (addingProperty) {
      addInputRef.current?.focus();
    }
  }, [addingProperty]);

  return (
    <section className="op-md-frontmatter-properties" aria-label="Properties">
      <div className="op-md-frontmatter-properties-header">
        <FrontmatterSourceButton onClick={onOpenSource} />
      </div>
      <div className="op-md-frontmatter-properties-body">
        {entries.map((entry) => (
          <PropertyRow
            key={entry.key}
            entry={entry}
            readOnly={readOnly}
            onPatch={(value) => {
              if (value === undefined) {
                onDeleteKey(entry.key);
                return;
              }
              onPatch(entry.key, value);
            }}
            onDeleteKey={() => onDeleteKey(entry.key)}
          />
        ))}
        {!readOnly ? (
          addingProperty ? (
            <div className="op-md-frontmatter-add-property-row">
              <input
                ref={addInputRef}
                className="op-md-frontmatter-property-input"
                placeholder="property name"
                value={newPropertyKey}
                onChange={(event) => setNewPropertyKey(event.target.value)}
                onBlur={() => {
                  const trimmed = newPropertyKey.trim();
                  if (trimmed && !entries.some((entry) => entry.key === trimmed)) {
                    onPatch(trimmed, '');
                  }
                  setNewPropertyKey('');
                  setAddingProperty(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const trimmed = newPropertyKey.trim();
                    if (trimmed && !entries.some((entry) => entry.key === trimmed)) {
                      onPatch(trimmed, '');
                    }
                    setNewPropertyKey('');
                    setAddingProperty(false);
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setNewPropertyKey('');
                    setAddingProperty(false);
                  }
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className="op-md-frontmatter-add-property"
              onClick={() => setAddingProperty(true)}
            >
              + Add property
            </button>
          )
        ) : null}
      </div>
    </section>
  );
}
