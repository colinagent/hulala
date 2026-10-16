export type SelectMenuOptionLike<T extends string = string> = {
  value: T;
  label?: string;
  disabled?: boolean;
};

export type SelectMenuState = {
  open: boolean;
  highlightedIndex: number;
};

export const CLOSED_SELECT_MENU_STATE: SelectMenuState = {
  open: false,
  highlightedIndex: -1,
};

export function findSelectedOptionIndex<T extends string>(
  options: readonly SelectMenuOptionLike<T>[],
  value: T | null | undefined
): number {
  if (value == null) {
    return -1;
  }
  return options.findIndex((option) => option.value === value);
}

export function findNextEnabledOptionIndex<T extends string>(
  options: readonly SelectMenuOptionLike<T>[],
  startIndex: number,
  direction: 1 | -1
): number {
  const total = options.length;
  if (total === 0) {
    return -1;
  }
  for (let step = 1; step <= total; step += 1) {
    const nextIndex = (startIndex + direction * step + total) % total;
    if (!options[nextIndex]?.disabled) {
      return nextIndex;
    }
  }
  return -1;
}

export function getOpenSelectMenuState<T extends string>(
  options: readonly SelectMenuOptionLike<T>[],
  value: T | null | undefined
): SelectMenuState {
  const selectedIndex = findSelectedOptionIndex(options, value);
  const highlightedIndex =
    selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : findNextEnabledOptionIndex(options, -1, 1);
  return {
    open: true,
    highlightedIndex,
  };
}

export function closeSelectMenu(state: SelectMenuState = CLOSED_SELECT_MENU_STATE): SelectMenuState {
  return {
    ...state,
    open: false,
  };
}

export function toggleSelectMenu<T extends string>(
  state: SelectMenuState,
  options: readonly SelectMenuOptionLike<T>[],
  value: T | null | undefined,
  disabled = false
): SelectMenuState {
  if (disabled) {
    return closeSelectMenu(state);
  }
  return state.open ? closeSelectMenu(state) : getOpenSelectMenuState(options, value);
}

export function moveSelectMenuHighlight<T extends string>(
  state: SelectMenuState,
  options: readonly SelectMenuOptionLike<T>[],
  direction: 1 | -1
): SelectMenuState {
  if (!state.open) {
    return state;
  }
  const startIndex =
    state.highlightedIndex >= 0
      ? state.highlightedIndex
      : direction === 1
        ? -1
        : 0;
  const highlightedIndex = findNextEnabledOptionIndex(options, startIndex, direction);
  if (highlightedIndex < 0) {
    return state;
  }
  return {
    open: true,
    highlightedIndex,
  };
}

export function commitSelectMenuSelection(index: number): SelectMenuState {
  return {
    open: false,
    highlightedIndex: index,
  };
}

export function getSelectMenuTriggerLabel<T extends string>(
  options: readonly SelectMenuOptionLike<T>[],
  value: T | null | undefined,
  placeholder = ''
): string {
  const index = findSelectedOptionIndex(options, value);
  if (index < 0) {
    return placeholder;
  }
  const option = options[index];
  return typeof option?.label === 'string' ? option.label : placeholder;
}
