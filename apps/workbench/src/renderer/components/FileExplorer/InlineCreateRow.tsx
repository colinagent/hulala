import React, { useEffect, useRef } from 'react';
import { FileTreeRow } from './FileTreeRow';

type InlineCreateRowProps = {
  depth: number;
  value: string;
  placeholder: string;
  error?: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
};

export function InlineCreateRow({
  depth,
  value,
  placeholder,
  error,
  onChange,
  onCommit,
  onCancel,
}: InlineCreateRowProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div>
      <FileTreeRow
        depth={depth}
        leftContent={(
          <input
            ref={inputRef}
            className="w-full bg-editor-bg border border-border rounded px-2 py-1 text-sm text-prime-text placeholder:text-secondary-text focus:outline-none focus:border-accent"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
              }
            }}
            onBlur={() => {
              // Match VS Code feel: blur cancels the inline create.
              onCancel();
            }}
          />
        )}
      />
      {error ? (
        <div className="text-xs text-red-400" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
