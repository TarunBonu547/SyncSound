import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useYouTubePlayer, extractVideoId, YT_STATE } from '../hooks/useYouTubePlayer';
import { useSocket } from '../hooks/useSocket';
import { useRoom } from '../hooks/useRoom';
import { readClientId } from '../utils/clientId';
import { createSearchRequest, searchYouTube, lookupYouTubeVideo, type SearchResult } from '../utils/youtubeSearch';
import { fetchVideoMeta } from '../utils/youtubeMeta';
import { syncDebug } from '../utils/syncDebug';
import '../styles/mobile-room.css';

type MobileRoomProps = {
  displayName: string;
  onLeaveRoom: () => void;
  onBackToHome: () => void;
};

const DRIFT_THRESHOLD = 1.2;

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return minutes + ':' + String(remaining).padStart(2, '0');
}

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

export default function MobileRoom({ displayName, onLeaveRoom: _onLeaveRoom, onBackToHome: _onBackToHome }: MobileRoomProps) {
  const { socket, connected } = useSocket();
  const [clientId] = useState(() => readClientId());
  const stageVideoRef = useRef<HTMLDivElement | null>(null);
  const yt = useYouTubePlayer(stageVideoRef);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

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
  const [isLiked, setIsLiked] = useState(false);

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

  const copyRoomCode = useCallback(() => {
    const code = room.roomCode || '';
    if (!code) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code)
        .then(() => pushToast('Room code copied ♡'))
        .catch(() => pushToast('Room code: ' + code));
    } else {
      pushToast('Room code: ' + code);
    }
  }, [room.roomCode, pushToast]);

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
      setIsLiked(false);
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
        const track = await lookupYouTubeVideo(videoId, { signal });
        return { results: [track], nextPageToken: null };
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
        const known = new Set(prev.map((r: SearchResult) => r.id));
        return [...prev, ...value.results.filter((r: SearchResult) => !known.has(r.id))];
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

  const handleProgressClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !yt.duration) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const value = percent * yt.duration;
    handleSeek(value);
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

  const seekRelative = (seconds: number) => {
    if (!yt.duration) return;
    const t = Math.max(0, Math.min(yt.duration, yt.currentTime + seconds));
    handleSeek(t);
  };

  const clearQueue = async () => {
    const items = [...room.queue];
    for (const item of items) {
      room.removeQueueItem(item.id);
    }
    setCurrent(null);
    setCurrentItemId(null);
    setRoomPb(null);
    currentVideoId.current = null;
    lastRevision.current = 0;
    yt.pause();
    pushToast('Queue cleared');
  };

  const toggleLike = () => {
    setIsLiked(!isLiked);
    pushToast(isLiked ? 'Removed from favourites' : 'Added to favourites ♡');
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

  const progress = yt.duration > 0 ? Math.min(100, (yt.currentTime / yt.duration) * 100) : 0;
  const currentSeconds = yt.currentTime || 0;
  const durationSeconds = yt.duration || 0;
  const listenerCount = Math.max(1, room.members.length || room.participantCount);

  const scrollToPanel = (panel: 'search' | 'player' | 'queue') => {
    setActivePanel(panel);
    const element = document.getElementById(`${panel}Section`);
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
    <main className="mobile-room" role="main">
      {/* HEADER */}
      <header className="header">
        <div className="brand">
          <div className="brand-icon">♫</div>
          <div>
            <div className="brand-name">SyncSound</div>
            <div className="brand-sub">Your little shared universe</div>
          </div>
        </div>

        <div className="header-actions">
          <button className="icon-btn" onClick={() => pushToast('Room settings coming soon')} aria-label="Settings">⚙</button>
          <button className="icon-btn" onClick={() => pushToast('You are in your room')} aria-label="Room">♡</button>
        </div>
      </header>

      {/* ROOM INFORMATION */}
      <section className="room-info">
        <div className="room-top">
          <div>
            <div className="room-label">Your listening room</div>
            <div className="room-title">{room.roomName || 'Little Moments ♡'}</div>
          </div>

          <div className="live-pill">
            <span className="live-dot" style={{ background: connected ? '#D7FFE0' : '#938592' }}></span>
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        <div className="room-bottom">
          <div>
            <div className="room-code-label">Room code</div>
            <div className="room-code" id="roomCode">{room.roomCode || 'SS-XXXX'}</div>
          </div>

          <div className="listeners">♡ {listenerCount} listening</div>

          <button className="copy-btn" onClick={copyRoomCode}>Copy code</button>
        </div>
      </section>

      {/* SEARCH */}
      <section className="section" id="searchSection">
        <div className="section-heading">
          <div>
            <div className="section-title">Find your next song</div>
            <div className="section-sub">A little music for the two of you</div>
          </div>
        </div>

        <form className="search-box" onSubmit={handleSearchSubmit}>
          <span className="search-icon">⌕</span>
          <input
            ref={searchInputRef}
            id="searchInput"
            type="search"
            placeholder="Search songs, artists..."
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (searchError) setSearchError(null);
            }}
          />
          <button className="search-btn" type="submit" disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : null} Search
          </button>
        </form>

        <div className={`search-results ${resultsVisible ? 'show' : ''}`} id="searchResults">
          {loading && <div className="empty-queue">Searching YouTube…</div>}
          {searchError && <div className="empty-queue" role="alert">{searchError}</div>}
          {searchNotice && <div className="empty-queue" role="status">{searchNotice}</div>}
          {!loading && !searchError && results.length === 0 && !resultsVisible && (
            <div className="empty-queue">No search yet. Enter a song or artist name.</div>
          )}
          {results.map((video) => (
            <div key={video.id} className="result-item">
              <img src={video.thumbnail} alt="" />
              <div className="result-info">
                <div className="result-title">{video.title}</div>
                <div className="result-channel">{video.channel}</div>
              </div>
              <button className="add-btn" onClick={() => send(onAddToQueue, video, 'Added to queue')} aria-label="Add to queue">
                +
              </button>
            </div>
          ))}
          {nextPageToken && !loading && !searchError && (
            <button className="add-btn" onClick={loadMore} disabled={loading}>
              {loading ? <Loader2 size={16} className="spin" /> : '+'}
            </button>
          )}
        </div>
      </section>

      {/* PLAYER */}
      <section className="section" id="playerSection">
        <div className="section-heading">
          <div>
            <div className="section-title">Now playing</div>
            <div className="section-sub">Listening together, wherever you are</div>
          </div>
          <button className="text-btn" onClick={() => pushToast('Playback is synchronized in the room')}>Sync status ↗</button>
        </div>

        <div className="player-card">

          <div className="artwork" id="artwork">
            <div ref={stageVideoRef} className="yt-host" title="SyncSound player" />

            <div className="artwork-placeholder" id="artworkPlaceholder">
              <div className="music-icon">♫</div>
              <p>Your song goes here</p>
              <small>Search for a song to begin</small>
            </div>

            {loadingPlayer && (
              <div className="stage-overlay" role="status">
                <Loader2 size={20} className="spin" aria-hidden="true" />
                <span>Loading the video…</span>
              </div>
            )}

            {failed && (
              <div className="stage-overlay is-error" role="alert">
                <span>{yt.error}</span>
              </div>
            )}

            {needsGesture && !failed && (
              <div className="stage-overlay" role="status">
                <button className="play-btn" onClick={requestPlay} style={{ width: 48, height: 48, fontSize: 20, marginBottom: 10 }}>
                  ▶
                </button>
                <span className="stage-overlay-hint">
                  The browser blocked the automatic start. One click and the room is on the same track again.
                </span>
              </div>
            )}
          </div>

          <div className="player-song">
            <div className="song-details">
              <div className="song-title" id="currentTitle">{hasTrack ? current.title : 'Choose a song together'}</div>
              <div className="song-artist" id="currentArtist">{hasTrack ? current.channel : 'Your shared listening room'}</div>
            </div>
            <button className="heart-btn" id="heartBtn" onClick={toggleLike}>{isLiked ? '♥' : '♡'}</button>
          </div>

          <div className="progress-wrap">
            <div className="progress" id="progressBar" ref={progressBarRef} onClick={handleProgressClick}>
              <div className="progress-fill" id="progressFill" style={{ width: progress + '%' }} />
            </div>

            <div className="time-row">
              <span id="currentTime">{formatTime(currentSeconds)}</span>
              <span id="duration">{formatTime(durationSeconds)}</span>
            </div>
          </div>

          <div className="controls">
            <button className="control-btn" id="previousBtn" onClick={playPrevious} disabled={!hasPrevious} aria-label="Previous song">⏮</button>
            <button className="control-btn" id="rewindBtn" onClick={() => seekRelative(-10)} disabled={!hasTrack} aria-label="Rewind 10 seconds">↶</button>
            <button className="control-btn play-btn" id="playBtn" onClick={togglePlayback} disabled={!hasTrack} aria-label={roomPlaying ? 'Pause' : 'Play'}>
              {roomPlaying ? 'Ⅱ' : '▶'}
            </button>
            <button className="control-btn" id="forwardBtn" onClick={() => seekRelative(10)} disabled={!hasTrack} aria-label="Forward 10 seconds">↷</button>
            <button className="control-btn" id="nextBtn" onClick={playNext} disabled={!hasNext} aria-label="Next song">⏭</button>
          </div>

          <div className="sync-status">
            <span>●</span> {hasTrack ? (roomPlaying ? 'Connected to your listening room' : 'Playback paused.') : 'Choose a song to begin.'}
          </div>
        </div>
      </section>

      {/* QUEUE */}
      <section className="section" id="queueSection">
        <div className="section-heading">
          <div>
            <div className="section-title">Up next</div>
            <div className="section-sub"><span id="queueCount">{room.queue.length}</span> songs in your shared queue</div>
          </div>
          <button className="text-btn" onClick={clearQueue}>Clear all</button>
        </div>

        <div className="queue-list" id="queueList">
          {room.queue.length === 0 && (
            <div className="empty-queue">Your queue is waiting for a little music ♡</div>
          )}
          {room.queue.map((song, index) => (
            <div key={song.id} className={`queue-item ${index === queueIndex ? 'active' : ''}`}>
              <div className="queue-number">{index + 1}</div>
              <img className="queue-thumb" src={song.thumbnail} alt="" />
              <div className="queue-info">
                <div className="queue-song">{song.title}</div>
                <div className="queue-artist">{song.channel}</div>
              </div>
              <button className="queue-play" onClick={() => room.playQueueItem(song.id)} aria-label="Play song">▶</button>
              <button className="queue-play" onClick={() => room.removeQueueItem(song.id)} aria-label="Remove song">×</button>
            </div>
          ))}
        </div>
      </section>

      {/* BOTTOM NAVIGATION */}
      <nav className="bottom-nav" aria-label="Mobile navigation">
        <button
          className={`nav-item ${activePanel === 'search' ? 'active' : ''}`}
          onClick={() => scrollToPanel('search')}
        >
          <span className="nav-icon">⌕</span>
          Search
        </button>

        <button
          className={`nav-item ${activePanel === 'player' ? 'active' : ''}`}
          onClick={() => scrollToPanel('player')}
        >
          <span className="nav-icon">♫</span>
          Player
        </button>

        <button
          className={`nav-item ${activePanel === 'queue' ? 'active' : ''}`}
          onClick={() => scrollToPanel('queue')}
        >
          <span className="nav-icon">☷</span>
          Queue
        </button>
      </nav>

      {/* TOASTS */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast show ${toast.tone}`} role="alert">
            {toast.text}
          </div>
        ))}
      </div>
    </main>
  );
}
