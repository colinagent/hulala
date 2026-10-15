import type { Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import { DocumentHeader } from '../DocumentHeader';
import { formatMarkdownModifiedLabel } from '../../../utils/documentHeader';
import {
  documentHeaderOptionsFacet,
  refreshDocumentHeaderEffect,
} from '../../../utils/documentHeaderState';
import { deferReactRootUnmount } from './reactRootLifecycle';

class DocumentHeaderView {
  private readonly mountEl: HTMLDivElement;
  private root: Root | null = null;
  private lastSignature = '';

  constructor(private readonly view: EditorView) {
    this.mountEl = document.createElement('div');
    this.mountEl.className = 'op-md-document-header-mount';
    view.scrollDOM.insertBefore(this.mountEl, view.scrollDOM.firstChild);
    this.sync();
  }

  update(update: ViewUpdate): void {
    const refreshed = update.transactions.some((tr) =>
      tr.effects.some((effect) => effect.is(refreshDocumentHeaderEffect)),
    );
    if (refreshed || this.signatureFor(update.state.facet(documentHeaderOptionsFacet)) !== this.lastSignature) {
      this.sync();
    }
  }

  destroy(): void {
    const root = this.root;
    this.root = null;
    this.mountEl.remove();
    deferReactRootUnmount(root);
  }

  private signatureFor(options: { enabled: boolean; title: string; modTime: number | null }): string {
    return `${options.enabled ? 1 : 0}\0${options.title}\0${options.modTime ?? ''}`;
  }

  private sync(): void {
    const options = this.view.state.facet(documentHeaderOptionsFacet);
    this.lastSignature = this.signatureFor(options);
    if (!options.enabled || !options.title.trim()) {
      this.mountEl.style.display = 'none';
      if (this.root) {
        this.root.render(null);
      }
      return;
    }

    this.mountEl.style.display = '';
    const modifiedLabel = options.modTime === null
      ? null
      : formatMarkdownModifiedLabel(options.modTime);

    const element = React.createElement(DocumentHeader, {
      title: options.title,
      modifiedLabel,
      onRenameTitle: options.onRenameTitle,
    });

    if (!this.root) {
      this.root = createRoot(this.mountEl);
    }
    this.root.render(element);
  }
}

export function documentHeaderPlugin(): Extension {
  return ViewPlugin.define((view) => new DocumentHeaderView(view));
}
