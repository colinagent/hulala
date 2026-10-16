/**
 * WebKit blocks parent-owned listeners in script-disabled frames:
 * https://bugs.webkit.org/show_bug.cgi?id=218086
 * Keep publication scripts disabled with a CSP installed before the inert EPUB
 * document is serialized, while permitting our parent-owned reader listeners.
 */
// epub.js swallows synchronous hook errors; a rejected promise stops rendering.
export async function protectEpubDocument(document: Document): Promise<void> {
  const root = document.documentElement;
  const namespace = 'http://www.w3.org/1999/xhtml';
  if (root?.localName !== 'html' || (root.namespaceURI && root.namespaceURI !== namespace)) {
    throw new Error('The EPUB section must be an HTML document.');
  }
  document.querySelectorAll('script, iframe, frame, frameset, object, embed').forEach(element => element.remove());
  document.querySelectorAll('meta[http-equiv]').forEach(element => {
    if (element.getAttribute('http-equiv')?.toLowerCase() === 'refresh') element.remove();
  });
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.localName)) element.removeAttributeNode(attribute);
    }
  }
  let head = Array.from(root.children).find(element => element.localName === 'head');
  if (!head) {
    head = document.createElementNS(namespace, 'head');
  }
  root.insertBefore(head, root.firstChild);
  const policy = document.createElementNS(namespace, 'meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', "script-src 'none'; script-src-elem 'none'; script-src-attr 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'");
  head.insertBefore(policy, head.firstChild);
}
