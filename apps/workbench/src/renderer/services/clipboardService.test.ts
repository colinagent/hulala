import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { writeClipboardImageFromElement, writeClipboardText } from './clipboardService';

type StubbedGlobalName = 'window' | 'navigator' | 'document' | 'ClipboardItem';

function stubGlobal(name: StubbedGlobalName, value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
      return;
    }
    Reflect.deleteProperty(globalThis, name);
  };
}

function stubGlobals(t: TestContext, values: Partial<Record<StubbedGlobalName, unknown>>) {
  const restores = Object.entries(values).map(([name, value]) => stubGlobal(name as StubbedGlobalName, value));
  t.after(() => {
    for (const restore of restores.reverse()) {
      restore();
    }
  });
}

test('prefers the electron bridge when available', async (t) => {
  const writes: string[] = [];
  stubGlobals(t, {
    window: {
      hulala: {
        clipboard: {
          writeText: (text: string) => {
            writes.push(text);
          },
        },
      },
    },
  });

  await writeClipboardText('/tmp/workspace/file.md');

  assert.deepEqual(writes, ['/tmp/workspace/file.md']);
});

test('falls back to navigator clipboard when the electron bridge throws', async (t) => {
  const navigatorWrites: string[] = [];
  stubGlobals(t, {
    window: {
      hulala: {
        clipboard: {
          writeText: () => {
            throw new Error('bridge failed');
          },
        },
      },
    },
    navigator: {
      clipboard: {
        writeText: async (text: string) => {
          navigatorWrites.push(text);
        },
      },
    },
  });

  await writeClipboardText('/remote/workspace/file.md');

  assert.deepEqual(navigatorWrites, ['/remote/workspace/file.md']);
});

test('falls back to execCommand and restores input focus/selection', async (t) => {
  let execCommandName = '';
  let removed = false;
  let activeFocusCount = 0;
  let restoredSelection: [number, number, string | undefined] | null = null;

  const activeInput = {
    tagName: 'INPUT',
    selectionStart: 2,
    selectionEnd: 5,
    selectionDirection: 'forward',
    focus: () => {
      activeFocusCount += 1;
    },
    setSelectionRange: (start: number, end: number, direction?: string) => {
      restoredSelection = [start, end, direction];
    },
  };

  const textArea = {
    value: '',
    readOnly: false,
    tabIndex: 0,
    style: {
      position: '',
      opacity: '',
      pointerEvents: '',
      inset: '',
    },
    setAttribute: () => {},
    focus: () => {},
    select: () => {},
    remove: () => {
      removed = true;
    },
  };

  const documentMock = {
    body: {
      appendChild: (node: unknown) => node,
      removeChild: () => {},
    },
    activeElement: activeInput,
    createElement: (tagName: string) => {
      assert.equal(tagName, 'textarea');
      return textArea;
    },
    execCommand: (command: string) => {
      execCommandName = command;
      return true;
    },
    getSelection: () => null,
  };

  stubGlobals(t, {
    window: undefined,
    navigator: undefined,
    document: documentMock,
  });

  await writeClipboardText('copy me');

  assert.equal(execCommandName, 'copy');
  assert.equal(textArea.value, 'copy me');
  assert.equal(removed, true);
  assert.equal(activeFocusCount, 1);
  assert.deepEqual(restoredSelection, [2, 5, 'forward']);
});

test('throws a uniform error when all clipboard strategies fail', async (t) => {
  stubGlobals(t, {
    window: {
      hulala: {
        clipboard: {
          writeText: () => {
            throw new Error('bridge failed');
          },
        },
      },
    },
    navigator: {
      clipboard: {
        writeText: async () => {
          throw new Error('navigator failed');
        },
      },
    },
    document: undefined,
  });

  await assert.rejects(
    () => writeClipboardText('copy me'),
    /Failed to write to clipboard/,
  );
});

test('writes rendered image elements as clipboard png data', async (t) => {
  const writes: Array<{ data: Record<string, Promise<Blob>> }> = [];
  let drawnImage: unknown = null;
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) => {
      assert.equal(kind, '2d');
      return {
        drawImage: (image: unknown) => {
          drawnImage = image;
        },
      };
    },
    toBlob: (callback: (blob: Blob | null) => void, mimeType: string) => {
      assert.equal(mimeType, 'image/png');
      callback(new Blob([Uint8Array.from([4, 5, 6])], { type: 'image/png' }));
    },
    remove: () => {},
  };

  class StubClipboardItem {
    data: Record<string, Promise<Blob>>;

    constructor(data: Record<string, Promise<Blob>>) {
      this.data = data;
    }
  }

  stubGlobals(t, {
    ClipboardItem: StubClipboardItem,
    navigator: {
      clipboard: {
        write: async (items: Array<{ data: Record<string, Promise<Blob>> }>) => {
          writes.push(...items);
        },
      },
    },
    document: {
      createElement: (tagName: string) => {
        assert.equal(tagName, 'canvas');
        return canvas;
      },
    },
  });

  const image = {
    complete: true,
    naturalWidth: 16,
    naturalHeight: 9,
  } as HTMLImageElement;

  await writeClipboardImageFromElement(image);

  assert.equal(canvas.width, 16);
  assert.equal(canvas.height, 9);
  assert.equal(drawnImage, image);
  assert.equal(writes.length, 1);
  const blob = await writes[0].data['image/png'];
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(Array.from(new Uint8Array(await blob.arrayBuffer())), [4, 5, 6]);
});

test('reports unsupported browser image clipboard writes', async (t) => {
  stubGlobals(t, {
    ClipboardItem: undefined,
    navigator: {
      clipboard: {},
    },
  });

  await assert.rejects(
    () => writeClipboardImageFromElement({
      complete: true,
      naturalWidth: 16,
      naturalHeight: 9,
    } as HTMLImageElement),
    /Clipboard image write is not supported/,
  );
});

test('falls back to selecting the rendered image when png clipboard write is unavailable', async (t) => {
  let selectedNode: unknown = null;
  let execCommandName = '';
  let removeRangeCount = 0;
  const image = {
    complete: true,
    naturalWidth: 16,
    naturalHeight: 9,
  } as HTMLImageElement;
  const documentMock = {
    getSelection: () => ({
      removeAllRanges: () => {
        removeRangeCount += 1;
      },
      addRange: () => {},
    }),
    createRange: () => ({
      selectNode: (node: unknown) => {
        selectedNode = node;
      },
    }),
    execCommand: (command: string) => {
      execCommandName = command;
      return true;
    },
  } as unknown as Document;
  Object.defineProperty(image, 'ownerDocument', { value: documentMock });

  stubGlobals(t, {
    ClipboardItem: undefined,
    navigator: {
      clipboard: {},
    },
  });

  await writeClipboardImageFromElement(image);

  assert.equal(selectedNode, image);
  assert.equal(execCommandName, 'copy');
  assert.equal(removeRangeCount, 2);
});
