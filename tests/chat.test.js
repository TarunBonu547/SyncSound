/**
 * Chat test: sending, receiving, the rules of the server and the isolation
 * between rooms.
 *
 * The tests talk to a running backend, so start it first:
 *   node backend/server.js
 *   node tests/chat.test.js
 */
import { io } from 'socket.io-client';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';
const MAX_CHAT_LENGTH = 500;

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

const HOST_ID = 'chat-host-0001';
const GUEST_ID = 'chat-guest-0002';
const OUTSIDER_ID = 'chat-outsider-0003';

(async () => {
  let host;
  let guest;
  let outsider;
  try {
    host = await connect();
    guest = await connect();
    outsider = await connect();

    const created = await ask(host, 'create-room', { name: 'Chat Room', clientId: HOST_ID });
    const code = created.code;
    check('the room exists', created.ok === true, created);
    await ask(guest, 'join-room', { code, clientId: GUEST_ID });

    // --- a message reaches everybody of the room ---------------------------------
    const hostMessages = collect(host, 'chat:message');
    const guestMessages = collect(guest, 'chat:message');
    const sent = await ask(host, 'chat:send', { code, text: '  hello room  ' });
    check('the message was accepted', sent.ok === true && !!sent.id, sent);
    await sleep(200);

    check('the sender receives the message once', hostMessages.length === 1, hostMessages);
    check('the other member receives the message once', guestMessages.length === 1, guestMessages);
    const message = guestMessages[0];
    check('the text is trimmed', message && message.text === 'hello room', message);
    check('the sender is the host', message && message.userName === 'Host', message);
    check('the sender id is the client id', message && message.userId === HOST_ID, message);
    check('the message has a timestamp', message && Number.isFinite(message.timestamp) && message.timestamp > 0, message);
    check('the message has an id', message && typeof message.id === 'string' && message.id.length > 0, message);
    check('the sender and the receiver see the same id', hostMessages[0].id === message.id, {
      sender: hostMessages[0].id,
      receiver: message.id,
    });

    // --- replying to a message ---------------------------------------------------
    const repliedTo = await ask(guest, 'chat:send', {
      code,
      text: 'This song hits different ❤️',
      replyTo: { messageId: message.id, senderId: HOST_ID, senderName: 'Host', text: message.text },
    });
    check('a reply is accepted', repliedTo.ok === true && !!repliedTo.id, repliedTo);
    await sleep(200);
    check('the sender receives the reply once', hostMessages.length === 2, hostMessages);
    check('the other member receives the reply once', guestMessages.length === 2, guestMessages);
    const reply = guestMessages[1];
    check('the reply carries the original target', reply && reply.replyTo && reply.replyTo.messageId === message.id, reply);
    check('the reply names the original sender', reply && reply.replyTo && reply.replyTo.senderName === 'Host', reply);
    check('the reply quotes the original text', reply && reply.replyTo && reply.replyTo.text === 'hello room', reply);

    const badReply = await ask(guest, 'chat:send', { code, text: 'x', replyTo: { messageId: '', senderId: HOST_ID, senderName: 'Host', text: 'hello room' } });
    check('a reply without a message id is refused', badReply.ok === false, badReply);
    const partialReply = await ask(guest, 'chat:send', { code, text: 'x', replyTo: { messageId: message.id, senderId: HOST_ID } });
    check('an incomplete reply target is refused', partialReply.ok === false, partialReply);
    await sleep(200);
    check('the refused replies were not delivered', guestMessages.length === 2, guestMessages.length);

    // --- the rules of the server ------------------------------------------------------
    const empty = await ask(host, 'chat:send', { code, text: '' });
    check('an empty message is refused', empty.ok === false, empty);
    const blank = await ask(host, 'chat:send', { code, text: '    \n\t  ' });
    check('a blank message is refused', blank.ok === false, blank);
    const notAString = await ask(host, 'chat:send', { code, text: { toString: () => 'x' } });
    check('a message that is not text is refused', notAString.ok === false, notAString);
    const tooLong = await ask(host, 'chat:send', { code, text: 'x'.repeat(MAX_CHAT_LENGTH + 1) });
    check('a too long message is refused', tooLong.ok === false, tooLong);
    const justFits = await ask(host, 'chat:send', { code, text: 'x'.repeat(MAX_CHAT_LENGTH) });
    check('a message of the maximum length is accepted', justFits.ok === true, justFits);
    await sleep(200);
    check('the refused messages were not delivered', guestMessages.every((m) => m.text !== '' && m.text !== '    \n\t  ' && m.text.length <= MAX_CHAT_LENGTH), guestMessages);

    // --- a message of a member of another room -------------------------------------------
    const otherRoom = await ask(outsider, 'create-room', { name: 'Other', clientId: OUTSIDER_ID });
    const foreign = await ask(outsider, 'chat:send', { code, text: 'leak' });
    check('a message for a room the sender is not in is refused', foreign.ok === false, foreign);
    const noRoom = await ask(outsider, 'chat:send', { code: 'SS-NOSUCHROOM', text: 'leak' });
    check('a message for an unknown room is refused', noRoom.ok === false, noRoom);
    await sleep(200);
    check('the message did not leak into the room', guestMessages.every((m) => m.text !== 'leak'), guestMessages);
    check('the other room is its own', otherRoom.ok === true && otherRoom.code !== code, otherRoom);

    // --- the history of the room ----------------------------------------------------------
    const late = await connect();
    const lateJoin = await ask(late, 'join-room', { code, clientId: 'chat-late-0004' });
    check('a late joiner gets the history', Array.isArray(lateJoin.messages) && lateJoin.messages.length === 3, lateJoin.messages && lateJoin.messages.length);
    check('the history has the first message', lateJoin.messages[0].text === 'hello room', lateJoin.messages[0]);
    check('the history has the sender', lateJoin.messages[0].userName === 'Host', lateJoin.messages[0]);
    check('the history keeps the reply metadata', lateJoin.messages[1] && lateJoin.messages[1].replyTo && lateJoin.messages[1].replyTo.messageId === message.id, lateJoin.messages[1]);

    // --- a reconnect gets the history again, without duplicates ---------------------------------
    const rejoin = await ask(guest, 'join-room', { code, clientId: GUEST_ID });
    check('a rejoin gets the history', Array.isArray(rejoin.messages) && rejoin.messages.length === 3, rejoin.messages && rejoin.messages.length);
    const ids = rejoin.messages.map((m) => m.id);
    check('the history has no duplicate ids', new Set(ids).size === ids.length, ids);
    check('the history keeps the order', rejoin.messages[0].text === 'hello room', rejoin.messages[0].text);

    // --- a member that leaves stops the messages -----------------------------------------------
    await ask(guest, 'leave-room', { code });
    const afterLeave = await ask(host, 'chat:send', { code, text: 'after the leave' });
    check('the host can still write', afterLeave.ok === true, afterLeave);
    await sleep(200);
    const refused = await ask(guest, 'chat:send', { code, text: 'after the leave' });
    check('a member that left cannot write anymore', refused.ok === false, refused);

    late.close();
  } catch (err) {
    failures++;
    console.log('FAIL  the test crashed ->', err && err.message);
  } finally {
    [host, guest, outsider].forEach((s) => s && s.close());
  }

  console.log(failures === 0 ? '\nALL CHAT CHECKS PASSED' : `\n${failures} CHAT CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
