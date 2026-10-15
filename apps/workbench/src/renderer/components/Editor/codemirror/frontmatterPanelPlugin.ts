import { Compartment, Transaction, type Extension, type StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import { FrontmatterPropertiesPanel } from '../FrontmatterPropertiesPanel';
import { parseFrontmatterDocument, patchFrontmatterDocument, splitFrontmatter } from '../../../utils/frontmatterYaml';
import {
  frontmatterPanelOptionsFacet,
  frontmatterSourceModeField,
  refreshFrontmatterPanelEffect,
  shouldShowFrontmatterProperties,
  toggleFrontmatterSourceModeEffect,
} from '../../../utils/frontmatterPanelState';
import { deferReactRootUnmount } from './reactRootLifecycle';
import { getFrontmatterInfo } from './utils/frontmatter';

class FrontmatterPanelView {
  private readonly mountEl: HTMLDivElement;
  private root: Root | null = null;
  private readonly handleDocumentMouseDown = (event: MouseEvent) => {
    this.closeSourceModeWhenClickingOutsideFrontmatter(event);
  };

  constructor(private readonly view: EditorView) {
    this.mountEl = document.createElement('div');
    this.mountEl.className = 'op-md-frontmatter-properties-mount';
    view.scrollDOM.insertBefore(this.mountEl, view.contentDOM);
    document.addEventListener('mousedown', this.handleDocumentMouseDown, true);
    this.sync();
  }

  update(update: ViewUpdate): void {
    if (update.selectionSet) {
      const state = update.state;
      if (state.field(frontmatterSourceModeField, false)) {
        const frontmatter = getFrontmatterInfo(state);
        if (frontmatter) {
          const cursorLine = state.doc.lineAt(state.selection.main.head);
          const cursorInBlock = cursorLine.from <= frontmatter.to && cursorLine.to >= frontmatter.from;
          if (!cursorInBlock) {
            this.closeSourceMode();
          }
        }
      }
    }

    if (
      update.docChanged
      || update.selectionSet
      || update.transactions.some((tr) =>
        tr.effects.some((effect) =>
          effect.is(toggleFrontmatterSourceModeEffect) || effect.is(refreshFrontmatterPanelEffect),
        ),
      )
    ) {
      this.sync();
    }
  }

  destroy(): void {
    document.removeEventListener('mousedown', this.handleDocumentMouseDown, true);
    const root = this.root;
    this.root = null;
    this.mountEl.remove();
    deferReactRootUnmount(root);
  }

  private closeSourceModeWhenClickingOutsideFrontmatter(event: MouseEvent): void {
    const state = this.view.state;
    if (!state.field(frontmatterSourceModeField, false)) {
      return;
    }

    const frontmatter = getFrontmatterInfo(state);
    if (!frontmatter) {
      this.closeSourceMode();
      return;
    }
    if (this.mountEl.contains(event.target as Node | null)) {
      return;
    }

    const clickedInsideEditor = this.view.dom.contains(event.target as Node | null);
    if (!clickedInsideEditor) {
      this.closeSourceMode();
      return;
    }

    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null || pos < frontmatter.from || pos > frontmatter.to) {
      this.closeSourceMode();
    }
  }

  private closeSourceMode(): void {
    this.view.dispatch({
      effects: toggleFrontmatterSourceModeEffect.of(false),
      annotations: Transaction.addToHistory.of(false),
    });
  }

  private sync(): void {
    const state = this.view.state;
    const showProperties = shouldShowFrontmatterProperties(state);

    if (!showProperties) {
      this.mountEl.style.display = 'none';
      return;
    }

    const parsed = parseFrontmatterDocument(state.doc.toString());
    if (!parsed) {
      this.mountEl.style.display = 'none';
      return;
    }

    this.mountEl.style.display = '';
    const options = state.facet(frontmatterPanelOptionsFacet);

    const element = React.createElement(FrontmatterPropertiesPanel, {
      entries: parsed.entries,
      readOnly: options.readOnly,
      onPatch: (key, value) => this.applyPatch({ type: 'set', key, value }),
      onDeleteKey: (key) => this.applyPatch({ type: 'delete', key }),
      onOpenSource: () => this.openSourceMode(),
    });

    if (!this.root) {
      this.root = createRoot(this.mountEl);
    }
    this.root.render(element);
  }

  private applyPatch(patch: { type: 'set'; key: string; value: unknown } | { type: 'delete'; key: string }): void {
    const current = this.view.state.doc.toString();
    const next = patchFrontmatterDocument(current, patch);
    if (next === current) {
      return;
    }
    const currentSplit = splitFrontmatter(current);
    const nextSplit = splitFrontmatter(next);
    if (!currentSplit || !nextSplit) {
      return;
    }
    const nextFrontmatter = next.slice(0, nextSplit.bodyStart);
    this.view.dispatch({
      changes: { from: 0, to: currentSplit.bodyStart, insert: nextFrontmatter },
      userEvent: 'input',
    });
  }

  private openSourceMode(): void {
    const anchor = this.view.state.doc.lines >= 2
      ? this.view.state.doc.line(2).from
      : 0;
    this.view.dispatch({
      effects: toggleFrontmatterSourceModeEffect.of(true),
      selection: { anchor },
      scrollIntoView: true,
    });
    this.view.focus();
  }
}

export function frontmatterPanelPlugin(): Extension {
  return [
    frontmatterSourceModeField,
    ViewPlugin.define((view) => new FrontmatterPanelView(view)),
  ];
}

export function frontmatterPanelOptionsExtension(options: {
  readOnly: boolean;
  exportMode: boolean;
}): Extension {
  return frontmatterPanelOptionsFacet.of(options);
}

export function createFrontmatterPanelOptionsCompartment(): Compartment {
  return new Compartment();
}

export function reconfigureFrontmatterPanelOptions(
  compartment: Compartment,
  options: { readOnly: boolean; exportMode: boolean },
): StateEffect<unknown> {
  return compartment.reconfigure(frontmatterPanelOptionsExtension(options));
}

export function refreshFrontmatterPanel(view: EditorView): void {
  view.dispatch({
    effects: refreshFrontmatterPanelEffect.of(null),
    annotations: Transaction.addToHistory.of(false),
  });
}
