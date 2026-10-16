import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { OutlineNode } from './outlineTypes';
import {
  areSetsEqual,
  filterVisibleOutlineNodes,
  normalizeExpandedIds,
  resolveExpandedIds,
} from './outlineExpand';

export type OutlineTreeProps = {
  nodes: OutlineNode[];
  activeId?: string | null;
  autoExpandedIds?: Set<string>;
  onNavigate: (node: OutlineNode) => void;
  emptyLabel?: string;
  className?: string;
  listClassName?: string;
  scrollActiveIntoView?: boolean;
};

export const OutlineTree: React.FC<OutlineTreeProps> = ({
  nodes,
  activeId = null,
  autoExpandedIds,
  onNavigate,
  emptyLabel = 'No contents',
  className = '',
  listClassName = 'op-outline-list',
  scrollActiveIntoView = true,
}) => {
  const [manualExpandedIds, setManualExpandedIds] = useState<Set<string>>(() => new Set());
  const [manualCollapsedIds, setManualCollapsedIds] = useState<Set<string>>(() => new Set());
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const resolvedAutoExpandedIds = useMemo(
    () => normalizeExpandedIds(nodes, autoExpandedIds ?? new Set()),
    [autoExpandedIds, nodes],
  );

  const expandedIds = useMemo(
    () => resolveExpandedIds(resolvedAutoExpandedIds, manualExpandedIds, manualCollapsedIds),
    [manualCollapsedIds, manualExpandedIds, resolvedAutoExpandedIds],
  );

  const visibleNodes = useMemo(
    () => filterVisibleOutlineNodes(nodes, expandedIds),
    [expandedIds, nodes],
  );

  const activeVisibleIndex = useMemo(
    () => visibleNodes.findIndex((node) => node.id === activeId),
    [activeId, visibleNodes],
  );

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, visibleNodes.length);
  }, [visibleNodes.length]);

  useEffect(() => {
    setManualExpandedIds((prev) => {
      const next = normalizeExpandedIds(nodes, prev);
      return areSetsEqual(prev, next) ? prev : next;
    });
    setManualCollapsedIds((prev) => {
      const next = normalizeExpandedIds(nodes, prev);
      return areSetsEqual(prev, next) ? prev : next;
    });
  }, [nodes]);

  useEffect(() => {
    if (!scrollActiveIntoView || activeVisibleIndex < 0) {
      return;
    }
    itemRefs.current[activeVisibleIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeVisibleIndex, scrollActiveIntoView]);

  if (nodes.length === 0) {
    return (
      <div className={`op-outline ${className}`.trim()}>
        <div className="op-outline-empty">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div className={`op-outline ${className}`.trim()}>
      <div className={listClassName}>
        {visibleNodes.map((node, index) => {
          const isActive = node.id === activeId;
          const isBranch = node.hasChildren;
          const isEntryExpanded = isBranch && expandedIds.has(node.id);
          const paddingLeft = 10 + node.depth * 12;

          const toggleEntry = () => {
            if (!isBranch) {
              return;
            }
            if (isEntryExpanded) {
              setManualExpandedIds((prev) => {
                if (!prev.has(node.id)) {
                  return prev;
                }
                const next = new Set(prev);
                next.delete(node.id);
                return next;
              });
              setManualCollapsedIds((prev) => {
                if (prev.has(node.id)) {
                  return prev;
                }
                const next = new Set(prev);
                next.add(node.id);
                return next;
              });
              return;
            }
            setManualCollapsedIds((prev) => {
              if (!prev.has(node.id)) {
                return prev;
              }
              const next = new Set(prev);
              next.delete(node.id);
              return next;
            });
            setManualExpandedIds((prev) => {
              if (prev.has(node.id)) {
                return prev;
              }
              const next = new Set(prev);
              next.add(node.id);
              return next;
            });
          };

          return (
            <div
              key={node.id}
              className={`op-outline-item-row ${isActive ? 'is-active' : ''} ${isBranch ? 'is-branch' : 'is-leaf'} ${isEntryExpanded ? 'is-expanded' : ''}`}
              style={{ paddingLeft }}
            >
              <button
                type="button"
                className={`op-outline-item-chevron ${isBranch ? 'is-branch' : 'is-leaf'} ${isEntryExpanded ? 'is-expanded' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleEntry();
                }}
                aria-label={isBranch
                  ? (isEntryExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`)
                  : undefined}
                aria-expanded={isBranch ? isEntryExpanded : undefined}
                disabled={!isBranch}
              >
                {isBranch ? (
                  <svg
                    className="op-outline-item-chevron-icon"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M5.5 3.75L10 8L5.5 12.25"
                      stroke="currentColor"
                      strokeWidth="2.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </button>
              <button
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                className={`op-outline-item ${isActive ? 'is-active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  if (isBranch && !isEntryExpanded) {
                    toggleEntry();
                  }
                  onNavigate(node);
                }}
                title={node.label}
              >
                <span className="op-outline-item-text">{node.label}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
