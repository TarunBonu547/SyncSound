/**
 * Room test: creation, joining, members, the host, leaving and presence.
 *
 * The tests talk to a running backend, so start it first:
 *   node backend/server.js
 *   node tests/room.test.js
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

const HOST_ID = 'client-host-0001';
const GUEST_ID = 'client-guest-0002';
const OTHER_ID = 'client-other-0003';

(async () => {
  let host;
  let guest;
  let other;
  try {
    host = await connect();
    guest = await connect();
    other = await connect();

    // --- the host creates a room -------------------------------------------
    const created = await ask(host, 'create-room', { name: '  Test   Room  ', clientId: HOST_ID });
    check('the room is created', created.ok === true && !!created.code, created);
    check('the room name is cleaned up', created.name === 'Test Room', created.name);
    const code = created.code;
    check('the creator is the host', created.isHost === true, created);
    check('the host is the only member', created.count === 1 && created.participants.length === 1, created.participants);
    check('the host is named Host', created.participants[0].name === 'Host', created.participants);

    // --- the guest joins -----------------------------------------------------
    const hostUpdates = collect(host, 'room-update');
    const joined = await ask(guest, 'join-room', { code, clientId: GUEST_ID });
    check('the guest joined the room', joined.ok === true && joined.code === code, joined);
    check('the guest is not the host', joined.isHost === false, joined);
    check('the room has two members', joined.count === 2 && joined.participants.length === 2, joined.participants);
    check('the host comes first in the list', joined.participants[0].isHost === true, joined.participants);
    const guestMember = joined.participants.find((p) => p.clientId === GUEST_ID);
    check('the guest is in the list', !!guestMember, joined.participants);
    check('the guest has a name', guestMember && guestMember.name === 'Listener 1', guestMember);

    await sleep(150);
    check('the host was told about the new member', hostUpdates.length === 1 && hostUpdates[0].count === 2, hostUpdates);
    check(
      'the update carries the members',
      hostUpdates[0] && hostUpdates[0].participants.length === 2 && hostUpdates[0].participants[1].name === 'Listener 1',
      hostUpdates[0] && hostUpdates[0].participants,
    );

    // --- a room code is not case sensitive ------------------------------------
    const lower = await ask(other, 'join-room', { code: code.toLowerCase(), clientId: OTHER_ID });
    check('a lower case code finds the room', lower.ok === true && lower.code === code, lower);
    check('the third member is a listener', lower.participants.length === 3, lower.participants);

    // --- a command from outside the room is refused -----------------------------
    const stranger = await ask(other, 'QUEUE_ADD', {
      code: 'SS-DOESNOTEXIST',
      item: { videoId: 'dQw4w9WgXcQ', title: 'x' },
    });
    check('a command for an unknown room is refused', stranger.ok === false, stranger);

    const notInRoom = await ask(other, 'QUEUE_ADD', {
      code,
      item: { videoId: 'dQw4w9WgXcQ', title: 'x' },
    });
    check('a command of a member is accepted', notInRoom.ok === true, notInRoom);

    // --- joining another room leaves the first one -------------------------------
    const second = await ask(other, 'create-room', { name: 'Second', clientId: OTHER_ID });
    check('a second room can be created', second.ok === true, second);
    await sleep(150);
    const afterSwitch = hostUpdates[hostUpdates.length - 1];
    check('the first room lost the member', afterSwitch && afterSwitch.count === 2, afterSwitch);

    // --- leaving on purpose --------------------------------------------------------
    // The member that leaves does not hear its own leave, the room does.
    const leaveUpdates = collect(host, 'room-update');
    await ask(guest, 'leave-room', { code });
    await sleep(200);
    const leaveUpdate = leaveUpdates[leaveUpdates.length - 1];
    check('the room was told about the leave', leaveUpdate && leaveUpdate.count === 1, leaveUpdates);
    check(
      'the member that left is gone from the list',
      leaveUpdate && !leaveUpdate.participants.some((p) => p.clientId === GUEST_ID),
      leaveUpdate && leaveUpdate.participants,
    );
    const afterLeave = await ask(guest, 'join-room', { code, clientId: GUEST_ID });
    check('the guest can come back', afterLeave.ok === true, afterLeave);
    check(
      'the guest keeps the name',
      afterLeave.participants.find((p) => p.clientId === GUEST_ID).name === 'Listener 1',
      afterLeave.participants,
    );

    // --- a disconnect removes the member --------------------------------------------
    const beforeDisconnect = collect(host, 'room-update');
    guest.disconnect();
    await sleep(300);
    const afterDisconnect = beforeDisconnect[beforeDisconnect.length - 1];
    check('a disconnect lowers the member count', afterDisconnect && afterDisconnect.count === 1, afterDisconnect);

    // --- the host keeps the role after a reconnect -------------------------------------
    host.disconnect();
    await sleep(300);
    const hostAgain = await connect();
    const rejoined = await ask(hostAgain, 'join-room', { code, clientId: HOST_ID });
    check('the host can come back', rejoined.ok === true, rejoined);
    check('the host is still the host', rejoined.isHost === true, rejoined);
    check(
      'the host keeps the name',
      rejoined.participants.find((p) => p.clientId === HOST_ID).name === 'Host',
      rejoined.participants,
    );
    hostAgain.close();
  } catch (err) {
    failures++;
    console.log('FAIL  the test crashed ->', err && err.message);
  } finally {
    [host, guest, other].forEach((s) => s && s.close());
  }

  console.log(failures === 0 ? '\nALL ROOM CHECKS PASSED' : `\n${failures} ROOM CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
