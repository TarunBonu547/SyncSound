'use strict';

/**
 * The YouTube Data API v3.
 *
 * The API key lives only in the environment of the backend. The browser never
 * sees it: the frontend asks this backend, the backend asks YouTube. That is
 * the only way to keep a quota of 100 units per search away from the client.
 */

const DEFAULT_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_TIMEOUT_MS = 8000;
/** YouTube itself refuses longer search terms. */
const MAX_QUERY_LENGTH = 100;
const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS = 25;
/** A page token of YouTube is an opaque base64-ish string. */
const PAGE_TOKEN_RE = /^[A-Za-z0-9_=-]{1,512}$/;
/** A video id is eleven characters of letters, digits, dash and underscore. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * A failure of the search with a status code and a code the frontend can
 * react on. The message is always a static, user safe sentence: nothing of
 * the upstream answer (which may contain the key) is ever forwarded.
 */
class YouTubeApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'YouTubeApiError';
    this.status = status;
    this.code = code;
  }
}

/** The key of the server, never exposed to a client. */
function apiKey() {
  return String(process.env.YOUTUBE_API_KEY || '').trim();
}

/** True when the server may talk to YouTube at all. */
function isConfigured() {
  return apiKey().length > 0;
}

/**
 * The base of the YouTube API. It can be pointed somewhere else for tests
 * (a local stub), but it is never taken from a request: a client can not
 * make the server call an arbitrary address.
 */
function baseUrl() {
  return String(process.env.YOUTUBE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/** The artwork of a video, even when YouTube does not send one. */
function thumbnailFor(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/**
 * YouTube sends titles with HTML entities in them. They are decoded here, so
 * the client gets the text a person would read.
 */
function decodeEntities(value) {
  if (typeof value !== 'string' || value.indexOf('&') === -1) return value;
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code) => {
    if (code[0] === '#') {
      const number = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(number) || number < 0 || number > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(number);
      } catch {
        return whole;
      }
    }
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
    const key = code.toLowerCase();
    return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : whole;
  });
}

/** The length of a video, as YouTube writes it: "PT3M33S". */
function parseIsoDuration(value) {
  if (typeof value !== 'string') return null;
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value.trim());
  if (!match) return null;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

/** The best thumbnail YouTube offered, with the known size as a fallback. */
function pickThumbnail(thumbnails, id) {
  const list = thumbnails && typeof thumbnails === 'object' ? thumbnails : {};
  const source = list.high || list.medium || list.standard || list.default;
  if (source && typeof source.url === 'string' && source.url.startsWith('https://')) return source.url;
  return thumbnailFor(id);
}

/** A search result, in the shape the frontend expects. */
function mapSearchItem(item) {
  const id = item && item.id && typeof item.id.videoId === 'string' ? item.id.videoId : '';
  if (!VIDEO_ID_RE.test(id)) return null;
  const snippet = item.snippet || {};
  return {
    id,
    title: decodeEntities(String(snippet.title || id)).slice(0, 200),
    channel: decodeEntities(String(snippet.channelTitle || '')).slice(0, 200),
    thumbnail: pickThumbnail(snippet.thumbnails, id),
    durationSeconds: null,
  };
}

/** A video of the details endpoint, in the same shape. */
function mapVideoItem(item) {
  const id = item && typeof item.id === 'string' ? item.id : '';
  if (!VIDEO_ID_RE.test(id)) return null;
  const snippet = item.snippet || {};
  return {
    id,
    title: decodeEntities(String(snippet.title || id)).slice(0, 200),
    channel: decodeEntities(String(snippet.channelTitle || '')).slice(0, 200),
    thumbnail: pickThumbnail(snippet.thumbnails, id),
    durationSeconds: parseIsoDuration(item?.contentDetails?.duration),
  };
}

/**
 * The reason of an upstream failure, without its text: the text of an
 * upstream error may repeat the key, so it is never logged or sent on.
 */
