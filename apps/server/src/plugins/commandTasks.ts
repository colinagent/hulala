/**
 * `/tasks`: list every Host scheduled task for the attached terminal.
 *
 * The Host owns task storage, so the command reads `ctx.schedule` directly and
 * returns text. Listing is a human command, not a model turn: the client renders
 * the settled result outside model history, exactly like `/compact`.
 *
 * @module hulala-server/command-tasks
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { ScheduleCatalogEntry } from '@deepseek-ai/dsh-schedule'

export const name = 'hulala-command-tasks'
export const inject = ['commands', 'schedule']

/** Refusal for an argument this command does not accept. */
const USAGE = '用法：/tasks'

const STATUS = { active: '启用', paused: '暂停', ended: '结束' } as const

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const

/** The task's own wall-clock zone, where its rule names one. */
function zoneOf(task: ScheduleCatalogEntry): string | undefined {
  return 'timeZone' in task ? task.timeZone : undefined
}

/** Render one UTC instant as `MM-DD HH:mm` in the task's zone, else the Host's. */
function stamp(instant: string, timeZone: string | undefined): string {
  const options: Intl.DateTimeFormatOptions = {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone === undefined ? {} : { timeZone }),
  }
  return new Intl.DateTimeFormat('en-CA', options).format(new Date(instant)).replace(',', '')
}

/** One line describing how often the task fires. */
function frequency(task: ScheduleCatalogEntry): string {
  switch (task.kind) {
    case 'after':
      return `${String(task.afterSeconds)} 秒后一次`
    case 'at':
      return '一次'
    case 'every': {
      const minutes = Math.round(task.everySeconds / 60)
      return minutes % 60 === 0 ? `每 ${String(minutes / 60)} 小时` : `每 ${String(minutes)} 分钟`
    }
    case 'daily':
      return `每天 ${task.time.slice(0, 5)} ${task.timeZone}`
    case 'weekly': {
      const days = task.weekdays.map(day => WEEKDAYS[day - 1] ?? String(day)).join('')
      return `每周${days} ${task.time.slice(0, 5)} ${task.timeZone}`
    }
    case 'cron':
      return `cron ${task.expression} ${task.timeZone}`
    case 'rrule': {
      const rule = task.rrule.split('\n').find(line => line.startsWith('RRULE:'))
      return rule === undefined ? 'RRULE' : rule
    }
  }
}

/** One task as a single scannable line. */
function lineOf(task: ScheduleCatalogEntry): string {
  const zone = zoneOf(task)
  const parts = [task.title, `[${STATUS[task.status]}]`, frequency(task)]
  if (task.status === 'active') parts.push(`下次 ${stamp(task.scheduledAt, zone)}`)
  if (task.lastDelivery !== undefined) parts.push(`最近投递 ${stamp(task.lastDelivery.deliveredAt, zone)}`)
  return `• ${parts.join(' · ')}`
}

/**
 * Render the Host task list.
 * @param tasks - every task the Host stores, active first.
 * @returns the text the terminal prints.
 */
export function formatTasks(tasks: readonly ScheduleCatalogEntry[]): string {
  if (tasks.length === 0) return '还没有定时任务。用 /create-auto-task 描述需求，让 agent 建一个。'
  const active = tasks.filter(task => task.status === 'active').length
  return [`定时任务 ${String(tasks.length)} 个（启用 ${String(active)}）`, ...tasks.map(lineOf)].join('\n')
}

/** Register `/tasks` for every composed human-command adapter. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'tasks',
    description: '列出 Host 上的定时任务',
    handler: async (invocation): Promise<CommandResult> => {
      if (invocation.rawInput.trim() !== '') return { kind: 'error', text: USAGE }
      try {
        return { kind: 'success', text: formatTasks(await ctx.schedule.catalog()) }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        return { kind: 'error', text: `读取定时任务失败：${reason}` }
      }
    },
  }), 'hulala-command-tasks lifecycle')
}

/** Cordis object-form plugin mounted by the Host assembly. */
export const commandTasksPlugin = { name, inject, apply }
