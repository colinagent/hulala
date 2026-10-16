export const CHAT_IMAGE_MAX_BYTES = 7 * 1024 * 1024;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export type ChatInputImage = {
  name: string;
  mimeType: string;
  extension: string;
  size: number;
  file: File;
  base64: string;
};

function normalizeExtension(input: string) {
  const value = input.trim().toLowerCase();
  if (!value) return '';
  return value.startsWith('.') ? value : `.${value}`;
}

function fileExtension(name: string) {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) {
    return '';
  }
  return normalizeExtension(trimmed.slice(dot));
}

function detectImageMimeType(file: File) {
  const explicit = file.type.trim().toLowerCase();
  if (explicit && explicit.startsWith('image/')) {
    return explicit;
  }
  return IMAGE_MIME_BY_EXTENSION[fileExtension(file.name)] || '';
}

function detectImageExtension(file: File, mimeType: string) {
  const byName = fileExtension(file.name);
  if (IMAGE_MIME_BY_EXTENSION[byName]) {
    return byName;
  }
  return IMAGE_EXTENSION_BY_MIME[mimeType] || '.png';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file'));
    reader.readAsDataURL(blob);
  });
}

export function hasClipboardImage(dataTransfer: DataTransfer | null | undefined) {
  const files = Array.from(dataTransfer?.files || []);
  if (files.some((file) => Boolean(detectImageMimeType(file)))) {
    return true;
  }
  return Array.from(dataTransfer?.items || []).some((item) => item.type.startsWith('image/'));
}

export async function readChatImage(file: File): Promise<ChatInputImage> {
  const mimeType = detectImageMimeType(file);
  if (!mimeType) {
    throw new Error('仅支持 PNG/JPG/GIF/WEBP 图片');
  }
  if (file.size > CHAT_IMAGE_MAX_BYTES) {
    throw new Error('单张图片不能超过 7MB');
  }
  const base64 = await blobToBase64(file);
  return {
    name: file.name || 'image',
    mimeType,
    extension: detectImageExtension(file, mimeType),
    size: file.size,
    file,
    base64,
  };
}

export async function readChatImages(files: Iterable<File> | ArrayLike<File>): Promise<ChatInputImage[]> {
  const nextFiles = Array.from(files).filter((file) => Boolean(file));
  return Promise.all(nextFiles.map((file) => readChatImage(file)));
}

export async function readClipboardImages(dataTransfer: DataTransfer | null | undefined): Promise<ChatInputImage[]> {
  const directFiles = Array.from(dataTransfer?.files || []).filter((file) => Boolean(detectImageMimeType(file)));
  if (directFiles.length > 0) {
    return readChatImages(directFiles);
  }

  const itemFiles = Array.from(dataTransfer?.items || [])
    .filter((item) => item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  return readChatImages(itemFiles);
}

export function extractDroppedImageFiles(dataTransfer: DataTransfer | null | undefined): File[] {
  return Array.from(dataTransfer?.files || []).filter((file) => Boolean(detectImageMimeType(file)));
}
