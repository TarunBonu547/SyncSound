import type { CSSProperties, RefObject } from 'react';
import { Video, Plus, UserPlus, Disc3, Loader2, AlertCircle, Play } from 'lucide-react';
import type { QueueEntry, Track } from '../../types/music';
import type { SearchResult } from '../../utils/youtubeSearch';
import { YT_STATE, type YouTubePlayer } from '../../hooks/useYouTubePlayer';
import TrackInfo from './TrackInfo';
import PlaybackControls from './PlaybackControls';
import QueuePanel from '../queue/QueuePanel';
import AddToQueueForm from '../queue/AddToQueueForm';
import DedicationCard from './DedicationCard';
import ReactionPicker from './ReactionPicker';
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
  onInvite: () => void;
  onVideoCall: () => void;
  onFocusQueueInput: () => void;
  /** Sends an emoji reaction to the room. */
  onSendReaction: (emoji: string) => void;
  /** True while a reaction is being sent. */
  reactionSending: boolean;
  /** Reactions to the current song, keyed by emoji. */
  reactions: Record<string, { clientId: string; clientName: string; timestamp: number }[]>;
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
 * The player in the middle of the room.
 *
 * The YouTube player is the real thing: it is mounted into a container that
 * React does not own, so the IFrame API may replace it with its own iframe
 * without breaking the rest of the page.
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
  onInvite,
  onVideoCall,
  onFocusQueueInput,
  onSendReaction,
  reactionSending,
  reactions,
  reactionClientId,
}: MainPlayerProps) {
  const hasTrack = !!current;
  const localPlaying = yt.state === YT_STATE.playing;
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

  return (
    <section className="card player-card" aria-label="Now playing">
      <div className="stage-wrap">
        <div className="reaction-stage" aria-hidden="true">
          {hasTrack &&
            Object.entries(reactions).map(([emoji, list]) => (
              <div key={emoji} className="reaction-emoji-group" aria-label={`${emoji} reactions`}>
                <span className="reaction-emoji-count" aria-hidden="true">
                  {emoji} {list.length}
                </span>
                {list.map((r) => (
                  <ReactionBubble
                    key={r.timestamp + r.clientId}
                    reaction={{ emoji, clientId: r.clientId, clientName: r.clientName, timestamp: r.timestamp }}
                    isSelf={r.clientId === reactionClientId}
                  />
                ))}
              </div>
            ))}
        </div>
        <div className="stage-glow" aria-hidden="true">
          {hasTrack && <img src={current.thumbnail} alt="" />}
        </div>
        <div className={`stage ${hasTrack ? 'has-video' : ''} ${localPlaying ? 'is-playing' : ''}`}>
          {/* The real video of the room lives here. The IFrame API fills the
              container, so the video is seen instead of the artwork. */}
          <div className="stage-video" ref={stageRef} title="SyncSound player" />
          {hasTrack && (
            <img
              className="stage-poster art-swap"
              key={current.id}
              src={current.thumbnail}
              alt={`Artwork for ${current.title}`}
            />
          )}
          {!hasTrack && (
            <div className="stage-empty">
              <span className="stage-empty-icon" aria-hidden="true">
                <Disc3 size={26} />
              </span>
              <p className="stage-empty-title">Nothing playing yet</p>
              <p className="stage-empty-hint">
                Add a song below and it starts for everyone in the room.
              </p>
            </div>
          )}
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
              <button className="btn primary" onClick={onRequestPlay}>
                <Play size={16} aria-hidden="true" /> Play the video
              </button>
              <span className="stage-overlay-hint">
                The browser blocked the automatic start. One click and the room
                is on the same track again.
              </span>
            </div>
          )}
        </div>
      </div>

      <TrackInfo
        current={current}
        isLiked={isLiked}
        ytError={ytError}
        playerError={playerError}
        onToggleLike={onToggleLike}
      />

      {showDedication && (
        <DedicationCard
          dedication={showDedication.dedication}
          isAuthor={showDedication.dedication.authorId === clientId}
          onDismiss={onDismissDedication}
          onSave={onSaveDedication}
          onRemove={onRemoveDedication}
        />
      )}

      <div className="scrubber">
        <input
          type="range"
          min={0}
          max={yt.duration || 0}
          value={yt.currentTime}
          aria-label="Seek position"
          aria-valuetext={`${formatTime(yt.currentTime)} of ${formatTime(yt.duration)}`}
          style={{ '--progress': `${progress}%` } as CSSProperties}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
        <div className="scrub-times">
          <span>{formatTime(yt.currentTime)}</span>
          <span>{formatTime(yt.duration)}</span>
        </div>
      </div>

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

      <ReactionPicker
        onReaction={onSendReaction}
        sending={reactionSending}
      />

      <div className="quick-actions">
        <button className="quick-action" onClick={onInvite} title="Invite a friend to this room">
          <span className="qa-icon qa-icon-mint" aria-hidden="true">
            <UserPlus size={18} />
          </span>
          <span>Invite Friend</span>
        </button>
        <button className="quick-action" onClick={onVideoCall} title="Start a video call">
          <span className="qa-icon qa-icon-lavender" aria-hidden="true">
            <Video size={18} />
          </span>
          <span>Video Call</span>
        </button>
        <button className="quick-action" onClick={onFocusQueueInput} title="Search for a song">
          <span className="qa-icon qa-icon-butter" aria-hidden="true">
            <Plus size={18} />
          </span>
          <span>Add Song</span>
        </button>
      </div>

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
    </section>
  );
}
