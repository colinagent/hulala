/**
 * Language Registry - Maps file patterns/extensions to language IDs
 * Similar to VS Code's files.associations
 */

import { LanguageDescription } from '@codemirror/language';
import { Extension } from '@codemirror/state';
import { languages as languageDescriptions } from '@codemirror/language-data';

export type LanguageId = 'plaintext' | string;

class LanguageRegistry {
  private extensionsCache = new Map<LanguageId, Promise<Extension[]>>();

  /**
   * Resolve language ID from file path and settings
   */
  resolveLanguageId(
    filePath: string,
    filesAssociations: Record<string, string>,
    defaultLanguage: string = 'plaintext'
  ): LanguageId {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const fileName = normalizedPath.split('/').pop() || normalizedPath;

    // Check files.associations (pattern matching)
    for (const [pattern, langId] of Object.entries(filesAssociations)) {
      if (this.matchPattern(pattern, fileName, normalizedPath)) {
        return this.normalizeLanguageId(langId);
      }
    }

    const description = LanguageDescription.matchFilename(languageDescriptions, fileName);
    if (description) {
      return this.toLanguageId(description);
    }

    return this.normalizeLanguageId(defaultLanguage);
  }

  async getExtensions(languageId: LanguageId): Promise<Extension[]> {
    const normalizedLanguageId = this.normalizeLanguageId(languageId);
    if (normalizedLanguageId === 'plaintext') {
      return [];
    }

    const cached = this.extensionsCache.get(normalizedLanguageId);
    if (cached) {
      return cached;
    }

    const loadPromise = this.loadExtensions(normalizedLanguageId);
    this.extensionsCache.set(normalizedLanguageId, loadPromise);
    return loadPromise;
  }

  private async loadExtensions(languageId: LanguageId): Promise<Extension[]> {
    const description = LanguageDescription.matchLanguageName(languageDescriptions, languageId, true);
    if (!description) {
      return [];
    }

    try {
      const support = description.support ?? await description.load();
      return [support.extension];
    } catch (error) {
      console.warn('Failed to load CodeMirror language support:', languageId, error);
      return [];
    }
  }

  private toLanguageId(description: LanguageDescription): LanguageId {
    return this.normalizeLanguageId(description.alias[0] || description.name);
  }

  private normalizeLanguageId(languageId: string | null | undefined): LanguageId {
    const normalized = typeof languageId === 'string' ? languageId.trim().toLowerCase() : '';
    return normalized || 'plaintext';
  }

  private matchPattern(pattern: string, fileName: string, fullPath: string): boolean {
    const normalizedPattern = pattern.replace(/\\/g, '/').trim();
    const candidate = normalizedPattern.includes('/') ? fullPath : fileName;

    if (!normalizedPattern) {
      return false;
    }
    if (normalizedPattern === fileName || normalizedPattern === fullPath) {
      return true;
    }

    return this.globToRegex(normalizedPattern).test(candidate);
  }

  private globToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}*]/g, '\\$&');
    const regexPattern = escaped
      .replace(/\\\*\\\*/g, '.*')
      .replace(/\\\*/g, '[^/]*')
      .replace(/\\\?/g, '[^/]');
    return new RegExp(`^${regexPattern}$`);
  }
}

export const languageRegistry = new LanguageRegistry();
