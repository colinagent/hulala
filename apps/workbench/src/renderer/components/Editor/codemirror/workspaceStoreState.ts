import { Facet, type EditorState } from '@codemirror/state';
import { useAppStore, workspaceViewIdForStore, type WorkspaceStore } from '../../../store/appStore';

export const workspaceStoreFacet = Facet.define<WorkspaceStore, WorkspaceStore | null>({
  combine(values) {
    return values.at(-1) || null;
  },
});

export function getWorkspaceStateForEditor(state: EditorState) {
  return state.facet(workspaceStoreFacet)?.getState() || useAppStore.getState();
}

export function getWorkspaceViewIdForEditor(state: EditorState): string {
  return workspaceViewIdForStore(state.facet(workspaceStoreFacet));
}
