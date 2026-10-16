export const CRON_TASK_HISTORY_LIMIT = 99;

export type CronTaskSchedule = {
  cron?: string;
  every?: string;
  time?: string;
  timeZone?: string;
};

export type CronTaskTarget = {
  kind: string;
  agentID?: string;
  cwd?: string;
};

export type CronTaskPayload = {
  kind: string;
  text?: string;
  data?: Record<string, unknown>;
};

export type CronTask = {
  id: string;
  revision?: number;
  requestId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  schedule: CronTaskSchedule;
  target: CronTaskTarget;
  payload: CronTaskPayload;
  createdAtMs?: number;
  updatedAtMs?: number;
};

export type CronTaskState = {
  taskID: string;
  specHash?: string;
  nextRunAtMs?: number;
  runNowAtMs?: number;
  lastRunAtMs?: number;
  runningAtMs?: number;
  lastError?: string;
  consecutiveErrors?: number;
};

export type CronTaskRecord = {
  task: CronTask;
  state?: CronTaskState | null;
};

export type CronListResult = {
  version?: number;
  tasks?: CronTaskRecord[];
};

export type CronRunResult = {
  queued?: boolean;
  task?: CronTaskRecord;
};

export type CronTaskHistoryEntry = {
  runID: string;
  taskID: string;
  trigger: string;
  scheduledAtMs?: number;
  startedAtMs: number;
  finishedAtMs?: number;
  durationMs?: number;
  status: string;
  error?: string;
  threadID?: string;
  agentID?: string;
};

export type CronTaskHistoryResult = {
  taskID?: string;
  limit?: number;
  runs?: CronTaskHistoryEntry[];
};

class CronService {
  constructor(private tabId: string) {}

  private readonly requests = new Map<string, string>();

  private async records(): Promise<CronTaskRecord[]> {
    const result = await window.hulala!.desktop.cron.list(this.tabId) as { items?: Array<any> };
    return (result.items || []).map((item) => ({
      task: {
        id: item.id,
        name: item.name,
        revision: item.revision,
        description: item.description,
        enabled: item.enabled,
        schedule: item.schedule,
        target: { kind: 'workspace', cwd: item.cwd },
        payload: { kind: 'prompt', text: item.prompt, data: { modelKey: item.modelKey || '', workspacePath: item.workspacePath } },
        createdAtMs: Date.parse(item.createdAt || '') || undefined,
        updatedAtMs: Date.parse(item.updatedAt || '') || undefined,
      },
      state: { taskID: item.id, nextRunAtMs: item.nextRunAt ? Date.parse(item.nextRunAt) : undefined,
        ...(item.lastRun ? { lastRunAtMs: Date.parse(item.lastRun.startedAt), lastError: item.lastRun.error || (item.lastRun.state === 'failed' ? 'The Agent turn failed. Open its Session for details.' : undefined), runningAtMs: ['queued', 'running'].includes(item.lastRun.state) ? Date.parse(item.lastRun.startedAt) : undefined } : {}),
      },
    }));
  }

  async list(): Promise<CronTaskRecord[]> {
    return this.records();
  }

  async get(id: string): Promise<CronTaskRecord | null> {
    if (!id.trim()) {
      return null;
    }
    return (await this.records()).find((record) => record.task.id === id) || null;
  }

  async update(task: CronTask): Promise<CronTaskRecord | null> {
    const created = await window.hulala!.desktop.cron.create(this.tabId, task) as any;
    return this.get(created.id);
  }

  async remove(id: string): Promise<void> { await window.hulala!.desktop.cron.remove(this.tabId, id); }

  async run(id: string): Promise<CronRunResult> {
    if (!this.requests.has(id)) this.requests.set(id, crypto.randomUUID());
    const result = await window.hulala!.desktop.cron.run(this.tabId, id, this.requests.get(id)) as { sessionId?: string };
    this.requests.delete(id);
    return { queued: true, ...(result.sessionId ? { task: await this.get(id) || undefined } : {}) };
  }

  async history(id: string, limit = CRON_TASK_HISTORY_LIMIT): Promise<CronTaskHistoryEntry[]> {
    if (!id.trim()) {
      return [];
    }
    const result = await window.hulala!.desktop.cron.history(this.tabId, id, limit) as { items?: CronTaskHistoryEntry[] };
    return result.items || [];
  }
}

export function createCronService(tabId: string): CronService {
  return new CronService(tabId);
}

export type { CronService };
