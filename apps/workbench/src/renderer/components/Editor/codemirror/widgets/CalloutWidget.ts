import { WidgetType } from '@codemirror/view';

function formatCalloutType(type: string): string {
  return type
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export class CalloutWidget extends WidgetType {
  private label: string;

  constructor(private type: string) {
    super();
    this.label = formatCalloutType(type);
  }

  eq(other: CalloutWidget): boolean {
    return other.type === this.type;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.className = 'cm-md-callout-header';
    wrapper.setAttribute('data-callout-type', this.type);

    const icon = document.createElement('span');
    icon.className = 'cm-md-callout-icon';
    icon.textContent = '*';

    const label = document.createElement('span');
    label.className = 'cm-md-callout-label';
    label.textContent = this.label;

    wrapper.appendChild(icon);
    wrapper.appendChild(label);
    return wrapper;
  }
}
