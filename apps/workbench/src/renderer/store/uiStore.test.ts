import assert from 'node:assert/strict';
import test from 'node:test';

import { useUiStore } from './uiStore';

function resetBlockingModalState() {
  useUiStore.setState({
    blockingModalIds: [],
    hasBlockingModal: false,
  });
}

test('blocking modal registry preserves active state until the last modal closes', (t) => {
  const previousState = useUiStore.getState();
  t.after(() => {
    useUiStore.setState({
      blockingModalIds: previousState.blockingModalIds,
      hasBlockingModal: previousState.hasBlockingModal,
    });
  });
  resetBlockingModalState();

  useUiStore.getState().registerBlockingModal('dialog-a');
  useUiStore.getState().registerBlockingModal('dialog-b');

  assert.deepEqual(useUiStore.getState().blockingModalIds, ['dialog-a', 'dialog-b']);
  assert.equal(useUiStore.getState().hasBlockingModal, true);

  useUiStore.getState().unregisterBlockingModal('dialog-a');

  assert.deepEqual(useUiStore.getState().blockingModalIds, ['dialog-b']);
  assert.equal(useUiStore.getState().hasBlockingModal, true);

  useUiStore.getState().unregisterBlockingModal('dialog-b');

  assert.deepEqual(useUiStore.getState().blockingModalIds, []);
  assert.equal(useUiStore.getState().hasBlockingModal, false);
});

test('blocking modal registry ignores duplicate registrations and unknown removals', (t) => {
  const previousState = useUiStore.getState();
  t.after(() => {
    useUiStore.setState({
      blockingModalIds: previousState.blockingModalIds,
      hasBlockingModal: previousState.hasBlockingModal,
    });
  });
  resetBlockingModalState();

  useUiStore.getState().registerBlockingModal(' dialog-a ');
  useUiStore.getState().registerBlockingModal('dialog-a');
  useUiStore.getState().unregisterBlockingModal('missing-dialog');

  assert.deepEqual(useUiStore.getState().blockingModalIds, ['dialog-a']);
  assert.equal(useUiStore.getState().hasBlockingModal, true);
});

test('sidebar view is externally controllable', (t) => {
  const previousView = useUiStore.getState().sidebarView;
  t.after(() => {
    useUiStore.getState().setSidebarView(previousView);
  });

  useUiStore.getState().setSidebarView('messenger');
  assert.equal(useUiStore.getState().sidebarView, 'messenger');

  useUiStore.getState().setSidebarView('workspace');
  assert.equal(useUiStore.getState().sidebarView, 'workspace');
});

test('opening a conversation uses the Activity Panel without changing the sidebar view', (t) => {
  const previous = useUiStore.getState();
  t.after(() => useUiStore.setState({ sidebarView: previous.sidebarView, composerOpen: previous.composerOpen }));
  useUiStore.getState().setSidebarView('workspace');
  useUiStore.getState().openConversation({ kind: 'workspace' });
  assert.equal(useUiStore.getState().sidebarView, 'workspace');
  assert.equal(useUiStore.getState().composerOpen, true);
  useUiStore.getState().closeConversation();
  assert.equal(useUiStore.getState().composerOpen, false);
});

test('sidebar panel can collapse and reopen with view changes', (t) => {
  const previousOpen = useUiStore.getState().sidebarPanelOpen;
  const previousView = useUiStore.getState().sidebarView;
  t.after(() => {
    useUiStore.getState().setSidebarPanelOpen(previousOpen);
    useUiStore.getState().setSidebarView(previousView);
  });

  useUiStore.getState().setSidebarPanelOpen(false);
  assert.equal(useUiStore.getState().sidebarPanelOpen, false);

  useUiStore.getState().toggleSidebarPanel();
  assert.equal(useUiStore.getState().sidebarPanelOpen, true);

  useUiStore.getState().setSidebarPanelOpen(false);
  useUiStore.getState().setSidebarView('cron');
  assert.equal(useUiStore.getState().sidebarPanelOpen, true);
  assert.equal(useUiStore.getState().sidebarView, 'cron');
});
