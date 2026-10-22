import { useCallback, useState } from 'react';
import { Play, Plus, Search, Loader2, Link2 } from 'lucide-react';
import { extractVideoId } from '../../hooks/useYouTubePlayer';
import { formatDuration } from '../../utils/youtubeSearch';
import type { SearchResult } from '../../utils/youtubeSearch';

type AddToQueueFormProps = {
  term: string;
  setTerm: (value: string) => void;
  searching: boolean;
  runSearch: (pageToken?: string) => void;
  results: SearchResult[];
  nextPageToken: string | null;
  adding: boolean;
  addQueue: () => void;
  loadVideo: (id: string) => void;
  onAddToQueue: (track: SearchResult) => Promise<string | null>;
  onPlayNow: (track: SearchResult) => Promise<string | null>;
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
 * old way of adding a track keeps working.
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

  /** Sends the track to the room and reports what the server said. */
  const send = useCallback(
    async (
      action: (track: SearchResult) => Promise<string | null>,
      track: SearchResult,
      label: string,
    ) => {
      setBusy(true);
      setNotice(null);
      setError(null);
      try {
        const message = await action(track);
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
          <Search size={15} />
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
          {searching ? <Loader2 size={15} className="spin" /> : null}
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
            loadVideo(pastedId);
          }}
          disabled={!pastedId || !inRoom}
          title={inRoom ? 'Play the pasted link for everybody' : 'Join a room first'}
        >
          <Link2 size={15} aria-hidden="true" /> Load
        </button>
        <button className="btn primary" onClick={addQueue} disabled={adding || !inRoom}>
          {adding ? 'Adding…' : 'Add to Queue'}
        </button>
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
          {results.map((track) => (
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
                  className="music-icon-btn"
                  onClick={() => send(onAddToQueue, track, 'Added to the queue')}
                  disabled={!inRoom || busy}
                  title={inRoom ? 'Add to queue' : 'Join a room first'}
                  aria-label={`Add ${track.title} to the queue`}
                >
                  <Plus size={20} />
                </button>
                <button
                  className="music-icon-btn primary"
                  onClick={() => send(onPlayNow, track, 'Playing now')}
                  disabled={!inRoom || busy}
                  title={inRoom ? 'Play now' : 'Join a room first'}
                  aria-label={`Play ${track.title} now`}
                >
                  <Play size={20} />
                </button>
              </div>
            </li>
          ))}
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
          {searching ? <Loader2 size={14} className="spin" /> : null} Load more
        </button>
      )}
    </section>
  );
}
