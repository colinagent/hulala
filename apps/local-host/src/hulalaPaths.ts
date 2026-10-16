import { resolve, join } from 'node:path';

export function resolveHulalaRoot(homeDir: string): string {
  const configured = (process.env.HULALA_HOME || '').trim();
  if (configured && !configured.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(configured)) {
    throw new Error('HULALA_HOME must be an absolute path');
  }
  return resolve(configured || join(homeDir, '.config', 'hulala'));
}

export function resolveHulalaConfigDir(homeDir: string): string {
  return join(resolveHulalaRoot(homeDir), 'config');
}

export function resolveHulalaDesktopDir(homeDir: string): string {
  return join(resolveHulalaRoot(homeDir), 'desktop');
}
