import { EditorView, WidgetType } from '@codemirror/view';
import { loadRenderUrlForReference, peekRenderUrlForReference } from './renderUrlCache';
import { getWorkspaceViewIdForEditor } from '../workspaceStoreState';

type WikilinkOptions = {
  label: string;
  target: string;
  isEmbed: boolean;
  isImage: boolean;
  documentPath?: string | null;
  resolvedPath?: string;
  widthPercent?: number | null;
  sourceFrom?: number;
  sourceTo?: number;
  className?: string;
  showDeleteButton?: boolean;
};

export class WikilinkWidget extends WidgetType {
  private label: string;
  private target: string;
  private isEmbed: boolean;
  private isImage: boolean;
  private documentPath: string | null;
  private resolvedPath?: string;
  private widthPercent: number | null;
  private sourceFrom?: number;
  private sourceTo?: number;
  private className: string;
  private showDeleteButton: boolean;

  constructor(options: WikilinkOptions) {
    super();
    this.label = options.label;
    this.target = options.target;
    this.isEmbed = options.isEmbed;
    this.isImage = options.isImage;
    this.documentPath = options.documentPath || null;
    this.resolvedPath = options.resolvedPath;
    this.widthPercent = options.widthPercent ?? null;
    this.sourceFrom = options.sourceFrom;
    this.sourceTo = options.sourceTo;
    this.className = (options.className || '').trim();
    this.showDeleteButton = options.showDeleteButton === true;
  }

  eq(other: WikilinkWidget): boolean {
    return (
      other.label === this.label &&
      other.target === this.target &&
      other.isEmbed === this.isEmbed &&
      other.isImage === this.isImage &&
      other.documentPath === this.documentPath &&
      other.resolvedPath === this.resolvedPath &&
      other.widthPercent === this.widthPercent &&
      other.sourceFrom === this.sourceFrom &&
      other.sourceTo === this.sourceTo &&
      other.className === this.className &&
      other.showDeleteButton === this.showDeleteButton
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const workspaceViewId = getWorkspaceViewIdForEditor(view.state);
    if (this.isEmbed && this.isImage && this.resolvedPath) {
      const wrapper = document.createElement('div');
      wrapper.className = ['cm-md-embed', this.className].filter(Boolean).join(' ');

      const img = document.createElement('img');
      img.className = this.widthPercent === null
        ? 'cm-md-embed-img is-auto-width'
        : 'cm-md-embed-img is-explicit-width';
      img.alt = '';
      img.draggable = false;
      img.dataset.mdLink = this.target;
      img.dataset.mdEmbed = 'true';
      if (Number.isFinite(this.sourceFrom) && Number.isFinite(this.sourceTo)) {
        img.dataset.mdImageSourceFrom = String(this.sourceFrom);
        img.dataset.mdImageSourceTo = String(this.sourceTo);
        if (this.widthPercent !== null) {
          img.dataset.mdImageWidth = String(this.widthPercent);
        }
      }
      if (this.widthPercent !== null) {
        img.style.width = `${this.widthPercent}%`;
      }
      const requestMeasure = () => {
        EditorView.findFromDOM(wrapper)?.requestMeasure();
      };
      const errorState = document.createElement('div');
      errorState.className = 'cm-md-embed-error';
      errorState.textContent = 'Image unavailable';
      errorState.hidden = true;
      const showError = () => {
        errorState.hidden = false;
        requestMeasure();
      };
      img.addEventListener('load', () => {
        errorState.hidden = true;
        requestMeasure();
      });
      img.addEventListener('error', showError);
      wrapper.appendChild(img);
      wrapper.appendChild(errorState);

      if (this.showDeleteButton && Number.isFinite(this.sourceFrom) && Number.isFinite(this.sourceTo)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cm-md-embed-delete';
        button.textContent = '×';
        button.dataset.mdImageDelete = 'true';
        button.dataset.mdImageSourceFrom = String(this.sourceFrom);
        button.dataset.mdImageSourceTo = String(this.sourceTo);
        if (this.widthPercent !== null) {
          button.dataset.mdImageWidth = String(this.widthPercent);
        }
        button.setAttribute('aria-label', `Delete ${this.label || 'image'}`);
        button.setAttribute('title', 'Delete image');
        wrapper.appendChild(button);
      }

      const renderRef = this.target || this.resolvedPath;
      const cachedUrl = peekRenderUrlForReference(this.documentPath, renderRef, workspaceViewId);
      if (cachedUrl) {
        img.src = cachedUrl;
      }

      void loadRenderUrlForReference(this.documentPath, renderRef, workspaceViewId)
        .then((url) => {
          if (img.src !== url) {
            img.src = url;
          }
        })
        .catch(showError);

      requestAnimationFrame(() => {
        requestMeasure();
      });

      return wrapper;
    }

    const link = document.createElement('span');
    const baseClass = this.isEmbed ? 'cm-md-embed-link' : 'cm-md-wikilink';
    link.className = baseClass;
    link.textContent = this.label;
    link.dataset.mdLink = this.target;
    if (this.isEmbed) {
      link.dataset.mdEmbed = 'true';
    }
    return link;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
