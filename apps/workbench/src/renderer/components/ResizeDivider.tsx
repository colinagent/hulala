import React, { useEffect, useRef, useState } from 'react';

type ResizeDividerProps = {
  direction: 'vertical' | 'horizontal';
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  ariaLabel?: string;
  highlighted?: boolean;
  visible?: boolean;
  hitTargetEnabled?: boolean;
  activeColor?: string;
  restingColor?: string;
  hoverDelayMs?: number;
};

export function ResizeDivider({
  direction,
  onResizeStart,
  ariaLabel,
  highlighted = false,
  visible = true,
  hitTargetEnabled,
  activeColor,
  restingColor,
  hoverDelayMs = 0,
}: ResizeDividerProps) {
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const isVertical = direction === 'vertical';
  const isVisible = dragging || visible;
  const isHitTargetEnabled = hitTargetEnabled ?? isVisible;
  const isActive = dragging || highlighted;

  const clearHoverTimer = () => {
    if (hoverTimerRef.current == null) {
      return;
    }
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  };

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const body = document.body;
    const cursorClass = isVertical ? 'op-global-cursor-col-resize' : 'op-global-cursor-row-resize';
    body.classList.add('select-none', cursorClass);

    const clearDragging = () => setDragging(false);
    window.addEventListener('pointerup', clearDragging);
    window.addEventListener('pointercancel', clearDragging);
    return () => {
      body.classList.remove('select-none', cursorClass);
      window.removeEventListener('pointerup', clearDragging);
      window.removeEventListener('pointercancel', clearDragging);
    };
  }, [dragging, isVertical]);

  useEffect(() => () => {
    clearHoverTimer();
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    clearHoverTimer();
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onResizeStart(event);
  };

  const useCustomColor = Boolean(activeColor);
  const showCustomColor = useCustomColor && (isActive || hovered);
  const lineStyle = showCustomColor
    ? { backgroundColor: activeColor }
    : restingColor
      ? { backgroundColor: restingColor }
      : undefined;
  const useDefaultBorderClass = !restingColor && !useCustomColor;
  const useIdleBorderClass = useCustomColor && !showCustomColor && !restingColor;

  return (
    <div
      className={`group relative overflow-visible no-drag ${
        isVertical ? 'z-[10] w-px shrink-0 self-stretch' : 'z-[10] h-px w-full shrink-0'
      }`}
      role="separator"
      aria-orientation={isVertical ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel || (isVertical ? 'Resize sidebar' : 'Resize composer dock')}
      data-dragging={dragging ? 'true' : 'false'}
    >
      <div
        className={`absolute transition-[color,opacity,box-shadow,filter] duration-150 ${
          useDefaultBorderClass ? `bg-border ${isActive ? 'bg-accent' : 'group-hover:bg-accent'}` : ''
        } ${useIdleBorderClass ? 'bg-border' : ''} ${
          isVertical
            ? `inset-y-0 left-0 w-px ${isVisible ? 'opacity-100' : 'opacity-0'}`
            : `inset-x-0 top-0 h-px ${isVisible ? 'opacity-100' : 'opacity-0'}`
        }`}
        style={lineStyle}
      />
      <div
        className={`absolute ${
          isVertical
            ? 'inset-y-0 left-[-3px] z-[1] w-[7px]'
            : 'inset-x-0 top-[-3px] z-[1] h-[7px]'
        } ${isHitTargetEnabled ? 'pointer-events-auto' : 'pointer-events-none'}`}
        style={{ cursor: isVertical ? 'col-resize' : 'row-resize' }}
        onPointerDown={handlePointerDown}
        onPointerEnter={() => {
          clearHoverTimer();
          if (hoverDelayMs <= 0) {
            setHovered(true);
            return;
          }
          hoverTimerRef.current = window.setTimeout(() => {
            hoverTimerRef.current = null;
            setHovered(true);
          }, hoverDelayMs);
        }}
        onPointerLeave={() => {
          clearHoverTimer();
          setHovered(false);
        }}
      />
    </div>
  );
}
