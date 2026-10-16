import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendBookHighlightNote,
  buildBookHighlightEntry,
  filterBookHighlightNotesForTarget,
  findOpenBookNoteDocument,
  getBookNotePath,
  hasHighlightText,
  parseBookHighlightNoteBlock,
  parseBookHighlightNotes,
  removeBookHighlightNote,
  updateBookHighlightNote,
} from './bookNotes.ts';

test('getBookNotePath replaces ebook extension with md in the same directory', () => {
  assert.equal(getBookNotePath('/workspace/books/Demo.epub'), '/workspace/books/Demo.md');
  assert.equal(getBookNotePath('/workspace/books/Demo.pdf'), '/workspace/books/Demo.md');
  assert.equal(getBookNotePath('/workspace/books/Demo'), '/workspace/books/Demo.md');
});

test('findOpenBookNoteDocument resolves the in-memory note across normalized paths', () => {
  const documents = [
    { id: 'book', filePath: '/workspace/books/Demo.epub', content: 'book' },
    { id: 'note', filePath: '/workspace/books/./Demo.md', content: 'unsaved manual note' },
  ];

  assert.deepEqual(
    findOpenBookNoteDocument(documents, '/workspace/books/Demo.md'),
    documents[1],
  );
  assert.equal(findOpenBookNoteDocument(documents, '/workspace/books/Missing.md'), null);
});

test('buildBookHighlightEntry creates a readable note block for epub highlights', () => {
  const entry = buildBookHighlightEntry({
    sourcePath: '/workspace/books/Demo.epub',
    sourceTitle: 'Demo Book',
    format: 'epub',
    text: '  A line\nwith   spacing  ',
    locator: 'Page 2 of 10',
    cfi: 'epubcfi(/6/2!/4/2/10,/1:0,/1:4)',
    createdAt: new Date('2026-06-02T08:00:00.000Z'),
  });
  assert.match(entry, /^```note\n/);
  assert.match(entry, /type: book-highlight\n/);
  assert.match(entry, /source: \.\/Demo\.epub\n/);
  assert.match(entry, /format: epub\n/);
  assert.match(entry, /locator: Page 2 of 10\n/);
  assert.match(entry, /cfi: epubcfi\(/);
  assert.match(entry, /created: 2026-06-02T08:00:00.000Z\n---\nA line with spacing\n```$/);
});

