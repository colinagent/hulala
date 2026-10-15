/**
 * Live Preview Plugin for CodeMirror 6
 * Renders markdown inline while hiding syntax in unfocused areas
 * Reference: VS Code markdownEditor/browser/codemirror/livePreviewPlugin.ts
 */

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';
import { EditorState, Range, type SelectionRange } from '@codemirror/state';
import {
  getVisibleDocBounds,
  resolveLivePreviewReplacePolicy,
} from './livePreviewParsePolicy';
import { useUiStore } from '../../../store/uiStore';
import { useToastStore } from '../../../store/toastStore';
import { isImagePath, normalizePosixPath, resolveMarkdownPath } from '../../../utils/markdownMedia';
import { parseThreadLinkTarget } from '../../../utils/threadLink';
import { getMarkdownDocumentPath } from './documentPathState';
import { getWorkspaceStateForEditor } from './workspaceStoreState';
import { parseDrawingEmbed } from '../excalidraw/drawingDocument';
import {
  openImageSourceEffect,
} from './imageSourceState';
import {
  refreshLivePreviewDecorationsEffect,
  refreshLivePreviewViewportDecorationsEffect,
} from './livePreviewDecorationEffects';
import {
  getFrontmatterInfo,
  type FrontmatterInfo,
} from './utils/frontmatter';
import {
  collectListContinuationLineInfo,
  getListDepth,
  parseListLinePrefix,
  type ListContinuationLineInfo,
  type ParsedListLine,
} from './utils/listPrefix';
import { findCjkAsteriskEmphasisRanges } from './utils/cjkAsteriskEmphasis';
import { findMarkdownHighlightRanges } from './utils/markdownHighlight';
import { findMarkdownTagRanges } from './utils/markdownTag';
import { parseInlineMarkdownLinkSource } from './utils/markdownLinkSource';
import { isSelectionOverlappingRange } from './utils/selectionOverlap';
import { CM_MD_INLINE_CODE } from './markdownInlinePill';
import { tagPillTone } from '../../../utils/tagPill';
import { LRUCache } from './utils/lru';
import { shouldInterceptRenderedMarkdownLinkMouseDown } from './utils/markdownLinkInteraction';
import {
  CalloutWidget,
  TaskCheckboxWidget,
  WikilinkWidget,
} from './widgets';

const CSS = {
  heading: 'cm-md-heading',
  headingLine: 'cm-md-heading-line',
  afterHeading: 'cm-md-after-heading',
  heading1: 'cm-md-heading-1',
  heading2: 'cm-md-heading-2',
  heading3: 'cm-md-heading-3',
  heading4: 'cm-md-heading-4',
  heading5: 'cm-md-heading-5',
  heading6: 'cm-md-heading-6',
  /** 聚焦时显示的标题 marker（#），字号跟随标题，颜色走统一的源码显现语义 */
  headingMarker1: 'cm-md-heading-marker-1 cm-md-syntax-visible',
  headingMarker2: 'cm-md-heading-marker-2 cm-md-syntax-visible',
  headingMarker3: 'cm-md-heading-marker-3 cm-md-syntax-visible',
  headingMarker4: 'cm-md-heading-marker-4 cm-md-syntax-visible',
  headingMarker5: 'cm-md-heading-marker-5 cm-md-syntax-visible',
  headingMarker6: 'cm-md-heading-marker-6 cm-md-syntax-visible',
  emphasis: 'cm-md-emphasis',
  strong: 'cm-md-strong',
  highlight: 'cm-md-highlight',
  strikethrough: 'cm-md-strikethrough',
  code: `cm-md-code ${CM_MD_INLINE_CODE}`,
  codeEditing: 'cm-md-code',
  link: 'cm-md-link',
  linkSourceLabel: 'cm-md-link-source-label',
  linkSourceTarget: 'cm-md-link-source-target',
  blockquote: 'cm-md-blockquote',
  blockquoteMarkerHidden: 'cm-md-blockquote-marker-hidden',
  blockquoteMarkerVisible: 'cm-md-blockquote-marker-visible',
  listLine: 'cm-md-list-line',
  listLineOrdered: 'cm-md-list-line-ordered',
  listMarkerSource: 'cm-md-list-marker-source',
  listMarkerSourceActive: 'cm-md-list-marker-source-active',
  callout: 'cm-md-callout',
  calloutTitle: 'cm-md-callout-title',
  calloutType: 'cm-md-callout-type',
  taskLine: 'cm-md-task-line',
  taskLineChecked: 'cm-md-task-line-checked',
  taskCheckedText: 'cm-md-task-checked-text',
  /** 水平线 ---：行容器；仅非聚焦时加 -rendered 并隐藏源码、显示横线 */
  horizontalRule: 'cm-md-horizontal-rule',
  horizontalRuleRendered: 'cm-md-horizontal-rule-rendered',
};

const marks = {
  heading1: Decoration.mark({ class: `${CSS.heading} ${CSS.heading1}` }),
  heading2: Decoration.mark({ class: `${CSS.heading} ${CSS.heading2}` }),
  heading3: Decoration.mark({ class: `${CSS.heading} ${CSS.heading3}` }),
  heading4: Decoration.mark({ class: `${CSS.heading} ${CSS.heading4}` }),
  heading5: Decoration.mark({ class: `${CSS.heading} ${CSS.heading5}` }),
  heading6: Decoration.mark({ class: `${CSS.heading} ${CSS.heading6}` }),
  headingMarker1: Decoration.mark({ class: CSS.headingMarker1 }),
  headingMarker2: Decoration.mark({ class: CSS.headingMarker2 }),
  headingMarker3: Decoration.mark({ class: CSS.headingMarker3 }),
  headingMarker4: Decoration.mark({ class: CSS.headingMarker4 }),
  headingMarker5: Decoration.mark({ class: CSS.headingMarker5 }),
  headingMarker6: Decoration.mark({ class: CSS.headingMarker6 }),
  emphasis: Decoration.mark({ class: CSS.emphasis }),
  strong: Decoration.mark({ class: CSS.strong }),
  highlight: Decoration.mark({ class: CSS.highlight }),
  strikethrough: Decoration.mark({ class: CSS.strikethrough }),
  code: Decoration.mark({ class: CSS.code }),
  codeEditing: Decoration.mark({ class: CSS.codeEditing }),
  linkSourceLabel: Decoration.mark({ class: CSS.linkSourceLabel }),
  linkSourceTarget: Decoration.mark({ class: CSS.linkSourceTarget }),
  syntaxVisible: Decoration.mark({ class: 'cm-md-syntax-visible' }),
  // Hide markdown formatting tokens with replace decorations so CodeMirror keeps
  // coordinate mapping consistent without relying on CSS `display: none`.
  syntaxHidden: Decoration.replace({}),
  // Blockquote marker: use mark (transparent) instead of replace to preserve space and avoid jitter.
  blockquoteMarkerHidden: Decoration.mark({ class: CSS.blockquoteMarkerHidden }),
  blockquoteMarkerVisible: Decoration.mark({ class: CSS.blockquoteMarkerVisible }),
};

