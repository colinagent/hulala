import { expect, test } from 'bun:test'
import { browserOwnsShortcut, matchesBrowserKeybinding, keybindingPlatform } from './keybindingManager'

const event = (key: string, patch: Partial<KeyboardEvent> = {}) => ({ key, code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...patch })
test('client platform wins over a browser compatibility user agent', () => {
  expect(keybindingPlatform('Linux x86_64', 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit')).toBe('linux')
  expect(keybindingPlatform('MacIntel', 'Mozilla/5.0')).toBe('mac')
  expect(keybindingPlatform('Win32', 'Mozilla/5.0')).toBe('win')
})
test('browser tab, navigation and zoom shortcuts cannot be reassigned by app bindings', () => {
  for (const key of ['t', 'w', 'n', 'l', 'r', '0', '1', '9', '+', '=', '-']) {
    expect(browserOwnsShortcut(event(key, { metaKey: true }))).toBe(true)
    expect(matchesBrowserKeybinding(event(key, { ctrlKey: true }), 'ctrl+' + key, 'win')).toBe(false)
  }
  expect(browserOwnsShortcut(event('F5'))).toBe(true)
  expect(browserOwnsShortcut(event('ArrowLeft', { altKey: true }))).toBe(true)
})
test('application bindings require exact modifiers and platform-specific primary key', () => {
  expect(matchesBrowserKeybinding(event(',', { metaKey: true }), 'cmd+,', 'mac')).toBe(true)
  expect(matchesBrowserKeybinding(event(',', { ctrlKey: true }), 'cmd+,', 'linux')).toBe(true)
  expect(matchesBrowserKeybinding(event('F', { ctrlKey: true, shiftKey: true }), 'cmd+shift+f', 'win')).toBe(true)
  expect(matchesBrowserKeybinding(event(',', { metaKey: true, shiftKey: true }), 'cmd+,', 'mac')).toBe(false)
  expect(matchesBrowserKeybinding(event('f', { ctrlKey: true }), 'cmd+shift+f', 'win')).toBe(false)
  expect(matchesBrowserKeybinding(event('s', { metaKey: true }), 'cmd+k cmd+s', 'mac')).toBe(false)
})
