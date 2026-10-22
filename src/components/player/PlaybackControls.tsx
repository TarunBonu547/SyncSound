import { RotateCcw, RotateCw, Play, Pause, Heart, SkipBack, SkipForward } from 'lucide-react';

type PlaybackControlsProps = {
  onRewind5: () => void;
  onPrevious: () => void;
  onTogglePlayback: () => void;
  onNext: () => void;
  onForward5: () => void;
  onToggleLike: () => void;
  playing: boolean;
  ready: boolean;
  hasTrack: boolean;
  isLiked: boolean;
  /** True when the queue has a track before the one that plays. */
  hasPrevious: boolean;
  /** True when the queue has a track after the one that plays. */
  hasNext: boolean;
};

/**
 * The transport of the player.
 *
 * Previous and next walk through the shared queue of the room, so every
 * member hears the same track change.
 */
export default function PlaybackControls({
  onRewind5,
  onPrevious,
  onTogglePlayback,
  onNext,
  onForward5,
  onToggleLike,
  playing,
  ready,
  hasTrack,
  isLiked,
  hasPrevious,
  hasNext,
}: PlaybackControlsProps) {
  return (
    <div className="transport">
      <button
        className="music-icon-btn"
        onClick={onRewind5}
        disabled={!ready}
        title="Rewind 5 seconds"
        aria-label="Rewind 5 seconds"
      >
        <RotateCcw size={18} />
      </button>
      <button
        className="music-icon-btn"
        onClick={onPrevious}
        disabled={!hasPrevious}
        title="Previous track"
        aria-label="Play the previous track"
      >
        <SkipBack size={18} />
      </button>
      <button
        className="play-btn"
        onClick={onTogglePlayback}
        disabled={!hasTrack}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause size={24} /> : <Play size={24} />}
      </button>
      <button
        className="music-icon-btn"
        onClick={onNext}
        disabled={!hasNext}
        title="Next track"
        aria-label="Play the next track"
      >
        <SkipForward size={18} />
      </button>
      <button
        className="music-icon-btn"
        onClick={onForward5}
        disabled={!ready}
        title="Forward 5 seconds"
        aria-label="Forward 5 seconds"
      >
        <RotateCw size={18} />
      </button>
      <button
        className={`music-icon-btn like-btn ${isLiked ? 'is-liked' : ''}`}
        onClick={onToggleLike}
        disabled={!hasTrack}
        title={isLiked ? 'Remove from liked songs' : 'Like this song'}
        aria-label={isLiked ? 'Remove from liked songs' : 'Like this song'}
        aria-pressed={isLiked}
      >
        <Heart size={18} fill={isLiked ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}