type HeadingMarkerInfo = {
  hashesTo: number;
  contentFrom: number;
};

const widgetCache = new LRUCache<WidgetType>(300);

function getCachedWidget<T extends WidgetType>(key: string, build: () => T): T {
  return widgetCache.getOrCreate(key, build) as T;
}

export function getListMarkerSourceClassName(active: boolean): string {
  return active
    ? `${CSS.listMarkerSource} ${CSS.listMarkerSourceActive} cm-md-syntax-visible`
    : CSS.listMarkerSource;
}

type LivePreviewPluginOptions = {
  exportMode?: boolean;
};

/**
 * Unordered list bullets by depth: solid circle (0), hollow circle (1),
 * solid square (2), then repeat.
 */
const UNORDERED_BULLETS = ['•', '◦', '▪'] as const;

export type ImageActivation = {
  from: number;
  to: number;
  widthPercent: number | null;
  x: number;
  y: number;
  imageElement?: HTMLImageElement | null;
};

function getFocusRange(view: EditorView, focusLines: number = 0): { from: number; to: number } | null {
  if (!view.hasFocus) {
    return null;
  }

  const selection = view.state.selection.main;
  if (!selection) {
    return null;
  }

  const cursorLine = view.state.doc.lineAt(selection.head);
  const startLine = Math.max(1, cursorLine.number - focusLines);
  const endLine = Math.min(view.state.doc.lines, cursorLine.number + focusLines);

  return {
    from: view.state.doc.line(startLine).from,
    to: view.state.doc.line(endLine).to,
  };
}

function isInFocusRange(
  from: number,
  to: number,
  focusRange: { from: number; to: number } | null
): boolean {
  if (!focusRange) {
    return false;
  }
  return from <= focusRange.to && to >= focusRange.from;
}

function hasAncestor(node: SyntaxNodeRef, ancestorName: string): boolean {
  let parent: SyntaxNode | null = node.node.parent;
  while (parent) {
    if (parent.name === ancestorName) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

function getListLineClass(parsed: ParsedListLine): string {
  const depthClass = `cm-md-list-depth-${getListDepth(parsed)}`;
  return parsed.isOrdered
    ? `${CSS.listLine} ${CSS.listLineOrdered} ${depthClass}`
    : `${CSS.listLine} ${depthClass}`;
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

function decorateHeadingLines(
  view: EditorView,
  headingFrom: number,
  level: HeadingLevel,
  decorations: Range<Decoration>[],
): void {
  const line = view.state.doc.lineAt(headingFrom);
  decorations.push(
    Decoration.line({
      class: `${CSS.headingLine} ${CSS.headingLine}-${level}`,
    }).range(line.from),
  );

  if (line.number >= view.state.doc.lines) {
    return;
  }

  const nextLine = view.state.doc.line(line.number + 1);
  decorations.push(
    Decoration.line({
      class: `${CSS.afterHeading} ${CSS.afterHeading}-${level}`,
    }).range(nextLine.from),
  );
}

const PARSE_BUDGET_MS = 100;

type LivePreviewDecoContext = {
  allowReplaceDecorations: boolean;
};

function getVisibleDocBoundsFromView(view: EditorView): { from: number; to: number } {
  return getVisibleDocBounds(view.visibleRanges, view.state.doc.length);
}

function isLineInsideCodeBlock(state: EditorState, lineFrom: number): boolean {
  ensureSyntaxTree(state, lineFrom + 1, PARSE_BUDGET_MS);
  let node: SyntaxNode | null = syntaxTree(state).resolve(lineFrom, 1);
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
      return true;
    }
    node = node.parent;
  }
  return false;
}

function buildDecorations(view: EditorView): DecorationSet {
  const { to: visibleTo } = getVisibleDocBoundsFromView(view);
  const allowReplaceDecorations = resolveLivePreviewReplacePolicy(view.state, visibleTo);
  const decoContext: LivePreviewDecoContext = { allowReplaceDecorations };

  const decorations: Range<Decoration>[] = [];
  const focusRange = getFocusRange(view);
  const fm = getFrontmatterInfo(view.state);

  for (const range of view.visibleRanges) {
    addSyntaxDecorations(view, range.from, range.to, focusRange, decorations, fm, decoContext);
  }

  for (const range of view.visibleRanges) {
    addInlineDecorations(view, range.from, range.to, focusRange, decorations, fm, decoContext);
  }

  // Sort decorations by position
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);

  return Decoration.set(decorations, true);
}

