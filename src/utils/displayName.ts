const KEY = 'syncsound-display-name';

/** A display name is short, so it always fits into a bubble of the chat. */
export const MAX_DISPLAY_NAME = 24;

/**
 * The name a person wants to be seen under.
 *
 * The name is text of the user: the control characters are removed, the
 * spaces are normalized and the length is limited, so it can never break the
 * line of a bubble. It is never used to identify anybody - the client id does
 * that - so two people may carry the same name.
 */
export function normalizeDisplayName(value: string): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, MAX_DISPLAY_NAME);
}

/** The name of this device, remembered for the next visit. */
export function readDisplayName(): string {
  try {
    return normalizeDisplayName(window.localStorage.getItem(KEY) || '');
  } catch {
    // The storage can be blocked: the name only lives in the page.
    return '';
  }
}

/**
 * Remembers the name of this device.
 *
 * The name survives a refresh, so a person does not have to type it again
 * after a reload.
 */
export function saveDisplayName(value: string): string {
  const name = normalizeDisplayName(value);
  try {
    if (name) window.localStorage.setItem(KEY, name);
    else window.localStorage.removeItem(KEY);
  } catch {
    // The storage can be blocked: the name is used anyway.
  }
  return name;
}
