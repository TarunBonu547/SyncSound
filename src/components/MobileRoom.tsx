import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ChevronLeft, MoreHorizontal, Search, Loader2, Play, Plus, SkipBack, SkipForward, RotateCcw, RotateCw } from 'lucide-react';
import { useYouTubePlayer, extractVideoId, YT_STATE } from '../hooks/useYouTubePlayer';
import { useSocket } from '../hooks/useSocket';
import { useRoom } from '../hooks/useRoom';
import { readClientId } from '../utils/clientId';
import { createSearchRequest, searchYouTube, type SearchResult } from '../utils/youtubeSearch';
import { fetchVideoMeta } from '../utils/youtubeMeta';
import { syncDebug } from '../utils/syncDebug';

type MobileRoomProps = {
  displayName: string;
  onLeaveRoom: () => void;
  onBackToHome: () => void;
};

const DRIFT_THRESHOLD = 1.2;

function messageFor(error: unknown): { code: string; text: string } {
  const _code = typeof error === 'object' && error !== null && 'code' in error ? String((error as any).code) : 'unknown';
  const text = error instanceof Error && error.message ? error.message : 'The search could not be completed.';
  if (_code === 'api_unavailable') {
    return { code: _code, text: 'The YouTube search is not configured on this server. Add YOUTUBE_API_KEY to the environment of the backend and start it again.' };
  }
  if (_code === 'api_disabled') {
    return { code: _code, text: 'The YouTube Data API is not enabled for the project of this server yet.' };
  }
  if (_code === 'invalid_api_key') {
    return { code: _code, text: 'The YouTube API key of this server is not valid.' };
  }
  if (_code === 'quota') {
    return { code: _code, text: 'The YouTube search quota is used up. Please try again later.' };
  }
  return { code: _code, text };
}

