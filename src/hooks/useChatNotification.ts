import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'syncsound-chat-muted';

/**
 * A tiny Web Audio chime that plays when a remote message arrives.
 *
 * The sound is generated in code, so there is no asset to load and no
 * network request to fail. It is a short two-note ascending arpeggio that
 * stays out of the way of the music that plays in the room.
 *
 * Browser autoplay restrictions are handled by only unlocking the audio
 * after the user has interacted with the page: the first click / keydown
 * creates the AudioContext and resumes it, and every later chime plays
 * through the same context.
 */
export function useChatNotification() {
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [ready, setReady] = useState(false);
  const audioCtxRef = useRef<BaseAudioContext | null>(null);
  const unlockRef = useRef(false);

  /** Build (or reuse) the AudioContext. Called on first user gesture. */
  const ensureContext = (): BaseAudioContext | null => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!Ctx) return null;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    return ctx;
  };

  /** Resume the context after a user gesture, so later chimes are not blocked. */
  const unlock = () => {
    if (unlockRef.current) return;
    unlockRef.current = true;
    const ctx = ensureContext();
    if (!ctx) return;
    // Cast to any so the resume call works across AudioContext variants.
    const anyCtx = ctx as unknown as { resume?: () => Promise<void>; state: AudioContextState };
    if (anyCtx.state === 'suspended' && anyCtx.resume) {
      anyCtx.resume().then(() => setReady(true)).catch(() => setReady(false));
    } else {
      setReady(true);
    }
  };

  /** Play the chime. Does nothing when muted, when audio is unavailable or
      when the context has not been unlocked by a user gesture yet. */
  const playChime = () => {
    if (muted || !ready) return;
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const notes = [880, 1320]; // a bright little two-note ping
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    gain.connect(ctx.destination);
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.08;
      osc.start(start);
      osc.stop(start + 0.2);
      osc.connect(gain);
    });
  };

  /** Toggle the mute state and persist it. */
  const toggleMute = () => {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Listen for the first user gesture so the audio context is unlocked and
  // the chime can play once a message arrives.
  useEffect(() => {
    const onGesture = () => unlock();
    window.addEventListener('click', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    window.addEventListener('touchstart', onGesture, { once: true });
    return () => {
      window.removeEventListener('click', onGesture);
      window.removeEventListener('keydown', onGesture);
      window.removeEventListener('touchstart', onGesture);
    };
  }, []);

  return { muted, ready, playChime, toggleMute, unlock };
}