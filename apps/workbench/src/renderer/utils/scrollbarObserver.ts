const hideTimers = new WeakMap<Element, number>();

function showScrollbar(el: Element) {
  el.classList.add('is-scrolling');
  const prev = hideTimers.get(el);
  if (prev) clearTimeout(prev);
  hideTimers.set(
    el,
    window.setTimeout(() => {
      el.classList.remove('is-scrolling');
      hideTimers.delete(el);
    }, 1500)
  );
}

document.addEventListener(
  'scroll',
  (e) => {
    const el = e.target;
    if (!(el instanceof Element)) return;
    showScrollbar(el);
  },
  { capture: true, passive: true }
);