function upstreamReason(status, body) {
  const errors = body && body.error && Array.isArray(body.error.errors) ? body.error.errors : [];
  const reason = errors.length && typeof errors[0].reason === 'string' ? errors[0].reason : '';
  const message = body && body.error && typeof body.error.message === 'string' ? body.error.message : '';
  // The reason of YouTube comes first: it says what really went wrong.
  if (/^(quotaExceeded|dailyLimitExceeded|rateLimitExceeded|userRateLimitExceeded)$/.test(reason)) return 'quota';
  if (/^(keyInvalid|keyNotValid)$/.test(reason)) return 'invalid_api_key';
  if (reason === 'invalidPageToken') return 'invalid_page_token';
  if (/^(accessNotConfigured|serviceDisabled)$/.test(reason)) return 'api_disabled';
  if (/api key not valid|key is not valid/i.test(message)) return 'invalid_api_key';
  if (/has not been used in project|is disabled|not enabled/i.test(message)) return 'api_disabled';
  if (/quota/i.test(reason) || /quota/i.test(message)) return 'quota';
  if (status === 401 || status === 403) return 'invalid_api_key';
  if (status === 400) return 'invalid_request';
  return 'upstream';
}

/** The answer of the upstream for a reason, safe to show and to log. */
function errorForReason(reason) {
  switch (reason) {
    case 'quota':
      return new YouTubeApiError(429, 'quota', 'The YouTube search quota is used up. Please try again later.');
    case 'invalid_api_key':
      return new YouTubeApiError(401, 'invalid_api_key', 'The YouTube API key of the server is not valid.');
    case 'api_disabled':
      return new YouTubeApiError(503, 'api_disabled', 'The YouTube Data API is not enabled for this project.');
    case 'invalid_page_token':
      return new YouTubeApiError(400, 'invalid_page_token', 'The page token is not valid.');
    case 'invalid_request':
      return new YouTubeApiError(400, 'invalid_request', 'The search request was refused by YouTube.');
    case 'timeout':
      return new YouTubeApiError(504, 'timeout', 'YouTube took too long to answer.');
    case 'network':
      return new YouTubeApiError(502, 'network', 'YouTube could not be reached.');
    case 'bad_response':
      return new YouTubeApiError(502, 'bad_response', 'The answer of YouTube could not be read.');
    default:
      return new YouTubeApiError(502, 'upstream', 'YouTube could not answer the search.');
  }
}

/**
 * One call to the YouTube API.
 *
 * The key only ever travels in the query of the request to the YouTube host.
 * Neither the URL nor the answer is logged.
 */
