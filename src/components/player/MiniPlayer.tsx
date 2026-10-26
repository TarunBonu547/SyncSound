import type { CSSProperties } from 'react';
import { Play, Pause, SkipBack, SkipForward, Maximize2 } from 'lucide-react';
import type { Track } from '../../types/music';

type MiniPlayerProps = {
  current: Track | null;
  playing: boolean;
  ready: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  onSeek: (value: number) => void;
  onOpenPlayer: () => void;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/**
 * The player that stays at the bottom of the screen.
 *
 * It keeps the music reachable while the lobby, the search or the library is
 * in front of the room, and it is the way back into the room.
 */
export default function MiniPlayer({
  current,
  playing,
  ready,
  currentTime,
  duration,
  onPlayPause,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  onSeek,
  onOpenPlayer,
}: MiniPlayerProps) {
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="mini-player" aria-label="Now playing">
      {current ? (
        <img className="mini-player-art" src={current.thumbnail} alt={`Artwork for ${current.title}`} />
      ) : (
        <span className="mini-player-art is-empty" aria-hidden="true" />
      )}

      <div className="mini-player-info">
        <p className="mini-player-title">{current?.title || 'Nothing playing'}</p>
        <p className="mini-player-channel">{current?.channel || 'Pick a track in the room'}</p>
      </div>

      <div className="mini-player-controls">
        <button
          className="btn icon sm"
          onClick={onPrevious}
          disabled={!hasPrevious}
          title="Previous track"
          aria-label="Play the previous track"
        >
          <SkipBack size={16} />
        </button>
        <button
          className="btn icon mini-player-play"
          onClick={onPlayPause}
          disabled={!current}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          className="btn icon sm"
          onClick={onNext}
          disabled={!hasNext}
          title="Next track"
          aria-label="Play the next track"
        >
          <SkipForward size={16} />
        </button>
      </div>

      <div className="mini-player-progress">
        <input
          type="range"
          min={0}
          max={duration || 0}
          value={currentTime}
          aria-label="Seek position"
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
          disabled={!current || !ready}
          style={{ '--progress': `${progress}%` } as CSSProperties}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
        <div className="mini-player-time">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <button className="mini-player-open" onClick={onOpenPlayer} title="Open the player" aria-label="Open the player">
        <Maximize2 size={16} aria-hidden="true" />
        <span>Open player</span>
      </button>
    </div>
  );
}
