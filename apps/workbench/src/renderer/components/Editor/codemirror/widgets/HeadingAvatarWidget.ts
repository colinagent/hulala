import { EditorView, WidgetType } from '@codemirror/view';
import { loadRenderUrlForReference, peekRenderUrlForReference } from './renderUrlCache';
import { getWorkspaceViewIdForEditor } from '../workspaceStoreState';

type HeadingAvatarWidgetOptions = {
  alt: string;
  documentPath?: string | null;
  resolvedPath: string;
  level: number;
  variant?: 'heading' | 'inline';
  showLabel?: boolean;
  sourceFrom?: number;
  sourceTo?: number;
};

export class HeadingAvatarWidget extends WidgetType {
  private alt: string;
  private documentPath: string | null;
  private resolvedPath: string;
  private level: number;
  private variant: 'heading' | 'inline';
  private showLabel: boolean;
  private sourceFrom?: number;
  private sourceTo?: number;

  constructor(options: HeadingAvatarWidgetOptions) {
    super();
    this.alt = options.alt;
    this.documentPath = options.documentPath || null;
    this.resolvedPath = options.resolvedPath;
    this.level = options.level;
    this.variant = options.variant ?? 'heading';
    this.showLabel = options.showLabel ?? false;
    this.sourceFrom = options.sourceFrom;
    this.sourceTo = options.sourceTo;
  }

  eq(other: HeadingAvatarWidget): boolean {
    return (
      other.alt === this.alt &&
      other.documentPath === this.documentPath &&
      other.resolvedPath === this.resolvedPath &&
      other.level === this.level &&
      other.variant === this.variant &&
      other.showLabel === this.showLabel &&
      other.sourceFrom === this.sourceFrom &&
      other.sourceTo === this.sourceTo
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const workspaceViewId = getWorkspaceViewIdForEditor(view.state);
    const wrapper = document.createElement('span');
    const baseClass = this.variant === 'heading' ? 'cm-md-heading-avatar' : 'cm-md-inline-avatar';
    wrapper.className = baseClass;
    wrapper.dataset.headingLevel = String(this.level);
    if (Number.isFinite(this.sourceFrom) && Number.isFinite(this.sourceTo)) {
      wrapper.dataset.mdImageSourceFrom = String(this.sourceFrom);
      wrapper.dataset.mdImageSourceTo = String(this.sourceTo);
    }

    const img = document.createElement('img');
    img.className = this.variant === 'heading' ? 'cm-md-heading-avatar-img' : 'cm-md-inline-avatar-img';
    img.alt = this.alt;
    img.crossOrigin = 'anonymous';

    const requestMeasure = () => {
      EditorView.findFromDOM(wrapper)?.requestMeasure();
    };

    img.addEventListener('load', requestMeasure);
    img.addEventListener('error', () => {
      wrapper.style.display = 'none';
      requestMeasure();
    });

    wrapper.appendChild(img);

    if (this.showLabel && this.alt.trim()) {
      const label = document.createElement('span');
      label.className = this.variant === 'heading' ? 'cm-md-heading-avatar-label' : 'cm-md-inline-avatar-label';
      label.textContent = this.alt.trim();
      wrapper.appendChild(label);
    }

    const cachedUrl = peekRenderUrlForReference(this.documentPath, this.resolvedPath, workspaceViewId);
    if (cachedUrl) {
      img.src = cachedUrl;
    }

    void loadRenderUrlForReference(this.documentPath, this.resolvedPath, workspaceViewId)
      .then((url) => {
        if (img.src !== url) {
          img.src = url;
        }
      })
      .catch(() => {
        wrapper.style.display = 'none';
      });

    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