async function request(path, params, { fetchImpl, timeoutMs } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new YouTubeApiError(503, 'api_unavailable', 'This server can not talk to YouTube.');
  }
  const url = new URL(`${baseUrl()}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set('key', apiKey());

  const controller = new AbortController();
  const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), limit);
  let response;
  try {
    response = await doFetch(url.toString(), {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') throw errorForReason('timeout');
    throw errorForReason('network');
  }
  clearTimeout(timer);

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw errorForReason(upstreamReason(response.status, body));
  }
  if (!body || typeof body !== 'object') {
    throw errorForReason('bad_response');
  }
  return body;
}

/** The lengths of the videos of a page, so the results can show them. */
async function fetchDurations(ids, options) {
  if (!ids.length) return new Map();
  try {
    const body = await request(
      'videos',
      { part: 'contentDetails', id: ids.join(','), maxResults: Math.min(ids.length, 50) },
      options,
    );
    const map = new Map();
    const items = Array.isArray(body.items) ? body.items : [];
    for (const item of items) {
      if (!item || typeof item.id !== 'string') continue;
      const seconds = parseIsoDuration(item?.contentDetails?.duration);
      if (seconds !== null) map.set(item.id, seconds);
    }
    return map;
  } catch {
    // The lengths are a nice to have: a failure here must not lose the
    // results of the search itself.
    return new Map();
  }
}

/**
 * The same search twice spends the quota twice, so a short answer is kept in
 * memory. The cache lives in the process and dies with it.
 */
const cache = new Map();
const CACHE_TTL_MS = Number(process.env.YOUTUBE_SEARCH_CACHE_MS ?? 60000);
const CACHE_MAX_ENTRIES = 40;

function cacheGet(key) {
  const ttl = Number(process.env.YOUTUBE_SEARCH_CACHE_MS ?? CACHE_TTL_MS);
  if (!Number.isFinite(ttl) || ttl <= 0) return null;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > ttl) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  const ttl = Number(process.env.YOUTUBE_SEARCH_CACHE_MS ?? CACHE_TTL_MS);
  if (!Number.isFinite(ttl) || ttl <= 0) return;
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { at: Date.now(), value });
}

/** The number of results of a page, inside the limits. */
function readMaxResults(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_MAX_RESULTS;
  return Math.min(MAX_RESULTS, Math.max(1, Math.floor(number)));
}

/**
 * Searches YouTube by text.
 *
 * The query is trimmed and checked, the page token is checked, and the number
 * of results is limited. Every failure leaves through a YouTubeApiError, so
 * the caller never has to read a raw upstream answer.
 */
async function searchVideos({ query, pageToken, maxResults } = {}, options = {}) {
  if (!isConfigured()) {
    throw new YouTubeApiError(503, 'api_unavailable', 'The YouTube search is not configured on this server.');
  }
  const term = typeof query === 'string' ? query.trim() : '';
  if (!term) {
    throw new YouTubeApiError(400, 'invalid_query', 'A search term is required.');
  }
  if (term.length > MAX_QUERY_LENGTH) {
    throw new YouTubeApiError(400, 'invalid_query', `The search term is too long (max ${MAX_QUERY_LENGTH} characters).`);
  }
  const token = typeof pageToken === 'string' ? pageToken.trim() : '';
  if (token && !PAGE_TOKEN_RE.test(token)) {
    throw new YouTubeApiError(400, 'invalid_page_token', 'The page token is not valid.');
  }
  const limit = readMaxResults(maxResults);
  const key = `${term} ${token} ${limit}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const body = await request(
    'search',
    {
      part: 'snippet',
      type: 'video',
      // A video that can not be embedded can not be played by the room.
      videoEmbeddable: 'true',
      q: term,
      maxResults: limit,
      ...(token ? { pageToken: token } : {}),
    },
    options,
  );

  const items = Array.isArray(body.items) ? body.items : [];
  const results = items.map(mapSearchItem).filter(Boolean);
  const durations = await fetchDurations(results.map((r) => r.id), options);
  for (const result of results) {
    const seconds = durations.get(result.id);
    if (seconds !== undefined && seconds !== null) result.durationSeconds = seconds;
  }
  const next = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : null;
  const answer = { results, nextPageToken: next };
  cacheSet(key, answer);
  return answer;
}

/**
 * The details of one video. It is used to look a link up and to give the
 * queue a title that the server knows.
 */
async function getVideo(id, options = {}) {
  if (!isConfigured()) {
    throw new YouTubeApiError(503, 'api_unavailable', 'The YouTube search is not configured on this server.');
  }
  const videoId = typeof id === 'string' ? id.trim() : '';
  if (!VIDEO_ID_RE.test(videoId)) {
    throw new YouTubeApiError(400, 'invalid_video_id', 'That is not a video id.');
  }
  const body = await request('videos', { part: 'snippet,contentDetails', id: videoId, maxResults: 1 }, options);
  const items = Array.isArray(body.items) ? body.items : [];
  const result = items.length ? mapVideoItem(items[0]) : null;
  if (!result) {
    throw new YouTubeApiError(404, 'not_found', 'No video was found for that id.');
  }
  return result;
}

module.exports = {
  YouTubeApiError,
  isConfigured,
  searchVideos,
  getVideo,
  parseIsoDuration,
  decodeEntities,
  thumbnailFor,
  MAX_QUERY_LENGTH,
  MAX_RESULTS,
  DEFAULT_MAX_RESULTS,
};