function addSyntaxDecorations(
  view: EditorView,
  from: number,
  to: number,
  focusRange: { from: number; to: number } | null,
  decorations: Range<Decoration>[],
  frontmatter: FrontmatterInfo | null,
  decoContext: LivePreviewDecoContext
): void {
  const selection = view.state.selection.main;
  syntaxTree(view.state).iterate({
    from,
    to,
    enter: (node) => {
      const nodeFrom = node.from;
      const nodeTo = node.to;
      if (frontmatter && nodeFrom >= frontmatter.from && nodeTo <= frontmatter.to) {
        return;
      }
      const inFocus = isInFocusRange(nodeFrom, nodeTo, focusRange);
      const isHeading =
        node.name === 'ATXHeading1' ||
        node.name === 'ATXHeading2' ||
        node.name === 'ATXHeading3' ||
        node.name === 'ATXHeading4' ||
        node.name === 'ATXHeading5' ||
        node.name === 'ATXHeading6';
      const isListItemHeading = isHeading && hasAncestor(node, 'ListItem');
      // Lezer treats a bare ATX marker ("#", "##", or "# ") as an empty
      // heading. Keep those in the editor's normal text geometry while the
      // user is still deciding between a heading and an inline tag. Heading
      // preview starts only after the required whitespace and real content
      // are both present.
      const shouldDecorateHeading = isHeading
        && !isListItemHeading
        && getHeadingMarkerInfo(view, nodeFrom, nodeTo) !== null;
      const isHorizontalRule =
        node.name === 'HorizontalRule' || node.name === 'ThematicBreak';
      const isLink = node.name === 'Link';
      const isBlockquote = node.name === 'Blockquote';
      const isInlineStyle =
        node.name === 'StrongEmphasis' ||
        node.name === 'Emphasis' ||
        node.name === 'Strikethrough' ||
        node.name === 'InlineCode';
      const usesInlineSelectionReveal = isInlineStyle || isLink;
      const inlineFocused = usesInlineSelectionReveal
        ? isSelectionOverlappingRange(selection, nodeFrom, nodeTo)
        : false;

      // Skip if in focus range (show raw source). Headings、水平线与加粗/斜体等始终装饰
      if (inFocus && !shouldDecorateHeading && !isHorizontalRule && !isInlineStyle && !isLink && !isBlockquote) {
        return;
      }

      if (isHeading && !shouldDecorateHeading) {
        return;
      }

      switch (node.name) {
        case 'ATXHeading1': {
          decorateHeadingLines(view, nodeFrom, 1, decorations);
          if (inFocus) {
            decorateFocusedHeading(view, nodeFrom, nodeTo, marks.headingMarker1, marks.heading1, decorations);
          } else {
            decorations.push(marks.heading1.range(nodeFrom, nodeTo));
            if (decoContext.allowReplaceDecorations) {
              hideHeadingMarkers(view, nodeFrom, nodeTo, decorations);
            }
          }
          break;
        }
        case 'ATXHeading2': {
          decorateHeadingLines(view, nodeFrom, 2, decorations);
          if (inFocus) {
            decorateFocusedHeading(view, nodeFrom, nodeTo, marks.headingMarker2, marks.heading2, decorations);
          } else {
            decorations.push(marks.heading2.range(nodeFrom, nodeTo));
            if (decoContext.allowReplaceDecorations) {
              hideHeadingMarkers(view, nodeFrom, nodeTo, decorations);
            }
          }
          break;
        }
        case 'ATXHeading3': {
          decorateHeadingLines(view, nodeFrom, 3, decorations);
          if (inFocus) {
            decorateFocusedHeading(view, nodeFrom, nodeTo, marks.headingMarker3, marks.heading3, decorations);
          } else {
            decorations.push(marks.heading3.range(nodeFrom, nodeTo));
            if (decoContext.allowReplaceDecorations) {
              hideHeadingMarkers(view, nodeFrom, nodeTo, decorations);
            }
          }
          break;
        }
        case 'ATXHeading4': {
          decorateHeadingLines(view, nodeFrom, 4, decorations);
          if (inFocus) {
            decorateFocusedHeading(view, nodeFrom, nodeTo, marks.headingMarker4, marks.heading4, decorations);
          } else {
            decorations.push(marks.heading4.range(nodeFrom, nodeTo));
            if (decoContext.allowReplaceDecorations) {
              hideHeadingMarkers(view, nodeFrom, nodeTo, decorations);
            }
          }
          break;
        }
        case 'ATXHeading5': {
          decorateHeadingLines(view, nodeFrom, 5, decorations);
          if (inFocus) {
            decorateFocusedHeading(view, nodeFrom, nodeTo, marks.headingMarker5, marks.heading5, decorations);
          } else {
            decorations.push(marks.heading5.range(nodeFrom, nodeTo));
            if (decoContext.allowReplaceDecorations) {
              hideHeadingMarkers(view, nodeFrom, nodeTo, decorations);
            }
          }
          break;
        }
        case 'ATXHeading6': {
          decorateHeadingLines(view, nodeFrom, 6, decorations);
          if (inFocus) {
            decorateFocusedHeading(view, nodeFrom, nodeTo, marks.headingMarker6, marks.heading6, decorations);
          } else {
            decorations.push(marks.heading6.range(nodeFrom, nodeTo));
            if (decoContext.allowReplaceDecorations) {
              hideHeadingMarkers(view, nodeFrom, nodeTo, decorations);
            }
          }
          break;
        }

        case 'Emphasis': {
          const markerLen = 1;
          if (inlineFocused) {
            if (nodeTo - nodeFrom > markerLen * 2) {
              decorations.push(marks.emphasis.range(nodeFrom + markerLen, nodeTo - markerLen));
            }
            showSurroundingMarkers(nodeFrom, nodeTo, markerLen, decorations);
          } else {
            decorations.push(marks.emphasis.range(nodeFrom, nodeTo));
            if (decoContext.allowReplaceDecorations) {
              hideSurroundingMarkers(nodeFrom, nodeTo, markerLen, decorations);
            }
          }
          break;
        }

        case 'StrongEmphasis': {
          const markerLen = 2;
          if (inlineFocused) {
            if (nodeTo - nodeFrom > markerLen * 2) {
              decorations.push(marks.strong.range(nodeFrom + markerLen, nodeTo - markerLen));
            }
            showSurroundingMarkers(nodeFrom, nodeTo, markerLen, decorations);
          } else {
            decorations.push(marks.strong.range(nodeFrom, nodeTo));
            if (decoContext.allowReplaceDecorations) {
              hideSurroundingMarkers(nodeFrom, nodeTo, markerLen, decorations);
            }
          }
          break;
        }

        case 'Strikethrough': {
          const markerLen = 2;
          if (inlineFocused) {
            if (nodeTo - nodeFrom > markerLen * 2) {
              decorations.push(marks.strikethrough.range(nodeFrom + markerLen, nodeTo - markerLen));
            }
            showSurroundingMarkers(nodeFrom, nodeTo, markerLen, decorations);
          } else {
            decorations.push(marks.strikethrough.range(nodeFrom, nodeTo));
            if (decoContext.allowReplaceDecorations) {
              hideSurroundingMarkers(nodeFrom, nodeTo, markerLen, decorations);
            }
          }
          break;
        }

        case 'InlineCode': {
          const markerLen = 1;
          if (inlineFocused) {
            if (nodeTo - nodeFrom > markerLen * 2) {
              decorations.push(marks.codeEditing.range(nodeFrom + markerLen, nodeTo - markerLen));
            }
            showSurroundingMarkers(nodeFrom, nodeTo, markerLen, decorations);
          } else {
            decorations.push(marks.code.range(nodeFrom, nodeTo));
            if (decoContext.allowReplaceDecorations) {
              hideSurroundingMarkers(nodeFrom, nodeTo, markerLen, decorations);
            }
          }
          break;
        }

        case 'Link':
          if (isInlineMarkdownLink(view, nodeFrom, nodeTo)) {
            if (inlineFocused) {
              styleLinkSourceMarkers(view, nodeFrom, nodeTo, decorations);
            } else {
              styleLinkContent(view, nodeFrom, nodeTo, decorations, decoContext);
            }
          } else {
            decorations.push(
              Decoration.mark({ class: 'cm-md-link-plain' }).range(nodeFrom, nodeTo)
            );
          }
          break;

        case 'Blockquote':
          decorateBlockquote(view, nodeFrom, nodeTo, focusRange, decorations, decoContext);
          break;

        case 'HorizontalRule':
        case 'ThematicBreak': {
          // frontmatter 的 --- 分隔符会被 Lezer 误识别为 ThematicBreak，跳过
          if (frontmatter && nodeFrom >= frontmatter.from && nodeTo <= frontmatter.to) {
            break;
          }
          const line = view.state.doc.lineAt(nodeFrom);
          const lineClass = inFocus || !decoContext.allowReplaceDecorations
            ? CSS.horizontalRule
            : `${CSS.horizontalRule} ${CSS.horizontalRuleRendered}`;
          decorations.push(Decoration.line({ class: lineClass }).range(line.from));
          break;
        }
      }
    },
  });
}

