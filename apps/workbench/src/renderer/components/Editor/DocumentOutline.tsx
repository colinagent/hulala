import React, { useEffect, useMemo, useState } from 'react';
import type { Text } from '@codemirror/state';
import { SidebarPanelToggleIcon } from '../Icons';
import type { MarkdownEditorInstance } from './codemirror/setup';
import {
  buildOutlineTreeEntries,
  getLinesFromContent,
  parseOutlineEntries,
  type OutlineEntry,
  type ParsedLine,
} from './markdownStructure';
import { OutlineTree } from './outline/OutlineTree';
import { getAncestorAutoExpandedIds } from './outline/outlineExpand';
import { markdownEntriesToOutlineNodes, type MarkdownOutlineNode } from './outline/markdownOutline';
import { DocumentOutlineToggle } from './DocumentOutlineToggle';

type DocumentOutlineProps = {
  content: string;
  editorRef: React.RefObject<MarkdownEditorInstance | null>;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onEntriesChange?: (hasEntries: boolean) => void;
  pinEnabled?: boolean;
  pinned?: boolean;
  onPinToggle?: () => void;
  outlineToggleEnabled?: boolean;
  onNavigate?: () => void;
};

function getLinesFromDoc(doc: Text): ParsedLine[] {
  const lines: ParsedLine[] = [];
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    lines.push({
      number,
      from: line.from,
      text: line.text,
    });
  }
  return lines;
}

function findActiveIndex(entries: OutlineEntry[], pos: number): number {
  if (entries.length === 0) {
    return -1;
  }
  let low = 0;
  let high = entries.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (entries[mid].spyPos <= pos) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

export const DocumentOutline: React.FC<DocumentOutlineProps> = ({
  content,
  editorRef,
  expanded,
  onExpandedChange,
  onEntriesChange,
  pinEnabled = false,
  pinned = false,
  onPinToggle,
  outlineToggleEnabled = true,
  onNavigate,
}) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewReadySeq, setViewReadySeq] = useState(0);

  useEffect(() => {
    let rafId = 0;
    const waitForView = () => {
      if (editorRef.current?.getView()) {
        setViewReadySeq((prev) => prev + 1);
        return;
      }
      rafId = window.requestAnimationFrame(waitForView);
    };
    waitForView();
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [editorRef, content]);

  const entries = useMemo(() => {
    const view = editorRef.current?.getView();
    if (view) {
      return parseOutlineEntries(getLinesFromDoc(view.state.doc));
    }
    return parseOutlineEntries(getLinesFromContent(content));
  }, [content, editorRef, viewReadySeq]);

  const treeEntries = useMemo(() => buildOutlineTreeEntries(entries), [entries]);
  const nodes = useMemo(() => markdownEntriesToOutlineNodes(treeEntries), [treeEntries]);
  // Single typed map serves both ancestor auto-expand (OutlineNode-typed) and
  // navigate lookups (MarkdownOutlineNode-typed, needs pos).
  const nodeById = useMemo(() => {
    const map = new Map<string, MarkdownOutlineNode>();
    for (const node of nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [nodes]);
  const autoExpandedIds = useMemo(
    () => getAncestorAutoExpandedIds(activeId, nodeById),
    [activeId, nodeById],
  );

  useEffect(() => {
    onEntriesChange?.(nodes.length > 0);
  }, [nodes.length, onEntriesChange]);

  useEffect(() => {
    if (nodes.length === 0) {
      setActiveId(null);
      return;
    }
    setActiveId((prev) => {
      if (prev && nodeById.has(prev)) {
        return prev;
      }
      return nodes[0].id;
    });
  }, [nodeById, nodes]);

  useEffect(() => {
    const view = editorRef.current?.getView();
    if (!view || treeEntries.length === 0) {
      return;
    }

    let rafId = 0;
    const syncActiveEntry = () => {
      rafId = 0;
      const visibleFrom = view.viewportLineBlocks[0]?.from ?? view.viewport.from;
      const nextIndex = findActiveIndex(treeEntries, visibleFrom);
      const nextActiveId = treeEntries[nextIndex]?.id ?? treeEntries[0]?.id ?? null;
      setActiveId((prev) => (prev === nextActiveId ? prev : nextActiveId));
    };

    const onScroll = () => {
      if (rafId) {
        return;
      }
      rafId = window.requestAnimationFrame(syncActiveEntry);
    };

    syncActiveEntry();
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      view.scrollDOM.removeEventListener('scroll', onScroll);
    };
  }, [editorRef, treeEntries]);

  const hasEntries = nodes.length > 0;
  const showToggleWrap = (!expanded && pinEnabled) || (hasEntries && outlineToggleEnabled);

  if (!hasEntries && !pinEnabled) {
    return null;
  }

  return (
    <div className={`op-md-outline ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
      {showToggleWrap ? (
        <div className="op-document-outline-toggle-wrap">
          {hasEntries && outlineToggleEnabled && (
            <DocumentOutlineToggle
              expanded={expanded}
              onToggle={() => onExpandedChange(!expanded)}
            />
          )}
          {!expanded && pinEnabled && (
            <button
              type="button"
              className={`op-md-outline-pin icon-gutter-btn-sm icon-button-inline ${pinned ? 'is-pinned' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                onPinToggle?.();
              }}
              title="Move to right workspace"
              aria-label="Move to right workspace"
              aria-pressed={pinned}
            >
              <SidebarPanelToggleIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : null}
      {expanded && hasEntries ? (
        <OutlineTree
          nodes={nodes}
          activeId={activeId}
          autoExpandedIds={autoExpandedIds}
          onNavigate={(node) => {
            const editor = editorRef.current;
            const markdownNode = nodeById.get(node.id);
            if (!markdownNode || !editor?.scrollToPos(markdownNode.pos)) {
              return;
            }
            setActiveId((prev) => (prev === node.id ? prev : node.id));
            onNavigate?.();
          }}
        />
      ) : null}
    </div>
  );
};
