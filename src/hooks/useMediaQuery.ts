import { useEffect, useState } from 'react';

/**
 * True while the screen matches a media query.
 *
 * The layout has a wide form (sidebar, player, chat side by side) and a
 * narrow one (the chat becomes a drawer). The hook tells the components which
 * of the two is in use, so the narrow screens do not render the chat twice.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
