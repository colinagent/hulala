import { sessionStore } from "../../platform/storage";
export const RENDERER_ASSET_RECOVERY_KEY = 'hulala.renderer.asset-recovery-at';
export const RENDERER_ASSET_RECOVERY_COOLDOWN_MS = 15_000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

type RendererAssetRecoveryOptions = {
  beforeReload?: () => void | Promise<void>;
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  now?: () => number;
  reload?: () => void;
  storage?: StorageLike;
};

function previousRecoveryTime(storage: StorageLike): number | null {
  try {
    const value = Number(storage.getItem(RENDERER_ASSET_RECOVERY_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function rememberRecovery(storage: StorageLike, timestamp: number): void {
  try {
    storage.setItem(RENDERER_ASSET_RECOVERY_KEY, String(timestamp));
  } catch {
    // Reloading still repairs a stale file:// build when session storage is unavailable.
  }
}

export function shouldRecoverRendererAssets(
  storage: StorageLike,
  timestamp: number,
  cooldownMs = RENDERER_ASSET_RECOVERY_COOLDOWN_MS,
): boolean {
  const previous = previousRecoveryTime(storage);
  return previous === null || timestamp - previous >= cooldownMs;
}

/**
 * Vite emits this event when a built page references a hashed chunk that no
 * longer exists. This can happen when the local Desktop build is replaced
 * while an older Electron window is still open.
 */
export function installRendererAssetRecovery(
  options: RendererAssetRecoveryOptions = {},
): () => void {
  const eventTarget = options.eventTarget ?? window;
  const storage = options.storage ?? sessionStore;
  const now = options.now ?? Date.now;
  const reload = options.reload ?? (() => window.location.reload());
  let recoveryInProgress = false;

  const handlePreloadError = (event: Event) => {
    const timestamp = now();
    if (recoveryInProgress || !shouldRecoverRendererAssets(storage, timestamp)) {
      return;
    }

    // Prevent Vite from rethrowing the missing-chunk error while dirty editor
    // state is flushed. A recent marker lets a persistent error surface on the
    // next page instead of creating a reload loop.
    event.preventDefault();
    recoveryInProgress = true;
    rememberRecovery(storage, timestamp);

    void Promise.resolve()
      .then(() => options.beforeReload?.())
      .catch((error) => {
        console.error('[renderer] Failed to flush state before asset recovery:', error);
      })
      .finally(reload);
  };

  eventTarget.addEventListener('vite:preloadError', handlePreloadError);
  return () => eventTarget.removeEventListener('vite:preloadError', handlePreloadError);
}
