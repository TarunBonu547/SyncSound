import type { Track } from '../types/music';

/**
 * The YouTube search of the browser.
 *
 * The browser never talks to YouTube itself: it asks this backend, the
 * backend talks to YouTube with the key that only the backend knows. The
 * module has no React and no browser only code, so it can be tested in node.
 */

const env = ((import.meta as any)?.env ?? {}) as Record<string, string | undefined>;
const SOCKET_URL = env.VITE_SOCKET_URL || 'http://localhost:4000';
/** The backend of the REST API. It is the socket server by default. */
export const API_URL = String(env.VITE_API_URL || SOCKET_URL).replace(/\/+$/, '');

export type SearchResult = Track;

export type SearchResponse = {
  results: SearchResult[];
  nextPageToken: string | null;
};

export type SearchErrorCode =
  | 'api_unavailable'
  | 'api_disabled'
  | 'invalid_api_key'
  | 'quota'
  | 'timeout'
  | 'network'
  | 'bad_response'
  | 'invalid_query'
  | 'invalid_page_token'
  | 'invalid_request'
  | 'not_found'
  | 'unknown';

/** A failure of the search with the code the server reported. */
export class YouTubeSearchError extends Error {
  code: SearchErrorCode;
  status: number;

  constructor(code: SearchErrorCode, message: string, status = 0) {
    super(message);
    this.name = 'YouTubeSearchError';
    this.code = code;
    this.status = status;
  }
}

/** The message of a failure that never reached the server. */
function localErrorMessage(err: unknown): { code: SearchErrorCode; message: string } {
  if (err instanceof YouTubeSearchError) return { code: err.code, message: err.message };
  if (err && (err as Error).name === 'AbortError') {
    return { code: 'network', message: 'The search was cancelled.' };
  }
  return { code: 'network', message: 'The server could not be reached.' };
}

/**
 * The artwork of a result.
 *
 * Only the image hosts of YouTube are used, so a broken or hostile answer
 * can not put an arbitrary address into the page.
 */
function safeThumbnail(value: unknown, id: string): string {
  const fallback = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  if (typeof value !== 'string' || !value.startsWith('https://')) return fallback;
  try {
    const host = new URL(value).hostname.toLowerCase();
    const allowed =
      host === 'i.ytimg.com' ||
      host.endsWith('.ytimg.com') ||
      host === 'img.youtube.com' ||
      host === 'yt3.ggpht.com';
    return allowed ? value : fallback;
  } catch {
    return fallback;
  }
}

/** The shape of a result that the frontend accepts. */
function toResult(value: any): SearchResult | null {
  if (!value || typeof value !== 'object') return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const duration = Number(value.durationSeconds);
  return {
    id,
    title: typeof value.title === 'string' && value.title ? value.title : id,
    channel: typeof value.channel === 'string' ? value.channel : '',
    thumbnail: safeThumbnail(value.thumbnail, id),
    durationSeconds: Number.isFinite(duration) ? duration : null,
  };
}

/** Reads the answer of the backend, whatever went wrong. */
async function readAnswer(response: Response): Promise<any> {
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code = (body?.error?.code || 'unknown') as SearchErrorCode;
    const message =
      typeof body?.error?.message === 'string' && body.error.message
        ? body.error.message
        : 'The search could not be completed.';
    throw new YouTubeSearchError(code, message, response.status);
  }
  if (!body || typeof body !== 'object') {
    throw new YouTubeSearchError('bad_response', 'The answer of the server could not be read.', response.status);
  }
  return body;
}

export type SearchOptions = {
  pageToken?: string | null;
  maxResults?: number;
  signal?: AbortSignal;
  baseUrl?: string;
};

/**
 * Searches YouTube by a song name, an artist or a video title.
 *
 * The server holds the key and does the call, so the browser never spends
 * quota and never learns the key.
 */
export async function searchYouTube(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const term = typeof query === 'string' ? query.trim() : '';
  if (!term) throw new YouTubeSearchError('invalid_query', 'A search term is required.');
  const base = (options.baseUrl || API_URL).replace(/\/+$/, '');
  const params = new URLSearchParams({ q: term });
  if (options.pageToken) params.set('pageToken', options.pageToken);
  if (options.maxResults) params.set('max', String(options.maxResults));
  let response: Response;
  try {
    response = await fetch(`${base}/api/youtube/search?${params.toString()}`, {
      signal: options.signal,
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    const { code, message } = localErrorMessage(err);
    throw new YouTubeSearchError(code, message);
  }
  const body = await readAnswer(response);
  const items = Array.isArray(body.results) ? body.results : [];
  const results = items.map(toResult).filter((r: SearchResult | null): r is SearchResult => r !== null);
  const next = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : null;
  return { results, nextPageToken: next };
}

/** The details of one video, for a link that was pasted into the search. */
export async function lookupYouTubeVideo(id: string, options: SearchOptions = {}): Promise<SearchResult> {
  const videoId = typeof id === 'string' ? id.trim() : '';
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new YouTubeSearchError('invalid_request', 'That is not a video id.');
  }
  const base = (options.baseUrl || API_URL).replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetch(`${base}/api/youtube/video?id=${encodeURIComponent(videoId)}`, {
      signal: options.signal,
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    const { code, message } = localErrorMessage(err);
    throw new YouTubeSearchError(code, message);
  }
  const body = await readAnswer(response);
  const result = toResult(body?.result);
  if (!result) throw new YouTubeSearchError('not_found', 'No video was found for that id.');
  return result;
}

/** The length of a track as it is written on a cover: "3:33". */
export function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** The outcome of one request. */
export type SearchRun<T> = {
  /** True when a newer request took over: the answer must be ignored. */
  stale: boolean;
  value: T | null;
  error: unknown | null;
};

/**
 * One search at a time.
 *
 * A new request cancels the one before it, and a slow answer of an older
 * request is dropped: the results of the newest search always win, no matter
 * in which order the answers arrive.
 */
export function createSearchRequest() {
  let generation = 0;
  let controller: AbortController | null = null;

  return {
    /** Runs a request. A request that was superseded comes back as stale. */
    async run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<SearchRun<T>> {
      const mine = ++generation;
      controller?.abort();
      const own = new AbortController();
      controller = own;
      try {
        const value = await fn(own.signal);
        if (mine !== generation) return { stale: true, value: null, error: null };
        return { stale: false, value, error: null };
      } catch (error) {
        if (mine !== generation) return { stale: true, value: null, error: null };
        return { stale: false, value: null, error };
      } finally {
        if (controller === own) controller = null;
      }
    },
    /** Stops the running request, so its answer is ignored. */
    cancel() {
      generation += 1;
      controller?.abort();
      controller = null;
    },
    /** True while a request is running. */
    get pending() {
      return controller !== null;
    },
  };
}
