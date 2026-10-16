export type ComposerPlanSpacer = {
  from: number;
  to: number;
  text: string;
};

export type ComposerPlanState = {
  anchor: number;
  beforeSpacer: ComposerPlanSpacer | null;
  afterSpacer: ComposerPlanSpacer | null;
};

type PositionMapper = {
  mapPos: (pos: number, assoc?: number) => number;
};

type ActivateComposerPlanBlockParams = {
  content: string;
  cursor: number;
  currentPlan: ComposerPlanState | null;
};

type RemoveComposerPlanBlockParams = {
  content: string;
  cursor: number;
  planState: ComposerPlanState | null;
};

type ComposerPlanBlockResult = {
  content: string;
  selection: number;
};

type ComposerPlanRangeRemovalResult = ComposerPlanBlockResult & {
  removedBeforeSpacer: boolean;
  removedAfterSpacer: boolean;
};

function clampPos(pos: number, length: number): number {
  if (!Number.isFinite(pos)) {
    return length;
  }
  return Math.max(0, Math.min(length, Math.trunc(pos)));
}

function sortSpacersDescending(spacers: ComposerPlanSpacer[]): ComposerPlanSpacer[] {
  return [...spacers].sort((a, b) => b.from - a.from || b.to - a.to);
}

function removePlanSpacers(
  content: string,
  cursor: number,
  planState: ComposerPlanState | null,
): ComposerPlanRangeRemovalResult {
  if (!planState) {
    return {
      content,
      selection: clampPos(cursor, content.length),
      removedBeforeSpacer: false,
      removedAfterSpacer: false,
    };
  }

  const spacers: ComposerPlanSpacer[] = [];
  if (planState.beforeSpacer) {
    spacers.push(planState.beforeSpacer);
  }
  if (planState.afterSpacer) {
    spacers.push(planState.afterSpacer);
  }
  if (spacers.length === 0) {
    return {
      content,
      selection: clampPos(cursor, content.length),
      removedBeforeSpacer: false,
      removedAfterSpacer: false,
    };
  }

  let nextContent = content;
  let nextSelection = clampPos(cursor, content.length);
  let removedBeforeSpacer = false;
  let removedAfterSpacer = false;

  // Treat the generated separators as a unit; user edits must survive removal.
  if (spacers.some(spacer => spacer.from < 0 || spacer.to > content.length
    || content.slice(spacer.from, spacer.to) !== spacer.text)) {
    return { content, selection: nextSelection, removedBeforeSpacer, removedAfterSpacer };
  }

  for (const spacer of sortSpacersDescending(spacers)) {
    if (spacer.from < 0 || spacer.to < spacer.from || spacer.to > nextContent.length) {
      continue;
    }
    if (nextContent.slice(spacer.from, spacer.to) !== spacer.text) {
      continue;
    }
    nextContent = nextContent.slice(0, spacer.from) + nextContent.slice(spacer.to);
    if (nextSelection > spacer.to) {
      nextSelection -= spacer.to - spacer.from;
    } else if (nextSelection > spacer.from) {
      nextSelection = spacer.from;
    }
    if (planState.beforeSpacer && spacer.from === planState.beforeSpacer.from && spacer.to === planState.beforeSpacer.to) {
      removedBeforeSpacer = true;
    }
    if (planState.afterSpacer && spacer.from === planState.afterSpacer.from && spacer.to === planState.afterSpacer.to) {
      removedAfterSpacer = true;
    }
  }

  return {
    content: nextContent,
    selection: nextSelection,
    removedBeforeSpacer,
    removedAfterSpacer,
  };
}

export function mapComposerPlanState(
  planState: ComposerPlanState,
  mapper: PositionMapper,
): ComposerPlanState {
  const mapSpacer = (spacer: ComposerPlanSpacer | null): ComposerPlanSpacer | null => {
    if (!spacer) {
      return null;
    }
    const from = mapper.mapPos(spacer.from, 1);
    const to = mapper.mapPos(spacer.to, -1);
    return {
      from: Math.max(0, Math.min(from, to)),
      to: Math.max(from, to),
      text: spacer.text,
    };
  };

  return {
    anchor: mapper.mapPos(planState.anchor, 1),
    beforeSpacer: mapSpacer(planState.beforeSpacer),
    afterSpacer: mapSpacer(planState.afterSpacer),
  };
}

export function areComposerPlanStatesEqual(
  left: ComposerPlanState | null | undefined,
  right: ComposerPlanState | null | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  const equalSpacer = (a: ComposerPlanSpacer | null, b: ComposerPlanSpacer | null) => {
    if (!a && !b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    return a.from === b.from && a.to === b.to && a.text === b.text;
  };
  return left.anchor === right.anchor
    && equalSpacer(left.beforeSpacer, right.beforeSpacer)
    && equalSpacer(left.afterSpacer, right.afterSpacer);
}

export function activateComposerPlanBlock(
  params: ActivateComposerPlanBlockParams,
): ComposerPlanBlockResult & { planState: ComposerPlanState } {
  const stripped = removePlanSpacers(params.content, params.cursor, params.currentPlan);
  let nextContent = stripped.content;
  let insertionPos = clampPos(stripped.selection, nextContent.length);
  let beforeSpacer: ComposerPlanSpacer | null = null;

  if (insertionPos > 0 && nextContent[insertionPos - 1] !== '\n') {
    nextContent = `${nextContent.slice(0, insertionPos)}\n${nextContent.slice(insertionPos)}`;
    beforeSpacer = {
      from: insertionPos,
      to: insertionPos + 1,
      text: '\n',
    };
    insertionPos += 1;
  }

  const anchor = insertionPos;
  const nextChar = nextContent[anchor] || '';
  const afterText = nextChar && nextChar !== '\n' ? '\n\n' : '\n';
  nextContent = `${nextContent.slice(0, anchor)}${afterText}${nextContent.slice(anchor)}`;
  const afterSpacer: ComposerPlanSpacer = {
    from: anchor,
    to: anchor + afterText.length,
    text: afterText,
  };

  return {
    content: nextContent,
    selection: anchor + 1,
    planState: {
      anchor,
      beforeSpacer,
      afterSpacer,
    },
  };
}

export function removeComposerPlanBlock(
  params: RemoveComposerPlanBlockParams,
): ComposerPlanRangeRemovalResult {
  return removePlanSpacers(params.content, params.cursor, params.planState);
}
