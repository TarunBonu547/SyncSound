import { useCallback, useEffect, useState } from 'react';
import type { Track } from '../types/music';

const LIKED_KEY = 'syncsound.liked';
const RECENT_KEY = 'syncsound.recent';

/** How many tracks the history keeps. */
const RECENT_LIMIT = 12;

/**
 * Reads a value from the storage of the browser.
 *
 * The storage can be blocked (a private window, a strict privacy setting), so
 * every failure falls back to the value the caller already has.
 */
function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

/** Writes a value into the storage of the browser. */
function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The storage is blocked: the library stays in the memory of the tab.
  }
}

/** Only the fields of a track that the library shows. */
function toStored(track: Track): Track {
  return {
    id: track.id,
    title: track.title,
    channel: track.channel,
    thumbnail: track.thumbnail,
    durationSeconds: track.durationSeconds ?? null,
  };
}

/**
 * The library of this person.
 *
 * The hearted tracks and the tracks that were heard live on this device and
 * survive a reload. This is the only place where they are kept: the room
 * never owns a list of favourites.
 */
export function useLibrary() {
  const [favorites, setFavorites] = useState<Record<string, Track>>(() =>
    read<Record<string, Track>>(LIKED_KEY, {}),
  );
  const [recent, setRecent] = useState<Track[]>(() => read<Track[]>(RECENT_KEY, []));

  useEffect(() => {
    write(LIKED_KEY, favorites);
  }, [favorites]);

  useEffect(() => {
    write(RECENT_KEY, recent);
  }, [recent]);

  /** True when the track is hearted. */
  const isLiked = useCallback((id: string | null | undefined) => !!id && !!favorites[id], [favorites]);

  /** Hearts a track or takes it out of the liked songs again. */
  const toggleLike = useCallback((track: Track) => {
    setFavorites((prev) => {
      const next = { ...prev };
      if (next[track.id]) delete next[track.id];
      else next[track.id] = toStored(track);
      return next;
    });
  }, []);

  /** Takes a track out of the liked songs. */
  const removeFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  /**
   * Remembers a track for the history. The list is personal: it is built
   * from the tracks this client heard, not from the room.
   */
  const rememberTrack = useCallback((track: Track) => {
    const stored = toStored(track);
    setRecent((prev) => [stored, ...prev.filter((t) => t.id !== stored.id)].slice(0, RECENT_LIMIT));
  }, []);

  return {
    /** The hearted tracks, as a list. */
    favoriteList: Object.values(favorites),
    /** The tracks that were heard, newest first. */
    recent,
    isLiked,
    toggleLike,
    removeFavorite,
    rememberTrack,
  };
}

export type Library = ReturnType<typeof useLibrary>;
