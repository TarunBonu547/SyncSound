const KEY = 'syncsound-client-id';
/** The fallback id, used when the storage is blocked. */
let fallbackId: string | null = null;

/**
 * The id of this browser tab.
 *
 * The server uses it to recognise one person: a refresh keeps the id, so the
 * host stays the host and a reload does not turn into a second listener. Two
 * tabs of the same browser get different ids, because they are two people at
 * the keyboard in a test.
 */
export function readClientId(): string {
  try {
    const stored = window.sessionStorage.getItem(KEY);
    if (stored) return stored;
    const id = `c-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    window.sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    // Storage can be blocked: the id stays the same for the whole page.
    if (!fallbackId) fallbackId = `c-${Math.random().toString(36).slice(2, 12)}`;
    return fallbackId;
  }
}
