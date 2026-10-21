/**
 * The YouTube search of the backend.
 *
 * The test starts a stub of the YouTube API and a backend that talks to it,
 * so neither a key nor a quota is needed:
 *   node tests/youtube-search.test.js
 */
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { io } from 'socket.io-client';
import roomStateModule from '../backend/roomState.js';

const { RoomState } = roomStateModule;

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(here, '..', 'backend');

let failures = 0;
function check(name, cond, extra) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The key of the test. It must never appear in an answer or in a log. */
const API_KEY = 'test-key-do-not-leak-123';

/** The stub of the YouTube Data API. */
function startStub() {
  const seen = { searches: [], videos: [], paths: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const q = url.searchParams.get('q') || '';
    const key = url.searchParams.get('key');
    seen.paths.push(url.pathname);
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };

    if (key !== API_KEY) {
      json(400, {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          errors: [{ reason: 'keyInvalid', message: 'API key not valid' }],
        },
      });
      return;
    }

    if (url.pathname === '/search') {
      seen.searches.push({
        q,
        pageToken: url.searchParams.get('pageToken'),
        maxResults: url.searchParams.get('maxResults'),
        type: url.searchParams.get('type'),
        embeddable: url.searchParams.get('videoEmbeddable'),
      });
      if (q.includes('quota')) {
        json(403, {
          error: {
            code: 403,
            message: 'The request cannot be completed because you have exceeded your quota.',
            errors: [{ reason: 'quotaExceeded', message: 'Quota exceeded' }],
          },
        });
        return;
      }
      if (q.includes('forbidden')) {
        json(403, {
          error: {
            code: 403,
            message: 'The request cannot be completed because you have exceeded your quota.',
            errors: [{ reason: 'quotaExceeded', message: 'Quota exceeded' }],
          },
        });
        return;
      }
      if (q.includes('badkey')) {
        json(400, {
          error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
            errors: [{ domain: 'usageLimits', reason: 'keyInvalid', message: 'API key not valid. Please pass a valid API key.' }],
          },
        });
        return;
      }
      if (q.includes('disabled')) {
        json(403, {
          error: {
            code: 403,
            message: 'YouTube Data API v3 has not been used in project 1234567890 before or it is disabled.',
            errors: [{ domain: 'usageLimits', reason: 'accessNotConfigured', message: 'Access Not Configured' }],
          },
        });
        return;
      }
      if (q.includes('denied')) {
        json(403, {
          error: {
            code: 403,
            message: 'The request is not allowed.',
            errors: [{ domain: 'global', reason: 'forbidden', message: 'Forbidden' }],
          },
        });
        return;
      }
      if (q.includes('malformed')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{ this is not json');
        return;
      }
      if (q.includes('network')) {
        req.socket.destroy();
        return;
      }
      if (q.includes('empty')) {
        json(200, { items: [] });
        return;
      }
      if (!url.searchParams.get('pageToken')) {
        json(200, {
          nextPageToken: 'PAGE-2',
          items: [
            {
              id: { videoId: 'aaaaaaaaaaa' },
              snippet: {
                title: 'Never Gonna Give You Up &amp; more &#39;live&#39;',
                channelTitle: 'Rick Astley',
                thumbnails: { medium: { url: 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg' } },
              },
            },
            {
              id: { videoId: 'bbbbbbbbbbb' },
              snippet: {
                title: 'Second result',
                channelTitle: 'Another channel',
                thumbnails: { high: { url: 'https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg' } },
              },
            },
          ],
        });
        return;
      }
      json(200, {
        items: [
          {
            id: { videoId: 'ccccccccccc' },
            snippet: { title: 'Third result', channelTitle: 'Third channel', thumbnails: {} },
          },
        ],
      });
      return;
    }

    if (url.pathname === '/videos') {
      const ids = (url.searchParams.get('id') || '').split(',').filter(Boolean);
      seen.videos.push(ids);
      json(200, {
        items: ids.map((id) => ({
          id,
          contentDetails: { duration: id === 'aaaaaaaaaaa' ? 'PT3M33S' : 'PT1H2M3S' },
          snippet: {
            title: 'Never Gonna Give You Up &amp; more &#39;live&#39;',
            channelTitle: 'Rick Astley',
            thumbnails: { high: { url: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg' } },
          },
        })),
      });
      return;
    }

    json(404, { error: { code: 404, message: 'Not found' } });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, seen, port: server.address().port });
    });
  });
}

/** A backend that talks to the stub instead of to YouTube. */
async function startBackend(port, apiBase) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(port),
      YOUTUBE_API_KEY: API_KEY,
      YOUTUBE_API_BASE_URL: apiBase,
      YOUTUBE_SEARCH_CACHE_MS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (data) => {
    log += data.toString();
  });
  child.stderr.on('data', (data) => {
    log += data.toString();
  });
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return { child, log: () => log };
    } catch {
      /* the backend is not up yet */
    }
    await sleep(150);
  }
  throw new Error('the backend did not start');
}

