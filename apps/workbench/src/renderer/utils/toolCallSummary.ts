const TOOL_SUMMARY_MAX_RUNES = 120;

type ToolArguments = Record<string, unknown> | null | undefined;

function truncateSummary(text: string): string {
  const normalized = stringsToSingleLine(text);
  if (!normalized) {
    return '';
  }
  const runes = Array.from(normalized);
  if (runes.length <= TOOL_SUMMARY_MAX_RUNES) {
    return normalized;
  }
  return `${runes.slice(0, TOOL_SUMMARY_MAX_RUNES - 3).join('')}...`;
}

function stringsToSingleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function joinSummary(toolName: string, detail: string): string {
  const normalizedToolName = stringsToSingleLine(toolName);
  const normalizedDetail = stringsToSingleLine(detail);
  if (!normalizedToolName) {
    return truncateSummary(normalizedDetail);
  }
  if (!normalizedDetail) {
    return truncateSummary(normalizedToolName);
  }
  return truncateSummary(`${normalizedToolName}: ${normalizedDetail}`);
}

function extractString(args: ToolArguments, key: string): string {
  if (!args || typeof args !== 'object') {
    return '';
  }
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function extractBaseName(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return '';
  }
  const normalized = trimmed.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    return '';
  }
  const baseName = segments[segments.length - 1];
  if (!baseName || baseName === '.') {
    return '';
  }
  return baseName;
}

export function normalizeToolCallName(name: string): string {
  switch (stringsToSingleLine(name).toLowerCase()) {
    case '':
    case 'tool':
      return 'tool';
    case 'bash':
    case 'sh':
    case 'shell':
    case 'zsh':
      return 'bash';
    case 'read':
    case 'read_file':
      return 'read';
    case 'edit':
    case 'edit_file':
      return 'edit';
    case 'glob':
      return 'glob';
    default:
      return stringsToSingleLine(name).toLowerCase();
  }
}

export function tryFormatToolCallSummary(toolName: string, args: ToolArguments): string {
  const normalizedToolName = normalizeToolCallName(toolName);

  if (normalizedToolName === 'bash') {
    const command = stringsToSingleLine(extractString(args, 'command'));
    return command ? joinSummary('bash', command) : '';
  }

  if (normalizedToolName === 'glob') {
    const pattern = stringsToSingleLine(extractString(args, 'pattern'));
    return pattern ? joinSummary('glob', pattern) : '';
  }

  const baseName = extractBaseName(extractString(args, 'path'));
  if (baseName) {
    return joinSummary(normalizedToolName, baseName);
  }

  return '';
}

export function formatToolCallSummary(toolName: string, args: ToolArguments): string {
  return tryFormatToolCallSummary(toolName, args)
    || normalizeToolCallName(toolName)
    || 'tool';
}
