import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAN_SKILL_SLUG,
  findSkillOptionBySlug,
  resolvePlanSkillShortcutAction,
} from './chatPlanSkillHotkey';
import type { SkillOption } from './chatSlash';

const SKILLS: SkillOption[] = [
  { id: 'skill-plan', slug: 'plan', name: 'Plan', description: 'Maintain plan files' },
  { id: 'skill-execute-plan', slug: 'execute-plan', name: 'Execute Plan', description: 'Run the plan' },
];

function resolveAction(overrides: Partial<Parameters<typeof resolvePlanSkillShortcutAction>[0]> = {}) {
  return resolvePlanSkillShortcutAction({
    key: 'Tab',
    shiftKey: true,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    isImeComposing: false,
    isCommandMode: false,
    isQueuedReadOnly: false,
    skillOptions: SKILLS,
    agentNodesLoading: false,
    ...overrides,
  });
}

test('findSkillOptionBySlug matches the built-in plan skill case-insensitively', () => {
  assert.equal(findSkillOptionBySlug(SKILLS, PLAN_SKILL_SLUG)?.id, 'skill-plan');
  assert.equal(findSkillOptionBySlug(SKILLS, ' PLAN ')?.id, 'skill-plan');
  assert.equal(findSkillOptionBySlug(SKILLS, 'missing'), null);
});

test('selects the built-in plan skill on Shift+Tab when callers allow the shortcut', () => {
  const result = resolveAction();

  assert.deepEqual(result, {
    action: 'select',
    option: SKILLS[0],
  });
});

test('returns loading when Shift+Tab is used before skills finish loading', () => {
  const result = resolveAction({
    skillOptions: [],
    agentNodesLoading: true,
  });

  assert.deepEqual(result, { action: 'loading' });
});

test('returns missing when Shift+Tab is used but plan skill is unavailable after loading', () => {
  const result = resolveAction({
    skillOptions: [SKILLS[1]],
    agentNodesLoading: false,
  });

  assert.deepEqual(result, { action: 'missing' });
});

test('selects the built-in plan skill even when callers still carry draft text separately', () => {
  const result = resolvePlanSkillShortcutAction({
    key: 'Tab',
    shiftKey: true,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    isImeComposing: false,
    isCommandMode: false,
    isQueuedReadOnly: false,
    skillOptions: SKILLS,
    agentNodesLoading: false,
    // @ts-expect-error draft is no longer part of the shortcut contract.
    draft: 'hello',
  });

  assert.deepEqual(result, {
    action: 'select',
    option: SKILLS[0],
  });
});

test('ignores plain Tab and command-mode shortcuts', () => {
  assert.deepEqual(resolveAction({ shiftKey: false }), { action: 'ignore' });
  assert.deepEqual(resolveAction({ isCommandMode: true }), { action: 'ignore' });
});
