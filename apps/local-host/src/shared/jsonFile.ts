import * as fs from 'fs/promises';
import * as path from 'path';

export async function writeJsonFileAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    const file = await fs.open(tempPath, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(data, null, 2), 'utf8');
      await file.sync();
    } finally { await file.close(); }
    await fs.rename(tempPath, filePath);
    // chmod also corrects files originally written by older releases with a
    // process-umask-derived mode. It is a no-op on platforms without POSIX
    // permission semantics.
    await fs.chmod(filePath, 0o600);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
