import React, { useEffect, useMemo, useRef, useState } from 'react';

import { CheckTinyIcon, ChevronDownIcon } from './Icons';
import { PopupMenu, PopupMenuItem } from './PopupMenu';
import {
  CLOSED_SELECT_MENU_STATE,
  closeSelectMenu,
  commitSelectMenuSelection,
  getOpenSelectMenuState,
  getSelectMenuTriggerLabel,
  moveSelectMenuHighlight,
  toggleSelectMenu,
  type SelectMenuOptionLike,
} from './selectMenuState';

export type SelectOption<T extends string = string> = SelectMenuOptionLike<T> & {
  label: string;
  description?: string;
  title?: string;
};

type SelectMenuProps<T extends string> = {
  options: readonly SelectOption<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  disabled?: boolean;
  placeholder?: string;
  title?: string;
  ariaLabel?: string;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
};

export function SelectMenu<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  placeholder = '',
  title,
  ariaLabel,
  className,
  triggerClassName,
  menuClassName,
}: SelectMenuProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState(CLOSED_SELECT_MENU_STATE);

  const triggerLabel = useMemo(
    () => getSelectMenuTriggerLabel(options, value, placeholder),
    [options, placeholder, value]
  );

  useEffect(() => {
    if (!state.open) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setState((current) => closeSelectMenu(current));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setState((current) => closeSelectMenu(current));
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setState((current) => moveSelectMenuHighlight(current, options, 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setState((current) => moveSelectMenuHighlight(current, options, -1));
        return;
      }
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      const nextOption = options[state.highlightedIndex];
      if (!nextOption || nextOption.disabled) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      onChange(nextOption.value);
      setState(commitSelectMenuSelection(state.highlightedIndex));
    };

    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onChange, options, state.highlightedIndex, state.open]);

  useEffect(() => {
    if (!state.open) {
      return;
    }
    setState((current) => ({
      ...current,
      highlightedIndex: getOpenSelectMenuState(options, value).highlightedIndex,
    }));
  }, [options, state.open, value]);

  const buttonClassName = [
    'flex',
    'w-full',
    'items-center',
    'justify-between',
    'gap-2',
    'rounded',
    'border',
    'border-border',
    'bg-editor-bg',
    'px-2',
    'py-1.5',
    'text-sm',
    'outline-none',
    'transition-colors',
    disabled
      ? 'cursor-not-allowed text-tertiary-text opacity-50'
      : state.open
        ? 'border-active-border text-prime-text'
        : 'text-prime-text hover:border-active-border hover:text-prime-text',
    triggerClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const rootClassName = ['relative w-full', className].filter(Boolean).join(' ');
  const popupClassName = [
    'absolute left-0 top-full z-[60] mt-1 min-w-full overflow-hidden',
    menuClassName,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={rootRef} className={rootClassName}>
      <button
        type="button"
        className={buttonClassName}
        title={title || triggerLabel}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={state.open}
        disabled={disabled}
        onClick={() => {
          setState((current) => toggleSelectMenu(current, options, value, disabled));
        }}
        onKeyDown={(event) => {
          if (disabled) {
            return;
          }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter' && event.key !== ' ') {
            return;
          }
          event.preventDefault();
          const opened = getOpenSelectMenuState(options, value);
          if (event.key === 'ArrowUp') {
            setState(moveSelectMenuHighlight(opened, options, -1));
            return;
          }
          setState(opened);
        }}
      >
        <span className={`min-w-0 truncate text-left ${triggerLabel ? '' : 'text-secondary-text'}`}>
          {triggerLabel || placeholder}
        </span>
        <ChevronDownIcon className="h-3.5 w-3.5 flex-shrink-0" />
      </button>

      {state.open && (
        <PopupMenu className={popupClassName} role="listbox" aria-label={ariaLabel}>
          <div className="max-h-60 overflow-auto py-1">
            {options.map((option, index) => {
              const selected = option.value === value;
              return (
                <PopupMenuItem
                  key={option.value}
                  highlighted={state.highlightedIndex === index}
                  disabled={option.disabled}
                  title={option.title || option.label}
                  role="option"
                  aria-selected={selected}
                  className={`items-start gap-2 px-3 py-1.5 ${selected ? 'font-medium text-brand' : ''}`}
                  onMouseEnter={() => {
                    if (option.disabled) {
                      return;
                    }
                    setState((current) => ({
                      ...current,
                      highlightedIndex: index,
                    }));
                  }}
                  onClick={() => {
                    if (option.disabled) {
                      return;
                    }
                    onChange(option.value);
                    setState(commitSelectMenuSelection(index));
                  }}
                >
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    {selected ? <CheckTinyIcon className="w-3 h-3" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{option.label}</span>
                    {option.description ? (
                      <span className="block truncate text-xs text-tertiary-text">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </PopupMenuItem>
              );
            })}
          </div>
        </PopupMenu>
      )}
    </div>
  );
}
