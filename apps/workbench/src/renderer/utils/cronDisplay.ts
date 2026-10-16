import type { CronTaskRecord } from '../services/cronService';

export type CronTaskStatusTone = 'running' | 'error' | 'ok' | 'idle' | 'disabled';

export function cronPayloadData(record: CronTaskRecord): Record<string, unknown> {
  return record.task.payload?.data || {};
}

export function cronDataString(record: CronTaskRecord, key: string): string {
  const value = cronPayloadData(record)[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function cronTaskTitle(record: CronTaskRecord): string {
  return record.task.name.trim() || record.task.id;
}

export function cronTaskPath(record: CronTaskRecord): string {
  const dataPath = cronDataString(record, 'workspacePath');
  const targetPath = record.task.target.cwd?.trim() || '';
  return dataPath || targetPath || 'No workspace path';
}

export function cronTaskBranch(record: CronTaskRecord): string {
  return cronDataString(record, 'branch') || 'main';
}

export function cronTaskStatus(record: CronTaskRecord): {
  label: string;
  tone: CronTaskStatusTone;
} {
  if ((record.state?.runningAtMs || 0) > 0) {
    return { label: 'Running', tone: 'running' };
  }
  if ((record.state?.runNowAtMs || 0) > 0) {
    return { label: 'Queued', tone: 'running' };
  }
  if ((record.state?.lastError || '').trim()) {
    return { label: 'Failed', tone: 'error' };
  }
  if (!record.task.enabled) {
    return { label: 'Paused', tone: 'disabled' };
  }
  if ((record.state?.lastRunAtMs || 0) > 0) {
    return { label: 'Ready', tone: 'ok' };
  }
  return { label: 'Ready', tone: 'idle' };
}

export function cronTaskSchedule(record: CronTaskRecord): string {
  const schedule = record.task.schedule || {};
  if (schedule.every) {
    return `Every ${schedule.every}`;
  }
  if (schedule.cron) {
    return schedule.cron;
  }
  if (schedule.time) {
    return schedule.time;
  }
  return 'Manual';
}

export function formatCronTime(value: number | null | undefined): string {
  if (!value) {
    return 'Never';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return date.toLocaleString();
}
