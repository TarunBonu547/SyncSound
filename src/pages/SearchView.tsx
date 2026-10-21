import { useMemo, useState, type FormEvent } from 'react';
import { Search, Loader2, Play, Plus, ArrowRight } from 'lucide-react';
import { extractVideoId } from '../hooks/useYouTubePlayer';
import { lookupVideo } from '../utils/youtubeMeta';
import {
  createSearchRequest,
  formatDuration,
  lookupYouTubeVideo,
  searchYouTube,
  type SearchResult,
} from '../utils/youtubeSearch';

type Props = {
  /** The queue actions need a room, so the search asks for one. */
  inRoom: boolean;
  /** Adds the track to the queue of the room. Resolves with a reason on error. */
  onAddToQueue: (track: SearchResult) => Promise<string | null>;
  /** Adds the track and starts it. Resolves with a reason on error. */
  onPlayNow: (track: SearchResult) => Promise<string | null>;
  /** Leads back to the lobby, where a room is created or joined. */
  onGoHome: () => void;
};

type Mode = 'none' | 'search' | 'lookup';

/** The message for a failure, in the words of the person who reads it. */
function messageFor(error: unknown): { code: string; text: string } {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as any).code) : 'unknown';
  const text = error instanceof Error && error.message ? error.message : 'The search could not be completed.';
  if (code === 'api_unavailable') {
    return {
      code,
      text: 'The YouTube search is not configured on this server. Add YOUTUBE_API_KEY to the environment of the backend and start it again.',
    };
  }
  if (code === 'api_disabled') {
    return { code, text: 'The YouTube Data API is not enabled for the project of this server yet.' };
  }
  if (code === 'invalid_api_key') {
    return { code, text: 'The YouTube API key of this server is not valid.' };
  }
  if (code === 'quota') {
    return { code, text: 'The YouTube search quota is used up. Please try again later.' };
  }
  return { code, text };
}

/**
 * The search of the lobby.
 *
 * A song name, an artist or a video title is looked up on YouTube. A pasted
 * link is looked up as well, so the old way of adding a track still works.
 */
