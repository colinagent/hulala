import { EditorView, WidgetType } from '@codemirror/view';
import { rendererI18n } from '../../../../../i18n/renderer';
import { getWorkspaceStateForEditor, workspaceStoreFacet } from '../workspaceStoreState';
import { openImageSource } from '../imageSourceState';
import { openDrawingFile } from '../../excalidraw/drawingFiles';
import { resolveDrawingPath } from '../../excalidraw/drawingDocument';
import { loadDrawingPreview, subscribeDrawingPreview } from '../../excalidraw/drawingPreview';
import { trackPdfExportTask } from '../../../../services/pdfExportReadiness';
import { EDIT_SOURCE_ICON_SVG } from './editSourceIcon';

export class ExcalidrawWidget extends WidgetType {
  private cleanups = new WeakMap<HTMLElement, () => void>();

  constructor(private documentPath: string | null, private target: string, private label: string,
    private sourceFrom: number, private sourceTo: number, private exportMode = false) { super(); }

  eq(other: ExcalidrawWidget): boolean {
    return this.documentPath === other.documentPath && this.target === other.target && this.label === other.label
      && this.sourceFrom === other.sourceFrom && this.sourceTo === other.sourceTo && this.exportMode === other.exportMode;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-md-excalidraw-block';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-md-excalidraw-preview';
    button.disabled = this.exportMode;
    button.setAttribute('aria-label', rendererI18n.t('dialog:excalidraw.edit', { name: this.label }));
    const status = document.createElement('span');
    status.className = 'cm-md-excalidraw-status';
    const img = document.createElement('img');
    img.alt = this.label;
    img.hidden = true;
    img.draggable = false;
    button.append(img, status);
    wrapper.append(button);
    const workspace = view.state.facet(workspaceStoreFacet);
    const access = getWorkspaceStateForEditor(view.state);
    const owner = workspace || access;
    let disposed = false;
    let generation = 0;
    let objectUrl: string | undefined;
    let unsubscribe = () => {};
    const releaseImage = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = undefined; };
    const fail = (error: unknown) => {
      img.hidden = true;
      status.hidden = false;
      const key = error instanceof Error ? error.message : 'readFailed';
      status.textContent = rendererI18n.t(`dialog:excalidraw.${['invalidPath', 'invalidFile', 'saveFailed', 'conflict'].includes(key) ? key : 'readFailed'}`);
      view.requestMeasure();
    };
    try {
      const path = resolveDrawingPath(this.documentPath, this.target);
      const refresh = () => {
        const request = ++generation;
        status.textContent = rendererI18n.t('dialog:excalidraw.loading');
        void trackPdfExportTask(loadDrawingPreview(owner, workspace?.getState() || access, path)).then((preview) => {
          if (disposed || request !== generation) return;
          releaseImage();
          if (preview.svg) {
            objectUrl = URL.createObjectURL(new Blob([preview.svg], { type: 'image/svg+xml' }));
            img.src = objectUrl;
            img.hidden = false;
            status.hidden = true;
          } else {
            img.hidden = true;
            status.hidden = false;
            status.textContent = rendererI18n.t(`dialog:excalidraw.${preview.missing ? 'create' : 'empty'}`, { name: this.label });
          }
          view.requestMeasure();
        }).catch((error) => { if (!disposed && request === generation) fail(error); });
      };
      img.onload = () => { if (!disposed) view.requestMeasure(); };
      img.onerror = () => { if (!disposed) fail(new Error('readFailed')); };
      button.addEventListener('click', () => {
        button.disabled = true;
        void openDrawingFile(workspace?.getState() || access, path).catch((error) => {
          if (!disposed) fail(error);
        }).finally(() => {
          if (!disposed) button.disabled = this.exportMode;
        });
      });
      unsubscribe = subscribeDrawingPreview(owner, path, refresh);
      refresh();
    } catch (error) { fail(error); }

    if (!this.exportMode) {
      const source = document.createElement('button');
      source.type = 'button';
      source.className = 'cm-md-edit-src-btn';
      source.title = rendererI18n.t('dialog:excalidraw.editReference');
      source.setAttribute('aria-label', source.title);
      source.innerHTML = EDIT_SOURCE_ICON_SVG;
      source.addEventListener('mousedown', (event) => {
        event.preventDefault();
        openImageSource(view, { from: this.sourceFrom, to: this.sourceTo });
      });
      wrapper.append(source);
    }
    this.cleanups.set(wrapper, () => { disposed = true; unsubscribe(); releaseImage(); });
    return wrapper;
  }

  destroy(dom: HTMLElement): void { this.cleanups.get(dom)?.(); }
  ignoreEvent(): boolean { return true; }
}