export default function MobileRoom({ displayName, onLeaveRoom, onBackToHome }: MobileRoomProps) {
  const { socket, connected } = useSocket();
  const [clientId] = useState(() => readClientId());
  const stageVideoRef = useRef<HTMLDivElement | null>(null);
  const yt = useYouTubePlayer(stageVideoRef);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const room = useRoom({
    socket,
    clientId,
    displayName,
    onPlayback: (p) => applyRemoteRef.current(p),
    onError: (message) => pushToast(message, 'error'),
    onRemoteMessage: () => {},
  });

  const [current, setCurrent] = useState<{ id: string; title: string; channel: string; thumbnail: string; durationSeconds?: number | null } | null>(null);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [roomPb, setRoomPb] = useState<any>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [resultsVisible, setResultsVisible] = useState(false);
  const searchRequest = useMemo(() => createSearchRequest(), []);

  const [activePanel, setActivePanel] = useState<'search' | 'player' | 'queue'>('player');

  const [toasts, setToasts] = useState<{ id: string; text: string; tone: string }[]>([]);

  const currentVideoId = useRef<string | null>(null);
  const lastRevision = useRef(0);
  const generation = useRef(0);
  const endedReportedFor = useRef<string | null>(null);
  const clockOffset = useRef<number | null>(null);
  const seekEmitTimer = useRef<number | null>(null);
  const ytRef = useRef(yt);
  const roomPbRef = useRef<any>(null);
  const applyRemoteRef = useRef<(p: any) => void>(() => {});

  useEffect(() => {
    ytRef.current = yt;
    roomPbRef.current = roomPb;
    applyRemoteRef.current = applyRemote;
  }, [yt, roomPb]);

  const pushToast = useCallback((text: string, tone: string = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev.slice(-3), { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const expectedPosition = (p: any) => {
    const base = typeof p.position === 'number' ? p.position : 0;
    if (!p.playing) return base;
    const now = Date.now() + (clockOffset.current ?? 0);
    const updatedAt = p.updatedAt || now;
    return base + Math.max(0, (now - updatedAt) / 1000);
  };

  const sampleClock = (serverNow?: number) => {
    if (!serverNow) return;
    const offset = serverNow - Date.now();
    if (clockOffset.current === null || offset < clockOffset.current) clockOffset.current = offset;
  };

  const applyRemote = (p: any) => {
    if (typeof p.revision === 'number') {
      if (p.revision <= lastRevision.current) {
        syncDebug('apply remote: stale revision ignored', { revision: p.revision, last: lastRevision.current });
        return;
      }
      lastRevision.current = p.revision;
    }
    sampleClock(p.serverNow);
    generation.current += 1;
    setRoomPb(p);
    if (p.currentQueueItemId) setCurrentItemId(p.currentQueueItemId);

    const expected = expectedPosition(p);
    const videoId = p.videoId || null;

    if (!videoId) {
      yt.pause();
      syncDebug('apply remote: room has no track', { revision: p.revision });
      return;
    }

    if (videoId !== currentVideoId.current) {
      currentVideoId.current = videoId;
      endedReportedFor.current = null;
      const gen = generation.current;
      const known = room.queueRef.current.find((q) => q.id === p.currentQueueItemId);
      const track = known
        ? {
            id: videoId,
            title: known.title,
            channel: known.channel,
            thumbnail: known.thumbnail,
            ...(known.dedication && { dedication: known.dedication }),
          }
        : { id: videoId, title: 'Loading…', channel: '', thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
      setCurrent(track);
      yt.load(videoId, expected, p.playing);
      fetchMeta(videoId, gen);
      syncDebug('apply remote: track change', {
        videoId,
        position: Number(expected.toFixed(2)),
        playing: p.playing,
        revision: p.revision,
      });
      return;
    }

    if (p.status === 'ended') {
      yt.syncTo(null, false);
      syncDebug('apply remote: room finished', { videoId, revision: p.revision });
      return;
    }

    const local = yt.getCurrentTime();
    const drift = Math.abs(local - expected);
    if (drift > DRIFT_THRESHOLD) {
      yt.syncTo(expected, p.playing);
      syncDebug('apply remote: seek to position', {
        videoId,
        local: Number(local.toFixed(2)),
        expected: Number(expected.toFixed(2)),
      });
    } else {
      yt.syncTo(null, p.playing);
    }
  };

  const fetchMeta = async (id: string, gen: number) => {
    try {
      const r = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`);
      const d = await r.json();
      if (gen !== generation.current) return;
      const title = typeof d?.title === 'string' ? d.title.trim() : '';
      if (!title) return;
      const track = {
        id,
        title,
        channel: d.author_name || '',
        thumbnail: d.thumbnail_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      };
      setCurrent((prev) => (prev && prev.id === id ? prev : track));
    } catch {
      if (gen !== generation.current) return;
      setCurrent((prev) =>
        prev && prev.id === id
          ? prev
          : { id, title: id, channel: 'Unknown channel', thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` },
      );
    }
  };

  useEffect(() => {
    let stalled = 0;
    const iv = setInterval(() => {
      const player = ytRef.current;
      const pb = roomPbRef.current;
      if (!pb || !pb.playing) {
        stalled = 0;
        return;
      }
      if (player.hasPendingTarget()) return;
      const state = player.getState();
      if (state === 1) {
        stalled = 0;
        const expected = expectedPosition(pb);
        const local = player.getCurrentTime();
        if (Math.abs(local - expected) > DRIFT_THRESHOLD) {
          player.seek(expected);
          syncDebug('drift correction', {
            local: Number(local.toFixed(2)),
            expected: Number(expected.toFixed(2)),
          });
        }
        return;
      }
      if (state === 2 || state === 5) {
        stalled += 1;
        if (stalled >= 2) {
          stalled = 0;
          player.play();
          syncDebug('restart stalled player', { playerState: state });
        }
        return;
      }
      stalled = 0;
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (yt.state !== 5) return;
    const player = ytRef.current;
    const pb = roomPbRef.current;
    if (!pb || !pb.videoId) return;
    const expected = expectedPosition(pb);
    const local = player.getCurrentTime();
    if (Math.abs(local - expected) <= DRIFT_THRESHOLD) return;
    player.syncTo(expected, pb.playing);
    syncDebug('apply room position on cue', {
      local: Number(local.toFixed(2)),
      expected: Number(expected.toFixed(2)),
    });
  }, [yt.state]);

  useEffect(() => {
    if (yt.state !== 0) return;
    const pb = roomPbRef.current;
    if (!pb?.playing) return;
    const transitionId = pb.transitionId;
    if (!transitionId) return;
    if (endedReportedFor.current === transitionId) return;
    const endedId = yt.endedVideoId;
    if (!endedId) return;
    if (pb.videoId && endedId !== pb.videoId) return;
    endedReportedFor.current = transitionId;
    if (!socket || !room.roomCode) return;
    syncDebug('track ended', { videoId: endedId, transitionId });
    socket.emit(
      'TRACK_ENDED',
      {
        code: room.roomCode,
        videoId: endedId,
        transitionId,
        position: ytRef.current.getCurrentTime(),
      },
      (res: any) => {
        if (!res?.ok) syncDebug('track ended rejected', { error: res?.error });
      },
    );
  }, [yt.state, yt.endedVideoId, socket, room.roomCode]);

  const sendCommand = (patch: { playing?: boolean; position?: number }) => {
    if (!socket || !room.roomCode) return;
    const player = ytRef.current;
    const pb = roomPbRef.current;
    const videoId = pb?.videoId || currentVideoId.current || current?.id || null;
    const local = player.getCurrentTime();
    const position = patch.position ?? (player.getState() >= 0 ? local : pb ? expectedPosition(pb) : local);
    const playing = patch.playing ?? (pb ? pb.playing : player.getState() === 1);
    generation.current += 1;
    syncDebug('send command', { videoId, playing, position: Number(position.toFixed(2)) });
    socket.emit(
      'PLAYBACK_UPDATE',
      {
        code: room.roomCode,
        videoId,
        playing,
        position: Math.max(0, position),
        clientRevision: lastRevision.current,
      },
      (res: any) => {
        if (!res?.ok) {
          syncDebug('command rejected', { error: res?.error });
          pushToast(res?.error || 'Playback command failed', 'error');
          return;
        }
        if (typeof res.revision === 'number') {
          lastRevision.current = Math.max(lastRevision.current, res.revision);
          setRoomPb((prev: any) =>
            prev
              ? {
                  ...prev,
                  revision: res.revision,
                  playing,
                  position,
                  updatedAt: Date.now() + (clockOffset.current ?? 0),
                  videoId: videoId ?? prev.videoId,
                }
              : prev,
          );
        }
      },
    );
  };

  const runSearch = async (pageToken?: string) => {
    const term = query.trim();
    if (!term) {
      setSearchError('Type a song, an artist or a title');
      return;
    }
    const videoId = extractVideoId(term);
    setLoading(true);
    setSearchError(null);
    setSearchNotice(null);
    const answer = await searchRequest.run(async (signal: AbortSignal) => {
      if (!videoId) return searchYouTube(term, { pageToken, signal });
      try {
        const track = await searchYouTube(term, { signal });
        return { results: track.results, nextPageToken: track.nextPageToken };
      } catch (err) {
        if (typeof err === 'object' && err !== null && (err as any).code === 'api_unavailable') {
          const meta = await fetchVideoMeta(videoId);
          return {
            results: [
              {
                id: videoId,
                title: meta.title,
                channel: meta.channel,
                thumbnail: meta.thumbnail,
                durationSeconds: meta.duration || null,
              },
            ],
            nextPageToken: null,
          };
        }
        throw err;
      }
    });
    if (answer.stale) {
      setLoading(false);
      return;
    }
    setLoading(false);
    if (answer.error) {
      const { text } = messageFor(answer.error);
      setSearchError(text);
      return;
    }
    const value = answer.value!;
    if (pageToken) {
      setResults((prev) => {
        const known = new Set(prev.map((r) => r.id));
        return [...prev, ...value.results.filter((r) => !known.has(r.id))];
      });
    } else {
      setResults(value.results);
      setResultsVisible(true);
    }
    setNextPageToken(value.nextPageToken);
    if (value.results.length === 0) setSearchError('Nothing was found for that search.');
  };

  const send = async (action: (track: SearchResult) => Promise<string | null>, track: SearchResult, label: string) => {
    setSearchNotice(null);
    setSearchError(null);
    try {
      const message = await action(track);
      if (message) {
        setSearchError(message);
      } else {
        setSearchNotice(`${label}: ${track.title}`);
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const onAddToQueue = useCallback(
    (track: SearchResult) => room.addTrackToQueue(track),
    [room]
  );

  const togglePlayback = () => {
    const player = ytRef.current;
    const pb = roomPbRef.current;
    const playing = pb ? pb.playing : player.getState() === 1;
    if (playing) {
      player.pause();
      sendCommand({ playing: false });
    } else {
      player.play();
      sendCommand({ playing: true });
    }
  };

  const requestPlay = () => {
    const player = ytRef.current;
    const pb = roomPbRef.current;
    const expected = pb ? expectedPosition(pb) : player.getCurrentTime();
    player.syncTo(expected, true);
    player.play();
  };

  const handleSeek = (value: number) => {
    yt.seek(value);
    if (seekEmitTimer.current) window.clearTimeout(seekEmitTimer.current);
    seekEmitTimer.current = window.setTimeout(() => {
      seekEmitTimer.current = null;
      const pb = roomPbRef.current;
      const playing = pb ? pb.playing : ytRef.current.getState() === 1;
      sendCommand({ position: value, playing });
    }, 150);
  };

  const playPrevious = () => {
    const activeQueueItemId = roomPb?.currentQueueItemId || currentItemId;
    const queueIndex = room.queue.findIndex((item) => item.id === activeQueueItemId);
    if (queueIndex > 0) {
      const previous = room.queue[queueIndex - 1];
      if (previous) room.playQueueItem(previous.id);
    }
  };

  const playNext = () => {
    const activeQueueItemId = roomPb?.currentQueueItemId || currentItemId;
    const queueIndex = room.queue.findIndex((item) => item.id === activeQueueItemId);
    if (queueIndex !== -1 && queueIndex < room.queue.length - 1) {
      const next = room.queue[queueIndex + 1];
      if (next) room.playQueueItem(next.id);
    }
  };

  const rewind5 = () => {
    const t = Math.max(0, yt.getCurrentTime() - 5);
    handleSeek(t);
  };

  const forward5 = () => {
    const dur = yt.duration;
    const cur = yt.getCurrentTime();
    const t = dur ? Math.min(dur, cur + 5) : cur + 5;
    handleSeek(t);
  };

  const activeQueueItemId = roomPb?.currentQueueItemId || currentItemId;
  const queueIndex = room.queue.findIndex((item) => item.id === activeQueueItemId);
  const hasPrevious = queueIndex > 0;
  const hasNext = queueIndex !== -1 && queueIndex < room.queue.length - 1;

  const roomPlaying = roomPb ? roomPb.playing : yt.state === 1;
  const playerReady = yt.ready;
  const hasTrack = !!current;
  const needsGesture = hasTrack && roomPlaying && playerReady && (yt.state === YT_STATE.cued || yt.state === YT_STATE.paused);
  const loadingPlayer = hasTrack && !playerReady && !yt.error;
  const failed = hasTrack && !!yt.error;

  const statusText = (() => {
    if (!hasTrack) return 'Ready';
    if (yt.state === YT_STATE.ended) return 'Ended';
    if (roomPlaying) return 'Playing';
    return 'Paused';
  })();

  const scrollToPanel = (panel: 'search' | 'player' | 'queue') => {
    setActivePanel(panel);
    const element = document.getElementById(`${panel}Panel`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch();
  };

  const loadMore = async () => {
    if (!nextPageToken) return;
    await runSearch(nextPageToken);
  };

  return (
    <main className="mr-app" role="main">
      {/* Header */}
      <header className="mr-header">
        <button className="mr-header-btn" onClick={onBackToHome} aria-label="Back to home">
          <ChevronLeft size={24} />
        </button>
        <div className="mr-brand">Sync<span>Sound</span></div>
        <button className="mr-header-btn" onClick={onLeaveRoom} aria-label="Room options">
          <MoreHorizontal size={24} />
        </button>
      </header>

      {/* Room bar */}
      <div className="mr-room-bar">
        <div className="mr-room-code">ROOM {room.roomCode || '—'}</div>
        <div className="mr-status">
          <span className="mr-dot" style={{ background: connected ? '#91C7A7' : '#E66B91' }} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      <h1 className="mr-title">Our listening room</h1>
      <p className="mr-subtitle">Listening with {displayName || 'a friend'}</p>

      {/* Search */}
      <form id="searchForm" className="mr-search-form" onSubmit={handleSearchSubmit}>
        <div className="mr-search-box">
          <input
            ref={searchInputRef}
            id="searchInput"
            type="search"
            placeholder="Search YouTube songs, artists..."
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (searchError) setSearchError(null);
            }}
          />
          <button type="submit" className="mr-search-btn" disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
            <span>Search</span>
          </button>
        </div>
      </form>

      <p className="mr-hint">Search YouTube and tap + to add a song to your queue.</p>

      {/* Search Results */}
      <section id="resultsPanel" className={`mr-panel ${resultsVisible ? 'show' : ''}`}>
        <div className="mr-panel-heading">
          <h2>Search results</h2>
          <span>{results.length} {results.length === 1 ? 'video' : 'videos'}</span>
        </div>
        <div id="resultList">
          {loading && <div className="mr-empty">Searching YouTube…</div>}
          {searchError && <div className="mr-empty" role="alert">{searchError}</div>}
          {searchNotice && <div className="mr-empty" role="status">{searchNotice}</div>}
          {!loading && !searchError && results.length === 0 && !resultsVisible && (
            <div className="mr-empty">No search yet. Enter a song or artist name.</div>
          )}
          {results.map((video) => (
            <div key={video.id} className="mr-result">
              <img src={video.thumbnail} alt="" />
              <div className="mr-result-info">
                <strong>{video.title}</strong>
                <span>{video.channel}</span>
              </div>
              <button className="mr-add-btn" onClick={() => send(onAddToQueue, video, 'Added to queue')} aria-label="Add to queue">
                <Plus size={20} />
              </button>
            </div>
          ))}
          {nextPageToken && !loading && !searchError && (
            <button className="mr-load-more" onClick={loadMore} disabled={loading}>
              {loading ? <Loader2 size={16} className="spin" /> : 'Load more'}
            </button>
          )}
        </div>
      </section>

      {/* Player */}
      <section id="playerPanel" className="mr-panel">
        <div className="mr-panel-heading">
          <h2>Now playing</h2>
          <span id="playerState">{statusText}</span>
        </div>

        <div className="mr-player-frame">
          <div ref={stageVideoRef} className="mr-yt-player" title="SyncSound player" />

          {/* Placeholder */}
          {!hasTrack && (
            <div id="playerPlaceholder" className="mr-player-placeholder">
              <div className="mr-youtube-icon">
                <Play size={24} />
              </div>
              <strong>Your song will appear here</strong>
              <span>Search YouTube and add a song to start listening.</span>
            </div>
          )}

          {loadingPlayer && (
            <div className="mr-stage-overlay" role="status">
              <Loader2 size={20} className="spin" aria-hidden="true" />
              <span>Loading the video…</span>
            </div>
          )}

          {failed && (
            <div className="mr-stage-overlay is-error" role="alert">
              <span>{yt.error}</span>
            </div>
          )}

          {needsGesture && !failed && (
            <div className="mr-stage-overlay" role="status">
              <button className="mr-btn mr-btn-primary" onClick={requestPlay}>
                <Play size={16} aria-hidden="true" /> Play the video
              </button>
              <span className="mr-stage-overlay-hint">
                The browser blocked the automatic start. One click and the room is on the same track again.
              </span>
            </div>
          )}
        </div>

        <div className="mr-now-playing">
          <div className="mr-now-playing-info">
            <strong id="currentTitle">{hasTrack ? current.title : 'No song selected'}</strong>
            <span id="currentArtist">{hasTrack ? current.channel : 'Search for a song to begin'}</span>
          </div>
        </div>

        <div className="mr-playback-controls">
          <button className="mr-control" id="previousBtn" onClick={playPrevious} disabled={!hasPrevious} aria-label="Previous song">
            <SkipBack size={19} />
          </button>
          <button className="mr-control" id="rewindBtn" onClick={rewind5} disabled={!hasTrack} aria-label="Rewind 5 seconds">
            <RotateCcw size={19} />
          </button>
          <button className="mr-control mr-control-main" id="playBtn" onClick={togglePlayback} disabled={!hasTrack} aria-label={roomPlaying ? 'Pause' : 'Play'}>
            {roomPlaying ? <span style={{ display: 'flex', gap: '3px' }}><span style={{ width: '4px', height: '16px', background: 'currentColor', borderRadius: '1px' }} /><span style={{ width: '4px', height: '16px', background: 'currentColor', borderRadius: '1px' }} /></span> : <Play size={23} />}
          </button>
          <button className="mr-control" id="forwardBtn" onClick={forward5} disabled={!hasTrack} aria-label="Forward 5 seconds">
            <RotateCw size={19} />
          </button>
          <button className="mr-control" id="nextBtn" onClick={playNext} disabled={!hasNext} aria-label="Next song">
            <SkipForward size={19} />
          </button>
        </div>

        <div className="mr-playback-status" id="playbackStatus">
          {hasTrack ? (roomPlaying ? 'Song is playing.' : 'Playback paused.') : 'Choose a song to begin.'}
        </div>
      </section>

      {/* Queue */}
      <section id="queuePanel" className="mr-panel">
        <div className="mr-panel-heading">
          <h2>Our queue</h2>
          <span id="queueCount">{room.queue.length} {room.queue.length === 1 ? 'song' : 'songs'}</span>
        </div>
        <div id="queueList">
          {room.queue.length === 0 && (
            <div className="mr-empty">
              Your queue is empty.<br />
              Search YouTube and add your first song.
            </div>
          )}
          {room.queue.map((song, index) => (
            <div key={song.id} className={`mr-queue-item ${index === queueIndex ? 'current' : ''}`}>
              <div className="mr-queue-number">{index + 1}</div>
              <img src={song.thumbnail} alt="" />
              <div className="mr-queue-info">
                <strong>{song.title}</strong>
                <span>{song.channel}</span>
              </div>
              <div className="mr-queue-actions">
                <button className="mr-queue-action" onClick={() => room.playQueueItem(song.id)} aria-label="Play song">
                  <Play size={17} />
                </button>
                <button className="mr-queue-action" onClick={() => room.removeQueueItem(song.id)} aria-label="Remove song">
                  <span style={{ fontSize: '20px', lineHeight: 1 }}>×</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom Navigation */}
      <nav className="mr-bottom-nav" aria-label="Mobile navigation">
        <button
          className={`mr-nav-btn ${activePanel === 'search' ? 'active' : ''}`}
          onClick={() => scrollToPanel('search')}
          data-target="searchForm"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="11" cy="11" r="7" />
            <path d="m16 16 4 4" />
          </svg>
          Search
        </button>
        <button
          className={`mr-nav-btn ${activePanel === 'player' ? 'active' : ''}`}
          onClick={() => scrollToPanel('player')}
          data-target="playerPanel"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          Player
        </button>
        <button
          className={`mr-nav-btn ${activePanel === 'queue' ? 'active' : ''}`}
          onClick={() => scrollToPanel('queue')}
          data-target="queuePanel"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M8 6h13M8 12h13M8 18h13" />
            <path d="M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
          Queue
        </button>
      </nav>

      {/* Toasts */}
      {toasts.map((toast) => (
        <div key={toast.id} className={`mr-toast ${toast.tone}`} role="alert">
          {toast.text}
        </div>
      ))}
    </main>
  );
}