import type { CSSProperties } from 'react';

/** Borderless colored tag pill for frontmatter `tags` only. */
export const UI_TAG_PILL = 'ui-tag-pill';

const TAG_PILL_HUES = [
  'var(--color-brand)',
  '#2f8f6b',
  '#8a7d2e',
  '#5f8d7c',
  '#9b6f63',
  '#6b9080',
  '#a67c52',
  '#7d6b91',
] as const;

const TAG_PILL_MIX = '22%';

function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

/**
 * Returns the stable palette slot for a tag. Keep all tag surfaces (frontmatter
 * and inline Markdown) on this same mapping so a tag never changes colour
 * between views.
 */
export function tagPillTone(label: string): number {
  const normalized = label.trim().toLowerCase() || 'tag';
  return fnv1a(normalized) % TAG_PILL_HUES.length;
}

export function tagPillHue(tone: number): string {
  return TAG_PILL_HUES[Math.abs(tone) % TAG_PILL_HUES.length];
}

export function tagPillBackground(label: string): string {
  const hue = tagPillHue(tagPillTone(label));
  return `color-mix(in srgb, ${hue} ${TAG_PILL_MIX}, var(--color-editor-bg))`;
}

export type TagPillStyle = CSSProperties & { '--ui-tag-bg': string };

export function tagPillStyle(label: string): TagPillStyle {
  return { '--ui-tag-bg': tagPillBackground(label) };
}
