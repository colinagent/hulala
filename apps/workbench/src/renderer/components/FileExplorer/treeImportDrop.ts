export type ExternalTreeDropTarget =
  | {
      kind: 'row';
      rowPath: string;
      targetDir: string;
    }
  | {
      kind: 'blank';
      dir: string;
    };

export function resolveDropTargetDir(input: {
  kind: 'blank';
  dir: string;
} | {
  kind: 'entry';
  path: string;
  parentDir: string;
  isDir: boolean;
}): string {
  if (input.kind === 'blank') {
    return input.dir;
  }
  return input.isDir ? input.path : input.parentDir;
}

type TimerFns = {
  setTimeoutFn?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
};

export function createTreeAutoExpandScheduler(
  onExpand: (dir: string) => void,
  delayMs = 650,
  timers: TimerFns = {},
) {
  const setTimeoutFn = timers.setTimeoutFn ?? ((callback, waitMs) => setTimeout(callback, waitMs));
  const clearTimeoutFn = timers.clearTimeoutFn ?? ((handle) => clearTimeout(handle));

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let pendingDir: string | null = null;

  const cancel = () => {
    if (timeoutHandle !== null) {
      clearTimeoutFn(timeoutHandle);
      timeoutHandle = null;
    }
    pendingDir = null;
  };

  const schedule = (dir: string | null | undefined) => {
    const nextDir = (dir || '').trim();
    if (!nextDir) {
      cancel();
      return;
    }
    if (pendingDir === nextDir && timeoutHandle !== null) {
      return;
    }
    cancel();
    pendingDir = nextDir;
    timeoutHandle = setTimeoutFn(() => {
      timeoutHandle = null;
      const resolvedDir = pendingDir;
      pendingDir = null;
      if (resolvedDir) {
        onExpand(resolvedDir);
      }
    }, delayMs);
  };

  return {
    schedule,
    cancel,
    getPendingDir: () => pendingDir,
  };
}
