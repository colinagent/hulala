import type { NavItem } from 'epubjs';
import type { OutlineNode } from './outlineTypes';

export type EpubOutlineNode = OutlineNode & {
  href: string;
};

function navItemId(item: NavItem, indexPath: string): string {
  // Always include indexPath so duplicate NavItem ids in a malformed EPUB
  // cannot collide into React keys.
  const rawId = (item.id || '').trim();
  const href = (item.href || '').trim();
  const suffix = rawId || href || indexPath;
  return `epub-toc-${indexPath}-${suffix}`;
}

const CHINESE_ORDINAL = '[零〇一二三四五六七八九十百千万两\\d]+';
const PART_LABEL = new RegExp(`^(?:第${CHINESE_ORDINAL}(?:部分|部|卷|篇)|part\\s+[\\divxlcdm]+)`, 'i');
const CHAPTER_LABEL = new RegExp(`^(?:第${CHINESE_ORDINAL}章|chapter\\s+[\\divxlcdm]+)`, 'i');
const SECTION_LABEL = new RegExp(`^(?:第${CHINESE_ORDINAL}节|section\\s+[\\divxlcdm]+)`, 'i');
const NUMBERED_LABEL = /^(\d+(?:[.．]\d+)*)(?:[\s、:：.)）-]|$)/;
/** End-matter that should leave the active chapter instead of nesting under it. */
const BACK_MATTER_LABEL = /^(?:致谢|后记|跋|译后记|译者后记|作者简介|译者简介|参考文献|索引|术语表)(?:\s|$|：|:)/;

function inferFlatOutlineDepths(items: NavItem[]): number[] {
  const labels = items.map((item) => (item.label || '').trim());
  let partActive = false;
  let chapterActive = false;

  return labels.map((label) => {
    if (PART_LABEL.test(label)) {
      partActive = true;
      chapterActive = false;
      return 0;
    }
    if (CHAPTER_LABEL.test(label)) {
      chapterActive = true;
      return partActive ? 1 : 0;
    }
    if (SECTION_LABEL.test(label)) {
      if (chapterActive) {
        return partActive ? 2 : 1;
      }
      return partActive ? 1 : 0;
    }
    const numbered = label.match(NUMBERED_LABEL)?.[1];
    if (numbered) {
      const numericDepth = numbered.split(/[.．]/).length - 1;
      if (numericDepth === 0) {
        chapterActive = true;
      }
      return (partActive ? 1 : 0) + numericDepth;
    }

    // Publisher flat TOCs often list plain section titles ("何为战略",
    // "价值投资的定义") as root siblings after "第N章". Keep nesting them under
    // the active chapter instead of flattening the rest of the book.
    if (BACK_MATTER_LABEL.test(label)) {
      partActive = false;
      chapterActive = false;
      return 0;
    }
    if (chapterActive) {
      return partActive ? 2 : 1;
    }
    if (partActive) {
      return 1;
    }
    return 0;
  });
}

/**
 * Some EPUB 2 NCX files declare a multi-level TOC but serialize every navPoint
 * as a root sibling. Recover only strong, conventional label hierarchy in that
 * fully-flat case; publisher-provided subitems always remain authoritative.
 */
function buildInferredFlatOutlineNodes(items: NavItem[]): EpubOutlineNode[] {
  const desiredDepths = inferFlatOutlineDepths(items);
  const nodes: EpubOutlineNode[] = [];
  const stack: EpubOutlineNode[] = [];

  items.forEach((item, index) => {
    let depth = desiredDepths[index] ?? 0;
    while (depth > 0 && !stack[depth - 1]) {
      depth -= 1;
    }
    const parent = depth > 0 ? stack[depth - 1] : null;
    const id = navItemId(item, `0.${index}`);
    const node: EpubOutlineNode = {
      id,
      label: (item.label || item.href || '').trim() || item.href || id,
      depth,
      hasChildren: false,
      parentId: parent?.id ?? null,
      ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [],
      href: (item.href || '').trim(),
    };
    if (parent) {
      parent.hasChildren = true;
    }
    nodes.push(node);
    stack.length = depth + 1;
    stack[depth] = node;
  });

  return nodes;
}

export function buildEpubOutlineNodes(
  items: NavItem[],
  depth = 0,
  parentId: string | null = null,
  ancestorIds: string[] = [],
  indexPath = '0',
): EpubOutlineNode[] {
  if (
    depth === 0
    && items.length > 0
    && items.every((item) => (item.subitems?.length ?? 0) === 0)
  ) {
    return buildInferredFlatOutlineNodes(items);
  }

  const nodes: EpubOutlineNode[] = [];

  items.forEach((item, index) => {
    const id = navItemId(item, `${indexPath}.${index}`);
    const children = item.subitems || [];
    const hasChildren = children.length > 0;
    const node: EpubOutlineNode = {
      id,
      label: (item.label || item.href || '').trim() || item.href || id,
      depth,
      hasChildren,
      parentId,
      ancestorIds,
      href: (item.href || '').trim(),
    };
    nodes.push(node);
    if (hasChildren) {
      nodes.push(
        ...buildEpubOutlineNodes(children, depth + 1, id, [...ancestorIds, id], `${indexPath}.${index}`),
      );
    }
  });

  return nodes;
}

/** Normalize EPUB hrefs for best-effort TOC matching (path + optional fragment). */
export function normalizeEpubHref(href: string): string {
  const trimmed = (href || '').trim();
  if (!trimmed) {
    return '';
  }
  try {
    const asUrl = new URL(trimmed, 'https://hulala.local/');
    const path = decodeURIComponent(asUrl.pathname).replace(/^\/+/, '');
    const hash = asUrl.hash ? decodeURIComponent(asUrl.hash) : '';
    return `${path}${hash}`.toLowerCase();
  } catch {
    return trimmed.replace(/^\.\//, '').toLowerCase();
  }
}

export function findActiveEpubOutlineId(
  nodes: EpubOutlineNode[],
  currentHref: string,
): string | null {
  const target = normalizeEpubHref(currentHref);
  if (!target || nodes.length === 0) {
    return null;
  }

  const targetPath = target.split('#')[0];
  let best: EpubOutlineNode | null = null;
  let bestExact = false;

  for (const node of nodes) {
    const normalized = normalizeEpubHref(node.href);
    if (!normalized) {
      continue;
    }
    const nodePath = normalized.split('#')[0];
    const exact = normalized === target;
    const pathMatch = nodePath !== '' && nodePath === targetPath;
    if (!exact && !pathMatch) {
      continue;
    }
    if (!best) {
      best = node;
      bestExact = exact;
      continue;
    }
    // Prefer exact href+fragment matches, then deeper nodes.
    if (exact && !bestExact) {
      best = node;
      bestExact = exact;
      continue;
    }
    if (exact === bestExact && node.depth >= best.depth) {
      best = node;
      bestExact = exact;
    }
  }

  return best?.id ?? null;
}
