import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SETI_FILE_ICON_FONT_SIZE,
  SETI_FILE_ICON_THEME_VERSION,
  hasFileLikeEditorIdentity,
  resolveFileIcon,
} from './setiFileIcon.ts';

function definitionId(filePath: string, scheme: 'light' | 'dark' = 'dark'): string {
  return resolveFileIcon({ filePath, scheme }).definitionId;
}

test('EPUB files and directory packages resolve to the same book icon by extension', () => {
  const longName = '/read/21世纪的公司现代企业商业运作原理与模式 (约翰·凯) (z-library.sk, 1lib.sk, z-lib.sk).epub';

  assert.equal(definitionId(longName), '_notebook');
  assert.equal(definitionId('/read/反脆弱.epub'), '_notebook');
  assert.equal(definitionId('/read/BOOK.EPUB'), '_notebook');
  assert.equal(definitionId(longName, 'light'), '_notebook_light');
});

test('Seti CSS escapes are decoded to one renderable font glyph', () => {
  const epub = resolveFileIcon({ filePath: '/read/反脆弱.epub', scheme: 'light' });
  const markdown = resolveFileIcon({ filePath: '/notes/index.md', scheme: 'light' });

  assert.equal(epub.glyph, String.fromCodePoint(0xe066));
  assert.equal(markdown.glyph, String.fromCodePoint(0xe060));
  assert.equal([...epub.glyph].length, 1);
  assert.equal([...markdown.glyph].length, 1);
  assert.doesNotMatch(epub.glyph, /^\\/);
  assert.doesNotMatch(markdown.glyph, /^\\/);
});

test('Seti resolution covers document, data, image and language-backed file types', () => {
  assert.equal(definitionId('/notes/chapter.md'), '_markdown');
  assert.equal(definitionId('/docs/paper.pdf'), '_pdf');
  assert.equal(definitionId('/docs/report.docx'), '_word');
  assert.equal(definitionId('/data/report.xlsx'), '_xls');
  assert.equal(definitionId('/data/report.csv'), '_csv');
  assert.equal(definitionId('/site/index.html'), '_html_3');
  assert.equal(definitionId('/data/settings.json'), '_json');
  assert.equal(definitionId('/data/settings.yaml'), '_yml');
  assert.equal(definitionId('/images/cover.png'), '_image');
  assert.equal(definitionId('/src/index.ts'), '_typescript');
  assert.equal(definitionId('/src/view.tsx'), '_react');
});

test('file names outrank compound extensions, which outrank detected languages', () => {
  const readme = resolveFileIcon({ filePath: '/repo/README.md', scheme: 'dark' });
  const testTypeScript = resolveFileIcon({ filePath: '/repo/view.test.ts', scheme: 'dark' });
  const normalTypeScript = resolveFileIcon({ filePath: '/repo/view.ts', scheme: 'dark' });

  assert.equal(readme.definitionId, '_info');
  assert.equal(readme.source, 'fileName');
  assert.equal(testTypeScript.definitionId, '_typescript_1');
  assert.equal(testTypeScript.source, 'extension');
  assert.equal(normalTypeScript.definitionId, '_typescript');
  assert.equal(normalTypeScript.source, 'language');
});

test('resolution is path-style agnostic and falls back safely', () => {
  assert.equal(definitionId('C:\\workspace\\notes\\guide.md'), '_markdown');
  assert.equal(definitionId('/workspace/file.unknown-hulala-type'), '_default');

  const untitled = resolveFileIcon({ fileName: 'Untitled', editorId: 'markdown', scheme: 'dark' });
  assert.equal(untitled.definitionId, '_markdown');
  assert.equal(untitled.source, 'editor');
});

test('light and dark schemes use their corresponding Seti definitions', () => {
  const light = resolveFileIcon({ filePath: '/notes/chapter.md', scheme: 'light' });
  const dark = resolveFileIcon({ filePath: '/notes/chapter.md', scheme: 'dark' });

  assert.equal(light.definitionId, '_markdown_light');
  assert.equal(dark.definitionId, '_markdown');
  assert.notEqual(light.color, dark.color);
});

test('light associations inherit base entries and glyph-only definitions inherit color', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const filePath of ['/repo/todo', '/repo/todo.txt', '/repo/todo.md']) {
      const icon = resolveFileIcon({ filePath, scheme });
      assert.equal(icon.definitionId, '_todo');
      assert.equal(icon.glyph, String.fromCodePoint(0xe096));
      assert.equal(icon.color, 'currentColor');
      assert.equal(icon.source, 'fileName');
    }
  }
});

test('only file-backed and unsaved text editors receive file identity in tabs', () => {
  assert.equal(hasFileLikeEditorIdentity('/books/book.epub', 'book'), true);
  assert.equal(hasFileLikeEditorIdentity(null, 'markdown'), true);
  assert.equal(hasFileLikeEditorIdentity(null, 'text'), true);
  assert.equal(hasFileLikeEditorIdentity(null, 'desktop-settings'), false);
  assert.equal(hasFileLikeEditorIdentity(null, 'marketplace'), false);
});

test('the vendored Seti mapping stays pinned to the reviewed upstream version', () => {
  assert.equal(
    SETI_FILE_ICON_THEME_VERSION,
    'https://github.com/jesseweed/seti-ui/commit/2d6c5e68b4ded73c92dac291845ee44e1182d511',
  );
  assert.equal(SETI_FILE_ICON_FONT_SIZE, '150%');
});
