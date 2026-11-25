import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, X, ArrowLeft, LogOut, Settings, CircleUserRound, Library, House, Search, MessageCircle, Heart, Plus, Link2, UsersRound } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useYouTubePlayer, extractVideoId } from './hooks/useYouTubePlayer';
import { useSocket } from './hooks/useSocket';
import { useRoom } from './hooks/useRoom';
import { useLibrary } from './hooks/useLibrary';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useChatNotification } from './hooks/useChatNotification';
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
import ChatPanel from './components/chat/ChatPanel';
import Toast from './components/common/Toast';
import FloatingCallWindow from './features/call/FloatingCallWindow';
import { useVideoCall } from './features/call/useVideoCall';
import DrawingOverlay from './components/drawing/DrawingOverlay';
import type { CreativeTool } from './components/creative/CreativeToolbar';
import FloatingCreativeMenu from './components/creative/FloatingCreativeMenu';
import CreateRoom from './pages/CreateRoom';
import JoinRoom from './pages/JoinRoom';
import SearchView from './pages/SearchView';
import LibraryView, { type LibrarySection } from './pages/LibraryView';
import type {
  PlaybackState,
  SongDedication,
  ToastMessage,
  ToastTone,
  Track,
} from './types/music';
import './App.css';
import './App.lounge.css';

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
  const { code: urlRoomCode } = useParams<{ code?: string }>();
  const navigate = useNavigate();

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

  /* --- Background animation elements --- */
  const bgMusicNotes = useMemo(() => {
    const notes = ['♪', '♫', '♬', '♩'];
    return Array.from({ length: 12 }, (_, i) => ({
      char: notes[i % notes.length],
      left: `${5 + Math.random() * 90}%`,
      size: `${16 + Math.random() * 16}px`,
      duration: `${20 + Math.random() * 20}s`,
      delay: `${-Math.random() * 20}s`,
    }));
  }, []);

  const bgGeoShapes = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const type = i % 3; // 0=circle, 1=ring, 2=star
      return {
        type,
        left: `${5 + Math.random() * 90}%`,
        size: `${8 + Math.random() * 24}px`,
        duration: `${25 + Math.random() * 25}s`,
        delay: `${-Math.random() * 25}s`,
        tx: `${-50 + Math.random() * 100}px`,
      };
    });
  }, []);
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
  const [mobileNav, setMobileNav] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [callOpen, setCallOpen] = useState(false);
  /** The active creative space tool. */
  const [activeCreativeTool, setActiveCreativeTool] = useState<CreativeTool | null>(null);
  /** The dedication card shown when a dedicated song starts playing. */
  const [showDedication, setShowDedication] = useState<{
    dedication: SongDedication;
    itemId: string;
  } | null>(null);
  /** Profile dropdown state. */
  const [profileOpen, setProfileOpen] = useState(false);
  /** Recently played rooms from localStorage. */
  const [recentRooms, setRecentRooms] = useState<Array<{
    code: string;
    name: string;
    lastTrack?: { title: string; thumbnail: string };
    lastActive: number;
  }>>([]);

  const library = useLibrary();
  /** On narrow screens the chat lives in a drawer instead of a side column. */
  const isNarrow = useMediaQuery('(max-width: 1024px)');

  /** Load recent rooms from localStorage on mount. */
  useEffect(() => {
    try {
      const stored = localStorage.getItem('syncsound-recent-rooms');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setRecentRooms(parsed);
      }
    } catch {}
  }, []);

  /** Save recent rooms to localStorage. */
  const saveRecentRooms = useCallback((rooms: typeof recentRooms) => {
    try {
      localStorage.setItem('syncsound-recent-rooms', JSON.stringify(rooms));
    } catch {}
    setRecentRooms(rooms);
  }, []);

  /** Add or update a room in recent history. */
  const addRecentRoom = useCallback((code: string, name: string, track?: { title: string; thumbnail: string }) => {
    setRecentRooms((prev) => {
      const filtered = prev.filter((r) => r.code !== code);
      const next = [
        { code, name, lastTrack: track, lastActive: Date.now() },
        ...filtered,
      ].slice(0, 10);
      saveRecentRooms(next);
      return next;
    });
  }, [saveRecentRooms]);

  /** Message notification sound and mute preference. */
  const chatNotify = useChatNotification();

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
    onRemoteMessage: () => chatNotify.playChime(),
  });
  const { editDedication } = room;

  /* --- Auto-enter room from URL --- */
  useEffect(() => {
    if (urlRoomCode && !room.roomCode) {
      const code = urlRoomCode.toUpperCase();
      room.enterRoom(code);
      setView('room');
      setHomeFocus(null);
      setMobileNav(false);
    }
  }, [urlRoomCode, room]);

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
        ? {
            id: videoId,
            title: known.title,
            channel: known.channel,
            thumbnail: known.thumbnail,
            ...(known.dedication && { dedication: known.dedication }),
          }
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

  /** Show the dedication card when a track that carries one starts playing. */
  useEffect(() => {
    if (!current?.dedication) {
      setShowDedication(null);
      return;
    }
    setShowDedication({ dedication: current.dedication, itemId: currentItemId || '' });
  }, [current, currentItemId]);

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
  const loadVideo = async (id: string, dedication?: string) => {
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
      ...(dedication && {
        dedication: {
          text: dedication,
          authorId: clientId,
          authorName: displayName || 'You',
          createdAt: Date.now(),
        },
      }),
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

  /** Adds a searched track, attaching a dedication when one was written. */
  const onAddToQueue = useCallback(
    (track: SearchResult, dedicationText?: string) => {
      const dedication = dedicationText
        ? {
            text: dedicationText,
            authorId: clientId,
            authorName: displayName,
            createdAt: Date.now(),
          }
        : undefined;
      return room.addTrackToQueue(track, dedication);
    },
    [room, clientId, displayName],
  );

  /** Plays a searched track now, attaching a dedication when one was written. */
  const onPlayNow = useCallback(
    (track: SearchResult, dedicationText?: string) => {
      const dedication = dedicationText
        ? {
            text: dedicationText,
            authorId: clientId,
            authorName: displayName,
            createdAt: Date.now(),
          }
        : undefined;
      return room.playTrack(track, dedication);
    },
    [room, clientId, displayName],
  );

  /** Plays a track from the library by finding it in favorites or recent. */
  const playLibraryTrack = useCallback(
    async (id: string): Promise<string | null> => {
      const track = library.favoriteList.find((t) => t.id === id) || library.recent.find((t) => t.id === id);
      if (!track) return 'Track not found';
      return room.playTrack(track);
    },
    [library, room],
  );

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
    navigate(`/room/${room.roomCode}`);
    setView('room');
    setHomeFocus(null);
    setMobileNav(false);
  }, [room.roomCode, goHome, navigate]);

  /** The sidebar and the mobile menu open the same screens. */
  const navigateTo = useCallback(
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
      navigate(`/room/${code.toUpperCase()}`);
      setView('room');
      setHomeFocus(null);
      setMobileNav(false);
      // Add to recent rooms with current track if available
      if (current) {
        addRecentRoom(code, room.roomName || code, { title: current.title, thumbnail: current.thumbnail });
      } else {
        addRecentRoom(code, room.roomName || code);
      }
    },
    [room, current, addRecentRoom, navigate],
  );

  /**
   * Room entry transition. The cards validate their own inputs before calling
   * this handler, so by the time we get here the room code and name are real.
   * The handler triggers the vinyl-inspired circular reveal and then hands off to
   * the existing room logic, preserving all room state and user information.
   */
  const handleEnterRoom = useCallback(
    (code: string, name?: string | null) => {
      const overlay = document.querySelector('.room-reveal') as HTMLElement;
      if (overlay) {
        overlay.classList.add('active');
        window.setTimeout(() => {
          enterRoom(code, name);
          overlay.classList.remove('active');
        }, 800);
      } else {
        enterRoom(code, name);
      }
    },
    [enterRoom],
  );

  /** Leaves the room on purpose and returns to the lobby. */
  const leaveRoom = useCallback(() => {
    // Save last track to recent rooms before leaving
    if (room.roomCode && current) {
      addRecentRoom(room.roomCode, room.roomName || room.roomCode, { title: current.title, thumbnail: current.thumbnail });
    }
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
    navigate('/');
    setView('home');
    setHomeFocus(null);
  }, [room, current, addRecentRoom, navigate]);

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

  /** Copies the room invitation URL to the clipboard. */
  const copyRoomLink = useCallback(async () => {
    if (!room.roomCode) return;
    const url = `${window.location.origin}/?room=${room.roomCode}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {}
  }, [room.roomCode]);

  /** Hearts the track that plays, so it shows up in the library. */
  const toggleFavorite = () => {
    if (current) library.toggleLike(current);
  };

  const dismissDedication = () => setShowDedication(null);

  const saveDedication = async (text: string) => {
    if (!showDedication) return;
    const message = await editDedication(showDedication.itemId, text);
    if (message) pushToast(message, 'error');
    else setShowDedication(null);
  };

  const removeDedication = async () => {
    if (!showDedication) return;
    const message = await editDedication(showDedication.itemId, null);
    if (message) pushToast(message, 'error');
    else setShowDedication(null);
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

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.profile-dropdown')) {
        setProfileOpen(false);
      }
    };
    if (profileOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [profileOpen]);

  return (
    <div className="app-root">
      {/* ------------------------------ Listening room ---------------------- */}
      <div className={`sunday-room lounge app ${view !== 'room' ? 'is-hidden' : ''}`} inert={view !== 'room'}>
        {/* Floating Sunday Radio background decor, kept behind the interface. */}
        <div className="sr-room-bg" aria-hidden="true">
          {bgMusicNotes.map((note, i) => (
            <span
              key={`rn-${i}`}
              className="sr-float-note"
              style={{
                left: note.left,
                fontSize: note.size,
                animationDuration: note.duration,
                animationDelay: note.delay,
              }}
            >
              {note.char}
            </span>
          ))}
          {bgGeoShapes.map((shape, i) => (
            <span
              key={`rg-${i}`}
              className={`sr-float-shape ${shape.type === 0 ? 'is-circle' : shape.type === 1 ? 'is-ring' : 'is-star'}`}
              style={{
                left: shape.left,
                width: shape.size,
                height: shape.size,
                animationDuration: shape.duration,
                animationDelay: shape.delay,
                ['--tx' as string]: shape.tx,
              } as React.CSSProperties}
            />
          ))}
        </div>
        <header className="navbar">
          <div className="navbar-left">
            <button
              className="btn icon ghost menu-btn"
              onClick={() => setMobileNav(true)}
              title="Open the menu"
              aria-label="Open the menu"
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <button className="wordmark-btn" onClick={goHome} title="Back to the start" aria-label="SyncSound home">
              <span className="waveform-icon" aria-hidden="true">
                <span className="bar" />
                <span className="bar" />
                <span className="bar" />
                <span className="bar" />
                <span className="bar" />
              </span>
              <span className="wordmark">
                <em>Sync</em>Sound
              </span>
            </button>
          </div>

          <nav className="navbar-center" aria-label="Main navigation">
            <button className={`nav-link ${view === 'home' ? 'is-active' : ''}`} onClick={goHome}>
              <House size={16} aria-hidden="true" />
              <span>Home</span>
            </button>
            <button className={`nav-link ${view === 'search' ? 'is-active' : ''}`} onClick={goSearch}>
              <Search size={16} aria-hidden="true" />
              <span>Search</span>
            </button>
            <button
              className={`nav-link ${view === 'library' ? 'is-active' : ''}`}
              onClick={() => goLibrary('liked')}
            >
              <Library size={16} aria-hidden="true" />
              <span>Your Library</span>
            </button>
          </nav>

          <div className="navbar-right">
            {isNarrow && room.roomCode && (
              <button
                className="btn icon mobile-chat-btn"
                onClick={() => setChatOpen(true)}
                title="On Air Chat"
                aria-label="Open the room chat"
              >
                <MessageCircle size={16} aria-hidden="true" />
              </button>
            )}
            <div className="profile-dropdown">
              <button
                className="navbar-avatar"
                style={{ background: profile.color }}
                title={displayName ? `You are ${displayName}` : 'You'}
                aria-label="Profile menu"
                aria-expanded={profileOpen}
                aria-haspopup="true"
                onClick={() => setProfileOpen(!profileOpen)}
              >
                {profile.initials}
              </button>
              {profileOpen && (
                <div className="profile-dropdown-menu" role="menu">
                  <div className="profile-dropdown-header">
                    <div className="profile-dropdown-name">{displayName || 'You'}</div>
                    <div className="profile-dropdown-email">Listener</div>
                  </div>
                  <div className="profile-dropdown-divider" />
                  <button className="profile-dropdown-item" role="menuitem" onClick={() => { setProfileOpen(false); goLibrary('liked'); }}>
                    <CircleUserRound size={18} /> Your Library
                  </button>
                  <button className="profile-dropdown-item" role="menuitem" onClick={() => { setProfileOpen(false); setSettingsOpen(true); }}>
                    <Settings size={18} /> Settings
                  </button>
                  <div className="profile-dropdown-divider" />
                  {room.roomCode && (
                    <button className="profile-dropdown-item danger" role="menuitem" onClick={() => { setProfileOpen(false); leaveRoom(); }}>
                      <LogOut size={18} /> Leave Room
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="main">
          <RoomHeader
            roomCode={room.roomCode}
            roomName={room.roomName}
            members={room.members}
            connected={connected}
            onOpenCall={() => setCallOpen(true)}
            onCopyLink={copyRoomLink}
          />

          <div className="lounge-grid">
            <div className="lounge-main-column">
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
                onAddToQueue={onAddToQueue}
                onPlayNow={onPlayNow}
                inRoom={!!room.roomCode}
                queue={room.queue}
                activeQueueItemId={activeQueueItemId}
                onPlayQueue={room.playQueueItem}
                onMoveUp={(id) => room.moveQueueItem(id, -1)}
                onMoveDown={(id) => room.moveQueueItem(id, 1)}
                onRemove={room.removeQueueItem}
                editDedication={editDedication}
                clientId={clientId}
                showDedication={showDedication}
                onDismissDedication={dismissDedication}
                onSaveDedication={saveDedication}
                onRemoveDedication={removeDedication}
                reactions={room.reactions}
                reactionClientId={clientId}
              />
            </div>

            <div className="lounge-creative-column">
              {!isNarrow && (
                <ChatPanel
                  roomCode={room.roomCode}
                  roomName={room.roomName}
                  members={room.members}
                  clientId={clientId}
                  connected={connected}
                  messages={room.messages}
                  typing={room.typing}
                  draft={room.draft}
                  chatError={room.chatError}
                  chatSending={room.chatSending}
                  replyTo={room.replyTo}
                  onDraftChange={room.setDraft}
                  onSend={room.sendMessage}
                  sendTyping={room.sendTyping}
                  onSelectReply={room.selectReply}
                  onCancelReply={room.cancelReply}
                />
              )}
            </div>
          </div>
        </main>
      </div>

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
        <div className="sunday-home">
          {view === 'home' && (
            <div className="ss-home">
              <div className="ss-wrap">
                <header className="ss-nav">
                  <div className="ss-logo">syncsound<span>.</span></div>
                  <nav className="ss-nav-links">
                    <a href="#connect">Rooms</a>
                    <a href="#about">About</a>
                  </nav>
                  <button className="ss-nav-cta" onClick={goCreate}>
                    Get Started
                  </button>
                </header>

                <div className="ss-split">
                  <section className="ss-hero" id="about">
                    <div className="ss-eyebrow">
                      <span className="ss-dot" aria-hidden="true" />
                      YOUR SPACE. YOUR SOUND.
                    </div>
                    <h1>
                      <span className="ss-line">Music brings us</span>
                      <span className="ss-line ss-highlight">closer.</span>
                    </h1>
                    <p className="ss-description">
                      Create a room, invite someone and listen together. Every song, every moment, in sync.
                    </p>
                    <div className="ss-wave-area">
                      <div className="ss-wave" aria-hidden="true">
                        {[13, 22, 34, 25, 43, 27, 17, 37, 47, 23, 34, 18, 29, 12].map((h, i) => {
                          const colors = ['#C58B71', '#B87358', '#A5A68A'];
                          const durations = ['.8s', '1s', '.9s', '1.1s', '.8s', '1.2s', '.9s', '1s', '.8s', '1.1s', '.9s', '1s', '.8s', '1.1s'];
                          const style: Record<string, string> = {
                            '--height': `${h}px`,
                            '--color': colors[i % 3],
                            '--delay': `${i * 0.1}s`,
                            '--duration': durations[i],
                          };
                          return <span key={`w-${i}`} style={style as unknown as React.CSSProperties} />;
                        })}
                      </div>
                      <span className="ss-wave-caption">IN PERFECT SYNC</span>
                    </div>
                  </section>

                  <section className="ss-rooms" id="connect">
                    <div className="ss-section-head">
                      <h2>How would you like to listen?</h2>
                      <span className="ss-section-index">01 — 02 / CONNECT</span>
                    </div>
                    <div className="ss-cards">
                      <article className="ss-card ss-card--host">
                        <div className="ss-card-top">
                          <span className="ss-card-number">01 / HOST</span>
                          <div className="ss-card-icon">↗</div>
                        </div>
                        <h3>Create a room.</h3>
                        <p className="ss-card-description">
                          Start a new listening session and bring someone along.
                        </p>
                        <CreateRoom
                          displayName={displayNameInput}
                          onDisplayNameChange={setDisplayNameInput}
                          onCreated={handleEnterRoom}
                        />
                      </article>

                      <article className="ss-card ss-card--guest">
                        <div className="ss-card-top">
                          <span className="ss-card-number">02 / GUEST</span>
                          <div className="ss-card-icon">⌁</div>
                        </div>
                        <h3>Join a room.</h3>
                        <p className="ss-card-description">
                          Have a room code already? Enter it and tune in.
                        </p>
                        <JoinRoom
                          displayName={displayNameInput}
                          onDisplayNameChange={setDisplayNameInput}
                          onJoined={handleEnterRoom}
                        />
                      </article>
                    </div>
                  </section>
                </div>

                <footer className="ss-footer" id="about">
                  <span>© 2026 SYNCSOUND</span>
                  <span>MADE FOR SHARED LISTENING.</span>
                </footer>
              </div>
            </div>
          )}

          {view === 'search' && (
            <div className="sunday-home-content">
              <SearchView
                inRoom={!!room.roomCode}
                onAddToQueue={room.addTrackToQueue}
                onPlayNow={room.playTrack}
                onGoHome={goHome}
              />
            </div>
          )}

          {view === 'library' && (
            <div className="sunday-home-content">
              <LibraryView
                section={librarySection}
                onSectionChange={setLibrarySection}
                favorites={library.favoriteList}
                recent={library.recent}
                inRoom={!!room.roomCode}
                onPlay={playLibraryTrack}
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
              <ArrowLeft size={18} className="room-return-icon" aria-hidden="true" />
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
        className={`sunday-room chat-drawer ${chatOpen ? 'is-open' : ''}`}
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
              typing={room.typing}
              draft={room.draft}
              chatError={room.chatError}
              chatSending={room.chatSending}
              replyTo={room.replyTo}
              onDraftChange={room.setDraft}
              onSend={room.sendMessage}
              sendTyping={room.sendTyping}
              onSelectReply={room.selectReply}
              onCancelReply={room.cancelReply}
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
              <button className="btn danger" onClick={() => { if (window.confirm("Leave this room?")) leaveRoom(); }}>
                <LogOut size={18} aria-hidden="true" /> Leave room
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

      <DrawingOverlay
        socket={socket}
        roomCode={room.roomCode}
        clientId={clientId}
        clientName={displayName || 'You'}
        initialState={room.drawings}
      />

      {/* ------------------------------ Mobile menu -------------------------- */}
      {mobileNav && (
        <div className="drawer" onClick={() => setMobileNav(false)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <span className="wordmark">
                <em>Sync</em>Sound
              </span>
              <button
                className="drawer-close"
                onClick={() => setMobileNav(false)}
                title="Close the menu"
                aria-label="Close the menu"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="nav-section">
              {[
                { id: 'home', label: 'Home', icon: <House size={18} /> },
                { id: 'search', label: 'Search Music', icon: <Search size={18} /> },
                { id: 'liked-songs', label: 'Liked Songs', icon: <Heart size={18} /> },
                { id: 'playlists', label: 'Your Library', icon: <CircleUserRound size={18} /> },
              ].map((item) => (
                <button
                  key={item.id}
                  className={`nav-link ${activeNav === item.id ? 'is-active' : ''}`}
                  onClick={() => {
                    setMobileNav(false);
                    if (item.id === 'liked-songs') goLibrary('liked');
                    else if (item.id === 'playlists') goLibrary('playlists');
                    else navigateTo(item.id as NavTarget);
                  }}
                >
                  {item.icon}
                  <span className="nav-label">{item.label}</span>
                </button>
              ))}
            </div>

            <div className="nav-section">
              <span className="nav-section-title">Listen Together</span>
              {[
                { id: 'room', label: 'Your Room', icon: <UsersRound size={18} /> },
                { id: 'create-room', label: 'Create Room', icon: <Plus size={18} /> },
                { id: 'join-room', label: 'Join Room', icon: <Link2 size={18} /> },
              ].map((item) => (
                <button
                  key={item.id}
                  className={`nav-link ${activeNav === item.id ? 'is-active' : ''} ${item.id === 'room' && room.roomCode ? 'is-room-active' : ''}`}
                  onClick={() => {
                    setMobileNav(false);
                    navigate(item.id as NavTarget);
                  }}
                >
                  {item.icon}
                  <span className="nav-label">{item.label}</span>
                  {item.id === 'room' && room.roomCode && (
                    <span className="nav-room-badge">Active</span>
                  )}
                </button>
              ))}
            </div>

            <div className="nav-section nav-section-bottom">
              {room.roomCode && (
                <button
                  className="nav-link"
                  onClick={() => {
                    setMobileNav(false);
                    setChatOpen(true);
                  }}
                >
                  <MessageCircle size={18} />
                  <span className="nav-label">On Air Chat</span>
                </button>
              )}
              <button
                className="nav-link"
                onClick={() => {
                  setMobileNav(false);
                  setSettingsOpen(true);
                }}
              >
                <Settings size={18} />
                <span className="nav-label">Settings</span>
              </button>
            </div>

            {room.roomCode && (
              <button className="nav-link nav-leave" onClick={leaveRoom}>
                <LogOut size={18} aria-hidden="true" />
                <span className="nav-label">Leave room</span>
              </button>
            )}
          </div>
        </div>
      )}

      <FloatingCreativeMenu
        activeTool={activeCreativeTool}
        onToolChange={setActiveCreativeTool}
      />

    </div>
  );
}

