import { KeybindingItem } from '../../platform/settingsTypes';

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;
export function keybindingPlatform(platform: string, userAgent: string): 'mac' | 'win' | 'linux' {
  // WebKit on Linux can report a Safari/macOS UA. The explicit client platform
  // takes precedence over that compatibility string and over the remote Host.
  const hint = (platform || userAgent).toLowerCase();
  return hint.includes('mac') ? 'mac' : hint.includes('win') ? 'win' : 'linux';
}
export function browserOwnsShortcut(event: ShortcutEvent): boolean {
  const key = event.key.toLowerCase();
  return ['f5', 'f11'].includes(key)
    || (event.altKey && ['arrowleft', 'arrowright'].includes(key))
    || ((event.metaKey || event.ctrlKey) && ['t', 'w', 'n', 'l', 'r', '+', '=', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(key));
}
export function matchesBrowserKeybinding(event: ShortcutEvent, chord: string, platform: 'mac' | 'win' | 'linux'): boolean {
  if (browserOwnsShortcut(event) || /\s/.test(chord.trim())) return false;
  const parts = chord.toLowerCase().split('+');
  const key = parts.pop();
  const modifiers = new Set(parts.map(part => ['cmd', 'command', 'meta'].includes(part) ? (platform === 'mac' ? 'meta' : 'ctrl') : part === 'control' ? 'ctrl' : part === 'option' ? 'alt' : part));
  if ([...modifiers].some(modifier => !['meta', 'ctrl', 'alt', 'shift'].includes(modifier))) return false;
  return (event.key.toLowerCase() === key || event.code.toLowerCase().replace(/^key/, '') === key)
    && event.metaKey === modifiers.has('meta') && event.ctrlKey === modifiers.has('ctrl')
    && event.altKey === modifiers.has('alt') && event.shiftKey === modifiers.has('shift');
}

// Context types (minimal set for now)
export type ContextKey =
  | 'editorFocus'
  | 'sidebarFocus'
  | 'inputFocus'
  | 'modalOpen'
  | 'always';

export type ContextState = {
  editorFocus?: boolean;
  sidebarFocus?: boolean;
  inputFocus?: boolean;
  modalOpen?: boolean;
};

// Command handler type
export type CommandHandler = (args?: unknown) => void | Promise<void>;

// Command registry
class CommandRegistry {
  private commands = new Map<string, CommandHandler>();

  register(command: string, handler: CommandHandler) {
    this.commands.set(command, handler);
  }

  unregister(command: string) {
    this.commands.delete(command);
  }

  execute(command: string, args?: unknown): void | Promise<void> {
    const handler = this.commands.get(command);
    if (handler) {
      return handler(args);
    }
    console.warn(`Command not found: ${command}`);
  }

  has(command: string): boolean {
    return this.commands.has(command);
  }
}

// Keybinding parser and matcher
class KeybindingMatcher {
  private keybindings: KeybindingItem[] = [];
  private contextState: ContextState = {};

  updateKeybindings(keybindings: KeybindingItem[]) {
    this.keybindings = keybindings;
  }

  updateContext(context: Partial<ContextState>) {
    this.contextState = { ...this.contextState, ...context };
  }

  private evaluateWhen(when?: string): boolean {
    if (!when) return true;

    // Simple context evaluation (can be extended later)
    const context = this.contextState;

    // Parse simple expressions like "editorFocus", "!modalOpen", "editorFocus && !inputFocus"
    const parts = when.split(/\s+(&&|\|\|)\s+/);

    for (let i = 0; i < parts.length; i += 2) {
      const expr = parts[i].trim();
      const negated = expr.startsWith('!');
      const key = negated ? expr.slice(1) : expr;

      let value = false;
      if (key === 'editorFocus') value = context.editorFocus ?? false;
      else if (key === 'sidebarFocus') value = context.sidebarFocus ?? false;
      else if (key === 'inputFocus') value = context.inputFocus ?? false;
      else if (key === 'modalOpen') value = context.modalOpen ?? false;
      else if (key === 'always') value = true;

      const result = negated ? !value : value;

      if (i === 0) {
        // First expression
        if (!result && parts.length > 1 && parts[1] === '&&') return false;
        if (result && parts.length > 1 && parts[1] === '||') return true;
      } else {
        // Subsequent expressions
        const op = parts[i - 1];
        if (op === '&&' && !result) return false;
        if (op === '||' && result) return true;
      }
    }

    return true;
  }

  findMatchingKeybinding(event: KeyboardEvent): KeybindingItem | null {
    // Get platform-specific key (renderer-safe: no `process` access)
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    const plat = typeof navigator !== 'undefined' ? (navigator.platform || '').toLowerCase() : '';
    const platform = keybindingPlatform(plat, ua);

    for (const binding of this.keybindings) {
      // Check platform-specific override
      const key = (platform === 'mac' && binding.mac) ? binding.mac :
                  (platform === 'win' && binding.win) ? binding.win :
                  (platform === 'linux' && binding.linux) ? binding.linux :
                  binding.key;

      if (!key) continue;

      if (matchesBrowserKeybinding(event, key, platform) && this.evaluateWhen(binding.when)) {
        return binding;
      }
    }

    return null;
  }
}

// Main KeybindingManager class
export class KeybindingManager {
  private commandRegistry = new CommandRegistry();
  private matcher = new KeybindingMatcher();
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private isEnabled = true;

  constructor() {
    this.setupGlobalKeyListener();
  }

  private setupGlobalKeyListener() {
    this.keydownHandler = (event: KeyboardEvent) => {
      if (!this.isEnabled || event.defaultPrevented || event.isComposing || browserOwnsShortcut(event)) return;

      // Don't handle if user is typing in an input/textarea
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        // Only handle if it's a modifier-only key combo
        if (!event.metaKey && !event.ctrlKey && !event.altKey) {
          return;
        }
      }

      const binding = this.matcher.findMatchingKeybinding(event);
      if (binding && this.commandRegistry.has(binding.command)) {
        event.preventDefault();
        event.stopPropagation();
        this.commandRegistry.execute(binding.command, binding.args);
      }
    };

    document.addEventListener('keydown', this.keydownHandler, true);
  }

  loadKeybindings(keybindings: KeybindingItem[]) {
    this.matcher.updateKeybindings(keybindings);
  }

  updateContext(context: Partial<ContextState>) {
    this.matcher.updateContext(context);
  }

  registerCommand(command: string, handler: CommandHandler) {
    this.commandRegistry.register(command, handler);
  }

  unregisterCommand(command: string) {
    this.commandRegistry.unregister(command);
  }

  executeCommand(command: string, args?: unknown) {
    return this.commandRegistry.execute(command, args);
  }

  setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
  }

  dispose() {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
  }
}

// Singleton instance
let keybindingManagerInstance: KeybindingManager | null = null;

export function getKeybindingManager(): KeybindingManager {
  if (!keybindingManagerInstance) {
    keybindingManagerInstance = new KeybindingManager();
  }
  return keybindingManagerInstance;
}
