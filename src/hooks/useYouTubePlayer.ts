import { useRef, useState, useCallback, useEffect, useId, type RefObject } from 'react';
import { syncDebug } from '../utils/syncDebug';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
      const v = u.searchParams.get('v');
      if (v) return v;
    }
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
  } catch {}
  return null;
}

type SyncTarget = {
  videoId: string;
  /** null = do not touch the position, only the play/pause state. */
  position: number | null;
  playing: boolean;
};

/** Below this difference a seek is skipped, so the player is not nudged. */
const SEEK_EPSILON = 0.35;

/**
 * How long a video may take to arrive.
 *
 * The script of the IFrame API can be slow or blocked by the network. A
 * video that does not arrive in this time is reported, so the stage does not
 * wait for it forever.
 */
const LOAD_TIMEOUT_MS = 15000;

/** Id of the element the IFrame API takes over. */
const PLAYER_ELEMENT_ID = 'yt-player';

/** The states of the IFrame API, so the numbers are named everywhere. */
export const YT_STATE = {
  unstarted: -1,
  ended: 0,
  playing: 1,
  paused: 2,
  buffering: 3,
  cued: 5,
} as const;

/**
 * The message of a playback error.
 *
 * The codes come from the IFrame API. A video that may not be embedded is
 * reported as such: the rules of YouTube are respected, nothing is worked
 * around.
 */
function describePlayerError(code: unknown): string {
  switch (Number(code)) {
    case 2:
      return 'This track does not point at a video any more.';
    case 5:
      return 'The video could not be played in this browser.';
    case 100:
      return 'This video is not available any more.';
    case 101:
    case 150:
      return 'The owner of this video does not allow it to be played here.';
    default:
      return 'The video could not be played.';
  }
}

/**
 * The IFrame API script may only be added once per document. StrictMode
 * mounts the effect twice, and a second script tag would call the ready
 * callback again and create a second player on the same container.
 */
const apiCallbacks: Array<() => void> = [];
let apiRequested = false;
/** The newest player instance wins; older ones ignore their callbacks. */
let activeInstance = 0;
/**
 * The containers that already own a player.
 *
 * A container never gets a second player: the IFrame API would replace the
 * element of the first one and the old player would keep on playing.
 */
const hostsWithPlayer = new WeakSet<HTMLElement>();

/**
 * The API script publishes `window.YT` long before `YT.Player` exists, so
 * the namespace alone is not a readiness signal - creating a player then
 * throws "YT.Player is not a constructor" and leaves a broken element
 * behind. Only a real constructor means the API is usable.
 */
function isApiReady() {
  return typeof window.YT?.Player === 'function';
}

function whenYouTubeApiReady(cb: () => void) {
  if (isApiReady()) {
    cb();
    return;
  }
  apiCallbacks.push(cb);
  if (apiRequested) return;
  apiRequested = true;
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.body.appendChild(tag);
  window.onYouTubeIframeAPIReady = () => {
    apiCallbacks.splice(0).forEach((fn) => fn());
  };
}

/**
 * Mounts the YouTube IFrame player inside a React owned container.
 *
 * The IFrame API replaces the element it is given with its own <iframe>.
 * If React owns that element, React keeps writing into a detached node and
 * the commit of the whole surrounding subtree fails, so the rest of the UI
 * (stage state, scrubber, title) stops updating. The player therefore lives
 * in an element that is created outside of React; React only owns the empty
 * host container and never touches what is inside it.
 */
