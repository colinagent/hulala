import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLOSED_SELECT_MENU_STATE,
  closeSelectMenu,
  commitSelectMenuSelection,
  getOpenSelectMenuState,
  getSelectMenuTriggerLabel,
  moveSelectMenuHighlight,
  toggleSelectMenu,
} from './selectMenuState';

const options = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'gemini-native', label: 'Gemini Native', disabled: true },
] as const;

test('toggleSelectMenu opens the menu and highlights the selected option', () => {
  const state = toggleSelectMenu(CLOSED_SELECT_MENU_STATE, options, 'anthropic-messages');
  assert.deepEqual(state, {
    open: true,
    highlightedIndex: 1,
  });
});

test('closeSelectMenu closes the menu for outside-click style dismissal', () => {
  const opened = getOpenSelectMenuState(options, 'openai-completions');
  assert.deepEqual(closeSelectMenu(opened), {
    open: false,
    highlightedIndex: 0,
  });
});

test('getSelectMenuTriggerLabel returns the selected item label', () => {
  assert.equal(
    getSelectMenuTriggerLabel(options, 'anthropic-messages', 'Choose API'),
    'Anthropic Messages'
  );
});

test('toggleSelectMenu keeps disabled selects closed', () => {
  const state = toggleSelectMenu(CLOSED_SELECT_MENU_STATE, options, 'openai-completions', true);
  assert.deepEqual(state, CLOSED_SELECT_MENU_STATE);
});

test('moveSelectMenuHighlight skips disabled options and commitSelectMenuSelection closes the menu', () => {
  const opened = getOpenSelectMenuState(options, 'anthropic-messages');
  const moved = moveSelectMenuHighlight(opened, options, 1);
  assert.deepEqual(moved, {
    open: true,
    highlightedIndex: 0,
  });
  assert.deepEqual(commitSelectMenuSelection(moved.highlightedIndex), {
    open: false,
    highlightedIndex: 0,
  });
});
