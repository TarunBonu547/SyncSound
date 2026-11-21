import type { CSSProperties } from 'react';
import { Play, Pause, SkipBack, SkipForward, Maximize2, Volume2, VolumeX, ListMusic, Disc3 } from 'lucide-react';
import type { Track } from '../../types/music';

type MiniPlayerProps = {
  current: Track | null;
  playing: boolean;
  ready: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  onSeek: (value: number) => void;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
  onOpenPlayer: () => void;
  onOpenQueue: () => void;
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
  volume,
  onPlayPause,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onOpenPlayer,
  onOpenQueue,
}: MiniPlayerProps) {
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const infoKey = current?.id || 'none';
  const isMuted = volume === 0;

  return (
    <div
      className={`sunday-room mini-player ${playing ? 'is-playing' : ''}`}
      role="region"
      aria-label="Now playing"
    >
      {current ? (
        <img className="mini-player-art" src={current.thumbnail} alt={`Artwork for ${current.title}`} />
      ) : (
        <span className="mini-player-art is-empty" aria-hidden="true">
          <Disc3 size={22} />
        </span>
      )}

      <div className="mini-player-info" key={infoKey}>
        <p className="mini-player-title">{current?.title || 'Nothing playing'}</p>
        <p className="mini-player-channel">{current?.channel || 'Pick a track in the room'}</p>
      </div>

      <div className="mini-player-controls">
        <button
          className="sr-icon-btn mini-player-skip"
          onClick={onPrevious}
          disabled={!hasPrevious}
          title="Previous track"
          aria-label="Play the previous track"
        >
          <SkipBack size={16} />
        </button>
        <button
          className="sr-icon-btn mini-player-play"
          onClick={onPlayPause}
          disabled={!current}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          className="sr-icon-btn mini-player-skip"
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

      <div className="mini-player-volume">
        <button
          className="sr-icon-btn mini-player-skip"
          onClick={onToggleMute}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label="Volume"
          style={{ '--volume': `${volume * 100}%` } as CSSProperties}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
        />
      </div>

      <button className="mini-player-queue" onClick={onOpenQueue} title="Open queue" aria-label="Open queue">
        <ListMusic size={16} /> <span className="mini-player-queue-text">Queue</span>
      </button>

      <button className="mini-player-open" onClick={onOpenPlayer} title="Open the player" aria-label="Open the player">
        <Maximize2 size={16} aria-hidden="true" />
        <span>Open player</span>
      </button>
    </div>
  );
}