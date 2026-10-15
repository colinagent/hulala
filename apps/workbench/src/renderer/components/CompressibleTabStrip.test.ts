import assert from 'node:assert/strict';
import test from 'node:test';

import { revealTabInsideStrip } from './tabScroll.ts';

function rect(left: number, right: number): DOMRect {
  return { left, right } as DOMRect;
}

test('active tabs scroll only their strip and never require ancestor scrolling', () => {
  const strip = {
    scrollLeft: 100,
    getBoundingClientRect: () => rect(20, 320),
  };

  revealTabInsideStrip(strip, { getBoundingClientRect: () => rect(280, 370) });
  assert.equal(strip.scrollLeft, 150);

  revealTabInsideStrip(strip, { getBoundingClientRect: () => rect(-10, 80) });
  assert.equal(strip.scrollLeft, 120);

  revealTabInsideStrip(strip, { getBoundingClientRect: () => rect(80, 180) });
  assert.equal(strip.scrollLeft, 120);
});
