import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_DOCUMENT_OUTLINE_WIDTH,
  clampDocumentOutlineWidthForContainer,
  normalizeDocumentOutlineWidth,
} from '../../../shared/documentOutlineWidth';
import { ResizeDivider } from '../ResizeDivider';
import { DocumentOutlineToggle } from './DocumentOutlineToggle';

type OutlineUiSettingsSnapshot = {
  ui?: {
    documentOutlineWidth?: unknown;
    markdownOutlineWidth?: unknown;
  };
};

type ResizableOutlinePanelProps = {
  containerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  resizeAriaLabel: string;
};

export const ResizableOutlinePanel: React.FC<ResizableOutlinePanelProps> = ({
  containerRef,
  open,
  onOpenChange,
  children,
  resizeAriaLabel,
}) => {
  const resizeRef = useRef<{
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);
  const [width, setWidth] = useState(DEFAULT_DOCUMENT_OUTLINE_WIDTH);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  const clampForContainer = useCallback((nextWidth: number) => {
    return clampDocumentOutlineWidthForContainer(
      nextWidth,
      containerRef.current?.clientWidth ?? null,
    );
  }, [containerRef]);

  useEffect(() => {
    const settingsApi = window.hulala?.settings;
    if (!settingsApi?.get) {
      return;
    }

    let disposed = false;
    const applySetting = (settings?: OutlineUiSettingsSnapshot) => {
      if (disposed || resizeRef.current) {
        return;
      }
      const nextWidth = clampForContainer(
        normalizeDocumentOutlineWidth(
          settings?.ui?.documentOutlineWidth ?? settings?.ui?.markdownOutlineWidth,
        ),
      );
      setWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    settingsApi.get()
      .then((settings) => applySetting(settings as OutlineUiSettingsSnapshot))
      .catch(() => {
        // Keep the in-memory default when settings cannot be loaded.
      });
    const disposeSettingsChanged = settingsApi.onChanged?.((settings) => {
      applySetting(settings as OutlineUiSettingsSnapshot);
    });
    return () => {
      disposed = true;
      disposeSettingsChanged?.();
    };
  }, [clampForContainer]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      if (resizeRef.current) {
        return;
      }
      const containerWidth = entries[0]?.contentRect.width ?? container.clientWidth;
      setWidth((current) => {
        const next = clampDocumentOutlineWidthForContainer(current, containerWidth);
        return next === current ? current : next;
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!open || resizeRef.current) {
      return;
    }
    resizeRef.current = {
      startX: event.clientX,
      startWidth: width,
      currentWidth: width,
    };
    setDragging(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = resizeRef.current;
      if (!drag) {
        return;
      }
      const deltaX = moveEvent.clientX - drag.startX;
      const nextWidth = clampForContainer(drag.startWidth - deltaX);
      drag.currentWidth = nextWidth;
      setWidth(nextWidth);
    };

    const cleanup = () => {
      const drag = resizeRef.current;
      resizeRef.current = null;
      setDragging(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      if (!drag) {
        return;
      }
      const finalWidth = clampForContainer(drag.currentWidth);
      if (finalWidth === drag.startWidth) {
        return;
      }
      void window.hulala?.settings?.set?.({
        ui: { documentOutlineWidth: finalWidth },
      })?.catch((error) => {
        console.warn('[documentOutlineWidth] failed to persist:', error);
      });
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  }, [clampForContainer, open, width]);

  if (!open) {
    return null;
  }

  return (
    <aside
      className="op-document-outline-layout-panel"
      style={{ width: `${width}px` }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <ResizeDivider
        direction="vertical"
        onResizeStart={handleResizeStart}
        ariaLabel={resizeAriaLabel}
        highlighted={dragging}
        visible={hovered || dragging}
        activeColor="var(--color-brand)"
      />
      <div className="op-document-outline-shell is-expanded">
        <div className="op-document-outline-panel">
          <div className="op-document-outline-toggle-wrap">
            <DocumentOutlineToggle
              expanded={true}
              onToggle={() => onOpenChange(false)}
            />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
      </div>
    </aside>
  );
};