test('appendBookHighlightNote creates a new highlights document when empty', () => {
  const content = appendBookHighlightNote('', {
    sourcePath: '/workspace/books/Demo.pdf',
    format: 'pdf',
    text: 'Selected text',
    locator: 'Page 3',
    page: 3,
    rects: [{ top: 0.1, left: 0.2, width: 0.3, height: 0.04 }],
    createdAt: new Date('2026-06-02T08:00:00.000Z'),
  });
  assert.match(content, /^# Highlights\n\n```note\n/s);
  assert.match(content, /format: pdf\n/);
  assert.match(content, /page: 3\n/);
  assert.match(content, /rects: \[\{"top":0\.1,"left":0\.2,"width":0\.3,"height":0\.04\}\]\n/);
  assert.match(content, /---\nSelected text\n```\n\n$/);
});

test('appendBookHighlightNote preserves existing markdown and appends a blank-line separated item', () => {
  const content = appendBookHighlightNote('# Highlights\n\n- existing\n', {
    sourcePath: '/workspace/books/Demo.pdf',
    format: 'pdf',
    text: 'Next text',
    page: 4,
    createdAt: new Date('2026-06-02T08:00:00.000Z'),
  });
  assert.match(content, /^# Highlights\n\n- existing\n\n```note\n/s);
  assert.match(content, /---\nNext text\n```\n\n$/);
});

test('appendBookHighlightNote preserves user-authored trailing spaces', () => {
  const content = appendBookHighlightNote('# Highlights\n\nManual hard break  ', {
    sourcePath: '/workspace/books/Demo.epub',
    format: 'epub',
    text: 'Next text',
    cfi: 'epubcfi(/6/2)',
    createdAt: new Date('2026-06-02T08:00:00.000Z'),
  });

  assert.match(content, /Manual hard break  \n\n```note/);
});

test('buildBookHighlightEntry expands fences when quote contains backticks', () => {
  const content = buildBookHighlightEntry({
    sourcePath: '/workspace/books/Demo.epub',
    format: 'epub',
    text: 'before\n```\nafter',
    cfi: 'epubcfi(/6/2)',
    createdAt: new Date('2026-06-02T08:00:00.000Z'),
  });

  assert.match(content, /^````note\n/);
  assert.match(content, /\n````$/);
});

test('parseBookHighlightNoteBlock parses note metadata and body', () => {
  const parsed = parseBookHighlightNoteBlock([
    'type: book-highlight',
    'source: ./Demo.pdf',
    'title: Demo',
    'format: pdf',
    'locator: Page 7',
    'page: 7',
    'rects: [{"top":0.1,"left":0.2,"width":0.3,"height":0.04}]',
    'created: 2026-06-02T08:00:00.000Z',
    '---',
    'Selected text',
  ].join('\n'));

  assert.deepEqual(parsed, {
    type: 'book-highlight',
    source: './Demo.pdf',
    title: 'Demo',
    format: 'pdf',
    locator: 'Page 7',
    cfi: null,
    page: 7,
    rects: [{ top: 0.1, left: 0.2, width: 0.3, height: 0.04 }],
    created: '2026-06-02T08:00:00.000Z',
    text: 'Selected text',
    note: '',
  });
});

test('parseBookHighlightNoteBlock reads optional reader reflection after second separator', () => {
  const parsed = parseBookHighlightNoteBlock([
    'type: book-highlight',
    'source: ./Demo.epub',
    'title: Demo',
    'format: epub',
    'cfi: epubcfi(/6/2)',
    'created: 2026-06-02T08:00:00.000Z',
    '---',
    'Quoted line',
    '---',
    'First thought',
    '',
    'Second thought',
  ].join('\n'));

  assert.equal(parsed?.text, 'Quoted line');
  assert.equal(parsed?.note, 'First thought\n\nSecond thought');
});

test('buildBookHighlightEntry writes reflection after a second body separator', () => {
  const entry = buildBookHighlightEntry({
    sourcePath: '/workspace/books/Demo.epub',
    sourceTitle: 'Demo Book',
    format: 'epub',
    text: 'Quoted line',
    note: 'My reflection\nspanning lines',
    cfi: 'epubcfi(/6/2)',
    createdAt: new Date('2026-06-02T08:00:00.000Z'),
  });
  assert.match(entry, /---\nQuoted line\n---\nMy reflection\nspanning lines\n```$/);
});

test('parseBookHighlightNotes extracts all structured highlight note blocks', () => {
  const content = [
    '# Highlights',
    '',
    '```note',
    'type: book-highlight',
    'source: ./Demo.epub',
    'title: Demo',
    'format: epub',
    'cfi: epubcfi(/6/2)',
    'created: 2026-06-02T08:00:00.000Z',
    '---',
    'First text',
    '```',
    '',
    '```note',
    'remember this ordinary note',
    '```',
    '',
    '````note',
    'type: book-highlight',
    'source: ./Demo.pdf',
    'title: Demo PDF',
    'format: pdf',
    'page: 2',
    'rects: [{"top":0.1,"left":0.2,"width":0.3,"height":0.04}]',
    'created: 2026-06-02T08:01:00.000Z',
    '---',
    'Second text with ``` inside',
    '````',
  ].join('\n');

  const notes = parseBookHighlightNotes(content);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].format, 'epub');
  assert.equal(notes[0].cfi, 'epubcfi(/6/2)');
  assert.equal(notes[0].text, 'First text');
  assert.equal(notes[1].format, 'pdf');
  assert.equal(notes[1].page, 2);
  assert.equal(notes[1].text, 'Second text with ``` inside');
});

test('filterBookHighlightNotesForTarget keeps only valid notes for the current book', () => {
  const notes = parseBookHighlightNotes([
    '```note',
    'type: book-highlight',
    'source: ./Demo.epub',
    'format: epub',
    'cfi: epubcfi(/6/2)',
    '---',
    'EPUB text',
    '```',
    '',
    '```note',
    'type: book-highlight',
    'source: ./Other.epub',
    'format: epub',
    'cfi: epubcfi(/6/4)',
    '---',
    'Other text',
    '```',
    '',
    '```note',
    'type: book-highlight',
    'source: ./Demo.pdf',
    'format: pdf',
    'page: 3',
    'rects: [{"top":0.1,"left":0.2,"width":0.3,"height":0.04}]',
    '---',
    'PDF text',
    '```',
    '',
    '```note',
    'type: book-highlight',
    'source: ./Demo.pdf',
    'format: pdf',
    'page: 4',
    '---',
    'Missing rects',
    '```',
  ].join('\n'));

  assert.deepEqual(
    filterBookHighlightNotesForTarget(notes, { sourcePath: '/workspace/books/Demo.epub', format: 'epub' }).map((note) => note.text),
    ['EPUB text'],
  );
  assert.deepEqual(
    filterBookHighlightNotesForTarget(notes, { sourcePath: '/workspace/books/Demo.pdf', format: 'pdf' }).map((note) => note.text),
    ['PDF text'],
  );
});

