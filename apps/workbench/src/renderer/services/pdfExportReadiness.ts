export class PdfExportReadinessTracker {
  private pendingCount = 0;
  private idleResolvers = new Set<() => void>();

  track<T>(task: Promise<T>): Promise<T> {
    this.pendingCount += 1;
    return task.finally(() => {
      this.pendingCount = Math.max(0, this.pendingCount - 1);
      if (this.pendingCount !== 0) {
        return;
      }
      const resolvers = Array.from(this.idleResolvers);
      this.idleResolvers.clear();
      for (const resolve of resolvers) {
        resolve();
      }
    });
  }

  waitForSettled(): Promise<void> {
    if (this.pendingCount === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleResolvers.add(resolve);
    });
  }
}

let activeTracker: PdfExportReadinessTracker | null = null;

export function installPdfExportReadinessTracker(tracker: PdfExportReadinessTracker | null): void {
  activeTracker = tracker;
}

export function trackPdfExportTask<T>(task: Promise<T>): Promise<T> {
  return activeTracker ? activeTracker.track(task) : task;
}