function addInlineDecorations(
  view: EditorView,
  from: number,
  to: number,
  focusRange: { from: number; to: number } | null,
  decorations: Range<Decoration>[],
  frontmatter: FrontmatterInfo | null,
  decoContext: LivePreviewDecoContext
): void {
  const sel = view.state.selection.main;
  const selAnchorLine = view.state.doc.lineAt(sel.anchor).number;
  const selHeadLine = view.state.doc.lineAt(sel.head).number;
  const seenLines = new Set<number>();
  const listContinuations = collectListContinuationLineInfo(view.state, from, to);
  forEachVisibleLine(view, from, to, (line) => {
    if (seenLines.has(line.number)) {
      return;
    }
    seenLines.add(line.number);
    if (frontmatter && line.from >= frontmatter.from && line.to <= frontmatter.to) {
      return;
    }
    const lineInFocus = isInFocusRange(line.from, line.to, focusRange);
    const parsedList = parseListLinePrefix(line.text);

    // Always run list marker decoration so focused list lines get line class.
    if (parsedList) {
      decorateListMarker(line, parsedList, decorations, sel, selAnchorLine, selHeadLine);
      decorateTaskList(
        line,
        parsedList,
        decorations,
        sel,
        selAnchorLine,
        selHeadLine,
        decoContext
      );
    } else {
      const continuation = listContinuations.get(line.number);
      if (continuation) {
        decorateListContinuationLine(line, continuation, decorations);
      }
    }
    decorateFallbackCjkAsteriskEmphasis(view, line, decorations, sel, decoContext);
    decorateMarkdownHighlights(view, line, decorations, sel, decoContext);
    decorateMarkdownTags(view, line, decorations, sel);
    if (lineInFocus) {
      return;
    }

    decorateWikilinks(view, line, focusRange, decorations, decoContext);
  });
}

function decorateMarkdownTags(
  view: EditorView,
  line: { from: number; to: number; text: string },
  decorations: Range<Decoration>[],
  selection: SelectionRange,
): void {
  if (isLineInsideCodeBlock(view.state, line.from)) {
    return;
  }

  const excludedRanges = collectMarkdownHighlightExcludedRanges(view.state, line);
  const tagRanges = findMarkdownTagRanges(line.text, excludedRanges.map((range) => ({
    from: range.from - line.from,
    to: range.to - line.from,
  })));

  for (const range of tagRanges) {
    const from = line.from + range.from;
    const to = line.from + range.to;
    // A tag turns back into source text as soon as the caret enters it, which
    // keeps typing and selection behaviour as predictable as other live-preview
    // Markdown constructs.
    if (isSelectionOverlappingRange(selection, from, to)) {
      continue;
    }
    decorations.push(
      Decoration.mark({
        class: `cm-md-tag-pill cm-md-tag-tone-${tagPillTone(range.label)}`,
      }).range(from, to),
    );
  }
}

