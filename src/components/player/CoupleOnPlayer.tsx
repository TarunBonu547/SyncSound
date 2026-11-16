import { useEffect, useRef, useState } from 'react';

export type CoupleOnPlayerProps = {
  /** True while the room's track is actually playing. */
  playing: boolean;
  /** True when a new track just started (subtle entrance reaction). */
  newSong?: boolean;
  /** Optional beat strength 0..1. When provided, the couple reacts more strongly. */
  beat?: number;
};

/**
 * The couple that sits on the upper-right edge of the player card.
 *
 * The artwork lives in `public/images/sync-couple.png`. The component itself only
 * decides *how* the image moves: it never draws a body with CSS, so the approved
 * 3D look is preserved.
 */
export default function CoupleOnPlayer({ playing, newSong = false, beat = 0 }: CoupleOnPlayerProps) {
  // Entrance only fires once per new-song signal; a ref tracks whether the
  // current signal has already been consumed so the animation does not replay.
  const consumedRef = useRef(false);
  const [entrance, setEntrance] = useState(false);

  useEffect(() => {
    if (!newSong || consumedRef.current) return;
    consumedRef.current = true;
    // Defer the state update out of the effect body to avoid a cascading render.
    const id = window.requestAnimationFrame(() => setEntrance(true));
    const t = window.setTimeout(() => {
      setEntrance(false);
      consumedRef.current = false;
    }, 1400);
    return () => {
      window.cancelAnimationFrame(id);
      window.clearTimeout(t);
    };
  }, [newSong]);

  const beatClass = beat > 0.5 ? 'is-beat-strong' : beat > 0.15 ? 'is-beat' : '';

  return (
    <div
      className={`couple-layer ${playing ? 'is-playing' : 'is-paused'} ${entrance ? 'is-entrance' : ''} ${beatClass}`}
      aria-hidden="true"
    >
      <img
        className="couple-img"
        src="/images/sync-couple.png"
        alt="Together Mode couple"
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}