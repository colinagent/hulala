type HorizontalScrollTarget = {
  scrollLeft: number;
  getBoundingClientRect: () => Pick<DOMRect, 'left' | 'right'>;
};

export function revealTabInsideStrip(
  strip: HorizontalScrollTarget,
  activeItem: Pick<HTMLElement, 'getBoundingClientRect'>,
): void {
  const stripRect = strip.getBoundingClientRect();
  const itemRect = activeItem.getBoundingClientRect();
  if (itemRect.left < stripRect.left) {
    strip.scrollLeft -= stripRect.left - itemRect.left;
  } else if (itemRect.right > stripRect.right) {
    strip.scrollLeft += itemRect.right - stripRect.right;
  }
}
