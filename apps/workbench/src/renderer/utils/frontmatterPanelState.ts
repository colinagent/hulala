import { Facet, type EditorState, StateEffect, StateField } from '@codemirror/state';
import { getFrontmatterInfo } from '../components/Editor/codemirror/utils/frontmatter';
import { parseFrontmatterDocument } from './frontmatterYaml';

export type FrontmatterPanelOptions = {
  readOnly: boolean;
  exportMode: boolean;
};

export const frontmatterPanelOptionsFacet = Facet.define<FrontmatterPanelOptions, FrontmatterPanelOptions>({
  combine: (values) => values[values.length - 1] ?? { readOnly: false, exportMode: false },
});

export const toggleFrontmatterSourceModeEffect = StateEffect.define<boolean>();

export const refreshFrontmatterPanelEffect = StateEffect.define<null>();

export const frontmatterSourceModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(toggleFrontmatterSourceModeEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

function hasParsableFrontmatter(state: EditorState): boolean {
  return parseFrontmatterDocument(state.doc.toString()) !== null;
}

export function isFrontmatterSourceMode(state: EditorState): boolean {
  if (state.field(frontmatterSourceModeField, false)) {
    return true;
  }
  if (!hasParsableFrontmatter(state)) {
    return true;
  }
  return false;
}

export function shouldShowFrontmatterProperties(state: EditorState): boolean {
  const options = state.facet(frontmatterPanelOptionsFacet);
  if (options.exportMode) {
    return false;
  }
  if (!getFrontmatterInfo(state)) {
    return false;
  }
  if (!hasParsableFrontmatter(state)) {
    return false;
  }
  return !isFrontmatterSourceMode(state);
}

export function shouldCollapseFrontmatterYaml(state: EditorState): boolean {
  if (!getFrontmatterInfo(state)) {
    return false;
  }
  if (!hasParsableFrontmatter(state)) {
    return false;
  }
  if (isFrontmatterSourceMode(state)) {
    return false;
  }
  return shouldShowFrontmatterProperties(state);
}
