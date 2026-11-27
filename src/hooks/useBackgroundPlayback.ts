import { useCallback, useEffect, useRef, useState } from 'react';
import { syncDebug } from '../utils/syncDebug';

/** SessionStorage key under which the last known playback snapshot is kept
 *  so a discarded tab can restore its place on return. */
const SESSION_KEY = 'syncsound-background-state';

/** How far the local playhead may drift from the room timeline before a
 *  corrective seek is issued on return to the foreground. */
const RETURN_DRIFT_THRESHOLD = 2.0;

/** How long the tab may stay hidden before we treat the return as a fresh
 *  reconciliation rather than a minor resume. */
const HIDDEN_STALE_MS = 60 * 1000;

type BackgroundPlaybackHandlers = {
  /** Starts playback (sends a command to the room). */
  onPlay: () => void;
  /** Pauses playback (sends a command to the room). */
  onPause: () => void;
  /** Plays the previous track in the shared queue. */
  onPrevious: () => void;
  /** Plays the next track in the shared queue. */
  onNext: () => void;
  /** The latest authoritative playback state from the server. */
  roomPb: { playing: boolean; position: number; updatedAt: number; videoId: string | null } | null;
  /** The local YouTube player handle. */
  yt: {
    getCurrentTime: () => number;
    getState: () => number;
    play: () => void;
    pause: () => void;
    seek: (t: number) => void;
  } | null;
  /** Sends an explicit playback command to the server. */
  sendCommand: (patch: { playing?: boolean; position?: number }) => void;
};

type BackgroundPlaybackResult = {
  /** True when the document is currently visible. */
  isVisible: boolean;
  /** True when the window currently has focus. */
  hasFocus: boolean;
  /** True when the page was hidden long enough to need a full reconciliation. */
  wasStale: boolean;
  /** Manually trigger a reconciliation with the server state. */
  reconcile: () => void;
  /** Update Media Session metadata for the current track. */
  setMediaMetadata: (params: { title: string; artist: string; artwork: string; playing: boolean }) => void;
};

/**
 * Handles mobile background playback and page lifecycle for SyncSound.
 *
 * The YouTube IFrame API does not support true background audio on mobile
 * browsers: Chrome on Android pauses <video> elements in background tabs,
 * and iOS Safari suspends background pages entirely. This hook cannot
 * override that browser enforcement. What it does:
 *
 * - Never pauses playback merely because the page became hidden.
 * - Keeps the Socket.IO connection alive across backgrounding.
 * - Sets up the Web Media Session API for lock screen / notification controls.
 * - On return to the foreground, reconciles the local player with the
 *   authoritative server state (position, play/pause) without sending
 *   spurious commands or creating sync loops.
 * - Persists the last known state to sessionStorage so a discarded tab can
 *   restore its place.
 */
