import { Compartment, Facet, StateEffect, Transaction, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export type DocumentHeaderOptions = {
  enabled: boolean;
  title: string;
  modTime: number | null;
  onRenameTitle?: (title: string) => Promise<DocumentHeaderRenameResult>;
};

export type DocumentHeaderRenameResult =
  | { success: true }
  | { success: false; error: string };

export const documentHeaderOptionsFacet = Facet.define<DocumentHeaderOptions, DocumentHeaderOptions>({
  combine(values) {
    if (values.length === 0) {
      return { enabled: false, title: '', modTime: null };
    }
    return values[0];
  },
});

export const refreshDocumentHeaderEffect = StateEffect.define<null>();

export function documentHeaderOptionsExtension(options: DocumentHeaderOptions): Extension {
  return documentHeaderOptionsFacet.of(options);
}

export function createDocumentHeaderOptionsCompartment(): Compartment {
  return new Compartment();
}

export function reconfigureDocumentHeaderOptions(
  compartment: Compartment,
  options: DocumentHeaderOptions,
): StateEffect<unknown> {
  return compartment.reconfigure(documentHeaderOptionsExtension(options));
}

export function refreshDocumentHeader(view: EditorView): void {
  view.dispatch({
    effects: refreshDocumentHeaderEffect.of(null),
    annotations: Transaction.addToHistory.of(false),
  });
}
