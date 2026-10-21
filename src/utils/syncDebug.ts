/**
 * Temporary sync diagnostics.
 *
 * Enabled in dev builds or via VITE_SYNC_DEBUG=1. Everything printed here is
 * prefixed with [sync] so it can be filtered out easily. Never log room codes,
 * tokens or any other secret.
 */
const enabled = import.meta.env.DEV || import.meta.env.VITE_SYNC_DEBUG === '1';

export function syncDebug(label: string, data?: unknown) {
  if (!enabled) return;
  console.log(`[sync] ${label}`, data ?? '');
}
