import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDirectoryPickerBreadcrumbs,
  buildDirectoryPickerRows,
  dedupeDirectoryPickerPaths,
  detectDirectoryPickerPathStyle,
  directoryPickerPathsEqual,
  getDirectoryPickerBaseName,
  getDirectoryPickerParentPath,
  joinDirectoryPickerPath,
  normalizeDirectoryPickerPath,
  parseDirectoryPickerInput,
  sortDirectoryPickerEntries,
} from './directoryPickerModel';

test('normalizeDirectoryPickerPath normalizes posix paths', () => {
  assert.equal(normalizeDirectoryPickerPath('/Users//example///code/'), '/Users/example/code');
  assert.equal(normalizeDirectoryPickerPath('/'), '/');
  assert.equal(detectDirectoryPickerPathStyle('/Users/example'), 'posix');
});

test('parseDirectoryPickerInput supports posix browsing and filter mode', () => {
  assert.deepEqual(parseDirectoryPickerInput('/Users/example/code/'), {
    normalizedInput: '/Users/example/code',
    browseDir: '/Users/example/code',
    filter: '',
    valid: true,
  });

  assert.deepEqual(parseDirectoryPickerInput('/Users/example/co'), {
    normalizedInput: '/Users/example/co',
    browseDir: '/Users/example',
    filter: 'co',
    valid: true,
  });
});

test('windows helpers normalize, compare, and resolve parent correctly', () => {
  assert.equal(normalizeDirectoryPickerPath('C:/Users//Example/'), 'C:\\Users\\Example');
  assert.equal(getDirectoryPickerParentPath('C:\\Users\\Example'), 'C:\\Users');
  assert.equal(getDirectoryPickerParentPath('C:\\'), 'C:\\');
  assert.equal(getDirectoryPickerBaseName('C:\\Users\\Example'), 'Example');
  assert.equal(directoryPickerPathsEqual('C:\\Users\\Example', 'c:/users/example'), true);
  assert.equal(detectDirectoryPickerPathStyle('C:\\Users\\Example'), 'windows');
});

test('buildDirectoryPickerBreadcrumbs returns clickable breadcrumb chain', () => {
  assert.deepEqual(buildDirectoryPickerBreadcrumbs('/Users/example/code'), [
    { key: '/', label: '/', path: '/', isRoot: true },
    { key: '/Users', label: 'Users', path: '/Users', isRoot: false },
    { key: '/Users/example', label: 'example', path: '/Users/example', isRoot: false },
    { key: '/Users/example/code', label: 'code', path: '/Users/example/code', isRoot: false },
  ]);

  assert.deepEqual(buildDirectoryPickerBreadcrumbs('C:\\Users\\Example'), [
    { key: 'C:\\', label: 'C:\\', path: 'C:\\', isRoot: true },
    { key: 'C:\\Users', label: 'Users', path: 'C:\\Users', isRoot: false },
    { key: 'C:\\Users\\Example', label: 'Example', path: 'C:\\Users\\Example', isRoot: false },
  ]);
});

test('sortDirectoryPickerEntries keeps directories first and dot directories last', () => {
  const sorted = sortDirectoryPickerEntries([
    { name: '.git', isDir: true, size: 0, modTime: 0 },
    { name: 'src', isDir: true, size: 0, modTime: 0 },
    { name: 'README.md', isDir: false, size: 10, modTime: 0 },
    { name: 'docs', isDir: true, size: 0, modTime: 0 },
  ]);

  assert.deepEqual(sorted.map((entry) => entry.name), ['docs', 'src', '.git', 'README.md']);
});

test('buildDirectoryPickerRows adds parent row and filters by prefix', () => {
  const rows = buildDirectoryPickerRows({
    browseDir: '/Users/example',
    filter: 'co',
    entries: [
      { name: 'code', isDir: true, size: 0, modTime: 0 },
      { name: 'config', isDir: true, size: 0, modTime: 0 },
      { name: 'notes.md', isDir: false, size: 0, modTime: 0 },
    ],
  });

  assert.deepEqual(rows, [
    { key: '..', label: '..', path: '/Users', isParent: true },
    { key: 'code', label: 'code', path: '/Users/example/code', isParent: false },
    { key: 'config', label: 'config', path: '/Users/example/config', isParent: false },
  ]);
});

test('joinDirectoryPickerPath joins paths correctly for posix and windows', () => {
  assert.equal(joinDirectoryPickerPath('/', 'Users'), '/Users');
  assert.equal(joinDirectoryPickerPath('/Users', 'example'), '/Users/example');
  assert.equal(joinDirectoryPickerPath('/Users/example', 'code'), '/Users/example/code');
  assert.equal(joinDirectoryPickerPath('C:\\', 'Users'), 'C:\\Users');
  assert.equal(joinDirectoryPickerPath('C:\\Users', 'Example'), 'C:\\Users\\Example');
});

test('dedupeDirectoryPickerPaths keeps first occurrence and normalizes windows casing', () => {
  assert.deepEqual(dedupeDirectoryPickerPaths(['/Users/example', '/Users/example/', '/Users/example/code']), [
    '/Users/example',
    '/Users/example/code',
  ]);

  assert.deepEqual(dedupeDirectoryPickerPaths(['C:\\Users\\Example', 'c:/users/example', 'C:\\Users\\Example\\Code']), [
    'C:\\Users\\Example',
    'C:\\Users\\Example\\Code',
  ]);
});
