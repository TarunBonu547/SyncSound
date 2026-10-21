import { Heart, Disc3 } from 'lucide-react';
import type { Track } from '../../types/music';

type TrackInfoProps = {
  current: Track | null;
  /** The name of the artist or channel of the track. */
  isLiked: boolean;
  ytError: string | null;
  playerError: string | null;
  onToggleLike: () => void;
};

/**
 * The track that plays.
 *
 * The artwork, the title and the artist, with the heart that keeps the track
 * in the library of this device.
 */
export default function TrackInfo({
  current,
  isLiked,
  ytError,
  playerError,
  onToggleLike,
}: TrackInfoProps) {
  return (
    <div className="player-meta">
      {(ytError || playerError) && (
        <p className="error-text" role="alert">
          {ytError || playerError}
        </p>
      )}

      <div className="track-row">
        {current ? (
          <img className="track-art" src={current.thumbnail} alt={`Artwork for ${current.title}`} />
        ) : (
          <span className="track-art is-empty" aria-hidden="true">
            <Disc3 size={20} />
          </span>
        )}
        <div className="track-text">
          <h1 className="track-title">{current?.title || 'Waiting for the first song'}</h1>
          <p className="track-channel">{current?.channel || 'No artist yet'}</p>
        </div>
        <button
          className={`btn icon like-btn ${isLiked ? 'is-liked' : ''}`}
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
