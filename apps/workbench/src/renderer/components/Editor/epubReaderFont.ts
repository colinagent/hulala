import type { Rendition } from 'epubjs';

import type { EpubReaderFont } from './epubReaderSettings';

/** CJK serif faces lead so Han characters and ASCII digits share metrics. */
export const EPUB_SERIF_FONT_FAMILY = [
  '"Songti SC"',
  '"STSong"',
  '"Noto Serif CJK SC"',
  '"Source Han Serif SC"',
  '"Hiragino Mincho ProN"',
  '"Yu Mincho"',
  'ui-serif',
  'Georgia',
  'Cambria',
  '"Times New Roman"',
  'serif',
].join(', ');

export const EPUB_SANS_FONT_FAMILY = [
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei"',
  '"Noto Sans CJK SC"',
  '"Source Han Sans SC"',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Arial',
  'sans-serif',
].join(', ');

type EpubReaderFontThemes = Pick<Rendition['themes'], 'font' | 'override'> & {
  // Present in epub.js at runtime but missing from its bundled declaration.
  removeOverride?: (name: string) => void;
};

const publisherFonts = new WeakMap<Document, Map<HTMLElement, { value: string; priority: string }>>();

/** epub.js only overrides body; publisher paragraphs can still specify another font. */
export function applyEpubContentFont(
  document: Document,
  font: EpubReaderFont,
  appFontFamily: string,
): void {
  let originals = publisherFonts.get(document);
  if (font === 'publisher') {
    originals?.forEach(({ value, priority }, element) => {
      if (value) element.style.setProperty('font-family', value, priority);
      else element.style.removeProperty('font-family');
    });
    publisherFonts.delete(document);
    return;
  }

  const family = font === 'serif' ? EPUB_SERIF_FONT_FAMILY
    : font === 'sans' ? EPUB_SANS_FONT_FAMILY : appFontFamily;
  if (!originals) {
    originals = new Map();
    publisherFonts.set(document, originals);
  }
  for (const element of document.querySelectorAll<HTMLElement>('body *')) {
    // Code and mathematical/illustration glyphs retain their specialized fonts.
    if (element.closest('pre, code, kbd, samp, svg, math') || !element.style) continue;
    if (!originals.has(element)) {
      originals.set(element, {
        value: element.style.getPropertyValue('font-family'),
        priority: element.style.getPropertyPriority('font-family'),
      });
    }
    element.style.setProperty('font-family', family, 'important');
  }
}

export function applyEpubReaderFont(
  themes: EpubReaderFontThemes,
  font: EpubReaderFont,
  appFontFamily: string,
): void {
  switch (font) {
    case 'publisher':
      if (typeof themes.removeOverride === 'function') {
        themes.removeOverride('font-family');
      } else {
        // Older epub.js builds remove an inline property when override is empty.
        themes.override('font-family', '', true);
      }
      return;
    case 'serif':
      themes.font(EPUB_SERIF_FONT_FAMILY);
      return;
    case 'sans':
      themes.font(EPUB_SANS_FONT_FAMILY);
      return;
    default:
      themes.font(appFontFamily);
  }
}
