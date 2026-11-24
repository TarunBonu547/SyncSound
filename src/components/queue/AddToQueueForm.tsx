import { useCallback, useState } from 'react';
import { Play, Plus, Loader2, Link2, Heart, Send, X, Search } from 'lucide-react';
import { extractVideoId } from '../../hooks/useYouTubePlayer';
import { formatDuration } from '../../utils/youtubeSearch';
import type { SearchResult } from '../../utils/youtubeSearch';

/** The longest dedication note a listener may attach to a song. */
const MAX_DEDICATION_LENGTH = 200;

type AddToQueueFormProps = {
  term: string;
  setTerm: (value: string) => void;
  searching: boolean;
  runSearch: (pageToken?: string) => void;
  results: SearchResult[];
  nextPageToken: string | null;
  adding: boolean;
  addQueue: () => void;
  loadVideo: (id: string, dedication?: string) => void;
  onAddToQueue: (track: SearchResult, dedication?: string) => Promise<string | null>;
  onPlayNow: (track: SearchResult, dedication?: string) => Promise<string | null>;
  inRoom: boolean;
  error: string | null;
  notice: string | null;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
};

/**
 * The form that puts a track into the shared queue.
 *
 * The search runs on the backend, which holds the key of the YouTube API, so
 * the browser never sees a key. A pasted link is looked up as well, so the
 * old way of adding a track keeps working. Each track may carry an optional
 * personal dedication that shows up when the song starts playing.
 */
