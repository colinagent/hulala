import { normalizePosixPath } from './markdownMedia';

export type PromptVariableName = 'platform' | 'agentRoot' | 'agentHome';

export type PromptVariableMatch = {
  name: string;
  raw: string;
  from: number;
  to: number;
};

const PROMPT_VARIABLE_PATTERN = /\$\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

const PROMPT_VARIABLE_DESCRIPTIONS: Record<PromptVariableName, string> = {
  platform: 'Runtime OS (runtime.GOOS)',
  agentRoot: 'Agent package root directory',
  agentHome: 'Agent resource directory (.agent)',
};

export function isKnownPromptVariableName(name: string): name is PromptVariableName {
  return name === 'platform' || name === 'agentRoot' || name === 'agentHome';
}

export function parsePromptVariablesInText(text: string): PromptVariableMatch[] {
  const matches: PromptVariableMatch[] = [];
  PROMPT_VARIABLE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PROMPT_VARIABLE_PATTERN.exec(text)) !== null) {
    matches.push({
      name: match[1],
      raw: match[0],
      from: match.index,
      to: match.index + match[0].length,
    });
  }
  return matches;
}

export function resolveRuntimePlatform(platform?: string | null): string {
  const normalized = (platform || '').trim();
  if (normalized === 'darwin' || normalized === 'linux' || normalized === 'windows') {
    return normalized;
  }
  if (typeof window !== 'undefined') {
    const electronPlatform = window.hulala?.platform;
    if (electronPlatform === 'darwin') {
      return 'darwin';
    }
    if (electronPlatform === 'linux') {
      return 'linux';
    }
    if (electronPlatform === 'win32') {
      return 'windows';
    }
  }
  return 'linux';
}

export function agentHomeFromDefinitionPath(definitionPath: string | null | undefined): string {
  const normalized = normalizePosixPath((definitionPath || '').trim());
  if (!normalized) {
    return '';
  }
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex < 0) {
    return '';
  }
  const configDir = normalized.slice(0, slashIndex);
  const base = configDir.slice(configDir.lastIndexOf('/') + 1);
  if (base === '.agent' || base === '.agents') {
    return configDir;
  }
  return `${configDir}/.agent`;
}

export function agentRootFromDefinitionPath(definitionPath: string | null | undefined): string {
  const agentHome = agentHomeFromDefinitionPath(definitionPath);
  if (!agentHome) {
    return '';
  }
  if (agentHome.endsWith('/.agents')) {
    return agentHome.slice(0, -'/.agents'.length);
  }
  if (agentHome.endsWith('/.agent')) {
    return agentHome.slice(0, -'/.agent'.length);
  }
  return agentHome;
}

export function resolvePromptVariableValues(
  definitionPath: string | null | undefined,
  platform?: string | null,
): Record<PromptVariableName, string> {
  return {
    platform: resolveRuntimePlatform(platform),
    agentRoot: agentRootFromDefinitionPath(definitionPath),
    agentHome: agentHomeFromDefinitionPath(definitionPath),
  };
}

export function describePromptVariable(name: string): string {
  if (isKnownPromptVariableName(name)) {
    return PROMPT_VARIABLE_DESCRIPTIONS[name];
  }
  return 'Unknown runtime prompt variable';
}

export function buildPromptVariableTooltip(
  name: string,
  values: Record<PromptVariableName, string>,
): string {
  const lines = [
    'Runtime prompt variable',
    `Name: ${name}`,
    describePromptVariable(name),
  ];
  if (isKnownPromptVariableName(name)) {
    const resolved = values[name];
    lines.push(resolved ? `Expands to: ${resolved}` : 'Expands at runtime');
  } else {
    lines.push('Not recognized by runtime expansion');
  }
  return lines.join('\n');
}
