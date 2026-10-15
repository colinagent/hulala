import { EditorView, WidgetType } from '@codemirror/view';

export class TaskCheckboxWidget extends WidgetType {
  constructor(
    private checked: boolean,
    private from: number,
    private to: number
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return (
      other.checked === this.checked &&
      other.from === this.from &&
      other.to === this.to
    );
  }

  ignoreEvent(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = `cm-md-task ${this.checked ? 'checked' : ''}`;
    span.setAttribute('role', 'checkbox');
    span.setAttribute('aria-checked', this.checked ? 'true' : 'false');
    span.dataset.mdTask = 'true';
    span.dataset.taskFrom = String(this.from);
    span.dataset.taskTo = String(this.to);
    span.dataset.taskChecked = String(this.checked);

    span.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return;
      }
      const view = EditorView.findFromDOM(span);
      if (!view) {
        return;
      }
      const replacement = this.checked ? '[ ]' : '[x]';
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: replacement },
      });
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    });
    if (this.checked) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 12 12');
      svg.setAttribute('width', '10');
      svg.setAttribute('height', '10');
      svg.setAttribute('aria-hidden', 'true');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M2 6l3 3 5-5');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');

      svg.appendChild(path);
      span.appendChild(svg);
    }

    return span;
  }
}