export default function SearchView({ inRoom, onAddToQueue, onPlayNow, onGoHome }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('none');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useMemo(() => createSearchRequest(), []);

  /** Sends the track to the room and reports what the server said. */
  const send = async (action: (track: SearchResult) => Promise<string | null>, track: SearchResult, label: string) => {
    setBusy(true);
    setNotice(null);
    setError(null);
    setErrorCode(null);
    try {
      const message = await action(track);
      if (message) {
        setError(message);
        setErrorCode('action');
      } else {
        setNotice(`${label}: ${track.title}`);
      }
    } finally {
      setBusy(false);
    }
  };

  /** The search of a term, or the lookup of a pasted link. */
  const run = async (event: FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    if (!term) {
      setError('Type a song, an artist or a title.');
      setErrorCode('invalid_query');
      setResults([]);
      setMode('none');
      return;
    }
    const videoId = extractVideoId(term);
    setLoading(true);
    setError(null);
    setErrorCode(null);
    setNotice(null);

    const answer = await request.run(async (signal) => {
      if (!videoId) return { kind: 'search' as const, ...(await searchYouTube(term, { signal })) };
      try {
        const track = await lookupYouTubeVideo(videoId, { signal });
        return { kind: 'lookup' as const, results: [track], nextPageToken: null };
      } catch (err) {
        // Without an API key the server can not look a link up. The public
        // lookup still works, so a pasted link is not lost.
        if (typeof err === 'object' && err !== null && (err as any).code === 'api_unavailable') {
          const track = await lookupVideo(videoId);
          return { kind: 'lookup' as const, results: [track], nextPageToken: null };
        }
        throw err;
      }
    });

    if (answer.stale) return; // a newer search took over
    setLoading(false);
    if (answer.error) {
      const { code, text } = messageFor(answer.error);
      setError(text);
      setErrorCode(code);
      setResults([]);
      setMode('none');
      setNextPageToken(null);
      return;
    }
    const value = answer.value!;
    setMode(value.kind);
    setResults(value.results);
    setNextPageToken(value.nextPageToken);
    if (value.results.length === 0) {
      setError('Nothing was found for that search.');
      setErrorCode('no_results');
    }
  };

  /** The next page of the same search. */
  const loadMore = async () => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    setErrorCode(null);
    const answer = await request.run((signal) => searchYouTube(query.trim(), { pageToken: nextPageToken, signal }));
    if (answer.stale) {
      setLoadingMore(false);
      return;
    }
    setLoadingMore(false);
    if (answer.error) {
      const { code, text } = messageFor(answer.error);
      setError(text);
      setErrorCode(code);
      return;
    }
    const value = answer.value!;
    setResults((prev) => {
      const known = new Set(prev.map((r) => r.id));
      return [...prev, ...value.results.filter((r) => !known.has(r.id))];
    });
    setNextPageToken(value.nextPageToken);
  };

  const duration = (track: SearchResult) => formatDuration(track.durationSeconds);

  return (
    <div className="card search-card fade-in-up">
      <p className="eyebrow">Search</p>
      <h2 className="section-title">Find a track</h2>
      <p className="card-sub">
        Search YouTube by song, artist or title. A pasted link is looked up as well.
      </p>

      <form className="search-form" onSubmit={run}>
        <span className="search-icon" aria-hidden="true">
          <Search size={16} />
        </span>
        <input
          className="input"
          id="search-input"
          type="search"
          placeholder="Song, artist or title"
          aria-label="Song, artist or video title"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (errorCode === 'invalid_query') {
              setError(null);
              setErrorCode(null);
            }
          }}
        />
        <button className="btn primary" type="submit" disabled={loading}>
          {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />} Search
        </button>
      </form>

      {loading && (
        <p className="search-state" role="status">
          <Loader2 size={15} className="spin" /> Searching YouTube…
        </p>
      )}

      {error && (
        <p className="error-text" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}

      {notice && (
        <p className="search-state" role="status">
          {notice}
        </p>
      )}

      {!loading && !error && mode === 'none' && (
        <p className="hint search-state">Nothing searched yet. A title is all it takes.</p>
      )}

      {mode === 'lookup' && results[0] && (
        <div className="search-result">
          <img className="search-thumb" src={results[0].thumbnail} alt="" />
          <div className="search-result-text">
            <p className="queue-title">{results[0].title}</p>
            <p className="queue-channel">
              {results[0].channel}
              {duration(results[0]) ? ` · ${duration(results[0])}` : ''}
            </p>
          </div>
          <div className="queue-actions">
            <button
              className="btn sm"
              onClick={() => send(onAddToQueue, results[0], 'Added to the queue')}
              disabled={!inRoom || busy}
              title={inRoom ? 'Add to the shared queue' : 'Join a room first'}
              aria-label={`Add ${results[0].title} to the queue`}
            >
              <Plus size={15} /> Queue
            </button>
            <button
              className="btn primary sm"
              onClick={() => send(onPlayNow, results[0], 'Playing now')}
              disabled={!inRoom || busy}
              title={inRoom ? 'Play for everybody now' : 'Join a room first'}
              aria-label={`Play ${results[0].title} now`}
            >
              <Play size={15} /> Play
            </button>
          </div>
        </div>
      )}

      {mode === 'search' && results.length > 0 && (
        <>
          <ul className="queue-list search-list">
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
                    className="btn icon sm"
                    onClick={() => send(onAddToQueue, track, 'Added to the queue')}
                    disabled={!inRoom || busy}
                    title={inRoom ? 'Add to the shared queue' : 'Join a room first'}
                    aria-label={`Add ${track.title} to the queue`}
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    className="btn icon sm primary"
                    onClick={() => send(onPlayNow, track, 'Playing now')}
                    disabled={!inRoom || busy}
                    title={inRoom ? 'Play for everybody now' : 'Join a room first'}
                    aria-label={`Play ${track.title} now`}
                  >
                    <Play size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {nextPageToken && (
            <button className="btn soft" onClick={loadMore} disabled={loadingMore} style={{ marginTop: 12 }}>
              {loadingMore ? <Loader2 size={14} className="spin" /> : null}
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}

      {!inRoom && (
        <p className="hint search-room-hint">
          A room is needed to add a track to a queue.
          <button className="link-button" onClick={onGoHome}>
            Create or join a room <ArrowRight size={13} />
          </button>
        </p>
      )}
    </div>
  );
}
