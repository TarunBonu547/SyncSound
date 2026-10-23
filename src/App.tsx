import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, X, Copy, MessageCircle, ArrowLeft, LogOut } from 'lucide-react';
import { useYouTubePlayer, extractVideoId } from './hooks/useYouTubePlayer';
import { useSocket } from './hooks/useSocket';
import { useRoom } from './hooks/useRoom';
import { useLibrary } from './hooks/useLibrary';
import { useMediaQuery } from './hooks/useMediaQuery';
import { syncDebug } from './utils/syncDebug';
import { readClientId } from './utils/clientId';
import { fetchVideoMeta } from './utils/youtubeMeta';
import {
  createSearchRequest,
  lookupYouTubeVideo,
  searchYouTube,
  type SearchResult,
} from './utils/youtubeSearch';
import { avatarFor } from './utils/avatar';
import { normalizeDisplayName, readDisplayName, saveDisplayName } from './utils/displayName';
import RoomHeader from './components/layout/RoomHeader';
import MainPlayer from './components/player/MainPlayer';
import MiniPlayer from './components/player/MiniPlayer';
import ChatPanel from './components/chat/ChatPanel';
import Toast from './components/common/Toast';
import FloatingCallWindow from './features/call/FloatingCallWindow';
import { useVideoCall } from './features/call/useVideoCall';
import CreateRoom from './pages/CreateRoom';
import JoinRoom from './pages/JoinRoom';
import SearchView from './pages/SearchView';
import LibraryView, { type LibrarySection } from './pages/LibraryView';
import type { PlaybackState, ToastMessage, ToastTone, Track } from './types/music';
import './App.css';

/** Ignore a drift below this many seconds. */
const DRIFT_THRESHOLD = 1.2;

type View = 'home' | 'room' | 'search' | 'library';

type NavTarget =
  | 'home'
  | 'room'
  | 'search'
  | 'liked-songs'
  | 'playlists'
  | 'recently-played'
  | 'create-room'
  | 'join-room'
  | 'settings';

