import { Rewind, SkipBack, SkipForward, FastForward, Play, Pause } from 'lucide-react';

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
 * The transport of the lounge player.
 *
 * Previous and next walk through the shared queue of the room, so every
 * member hears the same track change. Rewind and forward jump five seconds.
 */
export default function PlaybackControls({
  onRewind5,
  onPrevious,
  onTogglePlayback,
  onNext,
  onForward5,
  playing,
  ready,
  hasTrack,
  hasPrevious,
  hasNext,
}: PlaybackControlsProps) {
  return (
    <div className="lounge-controls">
      <button
        className="lounge-control"
        onClick={onRewind5}
        disabled={!ready}
        title="Rewind 5 seconds"
        aria-label="Rewind 5 seconds"
      >
        <Rewind size={20} />
      </button>
      <button
        className="lounge-control"
        onClick={onPrevious}
        disabled={!hasPrevious}
        title="Previous track"
        aria-label="Play the previous track"
      >
        <SkipBack size={20} />
      </button>
      <button
        className="lounge-control lounge-control--play"
        onClick={onTogglePlayback}
        disabled={!hasTrack}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause size={28} /> : <Play size={28} />}
      </button>
      <button
        className="lounge-control"
        onClick={onNext}
        disabled={!hasNext}
        title="Next track"
        aria-label="Play the next track"
      >
        <SkipForward size={20} />
      </button>
      <button
        className="lounge-control"
        onClick={onForward5}
        disabled={!ready}
        title="Forward 5 seconds"
        aria-label="Forward 5 seconds"
      >
        <FastForward size={20} />
      </button>
    </div>
  );
}
