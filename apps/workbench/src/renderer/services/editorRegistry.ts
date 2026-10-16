/**
 * Editor Registry - Maps file patterns to editor IDs
 * Similar to VS Code's workbench.editorAssociations
 */

import type React from 'react';

export type EditorId = 'markdown' | 'text' | string;

export interface EditorDefinition {
  id: EditorId;
  displayName: string;
  component: React.ComponentType;
}

const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const BOOK_EXTENSIONS = new Set(['.epub', '.pdf']);
const WORD_EXTENSIONS = new Set(['.docx']);

export function isImageFilePath(filePath: string): boolean {
  const fileName = filePath.split('/').pop() || '';
  const lastDot = fileName.lastIndexOf('.');
  const extension = lastDot >= 0 ? fileName.substring(lastDot).toLowerCase() : '';
  return IMAGE_EXTENSIONS.has(extension);
}

class EditorRegistry {
  private editors: Map<EditorId, EditorDefinition> = new Map();

  register(editor: EditorDefinition): void {
    this.editors.set(editor.id, editor);
  }

  get(editorId: EditorId): EditorDefinition | undefined {
    return this.editors.get(editorId);
  }

  /**
   * Resolve editor ID from file path and settings
   */
  resolveEditorId(
    filePath: string,
    workbenchEditorAssociations: Record<string, string>
  ): EditorId {
    const fileName = filePath.split('/').pop() || '';

    // Check workbench.editorAssociations (pattern matching)
    for (const [pattern, editorId] of Object.entries(workbenchEditorAssociations)) {
      if (this.matchPattern(pattern, fileName)) {
        return editorId;
      }
    }

    // Fallback: determine editor from file extension
    const extension = this.getExtension(fileName);
    if (extension === '.md' || extension === '.markdown') {
      return 'markdown';
    }
    if (extension === '.txt') {
      return 'text';
    }
    if (extension === '.excalidraw') {
      return 'excalidraw';
    }
    if (IMAGE_EXTENSIONS.has(extension)) {
      return 'image';
    }
    if (BOOK_EXTENSIONS.has(extension)) {
      return 'book';
    }
    if (WORD_EXTENSIONS.has(extension)) {
      return 'word';
    }

    // Default to text editor for unknown types
    return 'text';
  }

  private getExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    return lastDot >= 0 ? fileName.substring(lastDot).toLowerCase() : '';
  }

  private matchPattern(pattern: string, fileName: string): boolean {
    // Simple glob pattern matching
    if (pattern === fileName) {
      return true;
    }

    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(fileName);
  }
}

export const editorRegistry = new EditorRegistry();
