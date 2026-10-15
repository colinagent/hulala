import { useLayoutEffect, useState, type RefObject } from 'react';
import {
  normalizeToHex,
  type LogoGradientDirection,
} from '../Brand/hulalaLogoGradient';

const DEFAULT_TAIL = {
  lighten: '#F4F9F7',
  darken: '#101816',
} as const;

function resolveTailColor(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  return normalizeToHex(trimmed) ?? trimmed;
}

function readTailBg(element: Element): string {
  const style = getComputedStyle(element);
  const raw =
    style.getPropertyValue('--logo-tail-bg').trim() ||
    style.getPropertyValue('--color-editor-bg').trim() ||
    style.backgroundColor;
  return resolveTailColor(raw);
}

export function useLogoTailBg(
  ref: RefObject<Element | null>,
  direction: LogoGradientDirection,
  tailColor?: string,
) {
  const fallback = DEFAULT_TAIL[direction];
  const [resolvedTailBg, setResolvedTailBg] = useState(
    tailColor ? resolveTailColor(tailColor) : fallback,
  );

  useLayoutEffect(() => {
    if (tailColor) {
      setResolvedTailBg(resolveTailColor(tailColor));
      return;
    }

    const element = ref.current;
    if (!element) {
      return;
    }

    const sync = () => {
      const next = readTailBg(element);
      setResolvedTailBg(next || fallback);
    };
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-color-scheme'],
    });
    return () => observer.disconnect();
  }, [fallback, ref, tailColor]);

  return resolvedTailBg;
}
