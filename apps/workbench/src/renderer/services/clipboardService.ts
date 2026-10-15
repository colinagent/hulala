function isTextInputLikeElement(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (!element) {
    return false;
  }
  const tagName = typeof element.tagName === 'string'
    ? element.tagName.toUpperCase()
    : typeof element.nodeName === 'string'
      ? element.nodeName.toUpperCase()
      : '';
  return tagName === 'INPUT' || tagName === 'TEXTAREA';
}

function captureDocumentSelection(doc: Document): () => void {
  const activeElement = doc.activeElement;
  const selection = typeof doc.getSelection === 'function' ? doc.getSelection() : null;
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : [];
  const inputElement = isTextInputLikeElement(activeElement) ? activeElement : null;
  const selectionStart = inputElement?.selectionStart ?? null;
  const selectionEnd = inputElement?.selectionEnd ?? null;
  const selectionDirection = inputElement?.selectionDirection ?? null;

  return () => {
    const focusableElement = activeElement as HTMLElement | null;
    if (focusableElement && typeof focusableElement.focus === 'function') {
      try {
        focusableElement.focus();
      } catch {
        // Ignore focus restoration failures.
      }
    }

    if (inputElement && selectionStart !== null && selectionEnd !== null) {
      try {
        inputElement.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined);
      } catch {
        // Ignore selection restoration failures.
      }
      return;
    }

    if (!selection || ranges.length === 0) {
      return;
    }

    try {
      selection.removeAllRanges();
      for (const range of ranges) {
        selection.addRange(range);
      }
    } catch {
      // Ignore selection restoration failures.
    }
  };
}

async function writeWithElectronBridge(text: string): Promise<boolean> {
  const writeText = globalThis.window?.hulala?.clipboard?.writeText;
  if (typeof writeText !== 'function') {
    return false;
  }

  try {
    await Promise.resolve(writeText(text));
    return true;
  } catch {
    return false;
  }
}

async function writeWithNavigatorClipboard(text: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return false;
  }

  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function writeWithExecCommand(text: string): boolean {
  const doc = globalThis.document;
  const parent = doc?.body ?? doc?.documentElement;
  if (!doc || !parent || typeof doc.createElement !== 'function') {
    return false;
  }

  const restoreSelection = captureDocumentSelection(doc);
  const textArea = doc.createElement('textarea');
  textArea.value = text;
  textArea.readOnly = true;
  textArea.tabIndex = -1;
  textArea.setAttribute('aria-hidden', 'true');
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  textArea.style.pointerEvents = 'none';
  textArea.style.inset = '0';

  try {
    parent.appendChild(textArea);
    textArea.focus();
    textArea.select();
    return typeof doc.execCommand === 'function' && doc.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    if (typeof textArea.remove === 'function') {
      textArea.remove();
    } else if (typeof parent.removeChild === 'function') {
      try {
        parent.removeChild(textArea);
      } catch {
        // Ignore cleanup failures.
      }
    }
    restoreSelection();
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  if (await writeWithElectronBridge(text)) {
    return;
  }
  if (await writeWithNavigatorClipboard(text)) {
    return;
  }
  if (writeWithExecCommand(text)) {
    return;
  }

  throw new Error('Failed to write to clipboard');
}

function getBrowserClipboardImageWriter(): ((items: ClipboardItem[]) => Promise<void>) | null {
  const write = globalThis.navigator?.clipboard?.write;
  return typeof write === 'function' ? write.bind(globalThis.navigator.clipboard) : null;
}

function getClipboardItemConstructor(): typeof ClipboardItem | null {
  return typeof ClipboardItem === 'function' ? ClipboardItem : null;
}

function hasLoadedImagePixels(image: HTMLImageElement): boolean {
  return image.complete === true && image.naturalWidth > 0 && image.naturalHeight > 0;
}

async function waitForImagePixels(image: HTMLImageElement): Promise<void> {
  if (hasLoadedImagePixels(image)) {
    return;
  }

  if (image.complete) {
    throw new Error('Image is not loaded');
  }

  if (typeof image.decode === 'function') {
    try {
      await image.decode();
    } catch {
      // Fall through to load/error listeners. Some Chromium image decoders
      // reject before the regular element events have settled.
    }
    if (hasLoadedImagePixels(image)) {
      return;
    }
    if (image.complete) {
      throw new Error('Image is not loaded');
    }
  }

  if (typeof image.addEventListener !== 'function') {
    throw new Error('Image is not loaded');
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error('Image did not finish loading'));
    }, 3000);

    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
    };
    const onLoad = () => {
      cleanup();
      hasLoadedImagePixels(image) ? resolve() : reject(new Error('Image is not loaded'));
    };
    const onError = () => {
      cleanup();
      reject(new Error('Image failed to load'));
    };

    image.addEventListener('load', onLoad, { once: true });
    image.addEventListener('error', onError, { once: true });
  });
}