function decorateFallbackCjkAsteriskEmphasis(
  view: EditorView,
  line: { from: number; to: number; text: string },
  decorations: Range<Decoration>[],
  selection: SelectionRange,
  decoContext: LivePreviewDecoContext
): void {
  const excludedRanges = collectFallbackExcludedRanges(view.state, line.from, line.to);
  const fallbackRanges = findCjkAsteriskEmphasisRanges(line.text, excludedRanges.map((range) => ({
    from: range.from - line.from,
    to: range.to - line.from,
  })));

  for (const range of fallbackRanges) {
    const from = line.from + range.from;
    const to = line.from + range.to;
    const inlineFocused = isSelectionOverlappingRange(selection, from, to);
    const styleMark = range.markerLength === 2 ? marks.strong : marks.emphasis;

    if (inlineFocused) {
      if (to - from > range.markerLength * 2) {
        decorations.push(
          styleMark.range(from + range.markerLength, to - range.markerLength)
        );
      }
      showSurroundingMarkers(from, to, range.markerLength, decorations);
    } else {
      decorations.push(styleMark.range(from, to));
      if (decoContext.allowReplaceDecorations) {
        hideSurroundingMarkers(from, to, range.markerLength, decorations);
      }
    }
  }
}

function decorateMarkdownHighlights(
  view: EditorView,
  line: { from: number; to: number; text: string },
  decorations: Range<Decoration>[],
  selection: SelectionRange,
  decoContext: LivePreviewDecoContext
): void {
  if (isLineInsideCodeBlock(view.state, line.from)) {
    return;
  }

  const excludedRanges = collectMarkdownHighlightExcludedRanges(view.state, line);
  const highlightRanges = findMarkdownHighlightRanges(line.text, excludedRanges.map((range) => ({
    from: range.from - line.from,
    to: range.to - line.from,
  })));

  for (const range of highlightRanges) {
    const from = line.from + range.from;
    const to = line.from + range.to;
    const contentFrom = from + 2;
    const contentTo = to - 2;
    if (contentFrom >= contentTo) {
      continue;
    }

    decorations.push(marks.highlight.range(contentFrom, contentTo));
    if (isSelectionOverlappingRange(selection, from, to)) {
      showSurroundingMarkers(from, to, 2, decorations);
    } else if (decoContext.allowReplaceDecorations) {
      hideSurroundingMarkers(from, to, 2, decorations);
    }
  }
}

function collectMarkdownHighlightExcludedRanges(
  state: EditorState,
  line: { from: number; to: number; text: string }
): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];

  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (
        node.name !== 'InlineCode' &&
        node.name !== 'Link' &&
        node.name !== 'Image'
      ) {
        return;
      }
      ranges.push({ from: node.from, to: node.to });
    },
  });

  const wikiRegex = /(!)?\[\[([^\]]+)\]\]/g;
  let wikiMatch: RegExpExecArray | null;
  while ((wikiMatch = wikiRegex.exec(line.text)) !== null) {
    ranges.push({
      from: line.from + wikiMatch.index,
      to: line.from + wikiMatch.index + wikiMatch[0].length,
    });
  }

  return ranges;
}

function collectFallbackExcludedRanges(
  state: EditorState,
  from: number,
  to: number
): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (
        node.name !== 'Emphasis' &&
        node.name !== 'StrongEmphasis' &&
        node.name !== 'InlineCode' &&
        node.name !== 'Link' &&
        node.name !== 'Image'
      ) {
        return;
      }
      ranges.push({ from: node.from, to: node.to });
    },
  });

  return ranges;
}

