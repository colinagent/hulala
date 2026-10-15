import { EditorView, gutter, GutterMarker } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { useUiStore } from '../../../store/uiStore';

const EYE_OPEN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';

const EYE_CLOSED = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3 5 10 5 10-5 10-5"/><path d="M7 15.5l-1.5 2M12 17v2M17 15.5l1.5 2"/></svg>';

class ToggleMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'op-ln-toggle-marker';
    const show = useUiStore.getState().showLineNumbers;
    el.innerHTML = show ? EYE_OPEN : EYE_CLOSED;
    el.title = show ? 'Hide line numbers' : 'Show line numbers';
    return el;
  }
}

const toggleMarker = new ToggleMarker();

function syncToggleMarkerDom(root: HTMLElement, visible: boolean) {
  root.classList.toggle('cm-lineNumbers-hidden', !visible);
  const marker = root.querySelector<HTMLElement>('.op-ln-toggle-marker');
  if (!marker) {
    return;
  }
  marker.innerHTML = visible ? EYE_OPEN : EYE_CLOSED;
  marker.title = visible ? 'Hide line numbers' : 'Show line numbers';
}

export function setLineNumbersVisible(view: EditorView, visible: boolean) {
  syncToggleMarkerDom(view.dom, visible);
}

export function lineNumberToggleGutter(): Extension {
  return gutter({
    class: 'cm-lineToggleGutter',
    lineMarker(view, line) {
      if (view.state.doc.lineAt(line.from).number !== 1) return null;
      return toggleMarker;
    },
    domEventHandlers: {
      mousedown(view, line, event) {
        if (view.state.doc.lineAt(line.from).number !== 1) return false;
        event.preventDefault();
        const next = !useUiStore.getState().showLineNumbers;
        useUiStore.getState().setShowLineNumbers(next);
        syncToggleMarkerDom(view.dom, next);
        window.hulala?.settings?.set?.({ ui: { showLineNumbers: next } })?.catch(() => {});
        return true;
      },
    },
  });
}
