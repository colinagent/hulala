import { EditorView, WidgetType } from '@codemirror/view';
import { trackPdfExportTask } from '../../../../services/pdfExportReadiness';

let katexPromise: Promise<typeof import('katex')> | null = null;

function loadKatex(): Promise<typeof import('katex')> {
  if (!katexPromise) {
    katexPromise = import('katex');
  }
  return katexPromise;
}

export class MathWidget extends WidgetType {
  constructor(
    private formula: string,
    private displayMode: boolean,
    private srcFrom?: number,
    private srcTo?: number
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return other.formula === this.formula
      && other.displayMode === this.displayMode
      && other.srcFrom === this.srcFrom
      && other.srcTo === this.srcTo;
  }

  ignoreEvent(event: Event): boolean {
    if (!this.displayMode) return true;
    return event.type !== 'mousedown';
  }

  toDOM(): HTMLElement {
    const element = document.createElement(this.displayMode ? 'div' : 'span');
    element.className = this.displayMode ? 'cm-md-math-block' : 'cm-md-math-inline';
    element.textContent = this.formula;
    if (this.displayMode && Number.isFinite(this.srcFrom) && Number.isFinite(this.srcTo)) {
      element.dataset.srcFrom = String(this.srcFrom);
      element.dataset.srcTo = String(this.srcTo);
    }

    trackPdfExportTask(loadKatex())
      .then((katexModule) => {
        const katex = ((katexModule as unknown as { default?: unknown }).default || katexModule) as any;
        if (!katex || typeof katex.renderToString !== 'function') {
          return;
        }
        const html = katex.renderToString(this.formula, {
          displayMode: this.displayMode,
          throwOnError: false,
        });
        element.innerHTML = html;
        EditorView.findFromDOM(element)?.requestMeasure();
      })
      .catch(() => {
        element.textContent = this.formula;
        EditorView.findFromDOM(element)?.requestMeasure();
      });

    return element;
  }
}