export function useBackgroundPlayback(handlers: BackgroundPlaybackHandlers): BackgroundPlaybackResult {
  const {
    onPlay,
    onPause,
    onPrevious,
    onNext,
    roomPb,
    yt,
    sendCommand,
  } = handlers;

  const [isVisible, setIsVisible] = useState(!document.hidden);
  const [hasFocus, setHasFocus] = useState(document.hasFocus());
  const [wasStale, setWasStale] = useState(false);

  const hiddenAtRef = useRef<number | null>(null);
  const reconciliationRef = useRef<(p: { playing: boolean; position: number; updatedAt: number; videoId: string | null } | null) => void>(() => {});
  const mediaSessionRef = useRef<MediaSession | null>(null);

  /**
   * The reconciliation function is assigned in an effect (not during render)
   * so it always captures the latest `yt` and `sendCommand` without triggering
   * the refs-during-render lint rule.
   */
  useEffect(() => {
    reconciliationRef.current = (pb) => {
      if (!pb || !yt) return;
      if (pb.videoId === null) {
        // The room has no track: nothing to align.
        return;
      }
      const player = yt;
      const localState = player.getState();
      const localTime = player.getCurrentTime();
      const roomPlaying = pb.playing;

      // Where the room timeline says the playhead should be right now.
      const now = Date.now();
      const elapsed = Math.max(0, (now - pb.updatedAt) / 1000);
      const expected = roomPlaying ? pb.position + elapsed : pb.position;

      const drift = Math.abs(localTime - expected);
      const localPlaying = localState === 1;

      syncDebug('background reconcile', {
        localState,
        localTime: Number(localTime.toFixed(2)),
        expected: Number(expected.toFixed(2)),
        drift: Number(drift.toFixed(2)),
        localPlaying,
        roomPlaying,
      });

      // Align play/pause with the room, but only when they truly differ.
      if (roomPlaying && !localPlaying) {
        // The room plays but this client does not: resume at the room position.
        player.play();
        sendCommand({ playing: true, position: expected });
        syncDebug('background reconcile: resumed', { position: Number(expected.toFixed(2)) });
      } else if (!roomPlaying && localPlaying) {
        // The room is paused but this client plays: pause at the room position.
        player.pause();
        sendCommand({ playing: false, position: expected });
        syncDebug('background reconcile: paused', { position: Number(expected.toFixed(2)) });
      } else if (drift > RETURN_DRIFT_THRESHOLD) {
        // Both agree on play/pause but the playhead drifted: correct it.
        player.seek?.(expected);
        syncDebug('background reconcile: seek', {
          local: Number(localTime.toFixed(2)),
          expected: Number(expected.toFixed(2)),
        });
      }
    };
  }, [yt, sendCommand]);

  /** Persist the last known playback state so a discarded tab can restore it. */
  const persistState = useCallback(() => {
    if (!roomPb) return;
    try {
      const payload = {
        videoId: roomPb.videoId,
        playing: roomPb.playing,
        position: roomPb.position,
        updatedAt: roomPb.updatedAt,
        revision: (roomPb as { revision?: number }).revision,
        hiddenAt: Date.now(),
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    } catch {}
  }, [roomPb]);

  /** Restore persisted state on return after a tab discard. */
  const restorePersistedState = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.videoId === 'string' &&
        typeof parsed.playing === 'boolean' &&
        typeof parsed.position === 'number' &&
        typeof parsed.updatedAt === 'number'
      ) {
        syncDebug('background restore persisted', parsed);
        return parsed;
      }
    } catch {}
    return null;
  }, []);

  /** Clear persisted state once the server has confirmed the current state. */
  const clearPersistedState = useCallback(() => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
  }, []);

  /** Full reconciliation: applies the room state to the local player. */
  const reconcile = useCallback(() => {
    reconciliationRef.current(roomPb);
    clearPersistedState();
  }, [roomPb, clearPersistedState]);

  /** Update the Media Session metadata and playback state. */
  const setMediaMetadata = useCallback(
    ({ title, artist, artwork, playing }: { title: string; artist: string; artwork: string; playing: boolean }) => {
      if (!('mediaSession' in navigator)) return;
      try {
        mediaSessionRef.current = navigator.mediaSession;
        navigator.mediaSession.metadata = new MediaMetadata({
          title,
          artist,
          album: 'SyncSound',
          artwork: [{ src: artwork, sizes: '512x512', type: 'image/jpeg' }],
        });
        navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
      } catch {
        // Media Session API not fully supported: silently degrade.
      }
    },
    [],
  );

  // --- Media Session action handlers ---------------------------------------
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const handlePlay = () => {
      syncDebug('media session: play');
      onPlay();
    };
    const handlePause = () => {
      syncDebug('media session: pause');
      onPause();
    };
    const handlePrevious = () => {
      syncDebug('media session: previous track');
      onPrevious();
    };
    const handleNext = () => {
      syncDebug('media session: next track');
      onNext();
    };

    try {
      navigator.mediaSession.setActionHandler('play', handlePlay);
      navigator.mediaSession.setActionHandler('pause', handlePause);
      navigator.mediaSession.setActionHandler('previoustrack', handlePrevious);
      navigator.mediaSession.setActionHandler('nexttrack', handleNext);
    } catch {
      // Some handlers may not be supported: the ones that were set remain.
    }

    return () => {
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
      } catch {}
    };
  }, [onPlay, onPause, onPrevious, onNext]);

  // --- Page lifecycle listeners -------------------------------------------
  useEffect(() => {
    const onVisibilityChange = () => {
      const hidden = document.hidden;
      setIsVisible(!hidden);

      if (hidden) {
        // The page is going into the background: record when, persist state.
        hiddenAtRef.current = Date.now();
        persistState();
        syncDebug('background: page hidden');
      } else {
        // The page is coming back to the foreground.
        const hiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
        hiddenAtRef.current = null;
        setWasStale(hiddenFor > HIDDEN_STALE_MS);
        syncDebug('background: page visible', { hiddenForMs: hiddenFor, stale: hiddenFor > HIDDEN_STALE_MS });
        // Reconcile with the authoritative server state. If the socket
        // reconnected while hidden, roomPb already carries the latest state.
        reconcile();
      }
    };

    const onPageHide = (event: PageTransitionEvent) => {
      // pagehide fires on navigation and backgrounding on some mobile browsers.
      // Persist state so a discarded tab can restore its place.
      persistState();
      syncDebug('background: pagehide', { persisted: event.persisted });
    };

    const onPageShow = (event: PageTransitionEvent) => {
      // pageshow fires when the page is shown, including from bfcache.
      const restored = restorePersistedState();
      if (restored && event.persisted) {
        syncDebug('background: pageshow restored', restored);
      }
      setWasStale(false);
      reconcile();
    };

    const onFocus = () => setHasFocus(true);
    const onBlur = () => setHasFocus(false);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, [persistState, restorePersistedState, reconcile, setWasStale]);

  return {
    isVisible,
    hasFocus,
    wasStale,
    reconcile,
    setMediaMetadata,
  };
}
