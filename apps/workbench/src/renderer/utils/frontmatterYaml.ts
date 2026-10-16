import { Document, parseDocument } from 'yaml';

export type FrontmatterEntry = {
  key: string;
  value: unknown;
};

export type ParsedFrontmatterDocument = {
  entries: FrontmatterEntry[];
  data: Record<string, unknown>;
  body: string;
  bodyStart: number;
};

export type FrontmatterSplit = {
  rawBody: string;
  body: string;
  bodyStart: number;
  lineBreak: '\n' | '\r\n';
};

const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;

function detectLineBreak(content: string): '\n' | '\r\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

export function splitFrontmatter(content: string): FrontmatterSplit | null {
  const match = content.match(FRONTMATTER_BLOCK_RE);
  if (!match) {
    return null;
  }

  const rawBody = match[1];
  const bodyStart = match[0].length;
  const body = content.slice(bodyStart);

  return {
    rawBody,
    body,
    bodyStart,
    lineBreak: detectLineBreak(content),
  };
}

function stringifyFrontmatterData(data: Record<string, unknown>): string {
  const doc = new Document(data);
  return doc.toString({
    indent: 2,
    lineWidth: 0,
    defaultKeyType: 'PLAIN',
    defaultStringType: 'QUOTE_DOUBLE',
  }).trimEnd();
}

function rebuildFrontmatterContent(
  rawBody: string,
  body: string,
  lineBreak: '\n' | '\r\n',
): string {
  const trimmedBody = rawBody.trimEnd();
  const frontmatterBlock = trimmedBody
    ? `---${lineBreak}${trimmedBody}${lineBreak}---`
    : `---${lineBreak}---`;
  if (!body) {
    return `${frontmatterBlock}${lineBreak}`;
  }
  if (body.startsWith('\r\n') || body.startsWith('\n')) {
    return `${frontmatterBlock}${body}`;
  }
  return `${frontmatterBlock}${lineBreak}${body}`;
}

function quoteYamlReservedScalars(rawBody: string): string {
  return rawBody
    .split(/\r?\n/)
    .map((line) => {
      const keyMatch = line.match(/^(\s*[^#\s][^:\n]*:\s*)(@[^#\n]+?)(\s+#.*)?$/);
      if (keyMatch) {
        return `${keyMatch[1]}${JSON.stringify(keyMatch[2].trim())}${keyMatch[3] || ''}`;
      }
      const listMatch = line.match(/^(\s*-\s+)(@[^#\n]+?)(\s+#.*)?$/);
      if (listMatch) {
        return `${listMatch[1]}${JSON.stringify(listMatch[2].trim())}${listMatch[3] || ''}`;
      }
      return line;
    })
    .join('\n');
}

function parseFrontmatterData(rawBody: string): Record<string, unknown> | null {
  if (!rawBody.trim()) {
    return {};
  }
  try {
    for (const candidate of [rawBody, quoteYamlReservedScalars(rawBody)]) {
      const doc = parseDocument(candidate);
      if (doc.errors.length > 0) {
        continue;
      }
      const parsed = doc.toJSON();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseFrontmatterDocument(content: string): ParsedFrontmatterDocument | null {
  const split = splitFrontmatter(content);
  if (!split) {
    return null;
  }

  const data = parseFrontmatterData(split.rawBody);
  if (data === null) {
    return null;
  }

  const entries = Object.entries(data).map(([key, value]) => ({ key, value }));
  return {
    entries,
    data,
    body: split.body,
    bodyStart: split.bodyStart,
  };
}

export type FrontmatterPatch =
  | { type: 'set'; key: string; value: unknown }
  | { type: 'delete'; key: string };

export function patchFrontmatterDocument(content: string, patch: FrontmatterPatch): string {
  const split = splitFrontmatter(content);
  if (!split) {
    return content;
  }

  const data = parseFrontmatterData(split.rawBody);
  if (data === null) {
    return content;
  }

  const nextData = { ...data };
  if (patch.type === 'set') {
    nextData[patch.key] = patch.value;
  } else {
    delete nextData[patch.key];
  }

  const nextRawBody = stringifyFrontmatterData(nextData);
  return rebuildFrontmatterContent(nextRawBody, split.body, split.lineBreak);
}
