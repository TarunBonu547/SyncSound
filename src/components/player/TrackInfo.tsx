import { Heart, Disc3 } from 'lucide-react';
import type { Track } from '../../types/music';

type TrackInfoProps = {
  current: Track | null;
  isLiked: boolean;
  /** What the room is doing, used for the playback status label. */
  playing: boolean;
  ytError: string | null;
  playerError: string | null;
  onToggleLike: () => void;
};

/**
 * The track that plays.
 *
 * The artwork, the title, the artist and a small playback status, with the
 * heart that keeps the track in the library of this device.
 */
export default function TrackInfo({
  current,
  isLiked,
  playing,
  ytError,
  playerError,
  onToggleLike,
}: TrackInfoProps) {
  const key = current?.id || 'none';
  const status = current ? (playing ? 'On Air' : 'Paused') : 'Standby';
  return (
    <div className="player-meta" key={key}>
      {(ytError || playerError) && (
        <p className="error-text sr-error" role="alert">
          {ytError || playerError}
        </p>
      )}

      <div className="track-row">
        {current ? (
          <img className="track-art track-transition" src={current.thumbnail} alt={`Artwork for ${current.title}`} />
        ) : (
          <span className="track-art is-empty" aria-hidden="true">
            <Disc3 size={20} />
          </span>
        )}
        <div className="track-text">
          <span className={`track-status ${current && playing ? 'is-live' : ''}`}>
            <span className="track-status-dot" aria-hidden="true" />
            {status}
          </span>
          <h1 className="track-title track-transition">{current?.title || 'Waiting for the first song'}</h1>
          <p className="track-channel track-transition">{current?.channel || 'No artist yet'}</p>
        </div>
        <button
          className={`sr-icon-btn like-btn ${isLiked ? 'is-liked' : ''}`}
          onClick={onToggleLike}
          disabled={!current}
          title={isLiked ? 'Remove from liked songs' : 'Like this song'}
          aria-label={isLiked ? 'Remove from liked songs' : 'Like this song'}
          aria-pressed={isLiked}
        >
          <Heart size={18} fill={isLiked ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  );
}