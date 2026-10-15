import type { Book, Contents } from 'epubjs';

export type EpubFootnoteTarget = {
  documentHref: string;
  fragmentId: string;
  sameDocument: boolean;
};

const EPUB_RESOLUTION_ORIGIN = 'https://hulala-epub.invalid';
const EPUB_OPS_NAMESPACE = 'http://www.idpf.org/2007/ops';
const EPUB_FOOTNOTE_STYLE_ID = 'op-book-epub-footnote-style';
const EPUB_FOOTNOTE_DIALOG_CLASS = 'op-book-epub-footnote-dialog';

export type EpubFootnotePalette = {
  body: string;
  text: string;
  link: string;
};

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Compact marker text used by many Calibre/Kindle/Chinese EPUB exports: [1], 【2】, †, etc. */
const FOOTNOTE_MARKER_TEXT = /^(?:[\[【〔]\s*\d+[a-zA-Z]?\s*[\]】〕]|\d{1,3}|[¹²³⁴⁵⁶⁷⁸⁹⁰]+|[†‡⁎*]+)$/;

/** Forward-reference ids such as noteBack_1 / fnref-2 / cite_ref-3. */
const FOOTNOTE_FORWARD_ID = /(?:^|[_-])(?:noteBack|fnref|footnoteref|cite[_-]?ref)(?:[_-]?\d+[a-zA-Z]*)?$/i;

/** Backlink ids such as note_1 / fn1 that return from the note body to the marker. */
const FOOTNOTE_BACKLINK_ID = /^(?:note|fn|footnote)[_-]?\d+[a-zA-Z]*$/i;

const FOOTNOTE_REF_CLASS = /(?:^|[\s_-])(?:footnote|noteref|duokan-footnote|epub-footnote)(?:[\s_-]|$)/i;

export function semanticTokens(value: string | null | undefined): Set<string> {
  return new Set((value || '').trim().split(/\s+/).filter(Boolean));
}

export function isEpubFootnoteReference(epubType: string | null | undefined, role: string | null | undefined): boolean {
  const types = semanticTokens(epubType);
  const roles = semanticTokens(role);
  return types.has('noteref') || roles.has('doc-noteref');
}

export function isEpubFootnoteBacklink(epubType: string | null | undefined, role: string | null | undefined): boolean {
  const types = semanticTokens(epubType);
  const roles = semanticTokens(role);
  return types.has('backlink') || roles.has('doc-backlink');
}

function normalizeMarkerText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function looksLikeFootnoteMarkerText(value: string | null | undefined): boolean {
  return FOOTNOTE_MARKER_TEXT.test(normalizeMarkerText(value));
}

/**
 * Detect note markers across EPUB 3 semantics and common publisher exports that
 * omit epub:type (Calibre/Kindle noteBack_N, superscript [1], etc.). Backlinks
 * from the note body stay as normal navigation so readers can still jump back.
 */
export function isEpubFootnoteReferenceAnchor(anchor: HTMLAnchorElement): boolean {
  const epubType = epubTypeValue(anchor);
  const role = anchor.getAttribute('role');
  if (isEpubFootnoteReference(epubType, role)) {
    return true;
  }
  if (isEpubFootnoteBacklink(epubType, role)) {
    return false;
  }

  const href = (anchor.getAttribute('href') || '').trim();
  if (!href || !href.includes('#')) {
    return false;
  }

  const id = (anchor.getAttribute('id') || anchor.id || '').trim();
  const className = typeof anchor.className === 'string' ? anchor.className : anchor.getAttribute('class') || '';
  if (FOOTNOTE_FORWARD_ID.test(id) || FOOTNOTE_REF_CLASS.test(className)) {
    return true;
  }

  // note_1 → #noteBack_1 is a body backlink, not a popup trigger.
  if (FOOTNOTE_BACKLINK_ID.test(id) && /noteBack|fnref|footnoteref/i.test(href)) {
    return false;
  }

  // Marker-shaped text (`[1]`, superscript digits, †) pointing at an in-book
  // fragment is the common fallback when publishers omit EPUB note semantics.
  return looksLikeFootnoteMarkerText(anchor.textContent);
}

