import { EditorSelection } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import type { BookOpenTarget } from '../../../../store/appStore';
import { resolveMarkdownPath } from '../../../../utils/markdownMedia';
import type { ParsedBookHighlightNote } from '../../bookNotes';
import { EDIT_SOURCE_ICON_SVG } from './editSourceIcon';
import { getWorkspaceStateForEditor } from '../workspaceStoreState';

function formatCreated(value: string): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function targetFromNote(note: ParsedBookHighlightNote): BookOpenTarget | null {
  if (note.format === 'epub') {
    return note.cfi ? { format: 'epub', cfi: note.cfi, text: note.text } : null;
  }
  return note.page !== null ? {
    format: 'pdf',
    page: note.page,
    rects: note.rects,
    text: note.text,
  } : null;
}

/** External-open glyph for the note card action (imperative DOM, no React icon). */
function createOpenInBookIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('cm-md-book-note-open-icon');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  // Square + arrow out (open / jump to source).
  path.setAttribute(
    'd',
    'M6.5 3.5H3.75A1.25 1.25 0 002.5 4.75v7.5A1.25 1.25 0 003.75 13.5h7.5A1.25 1.25 0 0012.5 12.25V9.5M9.5 2.5h4v4M13.5 2.5L7.5 8.5',
  );
  svg.append(path);
  return svg;
}

function placeCursorInBookNoteSource(view: EditorView, srcFrom: number): void {
  // Same as Mermaid: land on the first content line inside the fence.
  const firstContentLine = view.state.doc.lineAt(srcFrom).number + 1;
  const pos = view.state.doc.line(Math.min(firstContentLine, view.state.doc.lines)).from;
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    scrollIntoView: true,
  });
  view.focus();
}

export class BookNoteWidget extends WidgetType {
  constructor(
    private note: ParsedBookHighlightNote,
    private documentPath: string | null,
    private srcFrom: number,
    private srcTo: number,
    private showSourceButton: boolean = true,
  ) {
    super();
  }

  eq(other: BookNoteWidget): boolean {
    return other.documentPath === this.documentPath
      && other.srcFrom === this.srcFrom
      && other.srcTo === this.srcTo
      && other.showSourceButton === this.showSourceButton
      && JSON.stringify(other.note) === JSON.stringify(this.note);
  }

  // Only the explicit </> / open actions enter editing or navigation; keep the
  // rendered card opaque so clicks do not map through mismatched source lines.
  ignoreEvent(event: Event): boolean {
    return event.type !== 'wheel';
  }

  toDOM(): HTMLElement {
    // CodeMirror measures a block widget from its root element's offsetHeight.
    // Keep vertical spacing as root padding (which offsetHeight includes), not
    // as card margin (which it excludes), or posAtCoords drifts after cards.
    const block = document.createElement('div');
    block.className = 'cm-md-book-note-block';

    const element = document.createElement('div');
    element.className = 'cm-md-book-note';
    element.dataset.srcFrom = String(this.srcFrom);
    element.dataset.srcTo = String(this.srcTo);

    const header = document.createElement('div');
    header.className = 'cm-md-book-note-header';

    const meta = document.createElement('div');
    meta.className = 'cm-md-book-note-meta';
    const title = document.createElement('div');
    title.className = 'cm-md-book-note-title';
    title.textContent = this.note.title || this.note.source;
    const detail = document.createElement('div');
    detail.className = 'cm-md-book-note-detail';
    detail.textContent = [this.note.format.toUpperCase(), this.note.locator, formatCreated(this.note.created)]
      .filter(Boolean)
      .join(' | ');
    meta.append(title, detail);

    const actions = document.createElement('div');
    actions.className = 'cm-md-book-note-actions';

    if (this.showSourceButton) {
      const sourceButton = document.createElement('button');
      sourceButton.type = 'button';
      sourceButton.className = 'cm-md-edit-src-btn cm-md-book-note-src-btn';
      sourceButton.title = 'Edit source';
      sourceButton.setAttribute('aria-label', 'Edit source');
      sourceButton.innerHTML = EDIT_SOURCE_ICON_SVG;
      sourceButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const view = EditorView.findFromDOM(element);
        if (!view || !Number.isFinite(this.srcFrom)) {
          return;
        }
        placeCursorInBookNoteSource(view, this.srcFrom);
      });
      actions.append(sourceButton);
    }

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'cm-md-book-note-open';
    openButton.title = 'Open in book';
    openButton.setAttribute('aria-label', 'Open in book');
    openButton.append(createOpenInBookIcon());
    openButton.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    openButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const resolved = resolveMarkdownPath(this.documentPath, this.note.source, false);
      const bookTarget = targetFromNote(this.note);
      if (!resolved || !bookTarget) {
        return;
      }
      const view = EditorView.findFromDOM(element);
      if (!view) return;
      void getWorkspaceStateForEditor(view.state).openFile(resolved, { bookTarget });
    });
    actions.append(openButton);

    header.append(meta, actions);

    const quote = document.createElement('blockquote');
    quote.className = 'cm-md-book-note-quote';
    quote.textContent = this.note.text;
    element.append(header, quote);

    const reflection = (this.note.note || '').trim();
    if (reflection) {
      const noteBody = document.createElement('div');
      noteBody.className = 'cm-md-book-note-reflection';
      noteBody.textContent = reflection;
      element.append(noteBody);
    }
    block.append(element);
    return block;
  }
}
