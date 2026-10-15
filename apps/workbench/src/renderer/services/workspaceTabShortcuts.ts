type WorkspaceTabShortcutEvent = Pick<KeyboardEvent,
  'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'
>;

function isMacPlatform(platform: NodeJS.Platform | string | undefined): boolean {
  if (platform) {
    return platform === 'darwin';
  }
  const navigatorPlatform = typeof navigator !== 'undefined' ? navigator.platform.toLowerCase() : '';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  return navigatorPlatform.includes('mac') || userAgent.includes('mac os');
}

function hasExactPrimaryModifier(
  event: WorkspaceTabShortcutEvent,
  platform?: NodeJS.Platform | string,
): boolean {
  if (isMacPlatform(platform)) {
    return event.metaKey && !event.ctrlKey;
  }
  return event.ctrlKey && !event.metaKey;
}

export function resolveWorkspaceTabShortcutIndex(
  event: WorkspaceTabShortcutEvent,
  platform?: NodeJS.Platform | string,
): number | null {
  if (event.altKey || event.shiftKey || !hasExactPrimaryModifier(event, platform)) {
    return null;
  }

  const codeMatch = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
  const digit = codeMatch?.[1] || (/^[1-9]$/.test(event.key) ? event.key : '');
  return digit ? Number(digit) - 1 : null;
}

export function getWorkspaceTabShortcut(
  tabIndex: number,
  platform?: NodeJS.Platform | string,
): { label: string; aria: string } | null {
  if (!Number.isInteger(tabIndex) || tabIndex < 0 || tabIndex >= 9) {
    return null;
  }

  const digit = String(tabIndex + 1);
  return isMacPlatform(platform)
    ? { label: `⌘${digit}`, aria: `Meta+${digit}` }
    : { label: `Ctrl+${digit}`, aria: `Control+${digit}` };
}
