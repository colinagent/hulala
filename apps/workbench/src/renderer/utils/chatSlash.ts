export type SkillOption = {
  id: string;
  slug: string;
  name: string;
  description: string;
};

export type SlashState = {
  token: string;
  query: string;
  tokenStart: number;
  tokenEnd: number;
};

export type SlashMenuStatus = 'hidden' | 'loading' | 'results' | 'no-match' | 'no-commands';

export type BuiltInSlashCommand = {
  key: string;
  slug: string;
  name: string;
  description: string;
};

export type SlashMenuItem =
  | ({ kind: 'command' } & BuiltInSlashCommand)
  | ({ kind: 'skill' } & SkillOption);

export type SlashMenuState = {
  status: SlashMenuStatus;
  slashState: SlashState | null;
  filteredSkillOptions: SkillOption[];
  filteredItems: SlashMenuItem[];
};

export type PlanSkillShortcutParams = {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isImeComposing: boolean;
  draft: string;
  isCommandMode: boolean;
  isQueuedReadOnly: boolean;
};

type ResolveSlashMenuStateParams = {
  draft: string;
  cursorPos: number | null;
  isCommandMode: boolean;
  isQueuedReadOnly: boolean;
  dismissedSlashToken: string | null;
  skillOptions: ReadonlyArray<SkillOption>;
  builtInCommands?: ReadonlyArray<BuiltInSlashCommand>;
  agentNodesLoading: boolean;
};

export function findSkillOptionBySlug(
  skillOptions: ReadonlyArray<SkillOption>,
  slug: string,
): SkillOption | null {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }
  return skillOptions.find((option) => option.slug.trim().toLowerCase() === normalizedSlug) || null;
}

export function shouldAutoSelectPlanSkillShortcut(params: PlanSkillShortcutParams): boolean {
  const isBareShiftTab = params.key === 'Tab'
    && params.shiftKey
    && !params.altKey
    && !params.ctrlKey
    && !params.metaKey;
  if (!isBareShiftTab) {
    return false;
  }
  if (params.isImeComposing || params.isCommandMode || params.isQueuedReadOnly) {
    return false;
  }
  return params.draft.trim().length === 0;
}

export function resolveSlashState(draft: string, cursorPos: number | null): SlashState | null {
  const safeCursorPos = Math.max(0, Math.min(cursorPos ?? draft.length, draft.length));
  const prevChar = safeCursorPos > 0 ? draft[safeCursorPos - 1] : '';
  const currentChar = safeCursorPos < draft.length ? draft[safeCursorPos] : '';

  if ((prevChar && /\s/.test(prevChar)) && (currentChar && /\s/.test(currentChar))) {
    return null;
  }

  let tokenStart = safeCursorPos;
  while (tokenStart > 0 && !/\s/.test(draft[tokenStart - 1] || '')) {
    tokenStart -= 1;
  }

  let tokenEnd = safeCursorPos;
  while (tokenEnd < draft.length && !/\s/.test(draft[tokenEnd] || '')) {
    tokenEnd += 1;
  }

  const token = draft.slice(tokenStart, tokenEnd);
  if (!token.startsWith('/')) {
    return null;
  }
  if (token.indexOf('/', 1) >= 0) {
    return null;
  }
  return {
    token,
    query: token.slice(1).trim().toLowerCase(),
    tokenStart,
    tokenEnd,
  };
}

export function removeSlashTokenFromDraft(draft: string, slashState: SlashState): string {
  const before = draft.slice(0, slashState.tokenStart);
  const after = draft.slice(slashState.tokenEnd);

  if (!before) {
    return after.replace(/^\s+/, '');
  }
  if (!after) {
    return before.replace(/\s+$/, '');
  }
  if (/\s$/.test(before) && /^\s/.test(after)) {
    return `${before}${after.replace(/^\s+/, '')}`;
  }
  return `${before}${after}`;
}

function scoreSlashOptions<T extends { slug: string; name: string; description: string }>(
  options: ReadonlyArray<T>,
  query: string,
): T[] {
  if (!query) {
    return [...options];
  }

  const scored = options
    .map((option) => {
      const slug = option.slug.toLowerCase();
      const slugIdx = slug.indexOf(query);
      if (slugIdx >= 0) {
        return { option, score: slugIdx };
      }
      const haystack = `${option.name}\n${option.description}`.toLowerCase();
      if (haystack.includes(query)) {
        return { option, score: 10000 };
      }
      return null;
    })
    .filter((item): item is { option: T; score: number } => item !== null);

  scored.sort((a, b) => a.score - b.score || a.option.slug.localeCompare(b.option.slug));
  return scored.map((item) => item.option);
}

export function filterSlashSkillOptions(
  skillOptions: ReadonlyArray<SkillOption>,
  query: string,
): SkillOption[] {
  return scoreSlashOptions(skillOptions, query);
}

export function filterBuiltInSlashCommands(
  commands: ReadonlyArray<BuiltInSlashCommand>,
  query: string,
): BuiltInSlashCommand[] {
  return scoreSlashOptions(commands, query);
}

export function resolveSlashMenuState(params: ResolveSlashMenuStateParams): SlashMenuState {
  const slashState = resolveSlashState(params.draft, params.cursorPos);
  if (!slashState) {
    return {
      status: 'hidden',
      slashState: null,
      filteredSkillOptions: [],
      filteredItems: [],
    };
  }

  if (params.isCommandMode || params.isQueuedReadOnly || slashState.token === params.dismissedSlashToken) {
    return {
      status: 'hidden',
      slashState,
      filteredSkillOptions: [],
      filteredItems: [],
    };
  }

  const filteredCommands = filterBuiltInSlashCommands(params.builtInCommands || [], slashState.query);
  const filteredSkillOptions = filterSlashSkillOptions(params.skillOptions, slashState.query);
  const filteredItems: SlashMenuItem[] = [
    ...filteredCommands.map((command) => ({ kind: 'command' as const, ...command })),
    ...filteredSkillOptions.map((option) => ({ kind: 'skill' as const, ...option })),
  ];
  if (filteredItems.length > 0) {
    return {
      status: 'results',
      slashState,
      filteredSkillOptions,
      filteredItems,
    };
  }

  if (params.skillOptions.length === 0) {
    return {
      status: params.agentNodesLoading ? 'loading' : 'no-commands',
      slashState,
      filteredSkillOptions,
      filteredItems: [],
    };
  }

  return {
    status: 'no-match',
    slashState,
    filteredSkillOptions,
    filteredItems: [],
  };
}