export function resolveEpubFootnoteTarget(
  currentDocumentHref: string,
  referenceHref: string,
): EpubFootnoteTarget | null {
  const current = currentDocumentHref.trim();
  const reference = referenceHref.trim();
  if (!current || !reference) {
    return null;
  }

  try {
    const currentUrl = new URL(current.replace(/^\/+/, ''), `${EPUB_RESOLUTION_ORIGIN}/`);
    const targetUrl = new URL(reference, currentUrl);
    if (targetUrl.origin !== EPUB_RESOLUTION_ORIGIN || !targetUrl.hash) {
      return null;
    }
    const documentHref = decodeUrlPart(targetUrl.pathname.replace(/^\/+/, ''));
    const fragmentId = decodeUrlPart(targetUrl.hash.slice(1));
    if (!documentHref || !fragmentId) {
      return null;
    }
    return {
      documentHref,
      fragmentId,
      sameDocument: documentHref === decodeUrlPart(currentUrl.pathname.replace(/^\/+/, '')),
    };
  } catch {
    return null;
  }
}

function epubTypeValue(element: Element): string {
  return element.getAttribute('epub:type')
    || element.getAttributeNS(EPUB_OPS_NAMESPACE, 'type')
    || '';
}

export function bindEpubFootnoteReferenceClicks(
  doc: Document,
  onActivate: (event: MouseEvent, anchor: HTMLAnchorElement) => void,
): () => void {
  const bindings: Array<{ anchor: HTMLAnchorElement; listener: (event: MouseEvent) => void }> = [];

  doc.querySelectorAll('a[href]').forEach((element) => {
    const anchor = element as HTMLAnchorElement;
    if (!isEpubFootnoteReferenceAnchor(anchor)) {
      return;
    }

    // Contents.linksHandler() gives every internal link an `onclick` that emits
    // LINK_CLICKED, and Rendition responds by calling display(). A document-level
    // delegate can still lose to that target handler in embedded reading views,
    // so note references must own their target click directly.
    anchor.onclick = null;
    anchor.classList.add('op-book-epub-noteref');
    anchor.setAttribute('aria-haspopup', 'dialog');
    const listener = (event: MouseEvent) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onActivate(event, anchor);
    };
    anchor.addEventListener('click', listener, true);
    bindings.push({ anchor, listener });
  });

  return () => {
    for (const { anchor, listener } of bindings) {
      anchor.removeEventListener('click', listener, true);
    }
  };
}

function footnoteFallbackText(anchor: HTMLAnchorElement): string {
  const image = anchor.querySelector('img[zy-footnote], img[alt]');
  return (
    image?.getAttribute('zy-footnote')
    || image?.getAttribute('alt')
    || anchor.getAttribute('title')
    || ''
  ).replace(/\s+/g, ' ').trim();
}

function sanitizeFootnoteContent(doc: Document, source: Element): HTMLElement {
  const content = doc.createElement('div');
  content.className = 'op-book-epub-footnote-content';
  for (const child of Array.from(source.childNodes)) {
    content.appendChild(doc.importNode(child, true));
  }

  content.querySelectorAll('script, style, iframe, object, embed, form, input, textarea, select, button, link, meta')
    .forEach((element) => element.remove());
  content.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name === 'id' || name === 'class' || name === 'style' || name.startsWith('on')) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.localName === 'a') {
      const href = element.getAttribute('href') || '';
      if (/^\s*(?:javascript|data):/i.test(href)) {
        element.removeAttribute('href');
      } else if (/^https?:/i.test(href)) {
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noreferrer');
      }
    }
  });
  return content;
}

