import { Cron } from 'croner'
import { cronScheduleSchema, type CronSchedule } from '@hulala/workbench-contracts'
import { HttpError } from './http'

export function intervalMilliseconds(every: string): number {
  const match = every.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/)
  const scale: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }
  const duration = match ? Number(match[1]) * scale[match[2]!]! : 0
  if (!Number.isSafeInteger(duration) || duration < 1000 || duration > 365 * 86400000) throw new HttpError(400, 'cron_interval_invalid', 'Use an interval between 1 second and 365 days, for example 5m or 1h')
  return duration
}

export function normalizeSchedule(value: CronSchedule): CronSchedule {
  const schedule = cronScheduleSchema.parse(value)
  const timeZone = schedule.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
  try { new Intl.DateTimeFormat('en', { timeZone }).format() } catch { throw new HttpError(400, 'cron_timezone_invalid', 'Choose a valid IANA time zone') }
  if (schedule.every) intervalMilliseconds(schedule.every)
  if (schedule.time && (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(schedule.time) || !Number.isFinite(Date.parse(schedule.time)))) throw new HttpError(400, 'cron_time_invalid', 'A one-time schedule requires a date and time with a UTC offset')
  if (schedule.cron) try { new Cron(schedule.cron, { paused: true, timezone: timeZone }) } catch { throw new HttpError(400, 'cron_schedule_invalid', 'Invalid cron expression') }
  return { ...schedule, timeZone }
}

/** Recurring schedules skip missed occurrences while retaining their original anchor. */
export function nextCronDate(schedule: CronSchedule, after = Date.now(), anchor = after): Date | null {
  if (schedule.every) {
    const interval = intervalMilliseconds(schedule.every)
    return new Date(anchor + Math.max(1, Math.floor((after - anchor) / interval) + 1) * interval)
  }
  if (schedule.time) return Date.parse(schedule.time) > after ? new Date(schedule.time) : null
  return new Cron(schedule.cron!, { paused: true, timezone: schedule.timeZone }).nextRun(new Date(after))
}
