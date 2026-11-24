import { Disc3 } from 'lucide-react';

type LoungeArtworkProps = {
  /** True while the room is playing; drives the spinning rings. */
  playing: boolean;
};

/**
 * The decorative artwork of the listening lounge.
 *
 * It is the visual centrepiece of the player stage: a soft, layered gradient
 * disc with slowly rotating rings. It is purely decorative — the real
 * YouTube video mounts into a separate, React-owned container behind it —
 * so it stays lightweight and never blocks the player.
 */
export default function LoungeArtwork({ playing }: LoungeArtworkProps) {
  return (
    <div className={`lounge-artwork ${playing ? 'is-playing' : 'is-paused'}`} aria-hidden="true">
      <div className="lounge-artwork-rings">
        <span className="lounge-artwork-ring lounge-artwork-ring--outer" />
        <span className="lounge-artwork-ring lounge-artwork-ring--inner" />
      </div>
      <div className="lounge-artwork-content">
        <span className="lounge-artwork-icon">
          <Disc3 size={42} />
        </span>
        <span className="lounge-artwork-label">OUR LITTLE MUSIC SPACE</span>
      </div>
    </div>
  );
}