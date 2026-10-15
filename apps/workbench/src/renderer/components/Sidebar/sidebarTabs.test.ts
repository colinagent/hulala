import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SIDEBAR_RAIL_ICON_CAPACITY,
  getMainSidebarRailItems,
  isMainSidebarRailItemActive,
  isMainSidebarRailItemHighlighted,
  isSidebarMoreRailActive,
  planSidebarRailPluginLayout,
} from './sidebarTabs';

test('main rail contains workspace, Messenger, and Cron', () => {
  assert.deepEqual(getMainSidebarRailItems().map((item) => item.key), ['workspace', 'messenger', 'cron']);
});

test('main sidebar rail active state follows the current view', () => {
  assert.equal(isMainSidebarRailItemActive('workspace', 'workspace'), true);
  assert.equal(isMainSidebarRailItemActive('messenger', 'messenger'), true);
  assert.equal(isMainSidebarRailItemActive('cron', 'cron'), true);
  assert.equal(isMainSidebarRailItemActive('workspace', 'cron'), false);
});

test('main sidebar rail only highlights the selected view while its panel is open', () => {
  assert.equal(isMainSidebarRailItemHighlighted('workspace', 'workspace', true), true);
  assert.equal(isMainSidebarRailItemHighlighted('workspace', 'workspace', false), false);
  assert.equal(isMainSidebarRailItemHighlighted('workspace', 'messenger', true), false);
});

test('sidebar overflow state only follows the menu', () => {
  assert.equal(isSidebarMoreRailActive('cron', false), false);
  assert.equal(isSidebarMoreRailActive('workspace', true), true);
});

test('rail keeps five navigation icons visible before folding', () => {
  const mainItemCount = getMainSidebarRailItems().length;
  const plugins = [
    { key: 'plugin:a/one', selected: false },
    { key: 'plugin:b/one', selected: false },
  ];

  assert.equal(SIDEBAR_RAIL_ICON_CAPACITY, 5);
  assert.equal(mainItemCount + plugins.length, SIDEBAR_RAIL_ICON_CAPACITY);
  assert.deepEqual(planSidebarRailPluginLayout(plugins, mainItemCount), {
    visible: plugins,
    overflow: [],
    folding: false,
  });
});

test('rail folds plugin icons only after exceeding its capacity', () => {
  const plugins = [
    { key: 'plugin:a/one', selected: false },
    { key: 'plugin:b/one', selected: false },
    { key: 'plugin:c/one', selected: false },
  ];
  const plan = planSidebarRailPluginLayout(plugins, getMainSidebarRailItems().length);

  assert.equal(plan.folding, true);
  assert.deepEqual(plan.visible.map((view) => view.key), ['plugin:a/one', 'plugin:b/one']);
  assert.deepEqual(plan.overflow.map((view) => view.key), ['plugin:c/one']);
});

test('folded rail keeps the selected plugin visible', () => {
  const plugins = [
    { key: 'plugin:a/one', selected: false },
    { key: 'plugin:b/one', selected: false },
    { key: 'plugin:c/one', selected: true },
  ];
  const plan = planSidebarRailPluginLayout(plugins, getMainSidebarRailItems().length);

  assert.deepEqual(plan.visible.map((view) => view.key), ['plugin:c/one', 'plugin:a/one']);
  assert.deepEqual(plan.overflow.map((view) => view.key), ['plugin:b/one']);
});
