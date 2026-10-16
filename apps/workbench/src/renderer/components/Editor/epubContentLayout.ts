const MIN_MALFORMED_NBSP_TEXT_LENGTH = 80;
const MIN_MALFORMED_NBSP_COUNT = 6;

export function hasMalformedEpubNonBreakingWhitespace(text: string): boolean {
  if (text.length < MIN_MALFORMED_NBSP_TEXT_LENGTH) {
    return false;
  }
  const nonBreakingSpaceCount = text.split('\u00a0').length - 1;
  if (nonBreakingSpaceCount < MIN_MALFORMED_NBSP_COUNT) {
    return false;
  }

  // Generated EPUBs sometimes replace every ordinary space in a long source
  // citation with NBSP. That turns the whole citation into one unbreakable run
  // which leaks across neighboring pagination columns.
  const ordinarySpaceCount = text.split(' ').length - 1;
  return ordinarySpaceCount * 2 < nonBreakingSpaceCount;
}

export function normalizeMalformedEpubNonBreakingWhitespace(doc: Document): number {
  let normalizedBlocks = 0;
  const showText = doc.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;

  doc.querySelectorAll('p, li').forEach((block) => {
    if (!hasMalformedEpubNonBreakingWhitespace(block.textContent || '')) {
      return;
    }
    const walker = doc.createTreeWalker(block, showText);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeValue?.includes('\u00a0')) {
        node.nodeValue = node.nodeValue.replaceAll('\u00a0', ' ');
      }
      node = walker.nextNode();
    }
    normalizedBlocks += 1;
  });

  return normalizedBlocks;
}
