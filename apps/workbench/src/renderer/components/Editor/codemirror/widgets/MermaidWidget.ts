import { EditorSelection } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { renderBeautifulMermaidSvg } from '../../../../utils/beautifulMermaid';
import { EDIT_SOURCE_ICON_SVG } from './editSourceIcon';

export class MermaidWidget extends WidgetType {
  constructor(
    private code: string,
    private srcFrom?: number,
    private srcTo?: number,
    private showSourceButton: boolean = true,
    private className: string = ''
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return other.code === this.code
      && other.srcFrom === this.srcFrom
      && other.srcTo === this.srcTo
      && other.showSourceButton === this.showSourceButton
      && other.className === this.className;
  }

  // 只有点击 </> 按钮才进入编辑态；块内点击不交给 CodeMirror，避免误进编辑态、方便复制
  ignoreEvent(event: Event): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = ['cm-md-mermaid-block', this.className].filter(Boolean).join(' ');
    const content = document.createElement('div');
    content.className = 'cm-md-mermaid-content';
    element.appendChild(content);
    const srcFrom = this.srcFrom;
    const srcTo = this.srcTo;
    if (Number.isFinite(srcFrom) && Number.isFinite(srcTo)) {
      element.dataset.srcFrom = String(srcFrom);
      element.dataset.srcTo = String(srcTo);
    }

    void renderBeautifulMermaidSvg(this.code)
      .then((svg) => {
        content.innerHTML = svg;
      })
      .catch((error) => {
        element.classList.add('cm-md-mermaid-error');
        content.classList.add('cm-md-mermaid-error');
        const message = error instanceof Error ? error.message : String(error);
        content.textContent = `Invalid mermaid diagram: ${message}`;
      })
      .finally(() => {
        EditorView.findFromDOM(element)?.requestMeasure();
      });

    // 源码切换按钮：点击后光标跳入块内，触发编辑态
    if (this.showSourceButton) {
      const btn = document.createElement('button');
      btn.className = 'cm-md-edit-src-btn cm-md-mermaid-src-btn';
      btn.type = 'button';
      btn.title = 'Edit source';
      btn.setAttribute('aria-label', 'Edit source');
      btn.innerHTML = EDIT_SOURCE_ICON_SVG;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!Number.isFinite(srcFrom)) return;
        const view = EditorView.findFromDOM(element);
        if (!view) return;
        // 光标放到块的第二行开头（跳过 ```mermaid 行）
        const firstContentLine = view.state.doc.lineAt(srcFrom!).number + 1;
        const pos = view.state.doc.line(Math.min(firstContentLine, view.state.doc.lines)).from;
        view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
        view.focus();
      });
      element.appendChild(btn);
    }

    return element;
  }
}
