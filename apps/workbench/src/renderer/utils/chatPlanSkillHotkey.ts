import type { SkillOption } from './chatSlash';

export const PLAN_SKILL_SLUG = 'plan';

export type PlanSkillShortcutResult =
  | { action: 'ignore' }
  | { action: 'select'; option: SkillOption }
  | { action: 'loading' }
  | { action: 'missing' };

type ResolvePlanSkillShortcutParams = {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  isImeComposing: boolean;
  isCommandMode: boolean;
  isQueuedReadOnly: boolean;
  skillOptions: ReadonlyArray<SkillOption>;
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

export function resolvePlanSkillShortcutAction(
  params: ResolvePlanSkillShortcutParams,
): PlanSkillShortcutResult {
  if (
    params.key !== 'Tab'
    || !params.shiftKey
    || params.altKey
    || params.metaKey
    || params.ctrlKey
    || params.isImeComposing
    || params.isCommandMode
    || params.isQueuedReadOnly
  ) {
    return { action: 'ignore' };
  }

  const planSkill = findSkillOptionBySlug(params.skillOptions, PLAN_SKILL_SLUG);
  if (planSkill) {
    return {
      action: 'select',
      option: planSkill,
    };
  }

  if (params.agentNodesLoading) {
    return { action: 'loading' };
  }

  return { action: 'missing' };
}