export default function App() {
  /** React owned, always empty container for the YouTube IFrame player. */
  const stageVideoRef = useRef<HTMLDivElement | null>(null);
  const yt = useYouTubePlayer(stageVideoRef);
  const { socket, connected } = useSocket();
  /** The id of this tab. The server uses it to recognise the person. */
  const [clientId] = useState(() => readClientId());
  /**
   * The name the person wants to be seen under.
   *
   * The text of the field is kept as it is typed, the cleaned name is what
   * goes over the wire and what the interface shows.
   */
  const [displayNameInput, setDisplayNameInput] = useState(() => readDisplayName());
  const displayName = useMemo(() => normalizeDisplayName(displayNameInput), [displayNameInput]);

  /**
   * The name is remembered while it is typed.
   *
   * So a refresh does not ask for it again, and so the room of the next visit
   * already knows how this person wants to be called.
   */
  useEffect(() => {
    saveDisplayName(displayNameInput);
  }, [displayNameInput]);

  /** The lobby has three parts: the start screen, the search and the library. */
  const [view, setView] = useState<View>('home');
  /** The part of the library that is open. */
  const [librarySection, setLibrarySection] = useState<LibrarySection>('liked');
  /** Which of the two room cards is in front. */
  const [homeFocus, setHomeFocus] = useState<'create' | 'join' | null>(null);

  const [current, setCurrent] = useState<Track | null>(null);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [roomPb, setRoomPb] = useState<PlaybackState | null>(null);
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytNotice, setYtNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** The results of the search of the add song form. */
  const [queueSearch, setQueueSearch] = useState<SearchResult[]>([]);
  const [queueSearchNext, setQueueSearchNext] = useState<string | null>(null);
  const [queueSearching, setQueueSearching] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  /** Whether the invite link really made it into the clipboard. */
  const [linkCopied, setLinkCopied] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [callOpen, setCallOpen] = useState(false);

  const library = useLibrary();
  /** On narrow screens the chat lives in a drawer instead of a side column. */
  const isNarrow = useMediaQuery('(max-width: 1024px)');

  const currentVideoId = useRef<string | null>(null);
  const lastRevision = useRef(0);
  /** Bumped on every applied state so stale async work can be discarded. */
  const generation = useRef(0);
  /** Transition id whose end was already reported to the server. */
  const endedReportedFor = useRef<string | null>(null);
  /** Estimated difference between the server clock and this clock (ms). */
  const clockOffset = useRef<number | null>(null);
  const seekEmitTimer = useRef<number | null>(null);
  /** Latest player handle / room state, readable from long lived intervals. */
  const ytRef = useRef(yt);
  const roomPbRef = useRef<PlaybackState | null>(null);
  const applyRemoteRef = useRef<(p: PlaybackState) => void>(() => {});

  /** A short lived message in the corner of the screen. */
  const pushToast = useCallback((text: string, tone: ToastTone = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev.slice(-3), { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  /**
   * The room of this client: the code, the name, the members, the shared
   * queue and the chat. The playback state is only forwarded, the player
   * owns it.
   */
  const room = useRoom({
    socket,
    clientId,
    displayName,
    onPlayback: (p) => applyRemoteRef.current(p),
    onError: (message) => pushToast(message, 'error'),
  });

  /** The two person call. It only uses the socket, never the music protocol. */
  const call = useVideoCall({ socket, roomCode: room.roomCode, clientId });

  /** Where the room timeline says the playhead should be right now. */
  const expectedPosition = (p: PlaybackState) => {
    const base = typeof p.position === 'number' ? p.position : 0;
    if (!p.playing) return base;
    const now = Date.now() + (clockOffset.current ?? 0);
    const updatedAt = p.updatedAt || now;
    return base + Math.max(0, (now - updatedAt) / 1000);
  };

  /** Keep the smallest observed clock difference - that sample had the least delay. */
  const sampleClock = (serverNow?: number) => {
    if (!serverNow) return;
    const offset = serverNow - Date.now();
    if (clockOffset.current === null || offset < clockOffset.current) clockOffset.current = offset;
  };

  /**
   * Apply an authoritative room state to the local player.
   * A track change loads the video and waits for the player to be ready before
   * the position is applied; the same track only seeks when the drift is real.
   */
  const applyRemote = (p: PlaybackState) => {
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
      // The queue already knows the title of the track, so the stage shows it
      // right away instead of a placeholder.
      const known = room.queueRef.current.find((q) => q.id === p.currentQueueItemId);
      const track: Track = known
        ? { id: videoId, title: known.title, channel: known.channel, thumbnail: known.thumbnail }
        : { id: videoId, title: 'Loading…', channel: '', thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
      setCurrent(track);
      library.rememberTrack(track);
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
      // The room has finished its queue: the playhead stays where the video
      // ended instead of jumping back to the start.
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

  /** Looks the title of a track up, without ever replacing a known one. */
  const fetchMeta = async (id: string, gen: number) => {
    try {
      const r = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`);
      const d = await r.json();
      if (gen !== generation.current) return; // a newer track took over
      // A lookup that brings no title knows less than the room does: the
      // title of the queue is kept instead of a placeholder.
      const title = typeof d?.title === 'string' ? d.title.trim() : '';
      if (!title) return;
      const track: Track = {
        id,
        title,
        channel: d.author_name || '',
        thumbnail: d.thumbnail_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      };
      setCurrent((prev) => (prev && prev.id === id ? prev : track));
      library.rememberTrack(track);
    } catch {
      if (gen !== generation.current) return;
      // Keep what is known instead of replacing the title with a placeholder.
      setCurrent((prev) =>
        prev && prev.id === id
          ? prev
          : { id, title: id, channel: 'Unknown channel', thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` },
      );
    }
  };

  useEffect(() => {
    ytRef.current = yt;
    roomPbRef.current = roomPb;
    applyRemoteRef.current = applyRemote;
  });

  /**
   * An explicit user action becomes a command: the server updates the room
   * state and broadcasts it. Remote state is never sent back.
   */
  const sendCommand = (patch: { playing?: boolean; position?: number }) => {
    if (!socket || !room.roomCode) return;
    const player = ytRef.current;
    const pb = roomPbRef.current;
    const videoId = pb?.videoId || currentVideoId.current || current?.id || null;
    const local = player.getCurrentTime();
    // A player that has not started yet cannot report a position; the room
    // timeline is the better source in that case.
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
          setYtError(res?.error || 'Playback command failed');
          return;
        }
        if (typeof res.revision === 'number') {
          lastRevision.current = Math.max(lastRevision.current, res.revision);
          // The broadcast of this very command is dropped by the revision
          // guard, so the local baseline is updated right here.
          setRoomPb((prev) =>
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

  useEffect(() => {
    // Drift correction. The room timeline is authoritative, so a client that
    // fell behind corrects itself instead of pulling the room back. The refs
    // keep the interval alive across re-renders, the threshold keeps it from
    // turning into a correction loop.
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
            reactState: ytRef.current.state,
            playerState: player.getState(),
          });
        }
        return;
      }
      if (state === 2 || state === 5) {
        // The room plays, this client does not: the start was lost somewhere
        // (a blocked autoplay, a player that was replaced while loading).
        // Two observations in a row, so a single hiccup does not restart the
        // video the user just paused.
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
    // The player has just cued the video (YouTube player state 5). The
    // position that was current when the target was created can be stale by
    // now - the video needed a moment to load - so the room position is
    // applied again with a fresh estimate.
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
    if (yt.state !== 0) return; // YouTube player state 0 = ended
    const pb = roomPbRef.current;
    if (!pb?.playing) return; // the room itself is not playing
    const transitionId = pb.transitionId;
    if (!transitionId) return;
    if (endedReportedFor.current === transitionId) return;
    // The video that really ended - not the one the room may already have
    // moved on to. Reporting the current one would skip a track.
    const endedId = yt.endedVideoId;
    if (!endedId) return;
    if (pb.videoId && endedId !== pb.videoId) return; // the room already advanced
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

  /* --- the search of the add song form ------------------------------------- */
  /** One search at a time in the add song form. */
  const queueSearchRequest = useMemo(() => createSearchRequest(), []);

  /**
   * The search of the add song form: a song name, an artist or a title, or a
   * pasted YouTube link. The results are shown under the form, the track
   * itself goes into the shared queue.
   */
  const runQueueSearch = async (pageToken?: string) => {
    const term = searchTerm.trim();
    if (!term) {
      setYtError('Type a song, an artist or a title');
      return;
    }
    const videoId = extractVideoId(term);
    setQueueSearching(true);
    setYtError(null);
    setYtNotice(null);
    const answer = await queueSearchRequest.run(async (signal) => {
      if (!videoId) return searchYouTube(term, { pageToken, signal });
      try {
        const track = await lookupYouTubeVideo(videoId, { signal });
        return { results: [track], nextPageToken: null };
      } catch (err) {
        // Without an API key the server can not look a link up. The public
        // lookup still works, so a pasted link is not lost.
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
      setQueueSearching(false);
      return;
    }
    setQueueSearching(false);
    if (answer.error) {
      const code = (answer.error as any)?.code;
      setYtError(
        code === 'api_unavailable'
          ? 'The YouTube search is not configured on this server. Add YOUTUBE_API_KEY to the environment of the backend and start it again.'
          : answer.error instanceof Error
            ? answer.error.message
            : 'The search could not be completed.',
      );
      return;
    }
    const value = answer.value!;
    setQueueSearch(value.results);
    setQueueSearchNext(value.nextPageToken);
    if (value.results.length === 0) setYtError('Nothing was found for that search.');
  };

  /** Add a video to the shared queue and start it for the whole room. */
  const loadVideo = async (id: string) => {
    if (!socket || !room.roomCode) {
      setYtError('Join a room first');
      return;
    }
    setYtError(null);
    const meta = await fetchVideoMeta(id);
    const message = await room.playTrack({
      id,
      title: meta.title,
      channel: meta.channel,
      thumbnail: meta.thumbnail,
      durationSeconds: meta.duration || null,
    });
    if (message) setYtError(message);
  };

  /** Puts a pasted or looked up track into the queue. */
  const addQueue = async () => {
    const id = extractVideoId(searchTerm);
    if (!id) {
      setYtError('Search for a track or paste a YouTube link');
      return;
    }
    if (!socket || !room.roomCode) {
      setYtError('Join a room first');
      return;
    }
    setAdding(true);
    setYtError(null);
    const meta = await fetchVideoMeta(id);
    const message = await room.addTrackToQueue({
      id,
      title: meta.title,
      channel: meta.channel,
      thumbnail: meta.thumbnail,
      durationSeconds: meta.duration || null,
    });
    setAdding(false);
    if (message) {
      setYtError(message);
      return;
    }
    setSearchTerm('');
  };

  /** Looks the metadata of a video up and plays it in the room. */
  const playNowById = async (id: string): Promise<string | null> => {
    const meta = await fetchVideoMeta(id);
    return room.playTrack({
      id,
      title: meta.title,
      channel: meta.channel,
      thumbnail: meta.thumbnail,
      durationSeconds: meta.duration || null,
    });
  };

  /* --- the invite ------------------------------------------------------------ */
  const inviteLink = room.roomCode ? `${window.location.origin}/?room=${room.roomCode}` : `${window.location.origin}`;

  const copyLink = async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(inviteLink);
      copied = true;
    } catch {
      // The clipboard is not available (no permission, not a secure
      // context): the dialog shows the link so it can be copied by hand.
    }
    setLinkCopied(copied);
    setInviteOpen(true);
  };

  /* --- navigation ------------------------------------------------------------ */
  const goHome = useCallback(() => {
    setView('home');
    setHomeFocus(null);
    setMobileNav(false);
  }, []);

  const goCreate = useCallback(() => {
    setView('home');
    setHomeFocus('create');
    setMobileNav(false);
  }, []);

  const goJoin = useCallback(() => {
    setView('home');
    setHomeFocus('join');
    setMobileNav(false);
  }, []);

  const goSearch = useCallback(() => {
    setView('search');
    setHomeFocus(null);
    setMobileNav(false);
  }, []);

  const goLibrary = useCallback((section: LibrarySection = 'liked') => {
    setLibrarySection(section);
    setView('library');
    setHomeFocus(null);
    setMobileNav(false);
  }, []);

  /** Back into the room the music is playing in. */
  const goRoom = useCallback(() => {
    if (!room.roomCode) {
      goHome();
      return;
    }
    setView('room');
    setHomeFocus(null);
    setMobileNav(false);
  }, [room.roomCode, goHome]);

  /** The sidebar and the mobile menu open the same screens. */
  const navigate = useCallback(
    (target: NavTarget) => {
      if (target === 'home') goHome();
      else if (target === 'room') goRoom();
      else if (target === 'search') goSearch();
      else if (target === 'create-room') goCreate();
      else if (target === 'join-room') goJoin();
    },
    [goHome, goRoom, goSearch, goCreate, goJoin],
  );

  const enterRoom = useCallback(
    (code: string, name?: string | null) => {
      room.enterRoom(code, name);
      setView('room');
      setHomeFocus(null);
      setMobileNav(false);
    },
    [room],
  );

  /** Leaves the room on purpose and returns to the lobby. */
  const leaveRoom = useCallback(() => {
    room.leaveRoom();
    setCallOpen(false);
    setSettingsOpen(false);
    setCurrent(null);
    setCurrentItemId(null);
    setRoomPb(null);
    roomPbRef.current = null;
    currentVideoId.current = null;
    lastRevision.current = 0;
    setYtError(null);
    // The invite link must not send the user back into the room on reload.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      url.searchParams.delete('code');
      window.history.replaceState({}, '', url.toString());
    } catch {
      // The url cannot be rewritten: the room code is simply forgotten.
    }
    setView('home');
    setHomeFocus(null);
  }, [room]);

  const focusQueueInput = () => {
    const el = document.getElementById('queue-url-input');
    if (!el) return;
    const reduce =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  };

  /* --- derived values -------------------------------------------------------- */
  /** The local player really renders a moving picture. */
  const localPlaying = yt.state === 1;
  /**
   * What the room does. A buffering player reports a stale state, so the
   * room state is the only reliable source for the play/pause intent.
   */
  const roomPlaying = roomPb ? roomPb.playing : localPlaying;
  const activeQueueItemId = (roomPb && roomPb.currentQueueItemId) || currentItemId || null;
  const progress = yt.duration > 0 ? Math.min(100, (yt.currentTime / yt.duration) * 100) : 0;
  const listenerCount = Math.max(1, room.members.length || room.participantCount);
  const isLiked = library.isLiked(current?.id);

  /** The index of the track that plays inside the shared queue. */
  const queueIndex = room.queue.findIndex((item) => item.id === activeQueueItemId);
  const hasNext = room.queue.length > 0 && (queueIndex === -1 || queueIndex < room.queue.length - 1);
  const hasPrevious = queueIndex > 0;

  /** Starts the track after the one that plays. */
  const playNext = () => {
    if (!room.queue.length) return;
    const index = queueIndex === -1 ? 0 : queueIndex;
    const next = room.queue[index + 1];
    if (next) room.playQueueItem(next.id);
  };

  /** Starts the track before the one that plays. */
  const playPrevious = () => {
    if (queueIndex <= 0) return;
    const previous = room.queue[queueIndex - 1];
    if (previous) room.playQueueItem(previous.id);
  };

  const togglePlayback = () => {
    const player = ytRef.current;
    const pb = roomPbRef.current;
    // The intent follows the room, not the momentary player state: a
    // buffering player is not playing, but the room still is.
    const playing = pb ? pb.playing : player.getState() === 1;
    if (playing) {
      player.pause();
      sendCommand({ playing: false });
    } else {
      player.play();
      sendCommand({ playing: true });
    }
  };

  /**
   * The browser refused to start the video on its own.
   *
   * The room already plays the track, so only this client is behind: the
   * player is moved onto the position of the room and started there. The
   * room is not told about it, because the room did not change.
   */
  const requestPlay = () => {
    const player = ytRef.current;
    const pb = roomPbRef.current;
    const expected = pb ? expectedPosition(pb) : player.getCurrentTime();
    // The target waits for the player, so a video that is still loading is
    // started as soon as it is ready.
    player.syncTo(expected, true);
    player.play();
  };

  /** Moves the playhead. The room is told about the last position only. */
  const handleSeek = (value: number) => {
    yt.seek(value);
    // Dragging produces a burst of events: only the last one is sent to the
    // room.
    if (seekEmitTimer.current) window.clearTimeout(seekEmitTimer.current);
    seekEmitTimer.current = window.setTimeout(() => {
      seekEmitTimer.current = null;
      // Seeking moves the playhead, it never changes whether the room plays.
      const pb = roomPbRef.current;
      const playing = pb ? pb.playing : ytRef.current.getState() === 1;
      sendCommand({ position: value, playing });
    }, 150);
  };

  /** Hearts the track that plays, so it shows up in the library. */
  const toggleFavorite = () => {
    if (current) library.toggleLike(current);
  };

  const activeNav: NavTarget =
    view === 'room'
      ? 'room'
      : view === 'search'
        ? 'search'
        : view === 'library'
          ? librarySection === 'liked'
            ? 'liked-songs'
            : librarySection === 'playlists'
              ? 'playlists'
              : 'recently-played'
          : homeFocus === 'create'
            ? 'create-room'
            : homeFocus === 'join'
              ? 'join-room'
              : 'home';

  /** The other person of the room, for the call window. */
  const peer = room.members.find((m) => m.clientId !== clientId) || null;
  const profile = avatarFor(displayName || 'You', clientId);

  return (
    <div className="app-root">
      <div className="ambient" aria-hidden="true">
        <span className="ambient-blob b1" />
        <span className="ambient-blob b2" />
        <span className="ambient-blob b3" />
        <span className="bokeh k1" />
        <span className="bokeh k2" />
        <span className="bokeh k3" />
      </div>

      {/* ------------------------------ Listening room ---------------------- */}
      <div className={`app ${view !== 'room' ? 'is-hidden' : ''}`} inert={view !== 'room'}>
        <header className="navbar">
          <div className="navbar-brand">
            <button
              className="btn icon ghost menu-btn"
              onClick={() => setMobileNav(true)}
              title="Open the menu"
              aria-label="Open the menu"
            >
              <Menu size={18} aria-hidden="true" />
            </button>
            <button className="wordmark-btn" onClick={goHome} title="Back to the start" aria-label="SyncSound home">
              <span className="wordmark">
                <em>Sync</em>Sound
              </span>
            </button>
          </div>

          <nav className="navbar-nav" aria-label="Main">
            <button className={`nav-link ${view === 'home' ? 'is-active' : ''}`} onClick={goHome}>
              Home
            </button>
            <button className={`nav-link ${view === 'search' ? 'is-active' : ''}`} onClick={goSearch}>
              Search
            </button>
            <button
              className={`nav-link ${view === 'library' ? 'is-active' : ''}`}
              onClick={() => goLibrary('liked')}
            >
              Your Library
            </button>
          </nav>

          <div className="navbar-brand navbar-end">
            <button
              className="chat-toggle"
              onClick={() => setChatOpen(true)}
              title="Open the chat"
              aria-label="Open the chat"
            >
              <MessageCircle size={16} aria-hidden="true" />
              <span>Chat</span>
            </button>
            <span
              className="navbar-avatar"
              style={{ background: profile.color }}
              title={displayName ? `You are ${displayName}` : 'You'}
              aria-hidden="true"
            >
              {profile.initials}
            </span>
          </div>
        </header>

        <main className="main">
          <RoomHeader
            roomCode={room.roomCode}
            roomName={room.roomName}
            members={room.members}
            connected={connected}
            linkCopied={linkCopied}
            onCopyInvite={copyLink}
            onVideoCall={() => setCallOpen(true)}
          />

          <MainPlayer
            stageRef={stageVideoRef}
            current={current}
            yt={yt}
            playing={roomPlaying}
            progress={progress}
            isLiked={isLiked}
            ytError={ytError}
            playerError={yt.error}
            onSeek={handleSeek}
            onTogglePlayback={togglePlayback}
            onRequestPlay={requestPlay}
            onRewind5={yt.rewind5}
            onForward5={yt.forward5}
            onPrevious={playPrevious}
            onNext={playNext}
            onToggleLike={toggleFavorite}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            adding={adding}
            onAddQueue={addQueue}
            onLoadVideo={loadVideo}
            search={{
              term: searchTerm,
              setTerm: setSearchTerm,
              searching: queueSearching,
              results: queueSearch,
              nextPageToken: queueSearchNext,
              error: ytError,
              notice: ytNotice,
              setError: setYtError,
              setNotice: setYtNotice,
              run: runQueueSearch,
            }}
            onAddToQueue={room.addTrackToQueue}
            onPlayNow={room.playTrack}
            inRoom={!!room.roomCode}
            queue={room.queue}
            activeQueueItemId={activeQueueItemId}
            onPlayQueue={room.playQueueItem}
            onMoveUp={(id) => room.moveQueueItem(id, -1)}
            onMoveDown={(id) => room.moveQueueItem(id, 1)}
            onRemove={room.removeQueueItem}
            onInvite={() => setInviteOpen(true)}
            onVideoCall={() => setCallOpen(true)}
            onFocusQueueInput={focusQueueInput}
          />
        </main>

        <aside className="right">
          {!isNarrow && (
            <ChatPanel
              roomCode={room.roomCode}
              roomName={room.roomName}
              members={room.members}
              clientId={clientId}
              connected={connected}
              messages={room.messages}
              draft={room.draft}
              chatError={room.chatError}
              chatSending={room.chatSending}
              onDraftChange={room.setDraft}
              onSend={room.sendMessage}
            />
          )}
        </aside>
      </div>

      {/* --------------------------- Persistent mini player ------------------ */}
      <MiniPlayer
        current={current}
        playing={roomPlaying}
        ready={yt.ready}
        currentTime={yt.currentTime}
        duration={yt.duration}
        onPlayPause={togglePlayback}
        onPrevious={playPrevious}
        onNext={playNext}
        hasPrevious={hasPrevious}
        hasNext={hasNext}
        onSeek={handleSeek}
        onOpenPlayer={goRoom}
      />

      {/*
        The call window lives outside the room shell: it floats above the
        player, the queue and the chat, and it is hidden until the video call
        is asked for.
      */}
      <FloatingCallWindow
        call={call}
        open={callOpen}
        onOpenChange={setCallOpen}
        roomCode={room.roomCode}
        peerName={peer?.name ?? null}
      />

      {/* ------------------------------ Lobby ------------------------------ */}
      {view !== 'room' && (
        <div className="home">
          <div className="home-top">
            <div className="navbar-brand">
              <button
                className="btn icon ghost menu-btn"
                onClick={() => setMobileNav(true)}
                title="Open the menu"
                aria-label="Open the menu"
              >
                <Menu size={18} aria-hidden="true" />
              </button>
              <button className="wordmark-btn" onClick={goHome} title="SyncSound home" aria-label="SyncSound home">
                <span className="wordmark">
                  <em>Sync</em>Sound
                </span>
              </button>
            </div>
            <nav className="navbar-nav" aria-label="Main">
              <button className={`nav-link ${view === 'home' ? 'is-active' : ''}`} onClick={goHome}>
                Home
              </button>
              <button className={`nav-link ${view === 'search' ? 'is-active' : ''}`} onClick={goSearch}>
                Search
              </button>
              <button
                className={`nav-link ${view === 'library' ? 'is-active' : ''}`}
                onClick={() => goLibrary('liked')}
              >
                Your Library
              </button>
            </nav>
            <span
              className="navbar-avatar"
              style={{ background: profile.color }}
              title={displayName ? `You are ${displayName}` : 'You'}
              aria-hidden="true"
            >
              {profile.initials}
            </span>
          </div>

          {view === 'home' && (
            <>
              <div className="home-hero fade-in-up">
                <h1 className="home-title">SyncSound</h1>
                <p className="home-sub">
                  Listen together. Create a room, share the link, and every track plays in sync for everyone in it.
                </p>
              </div>

              <div className="home-cards">
                <div className={`home-card fade-in-up stagger-2 ${homeFocus === 'create' ? 'is-focused' : ''}`}>
                  <CreateRoom
                    displayName={displayNameInput}
                    onDisplayNameChange={setDisplayNameInput}
                    onCreated={enterRoom}
                  />
                </div>
                <div className={`home-card fade-in-up stagger-3 ${homeFocus === 'join' ? 'is-focused' : ''}`}>
                  <JoinRoom
                    displayName={displayNameInput}
                    onDisplayNameChange={setDisplayNameInput}
                    onJoined={enterRoom}
                  />
                </div>
              </div>
            </>
          )}

          {view === 'search' && (
            <div className="lobby-view">
              <SearchView
                inRoom={!!room.roomCode}
                onAddToQueue={room.addTrackToQueue}
                onPlayNow={room.playTrack}
                onGoHome={goHome}
              />
            </div>
          )}

          {view === 'library' && (
            <div className="lobby-view">
              <LibraryView
                section={librarySection}
                onSectionChange={setLibrarySection}
                favorites={library.favoriteList}
                recent={library.recent}
                inRoom={!!room.roomCode}
                onPlay={playNowById}
                onRemoveFavorite={library.removeFavorite}
                onGoHome={goHome}
              />
            </div>
          )}

          {room.roomCode && (
            <button
              className="room-return"
              onClick={goRoom}
              title="Back to the room"
              aria-label={`Back to room ${room.roomCode}`}
            >
              <span className="room-return-dot" aria-hidden="true" />
              <span className="room-return-text">Room {room.roomCode}</span>
              <span className="room-return-note"> keeps playing</span>
              <span className="room-return-action">Back to the room</span>
              <ArrowLeft size={15} className="room-return-icon" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {/* ------------------------------ Chat drawer ------------------------- */}
      <div
        className={`chat-drawer-backdrop ${chatOpen ? 'is-open' : ''}`}
        onClick={() => setChatOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`chat-drawer ${chatOpen ? 'is-open' : ''}`}
        aria-label="Chat of the room"
        aria-hidden={!chatOpen}
      >
        {isNarrow && (
          <ChatPanel
            roomCode={room.roomCode}
            roomName={room.roomName}
            members={room.members}
            clientId={clientId}
            connected={connected}
            messages={room.messages}
            draft={room.draft}
            chatError={room.chatError}
            chatSending={room.chatSending}
            onDraftChange={room.setDraft}
            onSend={room.sendMessage}
            onClose={() => setChatOpen(false)}
          />
        )}
      </aside>

      {/* ------------------------------ Overlays ------------------------------ */}
      {settingsOpen && (
        <div className="overlay" onClick={() => setSettingsOpen(false)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h3>Room Settings</h3>
            <p className="hint">
              Room {room.roomCode || '—'} · {listenerCount} {listenerCount === 1 ? 'listener' : 'listeners'}. Copy the
              invite link to let somebody in, or leave the room and go back to the lobby.
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setSettingsOpen(false)}>
                Close
              </button>
              <button className="btn danger" onClick={leaveRoom}>
                <LogOut size={15} aria-hidden="true" /> Leave room
              </button>
            </div>
          </div>
        </div>
      )}

      {inviteOpen && (
        <div className="overlay" onClick={() => setInviteOpen(false)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h3>{linkCopied ? 'Invite Link Copied' : 'Invite Link'}</h3>
            <p className="hint">
              {linkCopied
                ? 'Send this link to the person you want to listen with.'
                : 'Copy this link to invite somebody:'}
            </p>
            <p className="hint invite-link">{inviteLink}</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setInviteOpen(false)}>
                Close
              </button>
              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inviteLink);
                    setLinkCopied(true);
                    pushToast('The invite link is on the clipboard.', 'success');
                  } catch {
                    // The clipboard is not available: the link above can be
                    // copied by hand.
                  }
                }}
              >
                <Copy size={15} aria-hidden="true" /> Copy link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------ Toasts ------------------------------ */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <Toast key={toast.id} id={toast.id} message={toast.text} tone={toast.tone} onDismiss={() => dismissToast(toast.id)} />
        ))}
      </div>

      {/* ------------------------------ Mobile menu -------------------------- */}
      {mobileNav && (
        <div className="drawer" onClick={() => setMobileNav(false)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <span className="wordmark">
                <em>Sync</em>Sound
              </span>
              <button
                className="btn icon sm"
                onClick={() => setMobileNav(false)}
                title="Close the menu"
                aria-label="Close the menu"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
            {(
              [
                { id: 'home', label: 'Home' },
                { id: 'search', label: 'Search music' },
                { id: 'liked-songs', label: 'Liked songs' },
                { id: 'playlists', label: 'Your Library' },
                { id: 'recently-played', label: 'Recently played' },
                { id: 'room', label: 'Your room' },
                { id: 'create-room', label: 'Create room' },
                { id: 'join-room', label: 'Join room' },
                { id: 'settings', label: 'Settings' },
              ] as { id: NavTarget; label: string }[]
            ).map((item) => (
              <button
                key={item.id}
                className={`side-link ${activeNav === item.id ? 'is-active' : ''}`}
                onClick={() => {
                  if (item.id === 'liked-songs') goLibrary('liked');
                  else if (item.id === 'playlists') goLibrary('playlists');
                  else if (item.id === 'recently-played') goLibrary('recent');
                  else if (item.id === 'settings') {
                    setMobileNav(false);
                    setSettingsOpen(true);
                  }
                  else navigate(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
            {room.roomCode && (
              <button className="side-link" onClick={leaveRoom}>
                <LogOut size={17} aria-hidden="true" /> Leave room
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