export function getHeadingMarkerInfo(
  source: { state: Pick<EditorState, 'sliceDoc'> },
  from: number,
  to: number
): HeadingMarkerInfo | null {
  const text = source.state.sliceDoc(from, to);
  const match = text.match(/^(#{1,6})([ \t]+)/);
  if (!match) {
    return null;
  }
  const rawContent = text.slice(match[0].length);
  const content = /^#+[ \t]*$/.test(rawContent)
    ? ''
    : rawContent.replace(/[ \t]+#+[ \t]*$/, '').trim();
  if (!content) {
    return null;
  }
  return {
    hashesTo: from + match[1].length,
    contentFrom: from + match[0].length,
  };
}

function decorateFocusedHeading(
  view: EditorView,
  from: number,
  to: number,
  markerMark: Decoration,
  headingMark: Decoration,
  decorations: Range<Decoration>[]
): void {
  const markerInfo = getHeadingMarkerInfo(view, from, to);
  if (!markerInfo) {
    return;
  }
  decorations.push(markerMark.range(from, markerInfo.hashesTo));
  if (markerInfo.hashesTo < markerInfo.contentFrom) {
    decorations.push(marks.syntaxVisible.range(markerInfo.hashesTo, markerInfo.contentFrom));
  }
  if (markerInfo.contentFrom < to) {
    decorations.push(headingMark.range(markerInfo.contentFrom, to));
  }
}

function hideHeadingMarkers(
  view: EditorView,
  from: number,
  to: number,
  decorations: Range<Decoration>[]
): void {
  const markerInfo = getHeadingMarkerInfo(view, from, to);
  if (markerInfo) {
    decorations.push(marks.syntaxHidden.range(from, markerInfo.contentFrom));
  }
}

function hideSurroundingMarkers(
  from: number,
  to: number,
  markerLen: number,
  decorations: Range<Decoration>[]
): void {
  decorations.push(marks.syntaxHidden.range(from, from + markerLen));
  decorations.push(marks.syntaxHidden.range(to - markerLen, to));
}

function showSurroundingMarkers(
  from: number,
  to: number,
  markerLen: number,
  decorations: Range<Decoration>[]
): void {
  decorations.push(marks.syntaxVisible.range(from, from + markerLen));
  decorations.push(marks.syntaxVisible.range(to - markerLen, to));
}

function createLinkMark(target: string): Decoration {
  return Decoration.mark({
    class: CSS.link,
    attributes: {
      'data-md-link': target,
    },
  });
}

function forEachVisibleLine(
  view: EditorView,
  from: number,
  to: number,
  callback: (line: { from: number; to: number; number: number; text: string }) => void
): void {
  const doc = view.state.doc;
  let line = doc.lineAt(from);
  while (true) {
    callback(line);
    if (line.to >= to) {
      break;
    }
    line = doc.line(line.number + 1);
  }
}

function decorateBlockquote(
  view: EditorView,
  from: number,
  to: number,
  focusRange: { from: number; to: number } | null,
  decorations: Range<Decoration>[],
  decoContext: LivePreviewDecoContext
): void {
  const doc = view.state.doc;
  let line = doc.lineAt(from);
  const firstLine = line;
  const prefixMatch = firstLine.text.match(/^(\s*> ?)/);
  const prefixLength = prefixMatch ? prefixMatch[0].length : 0;
  const firstLineContent = firstLine.text.slice(prefixLength);
  const calloutMatch = firstLineContent.match(/^\[!([^\]]+)\]/);
  const calloutType = calloutMatch && prefixMatch ? calloutMatch[1].toLowerCase() : null;

  let calloutMarkerStart = 0;
  let calloutMarkerEnd = 0;
  if (calloutMatch && prefixMatch) {
    calloutMarkerStart = firstLine.from + prefixLength;
    calloutMarkerEnd = calloutMarkerStart + calloutMatch[0].length;
  }

  while (true) {
    const lineText = line.text;
    const markerMatch = lineText.match(/^(\s*>)( ?)/);
    if (markerMatch) {
      const angleBracketStart = line.from;
      const angleBracketEnd = line.from + markerMatch[1].length;
      const spaceEnd = angleBracketEnd + markerMatch[2].length;
      if (!isInFocusRange(angleBracketStart, spaceEnd, focusRange)) {
        // ">" → transparent (preserves 1ch width to avoid jitter)
        decorations.push(marks.blockquoteMarkerHidden.range(angleBracketStart, angleBracketEnd));
        // " " after > → replace/remove (reduce indent width)
        if (markerMatch[2] && decoContext.allowReplaceDecorations) {
          decorations.push(marks.syntaxHidden.range(angleBracketEnd, spaceEnd));
        }
      } else {
        decorations.push(marks.blockquoteMarkerVisible.range(angleBracketStart, spaceEnd));
      }
    }
    if (calloutType) {
      const calloutClass = `${CSS.callout} ${CSS.calloutType}-${calloutType}`;
      decorations.push(Decoration.line({ class: calloutClass }).range(line.from));
      if (line.number === firstLine.number) {
        const widget = getCachedWidget(
          `callout:${calloutType}`,
          () => new CalloutWidget(calloutType)
        );
        decorations.push(
          Decoration.widget({ widget, side: -1 }).range(calloutMarkerStart)
        );
        if (decoContext.allowReplaceDecorations) {
          decorations.push(
            marks.syntaxHidden.range(calloutMarkerStart, calloutMarkerEnd)
          );
        }
        decorations.push(Decoration.line({ class: CSS.calloutTitle }).range(line.from));
      }
    } else {
      decorations.push(Decoration.line({ class: CSS.blockquote }).range(line.from));
    }

    if (line.to >= to) {
      break;
    }
    line = doc.line(line.number + 1);
  }
}

function decorateWikilinks(
  view: EditorView,
  line: { from: number; to: number; text: string },
  focusRange: { from: number; to: number } | null,
  decorations: Range<Decoration>[],
  decoContext: LivePreviewDecoContext
): void {
  if (!decoContext.allowReplaceDecorations) {
    return;
  }
  const wikiRegex = /(!)?\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = wikiRegex.exec(line.text))) {
    // Standalone drawings are rendered as block widgets, including while selected.
    if (parseDrawingEmbed(line.text)) continue;
    const isEmbed = Boolean(match[1]);
    const rawTarget = match[2];
    const parsed = parseWikiTarget(rawTarget);
    const linkTarget = parsed.target;
    const display = parsed.label || parsed.target;
    const { path, heading } = splitLinkTarget(linkTarget);
    const resolvedPath = resolveMarkdownPath(
      getMarkdownDocumentPath(view.state) || getWorkspaceStateForEditor(view.state).currentFilePath,
      path,
      true
    );
    const fullTarget = resolvedPath
      ? heading
        ? `${resolvedPath}#${heading}`
        : resolvedPath
      : linkTarget;
    const isImage = Boolean(resolvedPath && isImagePath(resolvedPath));

    const rangeFrom = line.from + match.index;
    const rangeTo = rangeFrom + match[0].length;
    if (isInFocusRange(rangeFrom, rangeTo, focusRange)) {
      continue;
    }

    const cacheKey = `wikilink:${fullTarget}:${display}:${isEmbed ? 'embed' : 'link'}`;
    const widget = getCachedWidget(cacheKey, () => {
      const currentFilePath = getMarkdownDocumentPath(view.state) || getWorkspaceStateForEditor(view.state).currentFilePath;
      return new WikilinkWidget({
        label: display,
        target: fullTarget,
        isEmbed,
        isImage,
        documentPath: currentFilePath,
        resolvedPath: resolvedPath || undefined,
      });
    });
    decorations.push(Decoration.replace({ widget }).range(rangeFrom, rangeTo));
  }
}

function decorateListMarker(
  line: { from: number; to: number; number: number; text: string },
  parsed: ParsedListLine,
  decorations: Range<Decoration>[],
  selection: { anchor: number; head: number },
  selAnchorLine: number,
  selHeadLine: number
): void {
  const depth = getListDepth(parsed);
  decorations.push(Decoration.line({ class: getListLineClass(parsed) }).range(line.from));

  const markerFrom = line.from + parsed.markerFrom;
  const markerTextEnd = markerFrom + parsed.markerText.length;
  const markerTo = line.from + parsed.markerTo;

  const markerAttributes: Record<string, string> = parsed.isOrdered
    ? {}
    : { 'data-ui-marker': UNORDERED_BULLETS[depth % UNORDERED_BULLETS.length] };

  // Reveal source only when cursor is on marker or marker's trailing space, not at content start.
  const near = (pos: number) => {
    if (pos >= markerFrom - 1 && pos < markerTo) return true;
    return false;
  };
  const active =
    (selAnchorLine === line.number && near(selection.anchor)) ||
    (selHeadLine === line.number && near(selection.head));

  const className = getListMarkerSourceClassName(active);

  decorations.push(
    Decoration.mark({
      class: className,
      attributes: markerAttributes,
    }).range(markerFrom, markerTextEnd)
  );
}

