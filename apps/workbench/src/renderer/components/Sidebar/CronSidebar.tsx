import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { CronTaskRecord } from '../../services/cronService';
import { AlertCircleIcon, CheckCircleIcon, ClockIcon, LoaderIcon, RefreshIcon, PlusIcon } from '../Icons';
import { IconButton } from '../IconButton';
import {
  cronTaskPath,
  cronTaskStatus,
  cronTaskTitle,
} from '../../utils/cronDisplay';

function CronSidebarRowError({ error }: { error: string }) {
  return (
    <div className="mt-2 whitespace-pre-wrap rounded border border-accent/35 bg-accent/10 px-2 py-1.5 text-xs text-accent">
      {error}
    </div>
  );
}

function StatusIcon({ tone }: { tone: ReturnType<typeof cronTaskStatus>['tone'] }) {
  if (tone === 'running') {
    return <LoaderIcon className="h-3.5 w-3.5 animate-spin" />;
  }
  if (tone === 'error') {
    return <AlertCircleIcon className="h-3.5 w-3.5 text-accent" />;
  }
  if (tone === 'ok') {
    return <CheckCircleIcon className="h-3.5 w-3.5 text-health-text" />;
  }
  return <ClockIcon className="h-3.5 w-3.5 text-secondary-text" />;
}

function statusPillClass(status: ReturnType<typeof cronTaskStatus>): string {
  if (status.label === 'Ready') {
    return 'border-health-text/35 bg-health-text/10 text-health-text';
  }
  if (status.tone === 'running') {
    return 'border-brand/35 bg-brand/10 text-brand';
  }
  if (status.tone === 'error') {
    return 'border-accent/35 bg-accent/10 text-accent';
  }
  return 'border-border bg-secondary-bg text-secondary-text';
}

function CronTaskRow({
  record,
  runningID,
  onRun,
  onOpen,
}: {
  record: CronTaskRecord;
  runningID: string | null;
  onRun: (taskID: string) => void;
  onOpen: (record: CronTaskRecord) => void;
}) {
  const status = cronTaskStatus(record);
  const running = runningID === record.task.id || status.tone === 'running';
  return (
    <div
      role="button"
      tabIndex={0}
      className="block w-full cursor-pointer border-b border-border/70 px-3 py-2.5 text-left hover:bg-hover-bg last:border-b-0"
      onClick={() => onOpen(record)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(record);
        }
      }}
      title={cronTaskTitle(record)}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
          <StatusIcon tone={status.tone} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-prime-text">
              {cronTaskTitle(record)}
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${statusPillClass(status)}`}>
              {status.label}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-secondary-text" title={cronTaskPath(record)}>
            {cronTaskPath(record)}
          </div>
          {record.state?.lastError ? (
            <CronSidebarRowError error={record.state.lastError} />
          ) : null}
        </div>
        <button
          type="button"
          className="ml-1 shrink-0 rounded border border-border px-2 py-1 text-xs text-secondary-text hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
          disabled={running}
          onClick={(event) => {
            event.stopPropagation();
            onRun(record.task.id);
          }}
        >
          {running ? 'Running' : 'Run'}
        </button>
      </div>
    </div>
  );
}

export function CronSidebar() {
  const connectionState = useAppStore((state) => state.connectionState);
  const listCronTasks = useAppStore((state) => state.listCronTasks);
  const openCronTaskTab = useAppStore((state) => state.openCronTaskTab);
  const runCronTask = useAppStore((state) => state.runCronTask);
  const [records, setRecords] = useState<CronTaskRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningID, setRunningID] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (connectionState !== 'connected') {
      setRecords([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const next = await listCronTasks();
      setRecords(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cron tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    if (connectionState !== 'connected') {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [connectionState, listCronTasks]);

  const visibleTasks = useMemo(() => records, [records]);

  const runTask = async (taskID: string) => {
    setRunningID(taskID);
    try {
      await runCronTask(taskID);
      await refresh();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run cron task');
    } finally {
      setRunningID(null);
    }
  };

  let body: React.ReactNode;
  if (connectionState !== 'connected') {
    body = <div className="px-3 py-3 text-xs text-secondary-text">Cron is unavailable while disconnected.</div>;
  } else if (loading && records.length === 0) {
    body = <div className="px-3 py-3 text-xs text-secondary-text">Loading cron tasks...</div>;
  } else if (error) {
    body = <div className="px-3 py-3 text-xs text-accent">{error}</div>;
  } else if (visibleTasks.length === 0) {
    body = <div className="px-3 py-3 text-xs text-secondary-text">No scheduled tasks in this Workspace.</div>;
  } else {
    body = (
      <div className="overflow-auto">
        {visibleTasks.map((record) => (
          <CronTaskRow
            key={record.task.id}
            record={record}
            runningID={runningID}
            onRun={(taskID) => void runTask(taskID)}
            onOpen={(record) => openCronTaskTab(record.task.id, cronTaskTitle(record))}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col text-prime-text">
      <div className="ui-tabbar sidebar-root-header flex shrink-0 items-center gap-1 overflow-hidden px-2 text-secondary-text">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="ui-chrome-row-label truncate">Cron</span>
        </div>
        <div className="sidebar-root-header-actions ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton title="New scheduled task" onClick={() => openCronTaskTab('new', 'New scheduled task')}><PlusIcon className="h-3.5 w-3.5" /></IconButton>
          <IconButton
            onClick={() => void refresh()}
            title="Refresh Cron"
            disabled={loading}
          >
            <RefreshIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </IconButton>
        </div>
      </div>
      {body}
    </div>
  );
}
