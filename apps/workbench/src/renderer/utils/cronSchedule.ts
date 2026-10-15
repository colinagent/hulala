export const DEFAULT_CRON_INTERVAL_SEC = 300;

export const CRON_INTERVAL_OPTIONS = [
  { seconds: 60, label: '1 min' },
  { seconds: 300, label: '5 min' },
  { seconds: 900, label: '15 min' },
  { seconds: 1800, label: '30 min' },
  { seconds: 3600, label: '1 hour' },
];

export function normalizeCronIntervalSec(value: number, fallback = DEFAULT_CRON_INTERVAL_SEC): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.round(value));
}

export function parseCronEveryToSeconds(value: string | null | undefined): number {
  const raw = (value || '').trim().toLowerCase();
  if (!raw) {
    return DEFAULT_CRON_INTERVAL_SEC;
  }
  const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (!match) {
    return DEFAULT_CRON_INTERVAL_SEC;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) {
    return DEFAULT_CRON_INTERVAL_SEC;
  }
  if (unit === 'h') {
    return normalizeCronIntervalSec(amount * 3600);
  }
  if (unit === 'm') {
    return normalizeCronIntervalSec(amount * 60);
  }
  if (unit === 's') {
    return normalizeCronIntervalSec(amount);
  }
  return normalizeCronIntervalSec(amount / 1000);
}

export function formatCronEvery(seconds: number): string {
  const interval = normalizeCronIntervalSec(seconds);
  if (interval % 3600 === 0) {
    return `${interval / 3600}h`;
  }
  if (interval % 60 === 0) {
    return `${interval / 60}m`;
  }
  return `${interval}s`;
}

export function formatCronIntervalLabel(seconds: number): string {
  const interval = normalizeCronIntervalSec(seconds);
  if (interval % 3600 === 0) {
    const hours = interval / 3600;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  if (interval % 60 === 0) {
    return `${interval / 60} min`;
  }
  return `${interval} sec`;
}

export function cronIntervalOptionsWithCurrent(seconds: number): Array<{ seconds: number; label: string }> {
  const interval = normalizeCronIntervalSec(seconds);
  if (CRON_INTERVAL_OPTIONS.some((option) => option.seconds === interval)) {
    return CRON_INTERVAL_OPTIONS;
  }
  return [
    ...CRON_INTERVAL_OPTIONS,
    { seconds: interval, label: formatCronIntervalLabel(interval) },
  ].sort((a, b) => a.seconds - b.seconds);
}
