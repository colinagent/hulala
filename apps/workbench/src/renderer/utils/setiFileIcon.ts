import { LanguageDescription } from '@codemirror/language';
import { languages as languageDescriptions } from '@codemirror/language-data';

import setiThemeDocumentJson from '../assets/file-icons/seti/vs-seti-icon-theme.json' with { type: 'json' };

export type FileIconColorScheme = 'light' | 'dark';

type SetiIconDefinition = {
  fontCharacter?: string;
  fontColor?: string;
};

type SetiIconAssociations = {
  file?: string;
  fileExtensions?: Record<string, string>;
  fileNames?: Record<string, string>;
  languageIds?: Record<string, string>;
};

type SetiIconThemeDocument = SetiIconAssociations & {
  fonts?: Array<{
    size?: string;
  }>;
  iconDefinitions: Record<string, SetiIconDefinition>;
  light?: SetiIconAssociations;
  version?: string;
};

export type ResolveFileIconOptions = {
  filePath?: string | null;
  fileName?: string | null;
  editorId?: string | null;
  languageId?: string | null;
  scheme: FileIconColorScheme;
};

export type ResolvedFileIcon = {
  definitionId: string;
  glyph: string;
  color: string;
  source: 'fileName' | 'extension' | 'language' | 'editor' | 'default';
};

const setiThemeDocument = setiThemeDocumentJson as SetiIconThemeDocument;

function mergeAssociations(
  base: SetiIconAssociations,
  override?: SetiIconAssociations,
): SetiIconAssociations {
  return {
    file: override?.file ?? base.file,
    fileExtensions: {
      ...(base.fileExtensions || {}),
      ...(override?.fileExtensions || {}),
    },
    fileNames: {
      ...(base.fileNames || {}),
      ...(override?.fileNames || {}),
    },
    languageIds: {
      ...(base.languageIds || {}),
      ...(override?.languageIds || {}),
    },
  };
}

const darkAssociations = mergeAssociations(setiThemeDocument);
const lightAssociations = mergeAssociations(setiThemeDocument, setiThemeDocument.light);

const CODEMIRROR_LANGUAGE_ID_OVERRIDES: Record<string, string> = {
  jsx: 'javascriptreact',
  shell: 'shellscript',
  tsx: 'typescriptreact',
};

const EDITOR_LANGUAGE_IDS: Record<string, string> = {
  markdown: 'markdown',
};

function normalizedBaseName(filePath?: string | null, fileName?: string | null): string {
  const explicitName = (fileName || '').trim();
  if (explicitName) {
    return explicitName.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || '';
  }
  const normalizedPath = (filePath || '').trim().replace(/\\/g, '/');
  return normalizedPath.split('/').pop()?.toLowerCase() || '';
}

function extensionCandidates(fileName: string): string[] {
  if (!fileName) {
    return [];
  }
  const segments = fileName.split('.');
  if (segments.length < 2) {
    return [];
  }
  if (fileName.length > 255) {
    return [segments[segments.length - 1]].filter(Boolean);
  }
  return segments.slice(1).map((_, index) => segments.slice(index + 1).join('.')).filter(Boolean);
}

function getAssociations(scheme: FileIconColorScheme): SetiIconAssociations {
  return scheme === 'light' ? lightAssociations : darkAssociations;
}

function epubDefinitionId(scheme: FileIconColorScheme): string {
  return scheme === 'light' ? '_notebook_light' : '_notebook';
}

function decodeSetiFontCharacter(fontCharacter?: string): string {
  if (!fontCharacter) {
    return '';
  }
  const cssEscape = /^\\([0-9a-f]{1,6})$/i.exec(fontCharacter.trim());
  if (!cssEscape) {
    return fontCharacter;
  }
  const codePoint = Number.parseInt(cssEscape[1], 16);
  return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
}

function resolveLanguageDefinitionId(
  fileName: string,
  requestedLanguageId: string | null | undefined,
  associations: SetiIconAssociations,
): string | null {
  const languageIds = associations.languageIds || {};
  const requested = (requestedLanguageId || '').trim().toLowerCase();
  if (requested && languageIds[requested]) {
    return languageIds[requested];
  }

  const description = fileName
    ? LanguageDescription.matchFilename(languageDescriptions, fileName)
    : null;
  if (!description) {
    return null;
  }

  const normalizedName = description.name.trim().toLowerCase();
  const candidates = [
    CODEMIRROR_LANGUAGE_ID_OVERRIDES[normalizedName],
    normalizedName,
    ...description.alias.map((alias) => alias.trim().toLowerCase()),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (languageIds[candidate]) {
      return languageIds[candidate];
    }
  }
  return null;
}

function resolveDefinition(
  definitionId: string,
  source: ResolvedFileIcon['source'],
  scheme: FileIconColorScheme,
): ResolvedFileIcon {
  const definition = setiThemeDocument.iconDefinitions[definitionId];
  if (definition?.fontCharacter) {
    return {
      definitionId,
      glyph: decodeSetiFontCharacter(definition.fontCharacter),
      color: definition.fontColor || 'currentColor',
      source,
    };
  }

  const associations = getAssociations(scheme);
  const fallbackId = associations.file || (scheme === 'light' ? '_default_light' : '_default');
  const fallback = setiThemeDocument.iconDefinitions[fallbackId];
  return {
    definitionId: fallbackId,
    glyph: decodeSetiFontCharacter(fallback?.fontCharacter),
    color: fallback?.fontColor || 'currentColor',
    source: 'default',
  };
}

export function resolveFileIcon(options: ResolveFileIconOptions): ResolvedFileIcon {
  const associations = getAssociations(options.scheme);
  const fileName = normalizedBaseName(options.filePath, options.fileName);
  const fileNameDefinition = fileName && associations.fileNames?.[fileName];
  if (fileNameDefinition) {
    return resolveDefinition(fileNameDefinition, 'fileName', options.scheme);
  }

  for (const extension of extensionCandidates(fileName)) {
    if (extension === 'epub') {
      return resolveDefinition(epubDefinitionId(options.scheme), 'extension', options.scheme);
    }
    const extensionDefinition = associations.fileExtensions?.[extension];
    if (extensionDefinition) {
      return resolveDefinition(extensionDefinition, 'extension', options.scheme);
    }
  }

  const languageDefinition = resolveLanguageDefinitionId(
    fileName,
    options.languageId,
    associations,
  );
  if (languageDefinition) {
    return resolveDefinition(languageDefinition, 'language', options.scheme);
  }

  const editorLanguageId = EDITOR_LANGUAGE_IDS[(options.editorId || '').trim().toLowerCase()];
  const editorDefinition = editorLanguageId && associations.languageIds?.[editorLanguageId];
  if (editorDefinition) {
    return resolveDefinition(editorDefinition, 'editor', options.scheme);
  }

  const fallbackId = associations.file || (options.scheme === 'light' ? '_default_light' : '_default');
  return resolveDefinition(fallbackId, 'default', options.scheme);
}

export function hasFileLikeEditorIdentity(
  filePath?: string | null,
  editorId?: string | null,
): boolean {
  if ((filePath || '').trim()) {
    return true;
  }
  const normalizedEditorId = (editorId || '').trim().toLowerCase();
  return normalizedEditorId === 'markdown' || normalizedEditorId === 'text';
}

export const SETI_FILE_ICON_THEME_VERSION = setiThemeDocument.version || '';
export const SETI_FILE_ICON_FONT_SIZE = setiThemeDocument.fonts?.[0]?.size || '150%';
