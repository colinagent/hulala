import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bindEpubFootnoteReferenceClicks,
  isEpubFootnoteBacklink,
  isEpubFootnoteReference,
  isEpubFootnoteReferenceAnchor,
  resolveEpubFootnoteContentElement,
  resolveEpubFootnoteTarget,
  semanticTokens,
} from './epubFootnotes.ts';

function mockAnchor(options: {
  href: string;
  id?: string;
  epubType?: string;
  role?: string;
  className?: string;
  text?: string;
}): HTMLAnchorElement {
  const attributes = new Map<string, string>();
  attributes.set('href', options.href);
  if (options.id) {
    attributes.set('id', options.id);
  }
  if (options.epubType) {
    attributes.set('epub:type', options.epubType);
  }
  if (options.role) {
    attributes.set('role', options.role);
  }
  if (options.className) {
    attributes.set('class', options.className);
  }
  return {
    id: options.id || '',
    className: options.className || '',
    textContent: options.text ?? '',
    getAttribute: (name: string) => attributes.get(name) || null,
    getAttributeNS: (_ns: string, local: string) => (
      local === 'type' ? (options.epubType || null) : null
    ),
  } as unknown as HTMLAnchorElement;
}

test('EPUB footnote semantics recognize EPUB and DPUB-ARIA noterefs', () => {
  assert.equal(isEpubFootnoteReference('noteref', null), true);
  assert.equal(isEpubFootnoteReference('foo noteref bar', null), true);
  assert.equal(isEpubFootnoteReference(null, 'doc-noteref'), true);
  assert.equal(isEpubFootnoteReference('backlink', 'doc-backlink'), false);
  assert.equal(isEpubFootnoteBacklink('backlink', null), true);
  assert.equal(isEpubFootnoteBacklink(null, 'doc-backlink'), true);
  assert.deepEqual([...semanticTokens('  footnote   note ')], ['footnote', 'note']);
});

test('EPUB footnote targets resolve same-document and cross-document fragments', () => {
  assert.deepEqual(resolveEpubFootnoteTarget('EPUB/xhtml/chapter.xhtml', '#note-1'), {
    documentHref: 'EPUB/xhtml/chapter.xhtml',
    fragmentId: 'note-1',
    sameDocument: true,
  });
  assert.deepEqual(resolveEpubFootnoteTarget('EPUB/xhtml/chapter.xhtml', '../notes/endnotes.xhtml#note%202'), {
    documentHref: 'EPUB/notes/endnotes.xhtml',
    fragmentId: 'note 2',
    sameDocument: false,
  });
  assert.equal(resolveEpubFootnoteTarget('EPUB/xhtml/chapter.xhtml', 'https://example.com/#note'), null);
  assert.equal(resolveEpubFootnoteTarget('EPUB/xhtml/chapter.xhtml', 'notes.xhtml'), null);
});

test('Calibre/Kindle noteBack markers count as footnote references, body backlinks do not', () => {
  const forward = mockAnchor({
    id: 'noteBack_1',
    href: 'part0007.html#note_1',
    className: 'calibre1',
    text: '[1]',
  });
  const back = mockAnchor({
    id: 'note_1',
    href: 'part0007.html#noteBack_1',
    className: 'calibre1',
    text: '[1]',
  });
  const semantic = mockAnchor({
    href: '#fn2',
    epubType: 'noteref',
    text: '2',
  });
  const chapter = mockAnchor({
    href: '#chapter-3',
    text: '见第3章',
  });
  const bareMarker = mockAnchor({
    href: '#note_2',
    text: '[2]',
  });

  assert.equal(isEpubFootnoteReferenceAnchor(forward), true);
  assert.equal(isEpubFootnoteReferenceAnchor(back), false);
  assert.equal(isEpubFootnoteReferenceAnchor(semantic), true);
  assert.equal(isEpubFootnoteReferenceAnchor(chapter), false);
  assert.equal(isEpubFootnoteReferenceAnchor(bareMarker), true);
});

test('footnote dialog content expands from marker anchors to the surrounding note block', () => {
  const parent = {
    localName: 'p',
    textContent: '[1]虽然美国司法部曾要求以某种方式重组AT&T。',
  };
  const marker = {
    localName: 'a',
    textContent: '[1]',
    closest: (selector: string) => (selector.includes('p') ? parent : null),
  } as unknown as Element;
  const rich = {
    localName: 'aside',
    textContent: 'Full semantic note with enough body text.',
    closest: () => null,
  } as unknown as Element;

  assert.equal(resolveEpubFootnoteContentElement(marker), parent);
  assert.equal(resolveEpubFootnoteContentElement(rich), rich);
});

test('EPUB footnote clicks replace epub.js link navigation at the anchor', () => {
  const listeners: {
    click: ((event: MouseEvent) => void) | null;
    removed: ((event: MouseEvent) => void) | null;
  } = {
    click: null,
    removed: null,
  };
  const attributes = new Map([
    ['href', '#note-1'],
    ['epub:type', 'noteref'],
  ]);
  const classList = new Set<string>();
  const anchor = {
    onclick: () => false,
    classList: {
      add: (value: string) => classList.add(value),
    },
    getAttribute: (name: string) => attributes.get(name) || null,
    getAttributeNS: () => null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    addEventListener: (type: string, listener: (event: MouseEvent) => void, capture: boolean) => {
      assert.equal(type, 'click');
      assert.equal(capture, true);
      listeners.click = listener;
    },
    removeEventListener: (type: string, listener: (event: MouseEvent) => void, capture: boolean) => {
      assert.equal(type, 'click');
      assert.equal(capture, true);
      listeners.removed = listener;
    },
  };
  const doc = {
    querySelectorAll: (selector: string) => {
      assert.equal(selector, 'a[href]');
      return [anchor];
    },
  } as unknown as Document;
  let activatedAnchor: HTMLAnchorElement | null = null;
  const cleanup = bindEpubFootnoteReferenceClicks(doc, (_event, activated) => {
    activatedAnchor = activated;
  });

  assert.equal(anchor.onclick, null);
  assert.equal(attributes.get('aria-haspopup'), 'dialog');
  assert.ok(classList.has('op-book-epub-noteref'));
  assert.ok(listeners.click);
  const calls: string[] = [];
  listeners.click({
    button: 0,
    preventDefault: () => calls.push('preventDefault'),
    stopPropagation: () => calls.push('stopPropagation'),
    stopImmediatePropagation: () => calls.push('stopImmediatePropagation'),
  } as unknown as MouseEvent);
  assert.equal(activatedAnchor, anchor);
  assert.deepEqual(calls, ['preventDefault', 'stopPropagation', 'stopImmediatePropagation']);

  cleanup();
  assert.equal(listeners.removed, listeners.click);
});
