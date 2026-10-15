import assert from 'node:assert/strict';
import test from 'node:test';

import { compactStatusBarPath, formatStatusBarPathDisplay } from './statusBarPath.ts';

const workspaceDir = '/Users/example/.config/hulala/workspace';

test('formatStatusBarPathDisplay shows workspace when no file is active', () => {
  assert.deepEqual(formatStatusBarPathDisplay(workspaceDir, null), {
    label: workspaceDir,
    fullLabel: workspaceDir,
  });
  assert.deepEqual(formatStatusBarPathDisplay(workspaceDir, ''), {
    label: workspaceDir,
    fullLabel: workspaceDir,
  });
});

test('formatStatusBarPathDisplay preserves long workspace paths when no file is active', () => {
  const longWorkspace = '/Users/example/very/long/workspace/path/that/must/remain/visible';
  assert.deepEqual(formatStatusBarPathDisplay(longWorkspace, null), {
    label: longWorkspace,
    fullLabel: longWorkspace,
  });
});

test('formatStatusBarPathDisplay shows No folder when workspace and file are empty', () => {
  assert.deepEqual(formatStatusBarPathDisplay(null, null), {
    label: 'No folder',
    fullLabel: 'No folder',
  });
});

test('formatStatusBarPathDisplay preserves short active file paths', () => {
  const shortWorkspaceDir = '/work';
  const filePath = `${shortWorkspaceDir}/notes/foo.md`;
  assert.deepEqual(
    formatStatusBarPathDisplay(shortWorkspaceDir, filePath),
    {
      label: filePath,
      fullLabel: filePath,
    },
  );
});

test('formatStatusBarPathDisplay does not duplicate workspace when file equals dir', () => {
  assert.deepEqual(formatStatusBarPathDisplay(workspaceDir, workspaceDir), {
    label: workspaceDir,
    fullLabel: workspaceDir,
  });
});

test('formatStatusBarPathDisplay preserves short file paths outside workspace', () => {
  const shortOutsidePath = '/agents/AGENT.md';
  assert.deepEqual(formatStatusBarPathDisplay('/work', shortOutsidePath), {
    label: shortOutsidePath,
    fullLabel: shortOutsidePath,
  });
});

test('formatStatusBarPathDisplay normalizes trailing slashes', () => {
  const shortWorkspaceDir = '/work';
  const filePath = `${shortWorkspaceDir}/notes/foo.md`;
  assert.deepEqual(
    formatStatusBarPathDisplay(`${shortWorkspaceDir}/`, `${filePath}/`),
    {
      label: filePath,
      fullLabel: filePath,
    },
  );
});

test('compactStatusBarPath preserves 18 leading and 25 trailing Unicode characters', () => {
  const longPath = '/Users/example/资料/诸子百家系列套装【套装全二十册】/孟子荀子老子列子庄子墨子公孙龙子韩非子淮南子鬼谷子管子孙子兵法.epub';
  const characters = Array.from(longPath);

  assert.equal(
    compactStatusBarPath(longPath),
    `${characters.slice(0, 18).join('')}…${characters.slice(-25).join('')}`,
  );
  assert.equal(Array.from(compactStatusBarPath(longPath)).length, 44);
});

test('formatStatusBarPathDisplay preserves the directory and compacts only a long file name', () => {
  const longFileName = 'this-is-a-very-long-book-name-that-needs-middle-compaction.epub';
  const longPath = `/Users/example/notes/this-is-a-very-long-folder/${longFileName}`;
  const display = formatStatusBarPathDisplay(workspaceDir, longPath);

  assert.notEqual(display.label, longPath);
  assert.equal(
    display.label,
    `/Users/example/notes/this-is-a-very-long-folder/${compactStatusBarPath(longFileName)}`,
  );
  assert.equal(display.fullLabel, longPath);
});

test('formatStatusBarPathDisplay never compacts a long directory when the file name is short', () => {
  const longDirectoryPath = '/Users/example/a/very/long/directory/path/that/exceeds/the/status/file/name/limit/book.epub';
  assert.deepEqual(formatStatusBarPathDisplay(workspaceDir, longDirectoryPath), {
    label: longDirectoryPath,
    fullLabel: longDirectoryPath,
  });
});

test('long EPUB labels preserve the beginning and end of the book file name', () => {
  const fileName = '诸子百家系列套装【套装全二十册】(孟子、荀子、老子、列子、庄子、墨子、公孙龙子、韩非子、淮南子、鬼谷子、管子、孙子兵法) (z-library.sk, 1lib.sk, z-lib.sk).epub';
  const fullPath = `/Users/example/note/raw/read/${fileName}`;
  const display = formatStatusBarPathDisplay('/Users/example/note', fullPath);

  assert.equal(display.label, `/Users/example/note/raw/read/${compactStatusBarPath(fileName)}`);
  assert.ok(display.label.startsWith('/Users/example/note/raw/read/诸子百家系列套装'));
  assert.ok(display.label.endsWith('z-lib.sk).epub'));
  assert.equal(display.fullLabel, fullPath);
});
