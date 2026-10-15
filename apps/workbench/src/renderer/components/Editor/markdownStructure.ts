import { parseFenceLine } from './markdownFences';

export type OutlineEntry = {
  id: string;
  type: 'heading';
  level: number;
  text: string;
  pos: number;
  spyPos: number;
};

export type OutlineTreeEntry = OutlineEntry & {
  parentId: string | null;
  depth: number;
  hasChildren: boolean;
  ancestorIds: string[];
  topLevelId: string;
};

export type ParsedLine = { number: number; from: number; text: string };

export function trimOutlineLabel(text: string, maxLength = 50): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function stripHeadingImages(text: string): string {
  return text.replace(/!\[[^\]]*\]\([^)]+\)(?:\{[^}]+\})?\s*/gu, '').replace(/\s+/g, ' ').trim();
}

export function getLinesFromContent(content: string): ParsedLine[] {
  let from = 0;
  return content.split('\n').map((text, index) => {
    const line = { number: index + 1, from, text };
    from += text.length + 1;
    return line;
  });
}

export function parseOutlineEntries(lines: ParsedLine[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceWidth = 0;
  let inFrontmatter = lines[0]?.text.trim() === '---';
  for (const parsedLine of lines) {
    const trimmed = parsedLine.text.trim();
    if (inFrontmatter) {
      if (parsedLine.number > 1 && (trimmed === '---' || trimmed === '...')) inFrontmatter = false;
      continue;
    }
    const fence = parseFenceLine(parsedLine.text);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence.char;
        fenceWidth = fence.width;
      } else if (fence.char === fenceChar && fence.width >= fenceWidth && fence.info === '') {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    const match = parsedLine.text.match(/^(#{1,6})\s+(.*)$/);
    if (!match) continue;
    const text = trimOutlineLabel(stripHeadingImages(match[2]));
    if (!text) continue;
    const pos = parsedLine.from + match[1].length + 1;
    entries.push({ id: `heading-${pos}`, type: 'heading', level: match[1].length, text, pos, spyPos: parsedLine.from });
  }
  return entries;
}

export function buildOutlineTreeEntries(entries: OutlineEntry[]): OutlineTreeEntry[] {
  const result: OutlineTreeEntry[] = [];
  const stack: OutlineTreeEntry[] = [];
  for (const entry of entries) {
    while (stack.length && stack[stack.length - 1].level >= entry.level) stack.pop();
    const parent = stack.at(-1) || null;
    const next: OutlineTreeEntry = {
      ...entry,
      parentId: parent?.id || null,
      depth: parent ? parent.depth + 1 : 0,
      hasChildren: false,
      ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [],
      topLevelId: parent?.topLevelId || entry.id,
    };
    if (parent) parent.hasChildren = true;
    result.push(next);
    stack.push(next);
  }
  return result;
}
