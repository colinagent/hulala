const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH_BYTES = 65_557;

export const WORD_ARCHIVE_BUDGET = Object.freeze({
  maxCompressedBytes: 50 * 1024 * 1024,
  maxUncompressedBytes: 200 * 1024 * 1024,
  maxEntryBytes: 100 * 1024 * 1024,
  maxEntries: 2_048,
  maxCompressionRatio: 100,
});

export type WordArchiveInspection = {
  entryCount: number;
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
};

function archiveError(message: string): never {
  throw new Error(`Unsafe or unsupported DOCX archive: ${message}`);
}

function findEndOfCentralDirectory(view: DataView): number {
  const start = Math.max(0, view.byteLength - MAX_EOCD_SEARCH_BYTES);
  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return archiveError('ZIP directory is missing');
}

function decodeEntryName(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some((value) => value >= 0x80)) {
    return archiveError('non-UTF-8 entry names are not supported');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return archiveError('entry name is not valid UTF-8');
  }
}

function validateEntryName(name: string) {
  const normalized = name.replace(/\\/g, '/').toLowerCase();
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    archiveError('entry path is invalid');
  }
  if (
    normalized.startsWith('word/afchunk')
    || normalized.endsWith('.mht')
    || normalized.endsWith('.mhtml')
    || normalized.endsWith('.html')
    || normalized.endsWith('.htm')
  ) {
    archiveError('altChunk/HTML content is not rendered');
  }
}

export function inspectWordArchive(data: ArrayBuffer): WordArchiveInspection {
  if (data.byteLength === 0) {
    archiveError('document is empty');
  }
  if (data.byteLength > WORD_ARCHIVE_BUDGET.maxCompressedBytes) {
    archiveError('compressed file exceeds 50 MB');
  }

  const view = new DataView(data);
  const eocdOffset = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const directoryDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const directorySize = view.getUint32(eocdOffset + 12, true);
  const directoryOffset = view.getUint32(eocdOffset + 16, true);

  if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
    archiveError('multi-disk ZIP files are not supported');
  }
  if (entryCount === 0 || entryCount > WORD_ARCHIVE_BUDGET.maxEntries) {
    archiveError(`entry count exceeds ${WORD_ARCHIVE_BUDGET.maxEntries}`);
  }
  if (directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    archiveError('ZIP64 is not supported for preview');
  }
  if (directoryOffset + directorySize > eocdOffset) {
    archiveError('ZIP directory is outside the archive');
  }

  const archiveBytes = new Uint8Array(data);
  const names = new Set<string>();
  let offset = directoryOffset;
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      archiveError('central directory entry is invalid');
    }
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedBytes = view.getUint32(offset + 20, true);
    const uncompressedBytes = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;

    if (
      compressedBytes === 0xffffffff
      || uncompressedBytes === 0xffffffff
      || localHeaderOffset === 0xffffffff
    ) {
      archiveError('ZIP64 entries are not supported for preview');
    }
    if ((flags & 0x1) !== 0) {
      archiveError('encrypted entries are not supported');
    }
    if (compression !== 0 && compression !== 8) {
      archiveError(`compression method ${compression} is not supported`);
    }
    if (nextOffset > eocdOffset || localHeaderOffset + 30 > directoryOffset) {
      archiveError('entry boundaries are invalid');
    }
    if (view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_SIGNATURE) {
      archiveError('local ZIP entry is invalid');
    }

    const name = decodeEntryName(
      archiveBytes.subarray(offset + 46, offset + 46 + nameLength),
      (flags & 0x800) !== 0,
    );
    validateEntryName(name);
    names.add(name.toLowerCase());

    if (uncompressedBytes > WORD_ARCHIVE_BUDGET.maxEntryBytes) {
      archiveError('a single entry exceeds 100 MB');
    }
    if (
      compressedBytes >= 1024
      && uncompressedBytes / compressedBytes > WORD_ARCHIVE_BUDGET.maxCompressionRatio
    ) {
      archiveError(`an entry exceeds the ${WORD_ARCHIVE_BUDGET.maxCompressionRatio}:1 compression ratio`);
    }
    totalCompressedBytes += compressedBytes;
    totalUncompressedBytes += uncompressedBytes;
    if (totalUncompressedBytes > WORD_ARCHIVE_BUDGET.maxUncompressedBytes) {
      archiveError('expanded document exceeds 200 MB');
    }
    offset = nextOffset;
  }

  if (offset !== directoryOffset + directorySize) {
    archiveError('central directory size does not match its entries');
  }
  if (!names.has('[content_types].xml') || !names.has('word/document.xml')) {
    archiveError('required Word document parts are missing');
  }

  return { entryCount, totalCompressedBytes, totalUncompressedBytes };
}

export type WordSelectionContext = {
  canonicalUri: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  page: number | null;
};
