/**
 * Display name test: the name a person is seen under.
 *
 * The first part runs the module of the browser directly, the second part
 * talks to a running backend, so start it first:
 *   node backend/server.js
 *   node tests/display-name.test.js
 */
import { io } from 'socket.io-client';
import {
  MAX_DISPLAY_NAME,
  normalizeDisplayName,
  readDisplayName,
  saveDisplayName,
} from '../src/utils/displayName.ts';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';

let failures = 0;
function check(name, cond, extra) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --- the browser ------------------------------------------------------------ */

/** A storage that behaves like the one of a browser. */
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  },
};

/** A name with a control character in the middle. */
const dirtyName = `Al${String.fromCharCode(7)}ex`;

check('the maximum length is 24', MAX_DISPLAY_NAME === 24, MAX_DISPLAY_NAME);
check('a name is trimmed', normalizeDisplayName('  Alex  ') === 'Alex', normalizeDisplayName('  Alex  '));
check('a blank name is empty', normalizeDisplayName('     ') === '', normalizeDisplayName('     '));
check('a name without text is empty', normalizeDisplayName(undefined) === '');
check('the spaces of a name are normalized', normalizeDisplayName('Ada   Lovelace') === 'Ada Lovelace');
check(
  'the control characters of a name are removed',
  normalizeDisplayName(dirtyName) === 'Al ex',
  normalizeDisplayName(dirtyName),
);
check('a long name is cut', normalizeDisplayName('x'.repeat(60)).length === MAX_DISPLAY_NAME);
check('the name that is saved is clean', saveDisplayName('  Sam  ') === 'Sam');
check('the name is remembered', readDisplayName() === 'Sam', readDisplayName());
check('an empty name is forgotten', saveDisplayName('   ') === '' && readDisplayName() === '');
// A name that was stored by an older version is cleaned when it is read.
store.set('syncsound-display-name', '  Old   Name  ');
check('a stored name is cleaned when it is read', readDisplayName() === 'Old Name', readDisplayName());
saveDisplayName('');

/* --- the protocol ----------------------------------------------------------- */

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

function collect(socket, event) {
  const list = [];
  socket.on(event, (payload) => list.push(payload));
  return list;
}

const HOST_ID = 'name-host-0001';
const GUEST_ID = 'name-guest-0002';
const TWIN_ID = 'name-twin-0003';
const OLD_ID = 'name-old-0004';

(async () => {
  let host;
  let guest;
  let twin;
  let old;
  try {
    host = await connect();
    guest = await connect();
    twin = await connect();
    old = await connect();

    // --- the name of the creator ------------------------------------------------
    const created = await ask(host, 'create-room', {
      name: 'Names',
      clientId: HOST_ID,
      displayName: '  Ada Lovelace  ',
    });
    const code = created.code;
    check('the room was created', created.ok === true, created);
    check(
      'the creator is seen under the name it chose',
      created.participants[0] && created.participants[0].name === 'Ada Lovelace',
      created.participants,
    );
    check('the creator is still the host', created.isHost === true, created);

    // --- the name of a guest ----------------------------------------------------
    const joined = await ask(guest, 'join-room', { code, clientId: GUEST_ID, displayName: 'Grace' });
    check('the guest joined the room', joined.ok === true, joined);
    const guestMember = joined.participants.find((p) => p.clientId === GUEST_ID);
    check('the guest is seen under its name', guestMember && guestMember.name === 'Grace', guestMember);
    check('the guest keeps its own id', guestMember && guestMember.clientId === GUEST_ID, guestMember);
    check('the name does not make somebody the host', guestMember && guestMember.isHost === false, guestMember);

    // --- two people with the same name -------------------------------------------
    const twinJoin = await ask(twin, 'join-room', { code, clientId: TWIN_ID, displayName: 'Grace' });
    check('the second guest joined the room', twinJoin.ok === true, twinJoin);
    const twins = twinJoin.participants.filter((p) => p.name === 'Grace');
    check('two people may carry the same name', twins.length === 2, twinJoin.participants);
    check(
      'the two of them keep their own id',
      twins.length === 2 && twins[0].clientId !== twins[1].clientId,
      twins,
    );
    check('the room still knows three members', twinJoin.count === 3, twinJoin.count);

    // --- an older client without a name -------------------------------------------
    const oldJoin = await ask(old, 'join-room', { code, clientId: OLD_ID });
    check('a client without a name may still join', oldJoin.ok === true, oldJoin);
    const oldMember = oldJoin.participants.find((p) => p.clientId === OLD_ID);
    check('a client without a name gets a safe fallback', oldMember && oldMember.name === 'Listener 1', oldMember);

    // --- the name is cleaned by the server ------------------------------------------
    const longName = await ask(old, 'join-room', { code, clientId: OLD_ID, displayName: 'y'.repeat(80) });
    const longMember = longName.participants.find((p) => p.clientId === OLD_ID);
    check('a long name is cut by the server', longMember && longMember.name.length === 24, longMember);
    const dirty = await ask(old, 'join-room', { code, clientId: OLD_ID, displayName: '  Ada   Lovelace  ' });
    const dirtyMember = dirty.participants.find((p) => p.clientId === OLD_ID);
    check('the server normalizes the spaces of a name', dirtyMember && dirtyMember.name === 'Ada Lovelace', dirtyMember);

    // --- the name in the chat ------------------------------------------------------
    const hostMessages = collect(host, 'chat:message');
    const twinMessages = collect(twin, 'chat:message');
    const sent = await ask(guest, 'chat:send', { code, text: 'hello' });
    check('the message was accepted', sent.ok === true, sent);
    await sleep(250);
    check('the message reaches the room', hostMessages.length === 1 && twinMessages.length === 1, {
      host: hostMessages.length,
      twin: twinMessages.length,
    });
    check(
      'the message carries the name of the sender',
      hostMessages[0] && hostMessages[0].userName === 'Grace',
      hostMessages[0],
    );
    check(
      'the message carries the id of the sender',
      hostMessages[0] && hostMessages[0].userId === GUEST_ID,
      hostMessages[0],
    );
    check(
      'the name of a message is plain text',
      hostMessages[0] && typeof hostMessages[0].userName === 'string' && !hostMessages[0].userName.includes('<'),
      hostMessages[0],
    );

    // --- a name that looks like markup stays text -------------------------------------
    const markup = await ask(old, 'join-room', { code, clientId: OLD_ID, displayName: '<b>Alex</b>' });
    const markupMember = markup.participants.find((p) => p.clientId === OLD_ID);
    check(
      'a name that looks like markup is kept as text',
      markupMember && markupMember.name === '<b>Alex</b>',
      markupMember,
    );

    // --- a name that is changed follows the client -------------------------------------
    const renamed = await ask(guest, 'join-room', { code, clientId: GUEST_ID, displayName: 'Grace Hopper' });
    const renamedMember = renamed.participants.find((p) => p.clientId === GUEST_ID);
    check('a new name follows the client', renamedMember && renamedMember.name === 'Grace Hopper', renamedMember);
    check('the client keeps its identity', renamedMember && renamedMember.clientId === GUEST_ID, renamedMember);
    check(
      'the host is not affected by the new name',
      renamed.participants[0].name === 'Ada Lovelace',
      renamed.participants,
    );
  } catch (err) {
    failures++;
    console.log('FAIL  the test crashed ->', err && err.message);
  } finally {
    [host, guest, twin, old].forEach((s) => s && s.close());
  }

  console.log(failures === 0 ? '\nALL DISPLAY NAME CHECKS PASSED' : `\n${failures} DISPLAY NAME CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
