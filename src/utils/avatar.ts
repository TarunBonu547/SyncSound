/**
 * Avatars of the members of a room.
 *
 * The initials and the colour are derived from the client id of a member, so
 * the same person always looks the same and no picture service is needed.
 */

const COLORS = [
  'var(--peach)',
  'var(--lavender)',
  'var(--butter)',
  'var(--mint)',
  'var(--sky)',
  'var(--pink)',
];

/** A short, stable number for a string. */
function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/** The initials of a name: "Host" becomes "H", "Listener 2" becomes "L2". */
export function initialsFor(name: string): string {
  const clean = (name || '').trim();
  if (!clean) return '?';
  const words = clean.split(/\s+/).slice(0, 2);
  const letters = words
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, '').charAt(0))
    .filter(Boolean)
    .join('');
  return letters ? letters.toUpperCase() : clean.charAt(0).toUpperCase();
}

/** The colour of the avatar bubble of a member. */
export function colorFor(seed: string): string {
  return COLORS[hash(seed || 'syncsound') % COLORS.length];
}

/** The initials and the colour of a member in one step. */
export function avatarFor(name: string, seed: string): { initials: string; color: string } {
  return { initials: initialsFor(name), color: colorFor(seed) };
}

/** The time of a chat message, in the local time zone. */
export function formatTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