/** A call of the search endpoint. */
async function search(port, params) {
  const response = await fetch(`http://127.0.0.1:${port}/api/youtube/search?${new URLSearchParams(params)}`);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body, text: JSON.stringify(body) };
}

/** A socket that talks to a backend. */
function connect(port) {
  const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the backend did not answer')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Emits an event and waits for the answer of the server. */
function ask(socket, event, payload) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 5000);
    socket.emit(event, payload, (answer) => {
      clearTimeout(timer);
      resolve(answer);
    });
  });
}

(async () => {
  const stub = await startStub();
  const port = 4300 + Math.floor(Math.random() * 200);
  let backend = null;
  try {
    backend = await startBackend(port, `http://127.0.0.1:${stub.port}`);

    // --- the query is checked ---------------------------------------------
    const empty = await search(port, { q: '' });
    check('an empty query is refused', empty.status === 400 && empty.body?.error?.code === 'invalid_query', empty);

    const blank = await search(port, { q: '   ' });
    check('a blank query is refused', blank.status === 400 && blank.body?.error?.code === 'invalid_query', blank);

    const missing = await fetch(`http://127.0.0.1:${port}/api/youtube/search`);
    check('a missing query is refused', missing.status === 400, missing.status);

    const tooLong = await search(port, { q: 'x'.repeat(300) });
    check('a long query is refused', tooLong.status === 400 && tooLong.body?.error?.code === 'invalid_query', tooLong.status);

    const trimmed = await search(port, { q: '  rick astley  ' });
    check('the query is trimmed', trimmed.status === 200 && stub.seen.searches.at(-1).q === 'rick astley', stub.seen.searches.at(-1));

    // --- the results are mapped -------------------------------------------
    const found = await search(port, { q: 'rick astley' });
    const results = found.body?.results || [];
    check('the search answers with results', found.status === 200 && results.length === 2, found.status);
    check('the result has the video id', results[0]?.id === 'aaaaaaaaaaa', results[0]?.id);
    check('the title is readable', results[0]?.title === "Never Gonna Give You Up & more 'live'", results[0]?.title);
    check('the channel is there', results[0]?.channel === 'Rick Astley', results[0]?.channel);
    check('the artwork is there', /^https:\/\/i\.ytimg\.com\//.test(results[0]?.thumbnail || ''), results[0]?.thumbnail);
    check('the length is there', results[0]?.durationSeconds === 213, results[0]?.durationSeconds);
    check('the second length is there', results[1]?.durationSeconds === 3723, results[1]?.durationSeconds);
    check('the next page is announced', found.body?.nextPageToken === 'PAGE-2', found.body?.nextPageToken);
    check('only videos that can be embedded are asked for', stub.seen.searches.at(-1).embeddable === 'true', stub.seen.searches.at(-1));

    // --- the pages ---------------------------------------------------------
    const second = await search(port, { q: 'rick astley', pageToken: 'PAGE-2' });
    check('the page token is passed on', stub.seen.searches.at(-1).pageToken === 'PAGE-2', stub.seen.searches.at(-1));
    check('the second page has its own result', second.body?.results?.[0]?.id === 'ccccccccccc', second.body?.results);
    check('the last page has no next page', second.body?.nextPageToken === null, second.body?.nextPageToken);

    const badToken = await search(port, { q: 'rick astley', pageToken: 'not a token!' });
    check('a broken page token is refused', badToken.status === 400 && badToken.body?.error?.code === 'invalid_page_token', badToken.status);

    // --- nothing found ------------------------------------------------------
    const none = await search(port, { q: 'empty results please' });
    check('a search without results answers empty', none.status === 200 && none.body?.results?.length === 0, none.body);

    // --- the failures of the upstream --------------------------------------
    const quota = await search(port, { q: 'quota please' });
    check('a used up quota is reported', quota.status === 429 && quota.body?.error?.code === 'quota', quota);
    check('the quota message is safe', /quota/i.test(quota.body?.error?.message || ''), quota.body?.error?.message);

    const forbidden = await search(port, { q: 'badkey please' });
    check('an invalid key is reported', forbidden.status === 401 && forbidden.body?.error?.code === 'invalid_api_key', forbidden);

    const disabled = await search(port, { q: 'disabled please' });
    check('a disabled API is reported', disabled.status === 503 && disabled.body?.error?.code === 'api_disabled', disabled);

    const denied = await search(port, { q: 'denied please' });
    check('a refused request is reported', denied.status === 401 && denied.body?.error?.code === 'invalid_api_key', denied);

    const malformed = await search(port, { q: 'malformed please' });
    check('a broken answer is reported', malformed.status === 502 && malformed.body?.error?.code === 'bad_response', malformed);

    const network = await search(port, { q: 'network please' });
    check('an unreachable YouTube is reported', network.status === 502 && network.body?.error?.code === 'network', network);

    // --- the key stays in the server ---------------------------------------
    const secret = await search(port, { q: 'rick astley' });
    check('the answer does not carry the key', !secret.text.includes(API_KEY), secret.text);
    check('the log does not carry the key', !backend.log().includes(API_KEY), backend.log().slice(0, 200));

    // --- a client can not aim the server at another address -----------------
    const aimed = await search(port, { q: 'rick astley', url: 'http://127.0.0.1:1/evil' });
    check('a client can not choose the address', aimed.status === 200, aimed.status);
    check('the server only calls YouTube', stub.seen.paths.every((p) => p === '/search' || p === '/videos'), [...new Set(stub.seen.paths)]);

    // --- the number of results is limited ------------------------------------
    const many = await search(port, { q: 'rick astley', max: '100' });
    check('the number of results is limited', Number(stub.seen.searches.at(-1).maxResults) <= 25, stub.seen.searches.at(-1).maxResults);
    check('the search still answers', many.status === 200, many.status);

    // --- the video of a link -------------------------------------------------
    const video = await fetch(`http://127.0.0.1:${port}/api/youtube/video?id=aaaaaaaaaaa`);
    const videoBody = await video.json();
    check('a video is looked up', video.status === 200 && videoBody?.result?.id === 'aaaaaaaaaaa', videoBody);
    check('the video has its length', videoBody?.result?.durationSeconds === 213, videoBody?.result?.durationSeconds);

    const badVideo = await fetch(`http://127.0.0.1:${port}/api/youtube/video?id=nope`);
    check('a broken video id is refused', badVideo.status === 400, badVideo.status);

    // --- a selected result goes into the queue ------------------------------
    const socket = await connect(port);
    const guest = await connect(port);
    const created = await ask(socket, 'create-room', { name: 'Search test', clientId: 'client-search-0001' });
    const code = created.code;
    check('the room of the queue test is open', !!code, created);

    const selected = results[0];
    const added = await ask(socket, 'QUEUE_ADD', {
      code,
      item: {
        videoId: selected.id,
        title: 'A title the client made up',
        channel: 'A channel the client made up',
        thumbnail: 'https://example.com/not-youtube.jpg',
        duration: 9999,
      },
    });
    check('the selected result enters the queue', added.ok === true, added);
    check('the server brings its own title', added.item?.title === "Never Gonna Give You Up & more 'live'", added.item?.title);
    check('the server brings its own channel', added.item?.channel === 'Rick Astley', added.item?.channel);
    check('the server brings the real length', added.item?.durationSeconds === 213, added.item?.durationSeconds);

    const played = await ask(socket, 'QUEUE_PLAY', { code, itemId: added.item.id });
    check('the selected result plays for the room', played.ok === true && played.playback?.videoId === selected.id, played.playback);

    const joined = await ask(guest, 'join-room', { code, clientId: 'client-search-0002' });
    check('the guest sees the track in the queue', joined.queue?.length === 1 && joined.queue[0].videoId === selected.id, joined.queue);
    check('the guest sees the track playing', joined.playback?.videoId === selected.id && joined.playback?.playing === true, joined.playback);
    socket.close();
    guest.close();

    // --- the queue item is checked by the server ----------------------------
    const room = new RoomState('SS-TEST01', 'Test');
    const checked = room.validateItem({
      videoId: 'aaaaaaaaaaa',
      title: '   ',
      channel: 'x'.repeat(300),
      thumbnail: 'https://example.com/x.jpg',
    });
    check('a blank title becomes the video id', checked.title === 'aaaaaaaaaaa', checked.title);
    check('a long channel is cut', checked.channel.length === 200, checked.channel.length);
    check('a foreign artwork is refused', checked.thumbnailUrl === 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg', checked.thumbnailUrl);
    const wrongId = room.validateItem({ videoId: 'nope', title: 'x' });
    check('a broken video id is refused', wrongId === null, wrongId);

    // --- the backend is still alive -------------------------------------------
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    check('the backend survived every failure', health.ok, health.status);

    console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL YOUTUBE SEARCH CHECKS PASSED');
    process.exitCode = failures ? 1 : 0;
  } catch (err) {
    console.error('TEST ERROR', err);
    process.exitCode = 1;
  } finally {
    if (backend) backend.child.kill();
    stub.server.close();
  }
})();
