import { useCallback, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { openImageSource } from './codemirror/imageSourceState';
import {
  parseMarkdownImage,
  replaceMarkdownImageWidth,
  resolveMarkdownImagePath,
} from '../../utils/markdownMedia';

export type ImageMenuState = {
  x: number;
  y: number;
  from: number;
  to: number;
  widthPercent: number | null;
  imageElement?: HTMLImageElement | null;
};

export type ImageMenuTarget = {
  sourceText: string;
  path: string;
};

type ImageDeleteContext = {
  view: EditorView;
  menu: ImageMenuState;
  currentText: string;
  deleteFrom: number;
  deleteTo: number;
  nextContent: string;
};

type UseMarkdownImageMenuOptions = {
  getView: () => EditorView | null;
  afterWidthChange?: (view: EditorView, replaceFrom: number) => void;
  afterDelete?: (view: EditorView, deleteFrom: number) => void;
  afterDeleteImage?: (context: ImageDeleteContext) => void;
};

function resolveImageDeleteRange(
  view: EditorView,
  menu: ImageMenuState
): { currentText: string; deleteFrom: number; deleteTo: number } {
  const doc = view.state.doc;
  const currentText = doc.sliceString(menu.from, menu.to);
  let deleteFrom = menu.from;
  let deleteTo = menu.to;

  const line = doc.lineAt(menu.from);
  const trimmedLine = line.text.trim();
  if (trimmedLine && trimmedLine === currentText) {
    if (line.number < doc.lines) {
      deleteFrom = line.from;
      deleteTo = doc.line(line.number + 1).from;
    } else if (line.number > 1) {
      deleteFrom = doc.line(line.number - 1).to;
      deleteTo = line.to;
    } else {
      deleteFrom = line.from;
      deleteTo = line.to;
    }
  }

  return {
    currentText,
    deleteFrom,
    deleteTo,
  };
}

export function resolveMarkdownImageMenuTarget(
  sourceText: string,
  currentFilePath: string | null,
): ImageMenuTarget | null {
  const normalizedSource = sourceText.trim();
  const parsed = parseMarkdownImage(normalizedSource);
  if (!parsed) {
    return null;
  }
  const resolvedPath = resolveMarkdownImagePath(currentFilePath, parsed.url);
  if (!resolvedPath) {
    return null;
  }
  return {
    sourceText: normalizedSource,
    path: resolvedPath,
  };
}

export function resolveImageMenuTarget(
  view: Pick<EditorView, 'state'>,
  menu: ImageMenuState,
  currentFilePath: string | null,
): ImageMenuTarget | null {
  const doc = view.state.doc;
  const currentText = doc.sliceString(menu.from, menu.to);
  const direct = resolveMarkdownImageMenuTarget(currentText, currentFilePath);
  if (direct) {
    return direct;
  }

  const line = doc.lineAt(menu.from);
  return resolveMarkdownImageMenuTarget(line.text.trim(), currentFilePath);
}

export function getImageMenuStateFromElement(
  element: HTMLElement,
  x: number,
  y: number
): ImageMenuState | null {
  const from = Number(element.dataset.mdImageSourceFrom);
  const to = Number(element.dataset.mdImageSourceTo);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return null;
  }
  const rawWidth = Number(element.dataset.mdImageWidth);
  return {
    x,
    y,
    from,
    to,
    widthPercent: Number.isFinite(rawWidth) ? rawWidth : null,
    imageElement: element instanceof HTMLImageElement ? element : element.querySelector('img'),
  };
}

export function useMarkdownImageMenu(options: UseMarkdownImageMenuOptions) {
  const [imageMenu, setImageMenu] = useState<ImageMenuState | null>(null);

  const openImageMenu = useCallback((nextMenu: ImageMenuState) => {
    setImageMenu(nextMenu);
  }, []);

  const closeImageContextMenu = useCallback(() => {
    setImageMenu(null);
  }, []);

  const handleImageWidthSelect = useCallback((nextWidthPercent: number) => {
    if (!imageMenu) {
      return;
    }
    const view = options.getView();
    if (!view) {
      return;
    }
    const currentText = view.state.doc.sliceString(imageMenu.from, imageMenu.to);
    let replaceFrom = imageMenu.from;
    let replaceTo = imageMenu.to;
    let nextText = replaceMarkdownImageWidth(currentText, nextWidthPercent);

    if (!nextText) {
      const line = view.state.doc.lineAt(imageMenu.from);
      const trimmed = line.text.trim();
      const leading = line.text.length - line.text.trimStart().length;
      const trailing = line.text.length - line.text.trimEnd().length;
      const fallback = replaceMarkdownImageWidth(trimmed, nextWidthPercent);
      if (fallback) {
        replaceFrom = line.from + leading;
        replaceTo = line.to - trailing;
        nextText = fallback;
      }
    }

    if (!nextText || (nextText === currentText && replaceFrom === imageMenu.from && replaceTo === imageMenu.to)) {
      return;
    }

    view.dispatch({
      changes: { from: replaceFrom, to: replaceTo, insert: nextText },
      selection: { anchor: replaceFrom + nextText.length },
      scrollIntoView: true,
      userEvent: 'input',
    });

    options.afterWidthChange?.(view, replaceFrom);
  }, [imageMenu, options]);

  const handleImageEditSource = useCallback(() => {
    if (!imageMenu) {
      return;
    }
    const view = options.getView();
    if (!view) {
      return;
    }
    openImageSource(view, {
      from: imageMenu.from,
      to: imageMenu.to,
    });
  }, [imageMenu, options]);

  const handleImageDelete = useCallback(() => {
    if (!imageMenu) {
      return;
    }
    const view = options.getView();
    if (!view) {
      return;
    }

    const { currentText, deleteFrom, deleteTo } = resolveImageDeleteRange(view, imageMenu);
    view.dispatch({
      changes: { from: deleteFrom, to: deleteTo, insert: '' },
      selection: { anchor: deleteFrom },
      scrollIntoView: true,
      userEvent: 'delete',
    });

    options.afterDelete?.(view, deleteFrom);
    options.afterDeleteImage?.({
      view,
      menu: imageMenu,
      currentText,
      deleteFrom,
      deleteTo,
      nextContent: view.state.doc.toString(),
    });
  }, [imageMenu, options]);

  return {
    imageMenu,
    openImageMenu,
    closeImageContextMenu,
    handleImageWidthSelect,
    handleImageEditSource,
    handleImageDelete,
  };
}
