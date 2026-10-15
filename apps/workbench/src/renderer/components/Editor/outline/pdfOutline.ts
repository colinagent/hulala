import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { OutlineNode } from './outlineTypes';

export type PdfOutlineSourceItem = {
  title?: string;
  dest?: string | unknown[] | null;
  url?: string | null;
  unsafeUrl?: string;
  items?: PdfOutlineSourceItem[];
};

export type PdfOutlineNode = OutlineNode & {
  page: number | null;
};

async function resolveDestinationPage(
  pdf: Pick<PDFDocumentProxy, 'getDestination' | 'getPageIndex'>,
  destination: string | unknown[] | null | undefined,
): Promise<number | null> {
  let resolved = destination;
  if (typeof destination === 'string') {
    try {
      resolved = await pdf.getDestination(destination);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(resolved) || resolved.length === 0) {
    return null;
  }
  const pageTarget = resolved[0];
  if (typeof pageTarget === 'number' && Number.isInteger(pageTarget) && pageTarget >= 0) {
    return pageTarget + 1;
  }
  if (!pageTarget || typeof pageTarget !== 'object') {
    return null;
  }
  try {
    return (await pdf.getPageIndex(pageTarget as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1;
  } catch {
    return null;
  }
}

export async function buildPdfOutlineNodes(
  pdf: Pick<PDFDocumentProxy, 'getDestination' | 'getPageIndex'>,
  items: PdfOutlineSourceItem[],
  depth = 0,
  parentId: string | null = null,
  ancestorIds: string[] = [],
  indexPath = '0',
): Promise<PdfOutlineNode[]> {
  const nodes: PdfOutlineNode[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const id = `pdf-outline-${indexPath}.${index}`;
    const children = Array.isArray(item.items) ? item.items : [];
    const page = item.url || item.unsafeUrl
      ? null
      : await resolveDestinationPage(pdf, item.dest);
    const node: PdfOutlineNode = {
      id,
      label: (item.title || '').trim() || `Section ${index + 1}`,
      depth,
      hasChildren: children.length > 0,
      parentId,
      ancestorIds,
      page,
    };
    nodes.push(node);
    if (children.length > 0) {
      nodes.push(...await buildPdfOutlineNodes(
        pdf,
        children,
        depth + 1,
        id,
        [...ancestorIds, id],
        `${indexPath}.${index}`,
      ));
    }
  }
  return nodes;
}

export function findActivePdfOutlineId(nodes: PdfOutlineNode[], currentPage: number): string | null {
  if (!Number.isFinite(currentPage) || currentPage < 1) {
    return null;
  }
  let best: PdfOutlineNode | null = null;
  for (const node of nodes) {
    if (node.page === null || node.page > currentPage) {
      continue;
    }
    if (
      !best
      || node.page > (best.page || 0)
      || (node.page === best.page && node.depth >= best.depth)
    ) {
      best = node;
    }
  }
  return best?.id || null;
}