test('hasHighlightText rejects whitespace-only selections', () => {
  assert.equal(hasHighlightText(' \n\t '), false);
  assert.equal(hasHighlightText(' text '), true);
});

test('removeBookHighlightNote removes a matching epub highlight block', () => {
  const content = [
    '# Highlights',
    '',
    'Intro text',
    '',
    '```note',
    'type: book-highlight',
    'source: ./Demo.epub',
    'format: epub',
    'cfi: epubcfi(/6/2)',
    '---',
    'Remove me',
    '```',
    '',
    '```note',
    'type: book-highlight',
    'source: ./Demo.epub',
    'format: epub',
    'cfi: epubcfi(/6/4)',
    '---',
    'Keep me',
    '```',
  ].join('\n');

  const result = removeBookHighlightNote(content, {
    sourcePath: '/workspace/books/Demo.epub',
    format: 'epub',
    cfi: 'epubcfi(/6/2)',
  });

  assert.equal(result.removed, 1);
  assert.doesNotMatch(result.content, /Remove me/);
  assert.match(result.content, /Intro text/);
  assert.match(result.content, /Keep me/);
  assert.match(result.content, /\n\n$/);
});

test('removeBookHighlightNote removes a matching pdf highlight block by page and rects', () => {
  const content = [
    '# Highlights',
    '',
    '```note',
    'type: book-highlight',
    'source: ./Demo.pdf',
    'format: pdf',
    'page: 2',
    'rects: [{"top":0.1,"left":0.2,"width":0.3,"height":0.04}]',
    '---',
    'Remove PDF',
    '```',
    '',
    '```note',
    'type: book-highlight',
    'source: ./Other.pdf',
    'format: pdf',
    'page: 2',
    'rects: [{"top":0.1,"left":0.2,"width":0.3,"height":0.04}]',
    '---',
    'Keep other source',
    '```',
  ].join('\n');

  const result = removeBookHighlightNote(content, {
    sourcePath: '/workspace/books/Demo.pdf',
    format: 'pdf',
    page: 2,
    rects: [{ top: 0.100001, left: 0.2, width: 0.3, height: 0.04 }],
  });

  assert.equal(result.removed, 1);
  assert.doesNotMatch(result.content, /Remove PDF/);
  assert.match(result.content, /Keep other source/);
  assert.match(result.content, /\n\n$/);
});

test('removeBookHighlightNote only normalizes whitespace at the removed block seam', () => {
  const content = [
    'Manual one',
    '',
    '',
    'Manual two  ',
    '',
    '```note',
    'type: book-highlight',
    'source: ./Demo.epub',
    'format: epub',
    'cfi: epubcfi(/6/2)',
    '---',
    'Remove me',
    '```',
    '',
    'Manual tail  ',
  ].join('\n');

  const result = removeBookHighlightNote(content, {
    sourcePath: '/workspace/books/Demo.epub',
    format: 'epub',
    cfi: 'epubcfi(/6/2)',
  });

  assert.equal(result.removed, 1);
  assert.match(result.content, /Manual one\n\n\nManual two  \n\nManual tail  \n\n$/);
});

test('updateBookHighlightNote sets and clears reader reflection', () => {
  const content = [
    '# Highlights',
    '',
    '```note',
    'type: book-highlight',
    'source: ./Demo.epub',
    'title: Demo',
    'format: epub',
    'cfi: epubcfi(/6/2)',
    'created: 2026-06-02T08:00:00.000Z',
    '---',
    'Quoted line',
    '```',
    '',
  ].join('\n');

  const withNote = updateBookHighlightNote(content, {
    sourcePath: '/workspace/books/Demo.epub',
    format: 'epub',
    cfi: 'epubcfi(/6/2)',
    note: 'A reflection',
  });
  assert.equal(withNote.updated, 1);
  assert.match(withNote.content, /---\nQuoted line\n---\nA reflection\n```/);
  assert.equal(parseBookHighlightNotes(withNote.content)[0]?.note, 'A reflection');

  const cleared = updateBookHighlightNote(withNote.content, {
    sourcePath: '/workspace/books/Demo.epub',
    format: 'epub',
    cfi: 'epubcfi(/6/2)',
    note: '',
  });
  assert.equal(cleared.updated, 1);
  assert.match(cleared.content, /---\nQuoted line\n```/);
  assert.doesNotMatch(cleared.content, /A reflection/);
  assert.equal(parseBookHighlightNotes(cleared.content)[0]?.note, '');
});
