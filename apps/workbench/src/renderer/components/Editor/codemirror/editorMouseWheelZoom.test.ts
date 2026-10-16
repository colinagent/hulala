import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_EDITOR_FONT_SIZE,
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  clampEditorFontSize,
  formatEditorFontSizePercent,
  hasEditorMouseWheelZoomModifiers,
  isLikelyPhysicalMouseWheel,
  nextEditorFontSizeForPhysicalWheel,
  nextEditorFontSizeForTrackpadGesture,
  type EditorWheelZoomEvent,
} from './editorMouseWheelZoom';

function wheelEvent(patch: Partial<EditorWheelZoomEvent>): EditorWheelZoomEvent {
  return {
    altKey: false,
    ctrlKey: false,
    deltaMode: 0,
    deltaY: 0,
    metaKey: false,
    shiftKey: false,
    ...patch,
  };
}

test('editor font size clamps to safe bounds', () => {
  assert.equal(DEFAULT_EDITOR_FONT_SIZE, 16);
  assert.equal(clampEditorFontSize(Number.NaN), DEFAULT_EDITOR_FONT_SIZE);
  assert.equal(clampEditorFontSize(EDITOR_FONT_SIZE_MIN - 1), EDITOR_FONT_SIZE_MIN);
  assert.equal(clampEditorFontSize(EDITOR_FONT_SIZE_MAX + 1), EDITOR_FONT_SIZE_MAX);
  assert.equal(clampEditorFontSize(13.26), 13.3);
});

test('editor wheel zoom modifiers match VS Code on macOS', () => {
  assert.equal(hasEditorMouseWheelZoomModifiers(wheelEvent({ metaKey: true }), 'darwin'), true);
  assert.equal(hasEditorMouseWheelZoomModifiers(wheelEvent({ ctrlKey: true }), 'darwin'), true);
  assert.equal(hasEditorMouseWheelZoomModifiers(wheelEvent({ metaKey: true, shiftKey: true }), 'darwin'), false);
  assert.equal(hasEditorMouseWheelZoomModifiers(wheelEvent({ metaKey: true, altKey: true }), 'darwin'), false);
});

test('editor wheel zoom modifiers use Ctrl outside macOS', () => {
  assert.equal(hasEditorMouseWheelZoomModifiers(wheelEvent({ ctrlKey: true }), 'linux'), true);
  assert.equal(hasEditorMouseWheelZoomModifiers(wheelEvent({ metaKey: true }), 'linux'), false);
  assert.equal(hasEditorMouseWheelZoomModifiers(wheelEvent({ ctrlKey: true, metaKey: true }), 'linux'), false);
});

test('detects likely physical wheel events', () => {
  assert.equal(isLikelyPhysicalMouseWheel(wheelEvent({ deltaY: 120 })), true);
  assert.equal(isLikelyPhysicalMouseWheel(wheelEvent({ deltaMode: 1, deltaY: 3 })), true);
  assert.equal(isLikelyPhysicalMouseWheel(wheelEvent({ deltaY: 2.5 })), false);
});

test('physical wheel zooms by 10 percent steps', () => {
  assert.equal(formatEditorFontSizePercent(nextEditorFontSizeForPhysicalWheel(DEFAULT_EDITOR_FONT_SIZE, -100)), '110%');
  assert.equal(formatEditorFontSizePercent(nextEditorFontSizeForPhysicalWheel(DEFAULT_EDITOR_FONT_SIZE, 100)), '90%');
  assert.equal(nextEditorFontSizeForPhysicalWheel(EDITOR_FONT_SIZE_MAX, -100), EDITOR_FONT_SIZE_MAX);
  assert.equal(nextEditorFontSizeForPhysicalWheel(EDITOR_FONT_SIZE_MIN, 100), EDITOR_FONT_SIZE_MIN);
});

test('physical wheel zooms down from displayed 110 percent to 100 percent', () => {
  const displayed110Percent = DEFAULT_EDITOR_FONT_SIZE * 1.1;

  assert.equal(formatEditorFontSizePercent(displayed110Percent), '110%');
  assert.equal(formatEditorFontSizePercent(nextEditorFontSizeForPhysicalWheel(displayed110Percent, 100)), '100%');
});

test('trackpad gesture snaps accumulated deltas to 10 percent steps', () => {
  assert.equal(formatEditorFontSizePercent(nextEditorFontSizeForTrackpadGesture(DEFAULT_EDITOR_FONT_SIZE, -5)), '110%');
  assert.equal(formatEditorFontSizePercent(nextEditorFontSizeForTrackpadGesture(DEFAULT_EDITOR_FONT_SIZE, 5)), '90%');
  assert.equal(nextEditorFontSizeForTrackpadGesture(EDITOR_FONT_SIZE_MAX, -20), EDITOR_FONT_SIZE_MAX);
});