function createPngBlobFromImage(image: HTMLImageElement): Promise<Blob> {
  const doc = globalThis.document;
  if (!doc || typeof doc.createElement !== 'function') {
    return Promise.reject(new Error('Canvas image copy is not supported'));
  }

  const canvas = doc.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  return new Promise<Blob>((resolve, reject) => {
    try {
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Canvas image copy is not supported'));
        return;
      }
      context.drawImage(image, 0, 0);
      if (typeof canvas.toBlob !== 'function') {
        reject(new Error('Canvas image copy is not supported'));
        return;
      }
      canvas.toBlob((blob) => {
        try {
          canvas.remove();
        } catch {
          // Ignore cleanup failures.
        }
        blob ? resolve(blob) : reject(new Error('Failed to encode image for clipboard'));
      }, 'image/png');
    } catch (error) {
      try {
        canvas.remove();
      } catch {
        // Ignore cleanup failures.
      }
      reject(error instanceof Error ? error : new Error('Failed to render image for clipboard'));
    }
  });
}

function writeImageElementWithSelectionFallback(image: HTMLImageElement): boolean {
  const doc = image.ownerDocument ?? globalThis.document;
  const selection = typeof doc?.getSelection === 'function'
    ? doc.getSelection()
    : doc?.defaultView && typeof doc.defaultView.getSelection === 'function'
      ? doc.defaultView.getSelection()
      : null;
  if (!doc || !selection || typeof doc.createRange !== 'function' || typeof doc.execCommand !== 'function') {
    return false;
  }

  try {
    selection.removeAllRanges();
    const range = doc.createRange();
    range.selectNode(image);
    selection.addRange(range);
    const copied = doc.execCommand('copy') === true;
    selection.removeAllRanges();
    return copied;
  } catch {
    try {
      selection.removeAllRanges();
    } catch {
      // Ignore selection cleanup failures.
    }
    return false;
  }
}

async function writeImageSourceTextFallback(image: HTMLImageElement): Promise<boolean> {
  const dataSource = typeof image.getAttribute === 'function' ? image.getAttribute('data-src') : '';
  const source = (dataSource || image.currentSrc || image.src || '').trim();
  if (!source) {
    return false;
  }
  if (await writeWithNavigatorClipboard(source)) {
    return true;
  }
  return writeWithExecCommand(source);
}

async function writeClipboardImagePngFromElement(image: HTMLImageElement): Promise<void> {
  const write = getBrowserClipboardImageWriter();
  const ClipboardItemCtor = getClipboardItemConstructor();
  if (!write || !ClipboardItemCtor) {
    throw new Error('Clipboard image write is not supported');
  }

  await waitForImagePixels(image);
  await write([
    new ClipboardItemCtor({
      'image/png': createPngBlobFromImage(image),
    }),
  ]);
}

export async function writeClipboardImageFromElement(image: HTMLImageElement): Promise<void> {
  try {
    await writeClipboardImagePngFromElement(image);
    return;
  } catch (error) {
    if (writeImageElementWithSelectionFallback(image)) {
      return;
    }
    if (await writeImageSourceTextFallback(image)) {
      return;
    }
    throw error instanceof Error ? error : new Error('Failed to copy image');
  }
}