export function ensureEpubFootnoteStyles(contents: Contents, palette: EpubFootnotePalette): void {
  const doc = contents.document;
  if (!doc) {
    return;
  }
  let style = doc.getElementById(EPUB_FOOTNOTE_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = EPUB_FOOTNOTE_STYLE_ID;
    (doc.head || doc.documentElement).appendChild(style);
  }
  style.textContent = `
    @namespace epub url("${EPUB_OPS_NAMESPACE}");

    aside[epub|type~="footnote"],
    aside[epub|type~="note"],
    aside[epub|type~="endnote"],
    aside[role~="doc-footnote"],
    aside[role~="doc-endnote"] {
      display: none !important;
    }

    aside[epub\\:type~="footnote"],
    aside[epub\\:type~="note"],
    aside[epub\\:type~="endnote"] {
      display: none !important;
    }

    a[epub|type~="noteref"],
    a[role~="doc-noteref"],
    a.op-book-epub-noteref {
      display: inline-block !important;
      position: relative !important;
      cursor: pointer !important;
      line-height: 1 !important;
      text-decoration: none !important;
      vertical-align: super !important;
    }

    a[epub\\:type~="noteref"] {
      display: inline-block !important;
      position: relative !important;
      cursor: pointer !important;
      line-height: 1 !important;
      text-decoration: none !important;
      vertical-align: super !important;
    }

    a[epub|type~="noteref"]::after,
    a[role~="doc-noteref"]::after,
    a[epub\\:type~="noteref"]::after,
    a.op-book-epub-noteref::after {
      content: "" !important;
      position: absolute !important;
      inset: -5px !important;
    }

    a[epub|type~="noteref"] img,
    a[role~="doc-noteref"] img,
    a[epub\\:type~="noteref"] img,
    a.op-book-epub-noteref img,
    img[zy-footnote],
    img.epub-footnote,
    img.epub-footnote1,
    img.epub-footnote2 {
      display: inline-block !important;
      width: 0.78em !important;
      min-width: 0 !important;
      max-width: 0.78em !important;
      height: 0.78em !important;
      min-height: 0 !important;
      max-height: 0.78em !important;
      margin: 0 0.08em !important;
      object-fit: contain !important;
      vertical-align: baseline !important;
    }

    dialog.${EPUB_FOOTNOTE_DIALOG_CLASS} {
      box-sizing: border-box !important;
      position: fixed !important;
      z-index: 2147483647 !important;
      width: min(430px, calc(100vw - 24px)) !important;
      max-width: calc(100vw - 24px) !important;
      max-height: min(54vh, 430px) !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      border: 1px solid color-mix(in srgb, ${palette.text} 18%, ${palette.body}) !important;
      border-radius: 11px !important;
      background: ${palette.body} !important;
      color: ${palette.text} !important;
      box-shadow: 0 12px 34px rgb(0 0 0 / 0.22), 0 2px 8px rgb(0 0 0 / 0.14) !important;
      font-family: inherit !important;
      font-size: clamp(14px, 0.78em, 18px) !important;
      font-style: normal !important;
      font-weight: 400 !important;
      line-height: 1.55 !important;
      text-align: start !important;
    }

    dialog.${EPUB_FOOTNOTE_DIALOG_CLASS}::backdrop {
      background: transparent !important;
    }

    .op-book-epub-footnote-header {
      box-sizing: border-box !important;
      display: flex !important;
      min-height: 38px !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 5px 7px 5px 14px !important;
      border-bottom: 1px solid color-mix(in srgb, ${palette.text} 12%, ${palette.body}) !important;
      color: color-mix(in srgb, ${palette.text} 72%, ${palette.body}) !important;
      background: ${palette.body} !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      line-height: 1 !important;
    }

    .op-book-epub-footnote-close {
      box-sizing: border-box !important;
      display: inline-grid !important;
      width: 28px !important;
      min-width: 28px !important;
      height: 28px !important;
      min-height: 28px !important;
      place-items: center !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 6px !important;
      background: transparent !important;
      box-shadow: none !important;
      color: ${palette.text} !important;
      font: inherit !important;
      font-size: 19px !important;
      line-height: 1 !important;
      cursor: pointer !important;
    }

    .op-book-epub-footnote-close:hover,
    .op-book-epub-footnote-close:focus-visible {
      color: ${palette.link} !important;
      outline: none !important;
    }

    .op-book-epub-footnote-content {
      box-sizing: border-box !important;
      max-height: calc(min(54vh, 430px) - 38px) !important;
      overflow: auto !important;
      padding: 13px 16px 15px !important;
      color: ${palette.text} !important;
      background: ${palette.body} !important;
      font: inherit !important;
      line-height: 1.55 !important;
      text-align: start !important;
      overflow-wrap: anywhere !important;
    }

    .op-book-epub-footnote-content > :first-child { margin-top: 0 !important; }
    .op-book-epub-footnote-content > :last-child { margin-bottom: 0 !important; }
    .op-book-epub-footnote-content p { margin: 0.55em 0 !important; line-height: inherit !important; }
    .op-book-epub-footnote-content ol,
    .op-book-epub-footnote-content ul { margin: 0 !important; padding-inline-start: 1.45em !important; }
    .op-book-epub-footnote-content li { margin: 0.2em 0 !important; }
    .op-book-epub-footnote-content a { color: ${palette.link} !important; }
    .op-book-epub-footnote-content img { max-width: 100% !important; height: auto !important; }
  `;

  doc.querySelectorAll('a[href]').forEach((element) => {
    const anchor = element as HTMLAnchorElement;
    if (isEpubFootnoteReferenceAnchor(anchor)) {
      anchor.classList.add('op-book-epub-noteref');
      anchor.setAttribute('aria-haspopup', 'dialog');
    }
  });
}

function pointOutsideRect(rect: DOMRect, clientX: number, clientY: number): boolean {
  return clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom;
}

