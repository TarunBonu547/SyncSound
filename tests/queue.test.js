/**
 * Queue and playback test: the commands the interface sends.
 *
 * The test covers the commands of the redesigned interface that no other test
 * touches: moving a track, taking a track out, the play/pause command and the
 * report that a track ended.
 *
 * The tests talk to a running backend, so start it first:
 *   node backend/server.js
 *   node tests/queue.test.js
 */
import { io } from 'socket.io-client';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';

let failures = 0;
function check(name, cond, extra) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  const socket = io(BACKEND, { transports: ['websocket'], reconnection: false });
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('the backend did not answer')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      res(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      rej(err);
    });
  });
}

/** Emits an event and waits for the answer of the server. */
function ask(socket, event, payload) {
  return new Promise((res) => {
    const timer = setTimeout(() => {
      console.log(`  (the server did not answer "${event}")`);
      res({ ok: false, error: 'timeout' });
    }, 4000);
    socket.emit(event, payload, (answer) => {
      clearTimeout(timer);
      res(answer);
    });
  });
}

/** Collects every event of a kind until the test stops it. */
function collect(socket, event) {
  const list = [];
  socket.on(event, (payload) => list.push(payload));
  return list;
}

const HOST_ID = 'client-queue-host-01';
const GUEST_ID = 'client-queue-guest-02';

const VIDEO_A = 'dQw4w9WgXcQ';
const VIDEO_B = 'aaaaaaaaaaa';
const VIDEO_C = 'bbbbbbbbbbb';

(async () => {
  let host;
  let guest;
  try {
    host = await connect();
    guest = await connect();

    const created = await ask(host, 'create-room', { name: 'Queue Test', clientId: HOST_ID });
    check('the room is created', created.ok === true, created);
    const code = created.code;
    const joined = await ask(guest, 'join-room', { code, clientId: GUEST_ID });
    check('the guest joined the room', joined.ok === true, joined);

    const queueUpdates = collect(guest, 'queue-update');
    const playbackUpdates = collect(guest, 'playback-update');

    // --- three tracks enter the queue ------------------------------------------
    const first = await ask(host, 'QUEUE_ADD', {
      code,
      item: { videoId: VIDEO_A, title: 'First', channel: 'One', duration: 210 },
    });
    check('the first track enters the queue', first.ok === true, first);
    const second = await ask(host, 'QUEUE_ADD', {
      code,
      item: { videoId: VIDEO_B, title: 'Second', channel: 'Two', duration: 120 },
    });
    check('the second track enters the queue', second.ok === true, second);
    const third = await ask(host, 'QUEUE_ADD', {
      code,
      item: { videoId: VIDEO_C, title: 'Third', channel: 'Three', duration: 60 },
    });
    check('the third track enters the queue', third.ok === true, third);
    await sleep(200);
    const queue = queueUpdates[queueUpdates.length - 1].queue;
    check('the guest sees three tracks', queue.length === 3, queue.length);
    check(
      'the queue keeps the order of the room',
      queue[0].videoId === VIDEO_A && queue[1].videoId === VIDEO_B && queue[2].videoId === VIDEO_C,
      queue.map((item) => item.videoId),
    );

    // --- a track moves one place up ---------------------------------------------
    host.emit('QUEUE_REORDER', { code, itemId: third.item.id, toIndex: 1 });
    await sleep(250);
    const moved = queueUpdates[queueUpdates.length - 1].queue;
    check(
      'the moved track has the new place',
      moved[1] && moved[1].id === third.item.id,
      moved.map((item) => item.videoId),
    );
    check('the other tracks kept their place', moved[0].id === first.item.id && moved[2].id === second.item.id, moved);

    // --- a track is taken out ---------------------------------------------------
    host.emit('QUEUE_REMOVE', { code, itemId: second.item.id });
    await sleep(250);
    const removed = queueUpdates[queueUpdates.length - 1].queue;
    check('the track is out of the queue', removed.length === 2, removed.length);
    check('the other tracks are still there', !removed.some((item) => item.id === second.item.id), removed);

    // --- a track starts ---------------------------------------------------------
    const played = await ask(host, 'QUEUE_PLAY', { code, itemId: first.item.id });
    check('the track starts', played.ok === true, played);
    await sleep(200);
    const playing = playbackUpdates[playbackUpdates.length - 1];
    check('the guest hears the track', playing && playing.videoId === VIDEO_A, playing);
    check('the guest knows what is playing', playing && playing.currentQueueItemId === first.item.id, playing);
    check('the room is playing', playing && playing.playing === true, playing);

    // --- the room is paused and moved --------------------------------------------
    const paused = await ask(host, 'PLAYBACK_UPDATE', {
      code,
      videoId: VIDEO_A,
      playing: false,
      position: 42.5,
      clientRevision: playing.revision,
    });
    check('the pause is accepted', paused.ok === true, paused);
    check('the pause brings a new revision', paused.revision > playing.revision, paused);
    await sleep(200);
    const afterPause = playbackUpdates[playbackUpdates.length - 1];
    check('the room is paused', afterPause && afterPause.playing === false, afterPause);
    check('the room keeps the position', afterPause && Math.abs(afterPause.position - 42.5) < 0.01, afterPause);

    // --- a track that ended -------------------------------------------------------
    const ended = await ask(host, 'TRACK_ENDED', {
      code,
      videoId: VIDEO_A,
      transitionId: playing.transitionId,
      position: 210,
    });
    check('the end of the track is accepted', ended.ok === true, ended);
    check('the room moved on to the next track', ended.advanced === true, ended);
    await sleep(200);
    const afterEnd = playbackUpdates[playbackUpdates.length - 1];
    check('the guest hears the next track', afterEnd && afterEnd.videoId !== VIDEO_A, afterEnd);

    // --- a command of a stranger is refused ----------------------------------------
    const stranger = await connect();
    const refused = await ask(stranger, 'PLAYBACK_UPDATE', {
      code,
      videoId: VIDEO_A,
      playing: true,
      position: 0,
    });
    check('a command of a stranger is refused', refused.ok === false, refused);
    stranger.close();
  } catch (err) {
    failures++;
    console.log('FAIL  the test crashed ->', err && err.message);
  } finally {
    [host, guest].forEach((s) => s && s.close());
  }

  console.log(failures === 0 ? '\nALL QUEUE CHECKS PASSED' : `\n${failures} QUEUE CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
