import type { CSSProperties, RefObject } from 'react';
import { Heart, Loader2, AlertCircle, Play } from 'lucide-react';
import type { QueueEntry, Track } from '../../types/music';
import type { SearchResult } from '../../utils/youtubeSearch';
import { YT_STATE, type YouTubePlayer } from '../../hooks/useYouTubePlayer';
import PlaybackControls from './PlaybackControls';
import QueuePanel from '../queue/QueuePanel';
import AddToQueueForm from '../queue/AddToQueueForm';
import DedicationCard from './DedicationCard';
import ReactionBubble from './ReactionBubble';
import type { SongDedication } from '../../types/music';

export type QueueSearchState = {
  term: string;
  setTerm: (value: string) => void;
  searching: boolean;
  results: SearchResult[];
  nextPageToken: string | null;
  error: string | null;
  notice: string | null;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  run: (pageToken?: string) => void;
};

type MainPlayerProps = {
  /** The container the YouTube player is mounted into. */
  stageRef: RefObject<HTMLDivElement | null>;
  current: Track | null;
  yt: YouTubePlayer;
  /** What the room does, not what the player momentarily reports. */
  playing: boolean;
  progress: number;
  isLiked: boolean;
  ytError: string | null;
  playerError: string | null;
  onSeek: (value: number) => void;
  onTogglePlayback: () => void;
  /** Starts the video when the browser refused to start it on its own. */
  onRequestPlay: () => void;
  onRewind5: () => void;
  onForward5: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleLike: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  /** True while a track is on its way into the queue. */
  adding: boolean;
  onAddQueue: () => void;
  onLoadVideo: (id: string, dedication?: string) => void;
  search: QueueSearchState;
  onAddToQueue: (track: SearchResult, dedication?: string) => Promise<string | null>;
  onPlayNow: (track: SearchResult, dedication?: string) => Promise<string | null>;
  inRoom: boolean;
  queue: QueueEntry[];
  activeQueueItemId: string | null;
  onPlayQueue: (itemId: string) => void;
  onMoveUp: (itemId: string) => void;
  onMoveDown: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  /** Edits or removes the dedication on a queued item. */
  editDedication: (itemId: string, text: string | null) => Promise<string | null>;
  /** The id of this client, used to decide who may edit a dedication. */
  clientId: string;
  /** The dedication card to show, if any. */
  showDedication: { dedication: SongDedication; itemId: string } | null;
  onDismissDedication: () => void;
  onSaveDedication: (text: string) => void;
  onRemoveDedication: () => void;
  /** Reactions to the current song, keyed by emoji. */
  reactions: Record<string, { id: string; clientId: string; clientName: string; timestamp: number }[]>;
  /** The id of this client, used to mark self reactions. */
  reactionClientId: string;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/**
 * The video player at the heart of the listening room.
 *
 * The YouTube player is the real thing: it is mounted once into a container
 * that React does not own, so the IFrame API may replace it with its own
 * iframe without breaking the rest of the page. The left card holds the video
 * (or the waiting equalizer when nothing plays); the right column holds the
 * track title, artist, playback status and favourite button. Progress bar and
 * transport controls span full width below.
 */
export default function MainPlayer({
  stageRef,
  current,
  yt,
  playing,
  progress,
  isLiked,
  ytError,
  playerError,
  onSeek,
  onTogglePlayback,
  onRequestPlay,
  onRewind5,
  onForward5,
  onPrevious,
  onNext,
  onToggleLike,
  hasPrevious,
  hasNext,
  adding,
  onAddQueue,
  onLoadVideo,
  search,
  onAddToQueue,
  onPlayNow,
  inRoom,
  queue,
  activeQueueItemId,
  onPlayQueue,
  onMoveUp,
  onMoveDown,
  onRemove,
  editDedication,
  clientId,
  showDedication,
  onDismissDedication,
  onSaveDedication,
  onRemoveDedication,
  reactions,
  reactionClientId,
}: MainPlayerProps) {
  const hasTrack = !!current;
  /** The video is loaded and the IFrame API is ready for it. */
  const playerReady = yt.ready;
  /**
   * The browser refused to start the video on its own.
   *
   * The room says the track plays, but the player only sits at the start.
   * That is the autoplay policy of the browser, so the interface asks for a
   * click instead of trying to get around it.
   */
  const needsGesture =
    hasTrack &&
    playing &&
    playerReady &&
    (yt.state === YT_STATE.cued || yt.state === YT_STATE.paused);
  /** The video is on its way. */
  const loading = hasTrack && !playerReady && !yt.error;
  /** The video may not be played. */
  const failed = hasTrack && !!yt.error;
  /** Playback status text derived from the YouTube player state. */
  const statusText = (() => {
    if (!hasTrack) return 'STANDBY';
    if (yt.state === YT_STATE.ended) return 'ENDED';
    if (playing) return 'PLAYING';
    return 'PAUSED';
  })();

  return (
    <div className="lounge-main-column">
      <section className="lounge-player" aria-label="Now playing">
        <div className="player-grid">
          {/* Left column: Video / visualizer card */}
          <div className="player-visual">
            <div className="video-card">
              {/* The real YouTube player mounts here exactly once. The IFrame API
                  fills the container; React never owns what is inside it. */}
              <div className="lounge-stage-video" ref={stageRef} title="SyncSound player" />

              {/* Empty state: animated equalizer + waiting message */}
              {!hasTrack && (
                <div className="video-empty-state">
                  <div className="eq-anim" aria-hidden="true">
                    <span className="eq-bar" style={{ height: '40%' }} />
                    <span className="eq-bar" style={{ height: '70%' }} />
                    <span className="eq-bar" style={{ height: '50%' }} />
                    <span className="eq-bar" style={{ height: '90%' }} />
                    <span className="eq-bar" style={{ height: '60%' }} />
                  </div>
                  <h3 className="waiting-title">WAITING FOR THE NEXT TRACK</h3>
                  <p className="waiting-hint">Add a song below to start listening.</p>
                </div>
              )}

              <div className="lounge-reaction-stage" aria-hidden="true">
                {hasTrack &&
                  Object.entries(reactions).map(([emoji, list]) => (
                    <div key={emoji} className="lounge-reaction-group" aria-label={`${emoji} reactions`}>
                      <span className="lounge-reaction-count" aria-hidden="true">
                        {emoji} {list.length}
                      </span>
                      {list.map((r) => (
                        <ReactionBubble
                          key={r.id}
                          reaction={{ ...r, emoji, id: r.id }}
                          isSelf={r.clientId === reactionClientId}
                        />
                      ))}
                    </div>
                  ))}
              </div>

              {loading && (
                <div className="stage-overlay" role="status">
                  <Loader2 size={20} className="spin" aria-hidden="true" />
                  <span>Loading the video…</span>
                </div>
              )}
              {failed && (
                <div className="stage-overlay is-error" role="alert">
                  <AlertCircle size={20} aria-hidden="true" />
                  <span>{yt.error}</span>
                </div>
              )}
              {needsGesture && !failed && (
                <div className="stage-overlay" role="status">
                  <button className="lounge-btn lounge-btn--primary" onClick={onRequestPlay}>
                    <Play size={16} aria-hidden="true" /> Play the video
                  </button>
                  <span className="lounge-stage-overlay-hint">
                    The browser blocked the automatic start. One click and the room is on the same track
                    again.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right column: Song title, artist, status, favorite */}
          <div className="player-meta">
            <div className="track-status-wrap">
              <span
                className={`lounge-sync-indicator ${playing ? 'is-playing' : 'is-paused'}`}
                title="Playback is synchronised across the room"
              >
                {statusText}
              </span>
              <div className="track-text">
                <h2 className="lounge-song-title">
                  {hasTrack ? current.title : 'Waiting for the first song'}
                </h2>
                <p className="lounge-artist">
                  {hasTrack ? current.channel || 'Unknown artist' : 'Add a song below to begin'}
                </p>
              </div>
            </div>

            <button
              className={`lounge-heart-btn ${isLiked ? 'is-active' : ''}`}
              onClick={onToggleLike}
              disabled={!hasTrack}
              title={isLiked ? 'Remove from liked songs' : 'Like this song'}
              aria-label={isLiked ? 'Remove from liked songs' : 'Like this song'}
              aria-pressed={isLiked}
            >
              <Heart size={18} fill={isLiked ? 'currentColor' : 'none'} />
            </button>

            {(ytError || playerError) && (
              <p className="lounge-error-text" role="alert">
                {ytError || playerError}
              </p>
            )}
          </div>
        </div>

        {/* Full-width playback progress bar */}
        <div className="lounge-progress-section">
          <div
            className="lounge-progress"
            onClick={(e) => {
              if (!yt.duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
              onSeek(ratio * yt.duration);
            }}
            role="slider"
            tabIndex={0}
            aria-label="Seek position"
            aria-valuemin={0}
            aria-valuemax={Math.round(yt.duration)}
            aria-valuenow={Math.round(yt.currentTime)}
            aria-valuetext={`${formatTime(yt.currentTime)} of ${formatTime(yt.duration)}`}
            onKeyDown={(e) => {
              if (!yt.duration) return;
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                onSeek(Math.min(yt.duration, yt.currentTime + 5));
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                onSeek(Math.max(0, yt.currentTime - 5));
              } else if (e.key === 'Home') {
                e.preventDefault();
                onSeek(0);
              } else if (e.key === 'End') {
                e.preventDefault();
                onSeek(yt.duration);
              }
            }}
          >
            <div className="lounge-progress-fill" style={{ width: `${progress}%` } as CSSProperties} />
          </div>
          <div className="lounge-times">
            <span>{formatTime(yt.currentTime)}</span>
            <span>{formatTime(yt.duration)}</span>
          </div>
        </div>

        {/* Bottom center: playback controls */}
        <div className="player-transport">
          <PlaybackControls
            onRewind5={onRewind5}
            onPrevious={onPrevious}
            onTogglePlayback={onTogglePlayback}
            onNext={onNext}
            onForward5={onForward5}
            onToggleLike={onToggleLike}
            playing={playing}
            ready={yt.ready}
            hasTrack={hasTrack}
            isLiked={isLiked}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
          />
        </div>
      </section>

      {showDedication && (
        <div className="lounge-dedication-wrap">
          <DedicationCard
            dedication={showDedication.dedication}
            isAuthor={showDedication.dedication.authorId === clientId}
            onDismiss={onDismissDedication}
            onSave={onSaveDedication}
            onRemove={onRemoveDedication}
          />
        </div>
      )}

      <AddToQueueForm
        term={search.term}
        setTerm={search.setTerm}
        searching={search.searching}
        runSearch={search.run}
        results={search.results}
        nextPageToken={search.nextPageToken}
        adding={adding}
        addQueue={onAddQueue}
        loadVideo={onLoadVideo}
        onAddToQueue={onAddToQueue}
        onPlayNow={onPlayNow}
        inRoom={inRoom}
        error={search.error}
        notice={search.notice}
        setError={search.setError}
        setNotice={search.setNotice}
      />

      <QueuePanel
        queue={queue}
        activeQueueItemId={activeQueueItemId}
        onPlay={onPlayQueue}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onRemove={onRemove}
        clientId={clientId}
        editDedication={editDedication}
      />
    </div>
  );
}
