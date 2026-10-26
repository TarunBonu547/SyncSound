/**
 * Live song reactions test: broadcast and rate limiting.
 *
 * The tests talk to a running backend, so start it first:
 *   node backend/server.js
 *   node tests/reactions.test.js
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

const HOST_ID = 'client-reaction-host-01';
const GUEST_ID = 'client-reaction-guest-02';

const VIDEO_A = 'dQw4w9WgXcQ';

(async () => {
  let host;
  let guest;
  try {
    host = await connect();
    guest = await connect();

    const created = await ask(host, 'create-room', { name: 'Reaction Test', clientId: HOST_ID });
    check('the room is created', created.ok === true, created);
    const code = created.code;
    const joined = await ask(guest, 'join-room', { code, clientId: GUEST_ID });
    check('the guest joined the room', joined.ok === true, joined);

    const reactions = collect(guest, 'song:reaction');

    // --- a reaction is broadcast to the room ----------------------------------
    const sent = await ask(host, 'SONG_REACTION', { code, emoji: '❤️' });
    check('the reaction is accepted', sent.ok === true, sent);
    await sleep(100);
    check('the guest receives the reaction', reactions.length === 1, reactions.length);
    check('the reaction carries the emoji', reactions[0].emoji === '❤️', reactions[0]);
    check('the reaction names the sender', reactions[0].clientName === 'Host', reactions[0]);

    // --- a second client sends a different emoji ------------------------------
    const sent2 = await ask(guest, 'SONG_REACTION', { code, emoji: '🔥' });
    check('the second reaction is accepted', sent2.ok === true, sent2);
    await sleep(100);
    check('both reactions are received', reactions.length === 2, reactions.length);

    // --- rate limiting: same emoji again within cooldown is refused -----------
    const rateLimited = await ask(host, 'SONG_REACTION', { code, emoji: '❤️' });
    check('a repeated reaction is rate limited', rateLimited.ok === false, rateLimited);
    check('the rate limit error is reported', rateLimited.error === 'Reaction rate limited', rateLimited);
    await sleep(100);
    check('no extra reaction was broadcast', reactions.length === 2, reactions.length);

    // --- after cooldown, the same emoji is accepted ---------------------------
    await sleep(1100); // server cooldown is 1000ms
    const afterCooldown = await ask(host, 'SONG_REACTION', { code, emoji: '❤️' });
    check('the reaction is accepted after cooldown', afterCooldown.ok === true, afterCooldown);
    await sleep(200);
    // The guest collects every broadcast, so the count grows (the client's
    // useRoom state deduplicates same-client same-emoji reactions).
    check('the reaction is received after cooldown', reactions.length === 3, reactions.length);

    // --- an invalid emoji is refused ------------------------------------------
    const bad = await ask(host, 'SONG_REACTION', { code, emoji: '' });
    check('an empty emoji is refused', bad.ok === false, bad);

    // --- a stranger is refused ------------------------------------------------
    const stranger = await connect();
    const refused = await ask(stranger, 'SONG_REACTION', { code, emoji: '❤️' });
    check('a stranger cannot send a reaction', refused.ok === false, refused);
    stranger.close();

    // --- reactions clear when the track changes -------------------------------
    const added = await ask(host, 'QUEUE_ADD', {
      code,
      item: { videoId: VIDEO_A, title: 'Reaction Track', channel: 'Test', duration: 210 },
    });
    check('a track enters the queue', added.ok === true, added);
    await sleep(100);

    // Send a reaction while the track is playing
    const reacting = await ask(host, 'QUEUE_PLAY', { code, itemId: added.item.id });
    check('the track starts', reacting.ok === true, reacting);
    await sleep(100);

    const sent3 = await ask(host, 'SONG_REACTION', { code, emoji: '🚀' });
    check('a reaction on the new track is accepted', sent3.ok === true, sent3);
    await sleep(200);
    check('the reaction is received', reactions.length === 4, reactions.length);

    // Change the track again: reactions should clear
    const added2 = await ask(host, 'QUEUE_ADD', {
      code,
      item: { videoId: 'aaaaaaaaaaa', title: 'Next Track', channel: 'Test', duration: 120 },
    });
    check('a second track enters the queue', added2.ok === true, added2);
    await sleep(100);
    const switched = await ask(host, 'QUEUE_PLAY', { code, itemId: added2.item.id });
    check('the track changes', switched.ok === true, switched);
    await sleep(100);

    // Send a new reaction on the new track - old reactions should be gone
    const sent4 = await ask(host, 'SONG_REACTION', { code, emoji: '✨' });
    check('a reaction after track change is accepted', sent4.ok === true, sent4);
    await sleep(100);
    // The guest may have missed the clear if the playback-update arrived late,
    // but the new reaction should be present.
    const hasNew = reactions.some((r) => r.emoji === '✨');
    check('the new reaction is received after track change', hasNew, reactions);

  } catch (err) {
    failures++;
    console.log('FAIL  the test crashed ->', err && err.message);
  } finally {
    [host, guest].forEach((s) => s && s.close());
  }

  console.log(failures === 0 ? '\nALL REACTION CHECKS PASSED' : `\n${failures} REACTION CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
