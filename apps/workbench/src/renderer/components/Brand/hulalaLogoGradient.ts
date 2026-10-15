import { mixHex } from '../../theme/brandCore.ts';

export const HULALA_LOGO_GRADIENT = {
  x1: 118,
  y1: 62,
  x2: 458.5,
  y2: 413.5,
} as const;

export const HULALA_LOGO_HUB = '#2F8F6B';

export type LogoGradientDirection = 'lighten' | 'darken';

type GradientStop = { offset: number; color: string };

const FIXED_STOPS: GradientStop[] = [
  { offset: 0, color: '#C87910' },
  { offset: 0.22, color: '#8A7D2E' },
  { offset: 0.44, color: '#3E8462' },
  { offset: 0.58, color: HULALA_LOGO_HUB },
];

const REFERENCE_TAIL: Record<
  LogoGradientDirection,
  { endpoint: string; stops: GradientStop[] }
> = {
  lighten: {
    endpoint: '#FFFFFF',
    stops: [
      { offset: 0.72, color: '#5F9D86' },
      { offset: 0.82, color: '#84D8C5' },
      { offset: 0.92, color: '#DFF3EC' },
      { offset: 1, color: '#FFFFFF' },
    ],
  },
  darken: {
    endpoint: '#000000',
    stops: [
      { offset: 0.72, color: '#17604D' },
      { offset: 0.82, color: '#123830' },
      { offset: 0.92, color: '#0F241F' },
      { offset: 1, color: '#000000' },
    ],
  },
};

function channelMixRatio(from: number, to: number, result: number): number | null {
  if (to === from) {
    return result === from ? 0 : null;
  }
  const ratio = (result - from) / (to - from);
  if (ratio < -0.001 || ratio > 1.001) {
    return null;
  }
  return Math.max(0, Math.min(1, ratio));
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim();
  const match = normalized.match(/^#([0-9a-fA-F]{6})$/);
  if (!match) {
    return null;
  }
  const value = match[1];
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function mixRatio(fromHex: string, toHex: string, resultHex: string): number {
  const from = parseHex(fromHex);
  const to = parseHex(toHex);
  const result = parseHex(resultHex);
  if (!from || !to || !result) {
    return 1;
  }
  const ratios = [
    channelMixRatio(from.r, to.r, result.r),
    channelMixRatio(from.g, to.g, result.g),
    channelMixRatio(from.b, to.b, result.b),
  ].filter((ratio): ratio is number => ratio !== null);
  if (ratios.length === 0) {
    return 1;
  }
  return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
}

const TAIL_MIX_RATIOS: Record<LogoGradientDirection, number[]> = {
  lighten: REFERENCE_TAIL.lighten.stops.map((stop) =>
    mixRatio(HULALA_LOGO_HUB, REFERENCE_TAIL.lighten.endpoint, stop.color),
  ),
  darken: REFERENCE_TAIL.darken.stops.map((stop) =>
    mixRatio(HULALA_LOGO_HUB, REFERENCE_TAIL.darken.endpoint, stop.color),
  ),
};

export function normalizeToHex(color: string): string | null {
  const trimmed = color.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('#')) {
    const short = trimmed.match(/^#([0-9a-fA-F]{3})$/);
    if (short) {
      const [r, g, b] = short[1].split('');
      return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
    const full = trimmed.match(/^#([0-9a-fA-F]{6})$/);
    return full ? `#${full[1].toUpperCase()}` : null;
  }
  const rgbMatch = trimmed.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+\s*)?\)$/i,
  );
  if (!rgbMatch) {
    return null;
  }
  const toHex = (value: string) =>
    Math.max(0, Math.min(255, Number.parseInt(value, 10)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`.toUpperCase();
}

export function buildHulalaLogoGradientStops(
  tailColor: string,
  direction: LogoGradientDirection,
): GradientStop[] {
  const resolved = normalizeToHex(tailColor) ?? tailColor;
  const reference = REFERENCE_TAIL[direction];
  const tailStops = reference.stops.map((stop, index) => ({
    offset: stop.offset,
    color: mixHex(HULALA_LOGO_HUB, resolved, TAIL_MIX_RATIOS[direction][index] * 100),
  }));
  return [...FIXED_STOPS, ...tailStops];
}

export const HULALA_LOGO_GRADIENT_STOPS = {
  light: buildHulalaLogoGradientStops('#FFFFFF', 'lighten'),
  dark: buildHulalaLogoGradientStops('#000000', 'darken'),
} as const;
