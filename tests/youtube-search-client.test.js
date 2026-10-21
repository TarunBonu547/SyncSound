/**
 * The search client of the browser.
 *
 * The module is plain typescript without react, so node can run it directly:
 *   node tests/youtube-search-client.test.js
 */
import http from 'http';
import {
  createSearchRequest,
  formatDuration,
  lookupYouTubeVideo,
  searchYouTube,
  YouTubeSearchError,
} from '../src/utils/youtubeSearch.ts';

let failures = 0;
function check(name, cond, extra) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A small server that answers like the backend of the search does. */
function startServer() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    seen.push({ path: url.pathname, query: url.searchParams.get('q'), pageToken: url.searchParams.get('pageToken') });
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/api/youtube/search') {
      if (url.searchParams.get('q') === 'quota') {
        json(429, { ok: false, error: { code: 'quota', message: 'The YouTube search quota is used up. Please try again later.' } });
        return;
      }
      if (url.searchParams.get('q') === 'broken') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('not json');
        return;
      }
      json(200, {
        ok: true,
        nextPageToken: 'NEXT',
        results: [
          { id: 'aaaaaaaaaaa', title: 'First', channel: 'One', thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg', durationSeconds: 213 },
          { id: 'not-an-id', title: 'Broken', channel: 'Two', thumbnail: 'https://example.com/x.jpg', durationSeconds: 10 },
          { id: 'bbbbbbbbbbb', title: 'Second', channel: 'Three', thumbnail: 'https://evil.example.com/x.jpg' },
        ],
      });
      return;
    }
    if (url.pathname === '/api/youtube/video') {
      json(200, { ok: true, result: { id: 'aaaaaaaaaaa', title: 'First', channel: 'One', thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg', durationSeconds: 213 } });
      return;
    }
    json(404, { ok: false, error: { code: 'not_found', message: 'No video was found for that id.' } });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

(async () => {
  const stub = await startServer();
  try {
    // --- the results of the server are read --------------------------------
    const answer = await searchYouTube('rick astley', { baseUrl: stub.base });
    check('the results are read', answer.results.length === 2, answer.results.map((r) => r.id));
    check('a broken result is dropped', !answer.results.some((r) => r.id === 'not-an-id'), answer.results.map((r) => r.id));
    check('the length is kept', answer.results[0].durationSeconds === 213, answer.results[0]);
    check('a foreign artwork is replaced', answer.results[1].thumbnail.startsWith('https://i.ytimg.com/'), answer.results[1].thumbnail);
    check('the next page is kept', answer.nextPageToken === 'NEXT', answer.nextPageToken);
    check('the term was sent', stub.seen.at(-1).query === 'rick astley', stub.seen.at(-1));

    // --- the page token is sent on ------------------------------------------
    await searchYouTube('rick astley', { baseUrl: stub.base, pageToken: 'NEXT' });
    check('the page token is sent on', stub.seen.at(-1).pageToken === 'NEXT', stub.seen.at(-1));

    // --- the failures of the server ----------------------------------------
    let quota = null;
    try {
      await searchYouTube('quota', { baseUrl: stub.base });
    } catch (err) {
      quota = err;
    }
    check('a used up quota is a failure', quota instanceof YouTubeSearchError, quota?.name);
    check('the code of the failure is kept', quota?.code === 'quota', quota?.code);
    check('the message of the failure is kept', /quota/i.test(quota?.message || ''), quota?.message);
    check('the status of the failure is kept', quota?.status === 429, quota?.status);

    let broken = null;
    try {
      await searchYouTube('broken', { baseUrl: stub.base });
    } catch (err) {
      broken = err;
    }
    check('a broken answer is a failure', broken instanceof YouTubeSearchError && broken.code === 'bad_response', broken?.code);

    // --- an empty term is refused before the server is asked ---------------
    let empty = null;
    try {
      await searchYouTube('   ', { baseUrl: stub.base });
    } catch (err) {
      empty = err;
    }
    check('an empty term is refused', empty instanceof YouTubeSearchError && empty.code === 'invalid_query', empty?.code);

    // --- the lookup of a link ----------------------------------------------
    const video = await lookupYouTubeVideo('aaaaaaaaaaa', { baseUrl: stub.base });
    check('a video is looked up', video.id === 'aaaaaaaaaaa' && video.title === 'First', video);

    let badVideo = null;
    try {
      await lookupYouTubeVideo('nope', { baseUrl: stub.base });
    } catch (err) {
      badVideo = err;
    }
    check('a broken video id is refused', badVideo instanceof YouTubeSearchError && badVideo.code === 'invalid_request', badVideo?.code);

    // --- a slow answer of an older search never wins ------------------------
    const request = createSearchRequest();
    let release = null;
    const slow = new Promise((resolve) => {
      release = resolve;
    });
    let slowSignal = null;
    const first = request.run((signal) => {
      slowSignal = signal;
      return slow;
    });
    await sleep(10);
    const second = await request.run(async () => 'new');
    check('the new search answers', second.value === 'new' && second.stale === false, second);
    check('the old request was cancelled', slowSignal?.aborted === true, slowSignal?.aborted);
    release('old');
    const firstAnswer = await first;
    check('the slow answer is dropped', firstAnswer.stale === true, firstAnswer);
    check('the slow answer does not bring a value', firstAnswer.value === null, firstAnswer.value);

    // --- a slow failure of an older search never wins ----------------------
    const request2 = createSearchRequest();
    let fail = null;
    const failing = new Promise((resolve, reject) => {
      fail = reject;
    });
    const firstFail = request2.run(() => failing);
    await sleep(10);
    await request2.run(async () => 'newer');
    fail(new Error('too late'));
    const failedAnswer = await firstFail;
    check('the slow failure is dropped', failedAnswer.stale === true && failedAnswer.error === null, failedAnswer);

    // --- a failure of the newest search is reported ------------------------
    const request3 = createSearchRequest();
    const failed = await request3.run(async () => {
      throw new Error('broken');
    });
    check('the newest failure is reported', failed.stale === false && failed.error instanceof Error, failed.error?.message);

    // --- the length of a track ---------------------------------------------
    check('a length is written as minutes and seconds', formatDuration(213) === '3:33', formatDuration(213));
    check('a long track keeps its hours', formatDuration(3723) === '1:02:03', formatDuration(3723));
    check('an unknown length is empty', formatDuration(null) === '' && formatDuration(undefined) === '', formatDuration(null));

    console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL YOUTUBE SEARCH CLIENT CHECKS PASSED');
    process.exitCode = failures ? 1 : 0;
  } catch (err) {
    console.error('TEST ERROR', err);
    process.exitCode = 1;
  } finally {
    stub.server.close();
  }
})();