export function showEpubFootnoteDialog(
  contents: Contents,
  anchor: HTMLAnchorElement,
  source: Element,
  palette: EpubFootnotePalette,
): void {
  const doc = contents.document;
  ensureEpubFootnoteStyles(contents, palette);
  const previous = doc.querySelector(`dialog.${EPUB_FOOTNOTE_DIALOG_CLASS}`) as HTMLDialogElement | null;
  if (previous) {
    if (previous.open) {
      previous.close();
    }
    previous.remove();
  }

  const dialog = doc.createElement('dialog');
  dialog.className = EPUB_FOOTNOTE_DIALOG_CLASS;
  dialog.setAttribute('aria-label', 'Footnote');

  const header = doc.createElement('div');
  header.className = 'op-book-epub-footnote-header';
  const label = doc.createElement('span');
  label.textContent = 'Footnote';
  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'op-book-epub-footnote-close';
  closeButton.setAttribute('aria-label', 'Close footnote');
  closeButton.textContent = '×';
  header.append(label, closeButton);
  dialog.append(header, sanitizeFootnoteContent(doc, source));
  doc.body.appendChild(dialog);

  const closeDialog = () => {
    if (dialog.open) {
      dialog.close();
    } else {
      dialog.remove();
    }
  };
  closeButton.addEventListener('click', closeDialog);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && pointOutsideRect(dialog.getBoundingClientRect(), event.clientX, event.clientY)) {
      closeDialog();
    }
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    try {
      anchor.focus({ preventScroll: true });
    } catch {
      anchor.focus();
    }
  }, { once: true });

  try {
    dialog.showModal();
  } catch {
    dialog.setAttribute('open', '');
  }

  const placeDialog = () => {
    if (!dialog.isConnected) {
      return;
    }
    const anchorRect = anchor.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const viewportWidth = contents.window.innerWidth || doc.documentElement.clientWidth;
    const viewportHeight = contents.window.innerHeight || doc.documentElement.clientHeight;
    const edge = 12;
    const gap = 9;
    const left = Math.min(
      Math.max(edge, anchorRect.left + anchorRect.width / 2 - dialogRect.width / 2),
      Math.max(edge, viewportWidth - dialogRect.width - edge),
    );
    const below = anchorRect.bottom + gap;
    const top = below + dialogRect.height <= viewportHeight - edge
      ? below
      : Math.max(edge, anchorRect.top - dialogRect.height - gap);
    dialog.style.left = `${Math.round(left)}px`;
    dialog.style.top = `${Math.round(top)}px`;
  };
  placeDialog();
  doc.defaultView?.requestAnimationFrame(placeDialog);
  closeButton.focus({ preventScroll: true });
}

/**
 * Publisher note targets are often a tiny marker `<a id="note_1">[1]</a>` whose
 * body text lives in the surrounding block. Prefer that block for the dialog.
 */
export function resolveEpubFootnoteContentElement(target: Element): Element {
  const markerText = normalizeMarkerText(target.textContent);
  const markerOnly = !markerText || looksLikeFootnoteMarkerText(markerText)
    || (target.localName === 'a' && markerText.length <= 8);
  if (!markerOnly) {
    return target;
  }

  const parent = target.closest('aside, li, p, dd, blockquote, section, div');
  if (!parent || parent === target) {
    return target;
  }
  const parentText = normalizeMarkerText(parent.textContent);
  if (parentText.length > markerText.length + 2) {
    return parent;
  }
  return target;
}

export async function loadEpubFootnoteSource(
  book: Book,
  contents: Contents,
  anchor: HTMLAnchorElement,
): Promise<Element> {
  const href = anchor.getAttribute('href') || '';
  const currentSection = book.spine.get(contents.sectionIndex);
  const target = resolveEpubFootnoteTarget(currentSection?.href || '', href);
  if (target) {
    try {
      const targetDocument = target.sameDocument
        ? contents.document
        : await book.load(target.documentHref) as Document;
      const targetElement = targetDocument.getElementById?.(target.fragmentId);
      if (targetElement) {
        return resolveEpubFootnoteContentElement(targetElement);
      }
    } catch {
      // Fall through to publisher-provided accessible text when a referenced
      // resource is absent or malformed.
    }
  }

  const fallback = footnoteFallbackText(anchor);
  const paragraph = contents.document.createElement('p');
  paragraph.textContent = fallback || 'Footnote unavailable.';
  return paragraph;
}

export function closeEpubFootnoteDialog(doc: Document): void {
  const dialog = doc.querySelector(`dialog.${EPUB_FOOTNOTE_DIALOG_CLASS}`) as HTMLDialogElement | null;
  if (dialog?.open) {
    dialog.close();
  }
  dialog?.remove();
}
