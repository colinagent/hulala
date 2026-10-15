import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderBeautifulMermaidSvg } from '../../utils/beautifulMermaid';
import { AppWindowIcon, CloseIcon, CodeBlockIcon, MermaidIcon, PlusIcon } from '../Icons';
import { IconButton } from '../IconButton';

type MermaidRenderState = {
  source: string;
  svg?: string;
  error?: string;
};

const MERMAID_FENCE_LANGUAGES = new Set(['mermaid', 'mmd']);
const MIN_MERMAID_ZOOM = 0.5;
const MAX_MERMAID_ZOOM = 2.5;
const MERMAID_ZOOM_STEP = 0.25;

function codeLanguage(className: unknown): string | null {
  if (typeof className !== 'string') return null;
  return /(?:^|\s)language-([\w-]+)(?:\s|$)/i.exec(className)?.[1]?.toLowerCase() ?? null;
}

function codeText(children: ReactNode): string {
  return String(children ?? '').replace(/\n$/, '');
}

function BeautifulMermaidDiagram({ source, streaming }: { source: string; streaming: boolean }) {
  const [state, setState] = useState<MermaidRenderState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showSource, setShowSource] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogZoom, setDialogZoom] = useState(1);
  const [dialogShowSource, setDialogShowSource] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    window.requestAnimationFrame(() => dialogTriggerRef.current?.focus());
  }, []);

  const openDialog = (event: React.MouseEvent<HTMLButtonElement>) => {
    dialogTriggerRef.current = event.currentTarget;
    setDialogZoom(1);
    setDialogShowSource(false);
    setDialogOpen(true);
  };

  useEffect(() => {
    if (streaming || !source.trim()) {
      setState(null);
      return;
    }
    let active = true;
    void renderBeautifulMermaidSvg(source)
      .then((svg) => {
        if (active) setState({ source, svg });
      })
      .catch((reason) => {
        if (!active) return;
        const error = reason instanceof Error ? reason.message : String(reason);
        setState({ source, error });
      });
    return () => { active = false; };
  }, [source, streaming]);

  useEffect(() => {
    setZoom(1);
    setShowSource(false);
    setDialogOpen(false);
    setDialogZoom(1);
    setDialogShowSource(false);
  }, [source]);

  useEffect(() => {
    if (!dialogOpen) return;
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeDialog();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeDialog, dialogOpen]);

  // Keep an unfinished fence stable while the assistant is still streaming;
  // the finalized message swaps it for the rendered diagram.
  if (streaming) {
    return <pre className="hulala-activity-mermaid-source"><code className="language-mermaid">{source}</code></pre>;
  }
  if (state?.source !== source) {
    return <div className="hulala-activity-mermaid-state">Rendering diagram…</div>;
  }
  if (!state.svg) {
    return (
      <div className="hulala-activity-mermaid-error" role="status">
        <span>Unable to render Mermaid diagram{state.error ? `: ${state.error}` : '.'}</span>
        <pre className="hulala-activity-mermaid-source"><code className="language-mermaid">{source}</code></pre>
      </div>
    );
  }
  return (
    <>
      <div className={`hulala-activity-mermaid${showSource ? ' is-source' : ''}`}>
        <div className="hulala-activity-mermaid-toolbar" role="toolbar" aria-label="Mermaid diagram controls">
          <IconButton
            size={24}
            className="hulala-activity-mermaid-control"
            disabled={showSource || zoom <= MIN_MERMAID_ZOOM}
            onClick={() => setZoom((value) => Math.max(MIN_MERMAID_ZOOM, value - MERMAID_ZOOM_STEP))}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <span className="text-base leading-none">−</span>
          </IconButton>
          <button
            type="button"
            className="hulala-activity-mermaid-zoom-value"
            disabled={showSource}
            onClick={() => setZoom(1)}
            title="Reset zoom"
            aria-label="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <IconButton
            size={24}
            className="hulala-activity-mermaid-control"
            disabled={showSource || zoom >= MAX_MERMAID_ZOOM}
            onClick={() => setZoom((value) => Math.min(MAX_MERMAID_ZOOM, value + MERMAID_ZOOM_STEP))}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </IconButton>
          <span className="hulala-activity-mermaid-toolbar-divider" />
          <IconButton
            size={24}
            className={`hulala-activity-mermaid-control${showSource ? ' is-active' : ''}`}
            onClick={() => setShowSource((value) => !value)}
            title={showSource ? 'Show diagram' : 'View source'}
            aria-label={showSource ? 'Show diagram' : 'View Mermaid source'}
            aria-pressed={showSource}
          >
            {showSource
              ? <MermaidIcon className="h-3.5 w-3.5" />
              : <CodeBlockIcon className="h-3.5 w-3.5" />}
          </IconButton>
          <span className="hulala-activity-mermaid-toolbar-divider" />
          <IconButton
            size={24}
            className="hulala-activity-mermaid-control"
            onClick={openDialog}
            title="Open large view"
            aria-label="Open Mermaid diagram in large view"
            aria-haspopup="dialog"
          >
            <AppWindowIcon className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        {showSource ? (
          <pre className="hulala-activity-mermaid-source is-view"><code className="language-mermaid">{source}</code></pre>
        ) : (
          <div className="hulala-activity-mermaid-viewport">
            <button
              type="button"
              className="hulala-activity-mermaid-open"
              onClick={openDialog}
              title="Open large view"
              aria-label="Open Mermaid diagram in large view"
              aria-haspopup="dialog"
            >
              <span
                className="hulala-activity-mermaid-graphic"
                style={{ zoom } as React.CSSProperties}
                role="img"
                aria-label="Mermaid diagram"
                dangerouslySetInnerHTML={{ __html: state.svg }}
              />
            </button>
          </div>
        )}
      </div>
      {dialogOpen ? createPortal(
        <div className="hulala-mermaid-dialog-layer" role="presentation">
          <button type="button" className="hulala-mermaid-dialog-scrim" aria-label="Close Mermaid large view" onClick={closeDialog} />
          <div
            ref={dialogRef}
            className="hulala-mermaid-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Mermaid diagram large view"
            tabIndex={-1}
          >
            <header className="hulala-mermaid-dialog-header">
              <div className="hulala-mermaid-dialog-title">
                <MermaidIcon className="h-4 w-4" />
                <span>Mermaid diagram</span>
                <small>{dialogShowSource ? 'Source' : 'Scroll to explore the full diagram'}</small>
              </div>
              <div className="hulala-mermaid-dialog-toolbar" role="toolbar" aria-label="Large Mermaid diagram controls">
                <IconButton
                  size={28}
                  className="hulala-activity-mermaid-control"
                  disabled={dialogShowSource || dialogZoom <= MIN_MERMAID_ZOOM}
                  onClick={() => setDialogZoom((value) => Math.max(MIN_MERMAID_ZOOM, value - MERMAID_ZOOM_STEP))}
                  title="Zoom out"
                  aria-label="Zoom out"
                >
                  <span className="text-lg leading-none">−</span>
                </IconButton>
                <button
                  type="button"
                  className="hulala-mermaid-dialog-zoom-value"
                  disabled={dialogShowSource}
                  onClick={() => setDialogZoom(1)}
                  title="Reset zoom"
                  aria-label="Reset zoom"
                >
                  {Math.round(dialogZoom * 100)}%
                </button>
                <IconButton
                  size={28}
                  className="hulala-activity-mermaid-control"
                  disabled={dialogShowSource || dialogZoom >= MAX_MERMAID_ZOOM}
                  onClick={() => setDialogZoom((value) => Math.min(MAX_MERMAID_ZOOM, value + MERMAID_ZOOM_STEP))}
                  title="Zoom in"
                  aria-label="Zoom in"
                >
                  <PlusIcon className="h-4 w-4" />
                </IconButton>
                <span className="hulala-activity-mermaid-toolbar-divider" />
                <IconButton
                  size={28}
                  className={`hulala-activity-mermaid-control${dialogShowSource ? ' is-active' : ''}`}
                  onClick={() => setDialogShowSource((value) => !value)}
                  title={dialogShowSource ? 'Show diagram' : 'View source'}
                  aria-label={dialogShowSource ? 'Show diagram' : 'View Mermaid source'}
                  aria-pressed={dialogShowSource}
                >
                  {dialogShowSource
                    ? <MermaidIcon className="h-4 w-4" />
                    : <CodeBlockIcon className="h-4 w-4" />}
                </IconButton>
                <span className="hulala-activity-mermaid-toolbar-divider" />
                <IconButton size={28} className="hulala-activity-mermaid-control" onClick={closeDialog} title="Close" aria-label="Close Mermaid large view">
                  <CloseIcon className="h-4 w-4" />
                </IconButton>
              </div>
            </header>
            <div className="hulala-mermaid-dialog-body">
              {dialogShowSource ? (
                <pre className="hulala-activity-mermaid-source is-dialog"><code className="language-mermaid">{source}</code></pre>
              ) : (
                <div className="hulala-mermaid-dialog-viewport">
                  <div className="hulala-mermaid-dialog-canvas">
                    <div
                      className="hulala-mermaid-dialog-graphic"
                      style={{ zoom: dialogZoom } as React.CSSProperties}
                      role="img"
                      aria-label="Mermaid diagram"
                      dangerouslySetInnerHTML={{ __html: state.svg }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

export function ConversationMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const components = useMemo<Components>(() => ({
    pre({ node: _node, children, ...props }) {
      const child = React.Children.count(children) === 1
        ? React.Children.only(children)
        : null;
      if (React.isValidElement<{ className?: string; children?: ReactNode }>(child)) {
        const language = codeLanguage(child.props.className);
        if (language && MERMAID_FENCE_LANGUAGES.has(language)) {
          return <BeautifulMermaidDiagram source={codeText(child.props.children)} streaming={streaming} />;
        }
      }
      return <pre {...props}>{children}</pre>;
    },
  }), [streaming]);

  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>;
}