function decorateListContinuationLine(
  line: { from: number; text: string },
  info: ListContinuationLineInfo,
  decorations: Range<Decoration>[]
): void {
  decorations.push(
    Decoration.line({ class: `${CSS.listLine} cm-md-list-depth-${info.depth}` }).range(line.from)
  );
}

function decorateTaskList(
  line: { from: number; to: number; number: number; text: string },
  parsed: ParsedListLine,
  decorations: Range<Decoration>[],
  selection: { anchor: number; head: number },
  selAnchorLine: number,
  selHeadLine: number,
  decoContext: LivePreviewDecoContext
): void {
  if (parsed.taskMarkerFrom === null || parsed.taskMarkerTo === null) {
    return;
  }
  const lineClass = parsed.taskChecked
    ? `${CSS.taskLine} ${CSS.taskLineChecked}`
    : `${CSS.taskLine}`;
  decorations.push(Decoration.line({ class: lineClass }).range(line.from));
  if (parsed.taskContentFrom === null) {
    return;
  }
  const markerStart = line.from + parsed.taskMarkerFrom;
  const markerEnd = line.from + parsed.taskMarkerTo;
  const contentStart = line.from + parsed.taskContentFrom;
  const checked = parsed.taskChecked;
  const nearTaskMarker = (pos: number): boolean => pos >= markerStart - 1 && pos <= markerEnd;
  const active =
    (selAnchorLine === line.number && nearTaskMarker(selection.anchor)) ||
    (selHeadLine === line.number && nearTaskMarker(selection.head));
  if (!active && decoContext.allowReplaceDecorations) {
    const widget = getCachedWidget(
      `task:${checked}:${markerStart}:${markerEnd}`,
      () => new TaskCheckboxWidget(checked, markerStart, markerEnd)
    );
    decorations.push(Decoration.replace({ widget }).range(markerStart, markerEnd));
  } else if (active) {
    decorations.push(
      Decoration.mark({ class: 'cm-md-syntax-visible' }).range(markerStart, markerEnd)
    );
  }
  if (checked && line.to > contentStart) {
    decorations.push(
      Decoration.mark({ class: CSS.taskCheckedText }).range(contentStart, line.to)
    );
  }
}

function parseWikiTarget(raw: string): { target: string; label?: string } {
  const parts = raw.split('|');
  return {
    target: parts[0].trim(),
    label: parts[1] ? parts[1].trim() : undefined,
  };
}

function splitLinkTarget(target: string): { path: string; heading: string | null } {
  const hashIndex = target.indexOf('#');
  if (hashIndex === -1) {
    return { path: target, heading: null };
  }
  const path = target.slice(0, hashIndex);
  const heading = target.slice(hashIndex + 1);
  return { path, heading: heading ? decodeURIComponent(heading) : null };
}

function styleLinkContent(
  view: EditorView,
  from: number,
  to: number,
  decorations: Range<Decoration>[],
  decoContext: LivePreviewDecoContext
): void {
  const text = view.state.sliceDoc(from, to);
  const parsed = parseInlineMarkdownLinkSource(text);
  if (parsed) {
    const textStart = from + 1;
    const textEnd = textStart + parsed.label.length;
    decorations.push(createLinkMark(parsed.target).range(textStart, textEnd));
    if (decoContext.allowReplaceDecorations) {
      decorations.push(marks.syntaxHidden.range(from, from + 1));
      decorations.push(marks.syntaxHidden.range(textEnd, to));
    }
  }
}

function styleLinkSourceMarkers(
  view: EditorView,
  from: number,
  to: number,
  decorations: Range<Decoration>[]
): void {
  const text = view.state.sliceDoc(from, to);
  const parsed = parseInlineMarkdownLinkSource(text);
  if (!parsed) {
    return;
  }
  const textStart = from + 1;
  const textEnd = textStart + parsed.label.length;
  const targetStart = textEnd + 2;
  const targetEnd = to - 1;
  decorations.push(marks.syntaxVisible.range(from, from + 1));
  decorations.push(marks.syntaxVisible.range(textEnd, textEnd + 2));
  decorations.push(marks.syntaxVisible.range(targetEnd, to));
  if (textStart < textEnd) {
    decorations.push(marks.linkSourceLabel.range(textStart, textEnd));
  }
  if (targetStart < targetEnd) {
    decorations.push(marks.linkSourceTarget.range(targetStart, targetEnd));
  }
}

function isInlineMarkdownLink(view: EditorView, from: number, to: number): boolean {
  return parseInlineMarkdownLinkSource(view.state.sliceDoc(from, to)) !== null;
}

class LivePreviewPluginValue {
  decorations: DecorationSet;
  private compositionActive = false;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.view.compositionStarted) {
      this.compositionActive = true;
      // Rebuilding replace/widget decorations around contenteditable's live
      // composition node can both disturb the IME and change line geometry.
      // Keep the existing preview mapped to the temporary document and render
      // the final decoration set once composition has committed.
      if (update.docChanged) {
        this.decorations = this.decorations.map(update.changes);
      }
      return;
    }
    const compositionEnded = this.compositionActive;
    this.compositionActive = false;
    const livePreviewRefreshRequested = update.transactions.some((tr) => tr.effects.some((effect) =>
      effect.is(refreshLivePreviewDecorationsEffect) ||
      effect.is(refreshLivePreviewViewportDecorationsEffect) ||
      effect.is(openImageSourceEffect)
    ));
    // CM6 syntax tree parsing is lazy: only the initial viewport is parsed synchronously.
    // When the user scrolls, new regions are parsed in the background. On completion a
    // ViewUpdate fires where docChanged/viewportChanged/selectionSet are all false — the
    // only change is the syntaxTree object itself.  Without this check decorations for
    // newly-parsed regions would never be built (the user must click to trigger selectionSet).
    // Pattern taken from CM6's own foldGutter / TreeHighlighter.
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      syntaxTree(update.state) !== syntaxTree(update.startState) ||
      livePreviewRefreshRequested ||
      compositionEnded
    ) {
      this.decorations = buildDecorations(update.view);
    }
  }

}

