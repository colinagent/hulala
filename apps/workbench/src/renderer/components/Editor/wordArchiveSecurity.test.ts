import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import test from 'node:test';
import {
  inspectWordArchive,
} from './wordArchiveSecurity.ts';

async function fixture(name: string): Promise<ArrayBuffer> {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>合成测试文档</w:t></w:r></w:p></w:body></w:document>'),
  };
  if (name === 'altchunk.docx') entries['word/afchunk.html'] = strToU8('<html>test</html>');
  if (name === 'header-footer-contract.docx') entries['word/header1.xml'] = strToU8('<header/>');
  if (name === 'table-contract.docx') entries['word/styles.xml'] = strToU8('<styles/>');
  return Uint8Array.from(zipSync(entries)).buffer;
}

test('accepts synthetic Word archives without importing document data', async () => {
  for (const name of ['chinese-contract.docx', 'table-contract.docx', 'header-footer-contract.docx']) {
    const result = inspectWordArchive(await fixture(name));
    assert.ok(result.entryCount > 0);
    assert.ok(result.totalUncompressedBytes > 0);
  }
});

test('rejects corrupt archives and altChunk content before rendering', async () => {
  assert.throws(() => inspectWordArchive(new ArrayBuffer(12)), /ZIP directory is missing/);
  await assert.rejects(async () => inspectWordArchive(await fixture('altchunk.docx')), /altChunk\/HTML content/);
});

test('rejects an entry whose declared expanded size exceeds the per-entry budget', async () => {
  const source = new Uint8Array(await fixture('chinese-contract.docx'));
  const copy = source.slice();
  const view = new DataView(copy.buffer);
  let centralDirectoryOffset = -1;
  for (let offset = 0; offset <= copy.length - 4; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      centralDirectoryOffset = offset;
      break;
    }
  }
  assert.ok(centralDirectoryOffset >= 0);
  view.setUint32(centralDirectoryOffset + 24, 101 * 1024 * 1024, true);
  assert.throws(() => inspectWordArchive(copy.buffer), /single entry exceeds 100 MB/);
});
