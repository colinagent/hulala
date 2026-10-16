import React, { useLayoutEffect, useRef } from 'react';
import { revealTabInsideStrip } from './tabScroll';

type CompressibleTabStripProps = {
  activeItemKey: string | null | undefined;
  children: React.ReactNode;
  action: React.ReactNode;
  className?: string;
  stripClassName?: string;
  tabContainerClassName?: string;
  actionClassName?: string;
};

/**
 * Chrome-style tab layout: tabs keep their preferred width until space is
 * constrained, then shrink to their per-item minimum and finally scroll. The
 * trailing action stays outside the scroll viewport and keeps a 12px right
 * safe area.
 */
export const CompressibleTabStrip: React.FC<CompressibleTabStripProps> = ({
  activeItemKey,
  children,
  action,
  className = '',
  stripClassName = '',
  tabContainerClassName = '',
  actionClassName = '',
}) => {
  const stripRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const activeItem = strip?.querySelector<HTMLElement>(
      '[data-tab-strip-active="true"]',
    );
    if (strip && activeItem) {
      revealTabInsideStrip(strip, activeItem);
    }
  }, [activeItemKey]);

  return (
    <div className={`flex h-full w-full min-w-0 items-center ${className}`.trim()}>
      <div className={`flex min-w-0 max-w-full items-center pr-3 ${tabContainerClassName}`.trim()}>
        <div
          ref={stripRef}
          className={`op-compressible-tab-strip flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden ${stripClassName}`.trim()}
        >
          {children}
        </div>
        <div className={`relative ml-1 flex shrink-0 no-drag ${actionClassName}`.trim()}>
          {action}
        </div>
      </div>
      <div className="min-w-0 flex-1" aria-hidden="true" />
    </div>
  );
};
