import { expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import type { AppState, WorkspaceStore } from '../../../store/appStore';
import { getWorkspaceStateForEditor, workspaceStoreFacet } from './workspaceStoreState';

test('CodeMirror resolves capabilities from the document owning Workspace', () => {
  const marker = { currentFilePath: '/origin/note.md' } as AppState;
  const store = { getState: () => marker } as unknown as WorkspaceStore;
  const editorState = EditorState.create({
    extensions: [workspaceStoreFacet.of(store)],
  });
  expect(getWorkspaceStateForEditor(editorState)).toBe(marker);
});