export function useYouTubePlayer(hostRef: RefObject<HTMLElement | null>) {
  const instanceId = useId();
  const playerRef = useRef<any>(null);
  const readyRef = useRef(false);
  const stateRef = useRef<number>(-1);
  /** The video id this client intends to have loaded. */
  const loadedVideoRef = useRef<string | null>(null);
  /** A state that still has to be applied to the player (waiting for readiness). */
  const targetRef = useRef<SyncTarget | null>(null);
  /** The element the IFrame API takes over. React never owns it. */
  const playerElementRef = useRef<HTMLElement | null>(null);
  const ownPlayerRef = useRef<any>(null);
  /** The timer that reports a video that does not arrive. */
  const loadTimerRef = useRef<number | null>(null);
  /** Guards against creating a second player for the same container. */
  const creatingRef = useRef(false);
  /** Creates the player, but only while the current instance is mounted. */
  const createPlayerRef = useRef<(videoId: string) => void>(() => {});
  /** True while the mounted effect is the one that owns the player. */
  const isCurrentRef = useRef<() => boolean>(() => true);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<number>(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /**
   * The video that really reached the end. It is captured in the player
   * event, because the room can move on to the next track before the
   * application reacts to the state.
   */
  const [endedVideoId, setEndedVideoId] = useState<string | null>(null);

  useEffect(() => {
    stateRef.current = state;
    syncDebug('state sync', { state, id: instanceId });
  }, [state, instanceId]);

  const playerVideoId = useCallback((): string | null => {
    const player = playerRef.current;
    if (!player) return null;
    const data = player.getVideoData?.();
    return data?.video_id || null;
  }, []);

  /**
   * Apply the pending target once the player is actually ready for it:
   * right video loaded and not unstarted. Never seeks a position onto a
   * different video.
   */
  const applyTarget = useCallback(() => {
    const target = targetRef.current;
    const player = playerRef.current;
    if (!target || !player) return;
    if (playerVideoId() !== target.videoId) return;
    const st = player.getPlayerState?.();
    if (typeof st === 'number' && st < 0) return;
    targetRef.current = null;
    try {
      if (target.position !== null && target.position > 0) {
        const now = player.getCurrentTime?.() || 0;
        if (Math.abs(now - target.position) > SEEK_EPSILON) {
          player.seekTo(target.position, true);
        }
      }
      if (target.playing) player.playVideo();
      else player.pauseVideo();
      syncDebug('player target applied', {
        videoId: target.videoId,
        position: target.position,
        playing: target.playing,
        playerState: st,
      });
    } catch (e) {
      syncDebug('player target failed', { message: (e as Error)?.message });
    }
  }, [playerVideoId]);

  /** Stops the timer that reports a video that does not arrive. */
  const clearLoadTimer = useCallback(() => {
    if (loadTimerRef.current === null) return;
    window.clearTimeout(loadTimerRef.current);
    loadTimerRef.current = null;
  }, []);

  /**
   * Reports a video that does not arrive.
   *
   * The script of the IFrame API can be slow or blocked by the network. The
   * stage says so instead of showing a loading sign for ever.
   */
  const armLoadTimer = useCallback(() => {
    clearLoadTimer();
    loadTimerRef.current = window.setTimeout(() => {
      loadTimerRef.current = null;
      if (readyRef.current) return;
      setError('The video did not load. Check the connection and try again.');
      syncDebug('player load timeout', { videoId: loadedVideoRef.current });
    }, LOAD_TIMEOUT_MS);
  }, [clearLoadTimer]);

  /**
   * Creates the player for a video.
   *
   * The player is created with the video id so the embed url of the iframe
   * is a real one. A player without a video id embeds an empty url, which
   * YouTube answers with "video unavailable" (error 150) and the video can
   * never be cued.
   */
  const createPlayer = useCallback(
    (videoId: string) => {
      if (playerRef.current || creatingRef.current) return;
      if (!isApiReady()) return;
      const host = hostRef.current;
      if (!host) {
        syncDebug('player host missing');
        return;
      }
      // A container that already carries a player never gets a second one.
      if (hostsWithPlayer.has(host)) return;
      creatingRef.current = true;
      const playerElement = document.createElement('div');
      playerElement.id = PLAYER_ELEMENT_ID;
      playerElement.className = 'yt-player-host';
      host.appendChild(playerElement);
      playerElementRef.current = playerElement;
      hostsWithPlayer.add(host);
      // The video only starts by itself when the room wants it to play.
      const wantsToPlay = targetRef.current?.playing === true;
      try {
        const player = new window.YT.Player(playerElement, {
          videoId,
          // The size of the stage. The rules of the interface fill the
          // container anyway, so the video never stretches.
          height: '360',
          width: '640',
          // The video starts by itself when the room starts the track. The
          // browser may still refuse it, then the interface asks for a click.
          playerVars: {
            autoplay: wantsToPlay ? 1 : 0,
            controls: 0,
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
          },
          events: {
            onReady: () => {
              if (!isCurrentRef.current()) return;
              readyRef.current = true;
              setReady(true);
              // The video arrived: a report of a slow load is not true any
              // more.
              clearLoadTimer();
              setError(null);
              syncDebug('player ready', { videoId });
              const wanted = loadedVideoRef.current;
              if (wanted && playerVideoId() !== wanted) {
                player.cueVideoById?.(wanted);
              }
              applyTarget();
            },
            onStateChange: (e: any) => {
              if (!isCurrentRef.current()) return;
              if (e.data === 0) {
                // State 0 = ended. Remember which video ended: by the time
                // the application reacts, the room may already have moved on
                // to the next track. The loaded id is the fallback when the
                // player no longer reports its video data.
                setEndedVideoId(playerVideoId() || loadedVideoRef.current);
              } else {
                // The ended video is only valid while the player really sits
                // at the end of it. A new playback clears it.
                setEndedVideoId(null);
              }
              setState(e.data);
              syncDebug('player state', { state: e.data });
              applyTarget();
            },
            onError: (e: any) => {
              if (!isCurrentRef.current()) return;
              setError(describePlayerError(e.data));
              syncDebug('player error', { code: e.data });
            },
          },
        });
        ownPlayerRef.current = player;
        playerRef.current = player;
        syncDebug('player created', { videoId });
      } catch (e) {
        creatingRef.current = false;
        playerElementRef.current = null;
        hostsWithPlayer.delete(host);
        if (playerElement.parentNode) playerElement.parentNode.removeChild(playerElement);
        syncDebug('player create failed', { message: (e as Error)?.message });
      }
    },
    [hostRef, playerVideoId, applyTarget, clearLoadTimer],
  );

  useEffect(() => {
    let cancelled = false;
    const instance = ++activeInstance;
    readyRef.current = false;
    // The container of the player. It is read here, because the cleanup
    // below may run long after the last render.
    const host = hostRef.current;
    // Only the newest player instance may act on the shared state.
    isCurrentRef.current = () => !cancelled && activeInstance === instance;
    createPlayerRef.current = createPlayer;

    // The player is created as soon as a video is known - and only then,
    // because a player without a video id embeds an empty url.
    whenYouTubeApiReady(() => {
      const wanted = loadedVideoRef.current;
      if (wanted) createPlayerRef.current(wanted);
    });

    // Progress readout. The playhead is read for every state that already
    // carries a video: 5 (cued) and 0 (ended) as well, otherwise the
    // scrubber would keep showing the values of the previous video.
    let ticks = 0;
    const interval = setInterval(() => {
      const st = stateRef.current;
      const player = playerRef.current;
      if (!player || typeof player.getCurrentTime !== 'function') return;
      if (st < 0) {
        // Unstarted: there is no playhead to show yet.
        ticks += 1;
        if (ticks % 4 === 0) {
          syncDebug('progress idle', {
            stateRef: st,
            playerState: player.getPlayerState?.() ?? null,
            ready: readyRef.current,
          });
        }
        return;
      }
      setCurrentTime(player.getCurrentTime() || 0);
      setDuration(player.getDuration() || 0);
      ticks += 1;
      if (ticks % 4 === 0) {
        syncDebug('progress update', {
          time: Number((player.getCurrentTime() || 0).toFixed(2)),
          duration: player.getDuration() || 0,
          state: st,
        });
      }
    }, 500);

    // Watchdog: a target that could not be applied yet (player still loading)
    // is retried until the player is ready for it. It also retries the mount
    // itself when the host container or the API was not available yet.
    const watchdog = setInterval(() => {
      if (!playerRef.current) {
        const wanted = loadedVideoRef.current;
        if (wanted) createPlayerRef.current(wanted);
        return;
      }
      if (targetRef.current) applyTarget();
    }, 200);

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(watchdog);
      clearLoadTimer();
      isCurrentRef.current = () => false;
      createPlayerRef.current = () => {};
      if (activeInstance !== instance) return; // a newer instance owns the player
      if (ownPlayerRef.current?.destroy) ownPlayerRef.current.destroy();
      // The API may have replaced the element with its own iframe; both
      // variants have to leave the host container empty again.
      const playerElement = playerElementRef.current;
      if (playerElement?.parentNode) playerElement.parentNode.removeChild(playerElement);
      playerElementRef.current = null;
      ownPlayerRef.current = null;
      playerRef.current = null;
      creatingRef.current = false;
      // The container is free again, so a new player may take it.
      if (host) hostsWithPlayer.delete(host);
    };
  }, [createPlayer, applyTarget, hostRef, clearLoadTimer]);

  /** Load a video and describe the state it should end up in. */
  const load = useCallback(
    (videoId: string, position: number | null = 0, playing = false) => {
      setError(null);
      loadedVideoRef.current = videoId;
      targetRef.current = { videoId, position, playing };
      // The video has to arrive: a player that stays away is reported.
      armLoadTimer();
      const player = playerRef.current;
      if (!player) {
        // The player does not exist yet: it is created for this video as
        // soon as the API is available.
        whenYouTubeApiReady(() => createPlayerRef.current(videoId));
        return;
      }
      if (!readyRef.current) return;
      if (playerVideoId() !== videoId) {
        // Cue only: the video must not start before the position is applied.
        player.cueVideoById?.(videoId);
        syncDebug('cue video', { videoId });
      }
      applyTarget();
    },
    [applyTarget, playerVideoId, armLoadTimer],
  );

  /** Apply a state to the video that is already loaded. */
  const syncTo = useCallback(
    (position: number | null, playing: boolean) => {
      const videoId = loadedVideoRef.current;
      if (!videoId) return;
      targetRef.current = { videoId, position, playing };
      applyTarget();
    },
    [applyTarget],
  );

  const seek = useCallback(
    (t: number) => {
      const pending = targetRef.current;
      if (pending) {
        // A different video is still loading: only move the pending target.
        if (pending.videoId !== playerVideoId()) {
          targetRef.current = { ...pending, position: t };
          return;
        }
        targetRef.current = { ...pending, position: t };
      }
      if (!readyRef.current) return;
      playerRef.current?.seekTo?.(t, true);
      setCurrentTime(t);
    },
    [playerVideoId],
  );

  const play = useCallback(() => {
    const pending = targetRef.current;
    if (pending) {
      targetRef.current = { ...pending, playing: true };
      applyTarget();
      return;
    }
    if (!readyRef.current) return;
    playerRef.current?.playVideo?.();
  }, [applyTarget]);

  const pause = useCallback(() => {
    const pending = targetRef.current;
    if (pending) {
      targetRef.current = { ...pending, playing: false };
      applyTarget();
      return;
    }
    if (!readyRef.current) return;
    playerRef.current?.pauseVideo?.();
  }, [applyTarget]);

  const getCurrentTime = useCallback(() => playerRef.current?.getCurrentTime?.() || 0, []);
  const getState = useCallback(() => playerRef.current?.getPlayerState?.() ?? -1, []);
  const hasPendingTarget = useCallback(() => targetRef.current !== null, []);

  const rewind5 = useCallback(() => {
    if (!playerRef.current) return;
    const t = Math.max(0, (playerRef.current.getCurrentTime?.() || 0) - 5);
    seek(t);
  }, [seek]);

  const forward5 = useCallback(() => {
    if (!playerRef.current) return;
    const dur = playerRef.current.getDuration?.() || 0;
    const cur = playerRef.current.getCurrentTime?.() || 0;
    const t = dur ? Math.min(dur, cur + 5) : cur + 5;
    seek(t);
  }, [seek]);

  return {
    ready,
    state,
    currentTime,
    duration,
    error,
    /** The video that really reached the end (YouTube player state 0). */
    endedVideoId,
    load,
    syncTo,
    seek,
    play,
    pause,
    rewind5,
    forward5,
    getCurrentTime,
    getState,
    hasPendingTarget,
  };
}

/** The handle of the YouTube player, as the components use it. */
export type YouTubePlayer = ReturnType<typeof useYouTubePlayer>;