export function livePreviewPlugin(_options: LivePreviewPluginOptions = {}) {
  return ViewPlugin.fromClass(LivePreviewPluginValue, {
    decorations: (v) => v.decorations,
  });
}

export function livePreviewInteractions(
  onImageActivate?: (image: ImageActivation) => void,
  onImageDelete?: (image: ImageActivation) => void,
) {
  return EditorView.domEventHandlers({
    mousedown: (event) => {
      const target = eventTargetToElement(event.target);
      if (!target) {
        return false;
      }

      const deleteTarget = getImageDeleteTarget(target);
      if (deleteTarget && event.button === 0) {
        event.preventDefault();
        return true;
      }

      const imageTarget = getImageActivationTarget(target);
      if (imageTarget && event.button === 0) {
        event.preventDefault();
        return true;
      }

      if (shouldInterceptRenderedMarkdownLinkMouseDown(event, target)) {
        event.preventDefault();
        return true;
      }

      return false;
    },
    click: (event, view) => {
      const target = eventTargetToElement(event.target);
      if (!target) {
        return false;
      }

      const deleteTarget = getImageDeleteTarget(target);
      if (deleteTarget) {
        onImageDelete?.({
          ...deleteTarget,
          x: event.clientX,
          y: event.clientY,
        });
        event.preventDefault();
        return true;
      }

      const taskEl = target.closest('[data-md-task]') as HTMLElement | null;
      if (taskEl) {
        const from = Number(taskEl.dataset.taskFrom);
        const to = Number(taskEl.dataset.taskTo);
        const checked = taskEl.dataset.taskChecked === 'true';
        if (Number.isFinite(from) && Number.isFinite(to)) {
          const replacement = checked ? '[ ]' : '[x]';
          view.dispatch({
            changes: { from, to, insert: replacement },
          });
          event.preventDefault();
          return true;
        }
      }

      const imageTarget = getImageActivationTarget(target);
      if (imageTarget) {
        onImageActivate?.({
          ...imageTarget,
          x: event.clientX,
          y: event.clientY,
        });
        event.preventDefault();
        return true;
      }

      const linkEl = target.closest('[data-md-link]') as HTMLElement | null;
      if (linkEl) {
        const rawLink = linkEl.dataset.mdLink || '';
        if (rawLink) {
          void navigateToLink(view, rawLink);
          event.preventDefault();
          return true;
        }
      }

      return false;
    },
  });
}

function eventTargetToElement(target: EventTarget | null): Element | null {
  if (!target) {
    return null;
  }
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Text) {
    return target.parentElement;
  }
  return null;
}

function getImageActivationTarget(
  target: Element
): { from: number; to: number; widthPercent: number | null; imageElement?: HTMLImageElement | null } | null {
  const el = target.closest('[data-md-image-source-from][data-md-image-source-to]') as HTMLElement | null;
  if (!el) {
    return null;
  }
  const from = Number(el.dataset.mdImageSourceFrom);
  const to = Number(el.dataset.mdImageSourceTo);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return null;
  }
  const rawWidth = Number(el.dataset.mdImageWidth);
  return {
    from,
    to,
    widthPercent: Number.isFinite(rawWidth) ? rawWidth : null,
    imageElement: el instanceof HTMLImageElement ? el : el.querySelector('img'),
  };
}

function getImageDeleteTarget(
  target: Element
): { from: number; to: number; widthPercent: number | null } | null {
  const button = target.closest('[data-md-image-delete="true"]') as HTMLElement | null;
  if (!button) {
    return null;
  }
  const from = Number(button.dataset.mdImageSourceFrom);
  const to = Number(button.dataset.mdImageSourceTo);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return null;
  }
  const rawWidth = Number(button.dataset.mdImageWidth);
  return {
    from,
    to,
    widthPercent: Number.isFinite(rawWidth) ? rawWidth : null,
  };
}

async function navigateToLink(view: EditorView, rawLink: string): Promise<void> {
  const trimmed = rawLink.trim();
  if (!trimmed) {
    return;
  }
  const threadLink = parseThreadLinkTarget(trimmed);
  if (threadLink) {
    await openThreadFile(threadLink.threadID);
    return;
  }
  if (trimmed.startsWith('#')) {
    scrollToHeading(view, trimmed.slice(1));
    return;
  }
  if (isExternalLink(trimmed)) {
    window.open(trimmed, '_blank');
    return;
  }

  const { path, heading } = splitLinkTarget(trimmed);
  const workspaceState = getWorkspaceStateForEditor(view.state);
  const currentFilePath = getMarkdownDocumentPath(view.state) || workspaceState.currentFilePath;
  const resolved = resolveMarkdownPath(currentFilePath, path, false);
  if (!resolved) {
    return;
  }
  if (heading) {
    if (resolved === currentFilePath) {
      scrollToHeading(view, heading);
      return;
    }
    workspaceState.openFile(resolved, { heading });
    return;
  }
  workspaceState.openFile(resolved);
}

async function openThreadFile(threadID: string): Promise<void> {
  try {
    useUiStore.getState().openConversation({ kind: 'session', sessionId: threadID });
  } catch (error) {
    useToastStore.getState().pushToast(
      error instanceof Error ? error.message : 'Failed to open thread'
    );
  }
}

function isExternalLink(target: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(target);
}

function scrollToHeading(view: EditorView, heading: string): void {
  const pos = findHeadingPosition(view, heading);
  if (pos === null) {
    return;
  }
  view.dispatch({
    selection: { anchor: pos },
    scrollIntoView: true,
  });
}

function findHeadingPosition(view: EditorView, heading: string): number | null {
  const doc = view.state.doc;
  const target = normalizeHeading(heading);
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.match(/^(#{1,6})\s+(.*)$/);
    if (!match) {
      continue;
    }
    const text = match[2].trim();
    if (normalizeHeading(text) === target || text.toLowerCase() === heading.toLowerCase()) {
      return line.from + match[1].length + 1;
    }
  }
  return null;
}

function normalizeHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}
