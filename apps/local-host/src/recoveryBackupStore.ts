import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  isRecoveryBackupInput,
  isRecoveryBackupRecord,
  type RecoveryBackupIdentity,
  type RecoveryBackupInput,
  type RecoveryBackupRecord,
} from './shared/recoveryBackup';
import { writeJsonFileAtomic } from './shared/jsonFile';

const DEFAULT_FLUSH_DELAY_MS = 250;

function backupKey(identity: RecoveryBackupIdentity): string {
  return createHash('sha256')
    .update(identity.workspaceTabId)
    .update('\0')
    .update(identity.id)
    .digest('hex');
}

export class RecoveryBackupStore {
  private readonly staged = new Map<string, RecoveryBackupRecord>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly latestVersions = new Map<string, number>();

  constructor(
    private readonly root: string,
    private readonly flushDelayMs = DEFAULT_FLUSH_DELAY_MS,
  ) {}

  stage(value: unknown): boolean {
    if (!isRecoveryBackupInput(value)) {
      return false;
    }
    const input: RecoveryBackupInput = {
      ...value,
      workspaceTabId: value.workspaceTabId.trim(),
      id: value.id.trim(),
      editorId: value.editorId.trim(),
      uri: value.uri?.trim() || undefined,
      filePath: value.filePath?.trim() || undefined,
    };
    const key = backupKey(input);
    const latestVersion = this.latestVersions.get(key);
    if (latestVersion !== undefined && latestVersion > input.contentVersion) {
      return true;
    }
    const existing = this.staged.get(key);
    if (existing && existing.contentVersion > input.contentVersion) {
      return true;
    }
    this.latestVersions.set(key, input.contentVersion);
    this.staged.set(key, { ...input, timestamp: Date.now() });
    this.schedule(key);
    return true;
  }

  async flush(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    while (this.staged.size > 0) {
      const keys = Array.from(this.staged.keys());
      await Promise.all(keys.map((key) => this.persist(key)));
    }
    await Promise.all(Array.from(this.writes.values()));
  }

  async load(): Promise<RecoveryBackupRecord[]> {
    await this.flush();
    await fs.mkdir(this.root, { recursive: true });
    const names = await fs.readdir(this.root).catch(() => [] as string[]);
    const latest = new Map<string, RecoveryBackupRecord>();
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }
      try {
        const value: unknown = JSON.parse(
          await fs.readFile(path.join(this.root, name), 'utf8'),
        );
        if (!isRecoveryBackupRecord(value)) {
          continue;
        }
        const key = backupKey(value);
        const existing = latest.get(key);
        if (
          !existing
          || value.contentVersion > existing.contentVersion
          || (
            value.contentVersion === existing.contentVersion
            && value.timestamp > existing.timestamp
          )
        ) {
          latest.set(key, value);
        }
        this.latestVersions.set(
          key,
          Math.max(this.latestVersions.get(key) ?? 0, value.contentVersion),
        );
      } catch {
        // A corrupt recovery record must not prevent other buffers restoring.
      }
    }
    return Array.from(latest.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  async delete(identity: RecoveryBackupIdentity): Promise<void> {
    const key = backupKey(identity);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    this.staged.delete(key);
    this.latestVersions.delete(key);
    await this.writes.get(key)?.catch(() => undefined);
    await fs.unlink(this.filePath(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }

  private schedule(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
    }
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      void this.persist(key).catch(() => undefined);
    }, this.flushDelayMs));
  }

  private persist(key: string): Promise<void> {
    const record = this.staged.get(key);
    if (!record) {
      return this.writes.get(key) ?? Promise.resolve();
    }
    const previous = this.writes.get(key) ?? Promise.resolve();
    const write = previous
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.root, { recursive: true });
        await writeJsonFileAtomic(this.filePath(key), record);
        if (this.staged.get(key) === record) {
          this.staged.delete(key);
        }
      })
      .finally(() => {
        if (this.writes.get(key) === write) {
          this.writes.delete(key);
        }
        if (this.staged.has(key) && !this.timers.has(key)) {
          this.schedule(key);
        }
      });
    this.writes.set(key, write);
    return write;
  }

  private filePath(key: string): string {
    return path.join(this.root, `${key}.json`);
  }
}
