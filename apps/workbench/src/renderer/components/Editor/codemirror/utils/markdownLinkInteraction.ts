export function shouldInterceptRenderedMarkdownLinkMouseDown(
  event: Pick<MouseEvent, 'button' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  target: Pick<Element, 'closest'> | null
): boolean {
  return event.button === 0
    && !hasModifierKey(event)
    && Boolean(target?.closest('.cm-md-link[data-md-link]'));
}

function hasModifierKey(
  event: Pick<MouseEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>
): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}
