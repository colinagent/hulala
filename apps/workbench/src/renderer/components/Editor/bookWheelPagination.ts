export type BookWheelMotion = {
  axis: 'horizontal' | 'vertical';
  delta: number;
};

const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

function normalizedWheelDelta(delta: number, deltaMode: number): number {
  switch (deltaMode) {
    case DOM_DELTA_LINE:
      return delta * 16;
    case DOM_DELTA_PAGE:
      return delta * 800;
    case DOM_DELTA_PIXEL:
    default:
      return delta;
  }
}

/**
 * Resolve a wheel/trackpad event to its dominant pagination direction.
 * Equal diagonal movement is ignored until the gesture has a clear axis.
 */
export function resolveBookWheelMotion(
  event: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>,
): BookWheelMotion | null {
  const deltaX = normalizedWheelDelta(event.deltaX, event.deltaMode);
  const deltaY = normalizedWheelDelta(event.deltaY, event.deltaMode);
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    return null;
  }

  const horizontalMagnitude = Math.abs(deltaX);
  const verticalMagnitude = Math.abs(deltaY);
  if (Math.max(horizontalMagnitude, verticalMagnitude) < 1 || horizontalMagnitude === verticalMagnitude) {
    return null;
  }

  return horizontalMagnitude > verticalMagnitude
    ? { axis: 'horizontal', delta: deltaX }
    : { axis: 'vertical', delta: deltaY };
}
