import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRenderUrlForPhysicalPath } from '../../services/resourceService';
import { writeClipboardImageFromElement, writeClipboardText } from '../../services/clipboardService';
import { useAppStore, useWorkspaceViewId } from '../../store/appStore';
import { useToastStore } from '../../store/toastStore';
import { CopyIcon, FileIcon, PlusIcon, RefreshIcon } from '../Icons';
import { IconButton } from '../IconButton';

type ImageEditorProps = {
  tabId?: string | null;
};

type ImageSize = {
  width: number;
  height: number;
};

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.25;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function formatImageSize(size: ImageSize | null) {
  if (!size) {
    return '';
  }
  return `${size.width}x${size.height}`;
}

function imageErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to load image';
}

export const ImageEditor: React.FC<ImageEditorProps> = ({ tabId = null }) => {
  const documents = useAppStore((state) => state.documents);
  const workspaceViewId = useWorkspaceViewId();
  const activeTabId = useAppStore((state) => state.activeTabId);
  const pushToast = useToastStore((state) => state.pushToast);
  const [renderUrl, setRenderUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fitToViewport, setFitToViewport] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [naturalSize, setNaturalSize] = useState<ImageSize | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const tab = useMemo(() => {
    const id = tabId || activeTabId || '';
    return documents.find((item) => item.id === id) || null;
  }, [activeTabId, documents, tabId]);

  const filePath = (tab?.filePath || '').trim();
  const resourceVersion = tab?.resourceVersion ?? 0;
  const missing = Boolean(tab?.missing);

  useEffect(() => {
    let cancelled = false;
    setNaturalSize(null);
    setRenderUrl('');
    setError(null);

    if (!filePath) {
      setLoading(false);
      setError('Image path is missing');
      return () => {
        cancelled = true;
      };
    }

    if (missing) {
      setLoading(false);
      setError('File was deleted on disk');
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    getRenderUrlForPhysicalPath(filePath, workspaceViewId)
      .then((url) => {
        if (cancelled) return;
        setRenderUrl(url);
        setError(null);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(imageErrorMessage(nextError));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, missing, refreshSeq, resourceVersion]);

  const zoomPercent = Math.round(zoom * 100);
  const sizeLabel = formatImageSize(naturalSize);

  const handleFit = useCallback(() => {
    setFitToViewport(true);
  }, []);

  const handleActualSize = useCallback(() => {
    setFitToViewport(false);
    setZoom(1);
  }, []);

  const handleZoomOut = useCallback(() => {
    setFitToViewport(false);
    setZoom((current) => clampZoom(current - ZOOM_STEP));
  }, []);

  const handleZoomIn = useCallback(() => {
    setFitToViewport(false);
    setZoom((current) => clampZoom(current + ZOOM_STEP));
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshSeq((current) => current + 1);
  }, []);

  const handleCopyImage = useCallback(async () => {
    if (!imageRef.current) {
      pushToast('Image is not loaded');
      return;
    }
    try {
      await writeClipboardImageFromElement(imageRef.current);
      pushToast('Image copied');
    } catch (nextError) {
      pushToast(imageErrorMessage(nextError));
    }
  }, [pushToast]);

  const handleCopyPath = useCallback(async () => {
    if (!filePath) {
      return;
    }
    try {
      await writeClipboardText(filePath);
      pushToast('Path copied');
    } catch (nextError) {
      pushToast(imageErrorMessage(nextError));
    }
  }, [filePath, pushToast]);

  const imageStyle = fitToViewport
    ? {
        maxWidth: '100%',
        maxHeight: '100%',
      }
    : {
        maxWidth: 'none',
        maxHeight: 'none',
        width: naturalSize ? `${Math.max(1, Math.round(naturalSize.width * zoom))}px` : `${zoomPercent}%`,
      };

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor-bg text-primary-text">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2 text-xs text-secondary-text">
        <div className="min-w-0 flex-1 truncate" title={filePath || tab?.title || 'Image'}>
          {filePath || tab?.title || 'Image'}
        </div>
        {sizeLabel ? <div className="hidden shrink-0 sm:block">{sizeLabel}</div> : null}
        <div className="shrink-0 tabular-nums">{fitToViewport ? 'Fit' : `${zoomPercent}%`}</div>
        <button
          type="button"
          className="h-6 shrink-0 rounded px-2 text-xs text-secondary-text hover:bg-hover-bg hover:text-prime-text"
          onClick={handleFit}
          title="Fit to view"
          aria-label="Fit to view"
        >
          Fit
        </button>
        <button
          type="button"
          className="h-6 shrink-0 rounded px-2 text-xs text-secondary-text hover:bg-hover-bg hover:text-prime-text"
          onClick={handleActualSize}
          title="Actual size"
          aria-label="Actual size"
        >
          100%
        </button>
        <IconButton
          size={26}
          className="text-secondary-text"
          onClick={handleZoomOut}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <span className="text-base leading-none">-</span>
        </IconButton>
        <IconButton
          size={26}
          className="text-secondary-text"
          onClick={handleZoomIn}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          size={26}
          className="text-secondary-text"
          onClick={handleRefresh}
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          size={26}
          className="text-secondary-text"
          onClick={() => void handleCopyImage()}
          disabled={!renderUrl}
          title="Copy image"
          aria-label="Copy image"
        >
          <CopyIcon className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          size={26}
          className="text-secondary-text"
          onClick={() => void handleCopyPath()}
          disabled={!filePath}
          title="Copy path"
          aria-label="Copy path"
        >
          <FileIcon className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto"
        style={{
          backgroundImage:
            'linear-gradient(45deg, color-mix(in srgb, var(--color-border) 26%, transparent) 25%, transparent 25%), linear-gradient(-45deg, color-mix(in srgb, var(--color-border) 26%, transparent) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--color-border) 26%, transparent) 75%), linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--color-border) 26%, transparent) 75%)',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
          backgroundSize: '16px 16px',
        }}
      >
        <div className="flex min-h-full min-w-full items-center justify-center p-6">
          {loading ? (
            <div className="text-sm text-secondary-text">Loading image...</div>
          ) : error ? (
            <div className="max-w-[520px] rounded border border-border bg-editor-bg px-3 py-2 text-sm text-secondary-text">
              {error}
            </div>
          ) : renderUrl ? (
            <img
              key={renderUrl}
              ref={imageRef}
              src={renderUrl}
              alt={tab?.title || filePath || 'Image'}
              draggable={false}
              className="block select-none"
              style={imageStyle}
              onLoad={(event) => {
                const image = event.currentTarget;
                setNaturalSize({
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                });
              }}
              onError={() => setError('Unable to render image')}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};
