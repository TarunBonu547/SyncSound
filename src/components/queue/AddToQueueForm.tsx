import { useCallback, useState } from 'react';
import { Play, Plus, Search, Loader2, Link2, Heart } from 'lucide-react';
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
  /** Dedication draft for a pasted YouTube link. */
  const [pastedDedication, setPastedDedication] = useState('');

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

  return (
    <section className="panel add-queue" aria-labelledby="add-queue-title">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Shared queue</p>
          <h2 className="section-title" id="add-queue-title">
            Add to Queue
          </h2>
        </div>
        <p className="hint">Search by song, artist or title, or paste a YouTube link</p>
      </div>

      <div className="queue-form">
        <span className="search-icon" aria-hidden="true">
          <Search size={16} />
        </span>
        <input
          className="input"
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
        <button className="btn" onClick={() => runSearch()} disabled={searching}>
          {searching ? <Loader2 size={16} className="spin" /> : null}
          {searching ? 'Searching…' : 'Search'}
        </button>
        <button
          className="btn"
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
        <button className="btn primary" onClick={addQueue} disabled={adding || !inRoom}>
          {adding ? 'Adding…' : 'Add to Queue'}
        </button>

        {pastedId && (
          <div className="dedication-input-group">
            <button
              type="button"
              className="dedication-toggle"
              onClick={() => setPastedDedication((d) => (d ? '' : ''))}
              aria-expanded={Boolean(pastedDedication)}
            >
              <Heart size={14} aria-hidden="true" />
              <span>{pastedDedication ? 'Edit note' : 'Add a note ❤️'}</span>
            </button>
            {pastedDedication && (
              <div className="dedication-editor">
                <textarea
                  className="input dedication-textarea"
                  value={pastedDedication}
                  onChange={(e) => setPastedDedication(e.target.value)}
                  placeholder="This song reminds me of you…"
                  maxLength={MAX_DEDICATION_LENGTH}
                  rows={2}
                  aria-label="Dedication"
                />
                <span className="dedication-counter">
                  {pastedDedication.length} / {MAX_DEDICATION_LENGTH}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="error-text" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="hint notice-text" role="status" style={{ marginTop: 8 }}>
          {notice}
        </p>
      )}

      {results.length > 0 && (
        <ul className="queue-list" style={{ marginTop: 12 }}>
          {results.map((track) => {
            const hasDraft = Boolean(dedicationDrafts[track.id]);
            return (
              <li className="queue-row" key={track.id}>
                <img className="queue-thumb" src={track.thumbnail} alt="" />
                <div className="queue-text">
                  <p className="queue-title">{track.title}</p>
                  <p className="queue-channel">
                    {track.channel}
                    {duration(track) ? ` · ${duration(track)}` : ''}
                  </p>
                </div>
                <div className="queue-actions">
                  <button
                    type="button"
                    className="dedication-toggle"
                    onClick={() =>
                      setDedicationFor(track, hasDraft ? '' : dedicationDrafts[track.id] || '')
                    }
                    aria-expanded={hasDraft}
                    title={hasDraft ? 'Remove note' : 'Add a note'}
                    aria-label={`Add a note to ${track.title}`}
                  >
                    <Heart size={14} aria-hidden="true" />
                    <span>{hasDraft ? 'Note added' : 'Add a note ❤️'}</span>
                  </button>
                  {hasDraft && (
                    <div className="dedication-editor">
                      <textarea
                        className="input dedication-textarea"
                        value={dedicationFor(track)}
                        onChange={(e) => setDedicationFor(track, e.target.value)}
                        placeholder="This song reminds me of you…"
                        maxLength={MAX_DEDICATION_LENGTH}
                        rows={2}
                        aria-label={`Dedication for ${track.title}`}
                      />
                      <span className="dedication-counter">
                        {dedicationFor(track).length} / {MAX_DEDICATION_LENGTH}
                      </span>
                    </div>
                  )}
                  <button
                    className="music-icon-btn"
                    onClick={() =>
                      send(onAddToQueue, track, 'Added to the queue', dedicationFor(track) || undefined)
                    }
                    disabled={!inRoom || busy}
                    title={inRoom ? 'Add to queue' : 'Join a room first'}
                    aria-label={`Add ${track.title} to the queue`}
                  >
                    <Plus size={20} />
                  </button>
                  <button
                    className="music-icon-btn primary"
                    onClick={() =>
                      send(onPlayNow, track, 'Playing now', dedicationFor(track) || undefined)
                    }
                    disabled={!inRoom || busy}
                    title={inRoom ? 'Play now' : 'Join a room first'}
                    aria-label={`Play ${track.title} now`}
                  >
                    <Play size={20} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!searching && results.length === 0 && !error && (
        <p className="hint" style={{ marginTop: 10 }}>
          {inRoom
            ? 'Nothing searched yet. A title is all it takes.'
            : 'A room is needed to add a track to a queue. Join one and come back.'}
        </p>
      )}

      {nextPageToken && (
        <button
          className="btn soft"
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