export default function AddToQueueForm({
  term,
  setTerm,
  searching,
  runSearch,
  results,
  nextPageToken,
  adding,
  addQueue,
  loadVideo,
  onAddToQueue,
  onPlayNow,
  inRoom,
  error,
  notice,
  setError,
  setNotice,
}: AddToQueueFormProps) {
  const [busy, setBusy] = useState(false);
  /** Dedication drafts for search results, keyed by video id. */
  const [dedicationDrafts, setDedicationDrafts] = useState<Record<string, string>>({});
  /** Track ids whose dedication editor is currently open. */
  const [editingTrackIds, setEditingTrackIds] = useState<Set<string>>(new Set());
  /** Dedication draft for a pasted YouTube link. */
  const [pastedDedication, setPastedDedication] = useState('');
  /** True when the pasted-link dedication editor is open. */
  const [isPastedDedicationEditing, setIsPastedDedicationEditing] = useState(false);

  /** Sends the track to the room and reports what the server said. */
  const send = useCallback(
    async (
      action: (track: SearchResult, dedication?: string) => Promise<string | null>,
      track: SearchResult,
      label: string,
      dedication?: string,
    ) => {
      setBusy(true);
      setNotice(null);
      setError(null);
      try {
        const message = await action(track, dedication);
        if (message) setError(message);
        else setNotice(`${label}: ${track.title}`);
      } finally {
        setBusy(false);
      }
    },
    [setError, setNotice],
  );

  const pastedId = extractVideoId(term);
  const duration = (track: SearchResult) => formatDuration(track.durationSeconds);

  const dedicationFor = (track: SearchResult) => dedicationDrafts[track.id] || '';
  const setDedicationFor = (track: SearchResult, value: string) => {
    setDedicationDrafts((prev) => ({ ...prev, [track.id]: value }));
  };
  const isEditing = (track: SearchResult) => editingTrackIds.has(track.id);

  const toggleDedicationEditing = (track: SearchResult) => {
    if (isEditing(track)) {
      setEditingTrackIds((prev) => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    } else {
      setEditingTrackIds((prev) => {
        const next = new Set(prev);
        next.add(track.id);
        return next;
      });
    }
  };

  const saveDedicationFor = (track: SearchResult) => {
    setEditingTrackIds((prev) => {
      const next = new Set(prev);
      next.delete(track.id);
      return next;
    });
  };

  const cancelDedicationFor = (track: SearchResult) => {
    setDedicationFor(track, '');
    setEditingTrackIds((prev) => {
      const next = new Set(prev);
      next.delete(track.id);
      return next;
    });
  };

  return (
    <section className="lounge-queue-panel lounge-add-queue" aria-labelledby="add-queue-title">
      <div className="lounge-section-heading">
        <div>
          <p className="lounge-eyebrow">Station Requests</p>
          <h2 className="lounge-section-title" id="add-queue-title">
            Song Queue
          </h2>
        </div>
        <span className="lounge-section-count">Search &amp; Discover</span>
      </div>

      <div className="lounge-search-row">
        <div className="lounge-search-wrap">
          <Search className="lounge-search-icon" size={18} aria-hidden="true" />
          <input
            className="lounge-search-input"
            id="queue-url-input"
            type="search"
            placeholder="Song, artist, title or YouTube link"
            aria-label="Song, artist, title or YouTube link"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              runSearch();
            }}
          />
        </div>

        <div className="lounge-search-actions">
          <button className="lounge-btn lounge-btn--primary lounge-action-search" onClick={() => runSearch()} disabled={searching}>
            {searching ? <Loader2 size={16} className="spin" /> : <Search size={16} aria-hidden="true" />}
            {searching ? 'Searching…' : 'Search'}
          </button>
          <button className="lounge-btn lounge-action-add" onClick={addQueue} disabled={adding || !inRoom}>
            {adding ? 'Adding…' : '+ Add to Queue'}
          </button>
          <button
            className="lounge-btn lounge-action-load"
            onClick={() => {
              if (!pastedId) {
                setError('Search for a track or paste a YouTube link');
                return;
              }
              setError(null);
              loadVideo(pastedId, pastedDedication || undefined);
            }}
            disabled={!pastedId || !inRoom}
            title={inRoom ? 'Play the pasted link for everybody' : 'Join a room first'}
          >
            <Link2 size={16} aria-hidden="true" /> Load
          </button>
        </div>

        {pastedId && (
          <div className="lounge-dedication-input-group">
            <button
              type="button"
              className="lounge-dedication-toggle"
              onClick={() => {
                setIsPastedDedicationEditing((prev) => !prev);
                if (!isPastedDedicationEditing) setPastedDedication('');
              }}
              aria-expanded={isPastedDedicationEditing}
            >
              <Heart size={14} aria-hidden="true" />
              <span>{isPastedDedicationEditing ? 'Cancel note' : 'Add a note'}</span>
            </button>
            {isPastedDedicationEditing && (
              <div className="lounge-dedication-editor">
                <textarea
                  className="lounge-dedication-textarea"
                  value={pastedDedication}
                  onChange={(e) => setPastedDedication(e.target.value)}
                  placeholder="This song reminds me of you…"
                  maxLength={MAX_DEDICATION_LENGTH}
                  rows={2}
                  aria-label="Dedication"
                />
                <span className="lounge-dedication-counter">
                  {pastedDedication.length} / {MAX_DEDICATION_LENGTH}
                </span>
                <div className="lounge-dedication-editor-actions">
                  <button
                    type="button"
                    className="lounge-icon-btn"
                    onClick={() => {
                      setPastedDedication('');
                      setIsPastedDedicationEditing(false);
                    }}
                    aria-label="Cancel note"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="lounge-icon-btn is-primary"
                    onClick={() => setIsPastedDedicationEditing(false)}
                    aria-label="Save note"
                  >
                    <Send size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="lounge-error-text" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="lounge-notice-text" role="status" style={{ marginTop: 8 }}>
          {notice}
        </p>
      )}

      {results.length > 0 && (
        <ul className="lounge-queue-list" style={{ marginTop: 12 }}>
          {results.map((track) => {
            return (
              <li className="lounge-queue-item" key={track.id}>
                <img className="lounge-queue-thumb" src={track.thumbnail} alt="" />
                <div className="lounge-queue-details">
                  <strong>{track.title}</strong>
                  <small>
                    {track.channel}
                    {duration(track) ? ` · ${duration(track)}` : ''}
                  </small>
                </div>
                <div className="lounge-queue-actions">
                  <button
                    type="button"
                    className="lounge-queue-icon-btn lounge-dedication-toggle"
                    onClick={() => toggleDedicationEditing(track)}
                    aria-expanded={isEditing(track)}
                    title={isEditing(track) ? 'Cancel note' : 'Add a note'}
                    aria-label={`Add a note to ${track.title}`}
                  >
                    <Heart size={14} aria-hidden="true" />
                  </button>
                  {isEditing(track) && (
                    <div className="lounge-dedication-editor">
                      <textarea
                        className="lounge-dedication-textarea"
                        value={dedicationFor(track)}
                        onChange={(e) => setDedicationFor(track, e.target.value)}
                        placeholder="This song reminds me of you…"
                        maxLength={MAX_DEDICATION_LENGTH}
                        rows={2}
                        aria-label={`Dedication for ${track.title}`}
                      />
                      <span className="lounge-dedication-counter">
                        {dedicationFor(track).length} / {MAX_DEDICATION_LENGTH}
                      </span>
                      <div className="lounge-dedication-editor-actions">
                        <button
                          type="button"
                          className="lounge-icon-btn"
                          onClick={() => cancelDedicationFor(track)}
                          aria-label="Cancel note"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="lounge-icon-btn is-primary"
                          onClick={() => saveDedicationFor(track)}
                          aria-label="Save note"
                        >
                          <Send size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )}
                  <button
                    className="lounge-queue-icon-btn"
                    onClick={() =>
                      send(onAddToQueue, track, 'Added to the queue', dedicationFor(track) || undefined)
                    }
                    disabled={!inRoom || busy}
                    title={inRoom ? 'Add to queue' : 'Join a room first'}
                    aria-label={`Add ${track.title} to the queue`}
                  >
                    <Plus size={18} />
                  </button>
                  <button
                    className="lounge-queue-icon-btn is-primary"
                    onClick={() =>
                      send(onPlayNow, track, 'Playing now', dedicationFor(track) || undefined)
                    }
                    disabled={!inRoom || busy}
                    title={inRoom ? 'Play now' : 'Join a room first'}
                    aria-label={`Play ${track.title} now`}
                  >
                    <Play size={18} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!searching && results.length === 0 && !error && (
        <div className="lounge-search-empty">
          <p className="lounge-search-empty-title">Nothing searched yet</p>
          <p className="lounge-search-empty-text">
            Search for a song, artist or paste a YouTube link to get started.
          </p>
        </div>
      )}

      {nextPageToken && (
        <button
          className="lounge-btn lounge-load-btn"
          style={{ marginTop: 10 }}
          onClick={() => runSearch(nextPageToken)}
          disabled={searching}
        >
          {searching ? <Loader2 size={16} className="spin" /> : null} Load more
        </button>
      )}
    </section>
  );
}
