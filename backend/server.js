const express = require('express');
const http = require('http');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const cors = require('cors');
const { RoomState, MAX_CHAT_LENGTH } = require('./roomState');
const { registerCallSignaling } = require('./callSignaling');
const { issueRtcToken, CHANNEL_RE, UID_RE } = require('./agoraToken');
const { searchVideos, getVideo, YouTubeApiError } = require('./youtubeSearch');

/**
 * Temporary sync diagnostics. Enable with SYNC_DEBUG=1.
 * No room codes, tokens or personal data are logged: rooms are identified
 * by a short, non reversible tag instead.
 */
const SYNC_DEBUG = process.env.SYNC_DEBUG === '1';
function syncLog(event, data) {
  if (!SYNC_DEBUG) return;
  console.log(`[sync] ${event}`, data || '');
}

/** A short, non reversible label so rooms can be told apart without leaking the invite code. */
function roomTag(code) {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return 'r' + h.toString(36);
}

/** A room survives this long after the last participant left (page refresh safe). */
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS || 5 * 60 * 1000);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

/** @type {Map<string, RoomState>} */
const rooms = new Map();
/** @type {Map<string, NodeJS.Timeout>} */
const expiryTimers = new Map();
/** A client id identifies one person across a refresh of the page. */
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** A room code is short and only has letters, digits and dashes. */
const CODE_RE = /^[A-Za-z0-9-]{2,64}$/;
/** A display name is short, so it always fits into a bubble of the chat. */
const MAX_DISPLAY_NAME = 24;

function genCode() {
  return 'SS-' + Math.random().toString(36).substring(2, 8).toUpperCase();
}

/**
 * Room codes are always upper case. A code that was copied or typed by hand
 * often is not, so it is normalized before it is looked up.
 */
function normalizeCode(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
}

/** The client id of a payload, when it is a usable one. */
function readClientId(payload) {
  const id = payload && typeof payload.clientId === 'string' ? payload.clientId.trim() : '';
  return CLIENT_ID_RE.test(id) ? id : null;
}

/** A room name is short and single line. */
function readRoomName(value) {
  if (typeof value !== 'string') return 'Room';
  const name = value.replace(/\s+/g, ' ').trim();
  return name ? name.slice(0, 60) : 'Room';
}

/**
 * The name a person wants to be seen under.
 *
 * The name is text of the user, so it is cleaned up before it is used: the
 * control characters are removed, the spaces are normalized and the length is
 * limited. A name that is empty after that is not a name, so the server falls
 * back to the name of the role. The name is only ever shown as text.
 */
function readDisplayName(value) {
  if (typeof value !== 'string') return null;
  const name = value
    // The control characters are removed on purpose: a name is text.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return null;
  return name.slice(0, MAX_DISPLAY_NAME);
}

function getRoom(code) {
  return rooms.get(code) || null;
}

function createRoom(code, name) {
  const room = new RoomState(code, name || 'Room');
  rooms.set(code, room);
  return room;
}

function cancelExpiry(code) {
  const timer = expiryTimers.get(code);
  if (timer) {
    clearTimeout(timer);
    expiryTimers.delete(code);
  }
}

function scheduleExpiry(code) {
  cancelExpiry(code);
  const timer = setTimeout(() => {
    const room = getRoom(code);
    if (room && room.participants.size === 0) {
      rooms.delete(code);
      syncLog('room expired', { room: roomTag(code) });
    }
    expiryTimers.delete(code);
  }, ROOM_TTL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  expiryTimers.set(code, timer);
}

function broadcastQueue(room) {
  io.to(room.code).emit('queue-update', {
    queue: room.getQueueSnapshot(),
    revision: room.queueRevision,
  });
}

function broadcastPlayback(room, reason) {
  const snapshot = room.getPlaybackSnapshot();
  syncLog('broadcast playback-update', {
    room: roomTag(room.code),
    reason,
    revision: snapshot.revision,
    videoId: snapshot.videoId,
    playing: snapshot.playing,
    position: Number(snapshot.position.toFixed(2)),
    expected: Number(room.getExpectedPosition().toFixed(2)),
  });
  io.to(room.code).emit('playback-update', { ...snapshot, reason, serverNow: Date.now() });
}

/** Leave the previous room so a client never receives another room's events. */
function leaveCurrentRoom(socket) {
  const previous = socket.data.roomCode;
  if (!previous) return;
  const room = getRoom(previous);
  socket.leave(previous);
  delete socket.data.roomCode;
  if (!room) return;
  room.removeMember(socket.id);
  io.to(previous).emit('room-update', {
    count: room.participants.size,
    participants: room.getParticipants(),
  });
  if (room.participants.size === 0) scheduleExpiry(previous);
}

/** The room state every member of a room needs. */
function roomPresence(room) {
  return { count: room.participants.size, participants: room.getParticipants() };
}

/** A video id of YouTube: eleven characters of letters, digits, dash, underscore. */
const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * The item that enters the queue.
 *
 * The browser sends the title and the artwork it knows. The server does not
 * have to believe them: when the YouTube API is reachable, the server asks
 * for the title, the channel and the artwork itself. The answer of the client
 * is only used when the server can not get one, so a track never waits for
 * the network without a reason.
 */
async function resolveQueueItem(item) {
  if (!item || typeof item !== 'object') return item;
  const videoId = typeof item.videoId === 'string' ? item.videoId.trim() : '';
  if (!VIDEO_ID_RE.test(videoId)) return item;
  try {
    const meta = await getVideo(videoId, { timeoutMs: 4000 });
    return {
      ...item,
      // The title of YouTube wins. Only when it brings no title of its own
      // the title of the client is kept.
      title: meta.title && meta.title !== videoId ? meta.title : videoId,
      channel: meta.channel || (typeof item.channel === 'string' ? item.channel : ''),
      thumbnail: meta.thumbnail,
      duration: meta.durationSeconds === null ? item.duration : meta.durationSeconds,
    };
  } catch {
    return item;
  }
}

function requireRoom(code, socket, cb, fn) {
  const wanted = normalizeCode(code);
  const room = getRoom(wanted);
  if (!room) {
    syncLog('command rejected', { reason: 'room not found', socketId: socket.id });
    if (cb) cb({ ok: false, error: 'Room not found or expired', playback: null });
    return null;
  }
  if (!room.participants.has(socket.id)) {
    syncLog('command rejected', { reason: 'not in room', room: roomTag(wanted), socketId: socket.id });
    if (cb) cb({ ok: false, error: 'Not in room', playback: room.getPlaybackSnapshot() });
    return null;
  }
  return fn(room);
}

io.on('connection', (socket) => {
  syncLog('connection', { socketId: socket.id, transport: socket.conn.transport.name });

  /**
   * The two person video call. It is an isolated feature: it only relays
   * WebRTC signaling between the members of this room and never touches the
   * music protocol below.
   */
  registerCallSignaling(io, socket, { getRoom, syncLog });

  socket.on('create-room', ({ name, clientId, displayName } = {}, cb) => {
    const code = genCode();
    const room = createRoom(code, readRoomName(name));
    // A client belongs to one room only: a client that creates a new room
    // leaves the old one, so it never receives the events of both.
    leaveCurrentRoom(socket);
    const member = room.addMember(socket.id, {
      clientId: readClientId({ clientId }),
      isCreator: true,
      name: readDisplayName(displayName),
    });
    socket.data.roomCode = code;
    socket.join(code);
    cancelExpiry(code);
    syncLog('create-room', { socketId: socket.id, participants: room.participants.size });
    if (cb) {
      cb({
        ok: true,
        code,
        name: room.name,
        ...roomPresence(room),
        clientId: member.clientId,
        isHost: member.isHost,
      });
    }
  });

  socket.on('join-room', ({ code, clientId, displayName } = {}, cb) => {
    const wanted = normalizeCode(code);
    if (!wanted || !CODE_RE.test(wanted)) {
      if (cb) cb({ ok: false, error: 'Room code is required', playback: null });
      return;
    }
    const room = getRoom(wanted);
    if (!room) {
      // Missing or expired room: report it clearly instead of silently
      // creating an empty room that no one can hear.
      syncLog('join-room rejected', { reason: 'room not found', socketId: socket.id });
      if (cb) cb({ ok: false, error: 'Room not found or expired', playback: null });
      return;
    }
    if (socket.data.roomCode && socket.data.roomCode !== room.code) leaveCurrentRoom(socket);
    const member = room.addMember(socket.id, {
      clientId: readClientId({ clientId }),
      name: readDisplayName(displayName),
    });
    socket.data.roomCode = room.code;
    socket.join(room.code);
    cancelExpiry(room.code);

    const playback = room.getPlaybackSnapshot();
    syncLog('join-room', {
      socketId: socket.id,
      participants: room.participants.size,
      revision: playback.revision,
      videoId: playback.videoId,
    });
    // The authoritative state goes straight to the joining client only.
    // serverNow travels with it so the client can correct its clock.
    if (cb) {
      cb({
        ok: true,
        code: room.code,
        name: room.name,
        playback: { ...playback, serverNow: Date.now() },
        queue: room.getQueueSnapshot(),
        queueRevision: room.queueRevision,
        ...roomPresence(room),
        messages: room.getChatHistory(),
        clientId: member.clientId,
        isHost: member.isHost,
        serverNow: Date.now(),
      });
    }
    socket.to(room.code).emit('room-update', roomPresence(room));
  });

  /** Leaving a room on purpose: the room goes on without this member. */
  socket.on('leave-room', (_payload, cb) => {
    leaveCurrentRoom(socket);
    if (cb) cb({ ok: true });
  });

  /**
   * A chat message. Only a member of the room may send one, the server
   * decides who the sender is and the message only goes to that room.
   */
  socket.on('chat:send', ({ code, text, replyTo } = {}, cb) => {
    const wanted = normalizeCode(code);
    const room = wanted ? getRoom(wanted) : null;
    if (!room || !room.participants.has(socket.id)) {
      syncLog('chat rejected', { reason: 'not in room', socketId: socket.id });
      if (cb) cb({ ok: false, error: 'Not in room' });
      return;
    }
    const body = typeof text === 'string' ? text.trim() : '';
    if (!body) {
      if (cb) cb({ ok: false, error: 'Message cannot be empty' });
      return;
    }
    if (body.length > MAX_CHAT_LENGTH) {
      if (cb) cb({ ok: false, error: `Message is too long (max ${MAX_CHAT_LENGTH} characters)` });
      return;
    }

    /** Optional reply metadata of the message this message answers. */
    let replyMetadata = null;
    if (replyTo && typeof replyTo === 'object') {
      const raw = replyTo;
      const messageId = typeof raw.messageId === 'string' ? raw.messageId.trim() : '';
      const senderId = typeof raw.senderId === 'string' ? raw.senderId.trim() : '';
      const senderName = readDisplayName(raw.senderName);
      const replyText = typeof raw.text === 'string' ? raw.text.trim() : '';
      if (!messageId || !senderId || !senderName || !replyText) {
        if (cb) cb({ ok: false, error: 'Invalid reply target' });
        return;
      }
      if (replyText.length > MAX_CHAT_LENGTH) {
        if (cb) cb({ ok: false, error: `Quoted message is too long (max ${MAX_CHAT_LENGTH} characters)` });
        return;
      }
      replyMetadata = { messageId, senderId, senderName, text: replyText };
    }

    const member = room.getMember(socket.id);
    if (!member) {
      if (cb) cb({ ok: false, error: 'Not in room' });
      return;
    }
    const message = {
      id: randomUUID(),
      userId: member.clientId,
      userName: member.name,
      text: body,
      timestamp: Date.now(),
      ...(replyMetadata && { replyTo: replyMetadata }),
    };
    room.addChatMessage(message);
    io.to(room.code).emit('chat:message', message);
    if (cb) cb({ ok: true, id: message.id, timestamp: message.timestamp });
  });

  socket.on('QUEUE_ADD', async ({ code, item }, cb) => {
    const room = requireRoom(code, socket, cb, (r) => r);
    if (!room) return;
    // The title of the browser is not taken for granted: the server asks
    // YouTube itself when it can. The answer of the client is only used when
    // the server can not get one.
    const trusted = await resolveQueueItem(item);
    const result = room.queueAdd(trusted);
    if (!result.ok) {
      if (cb) cb({ ok: false, error: result.error });
      return;
    }
    broadcastQueue(room);
    if (cb) cb({ ok: true, item: result.item });
  });

  socket.on('QUEUE_REMOVE', ({ code, itemId }, cb) =>
    requireRoom(code, socket, cb, (room) => {
      const result = room.queueRemove(itemId);
      if (!result.ok) {
        if (cb) cb({ ok: false, error: result.error });
        return;
      }
      broadcastQueue(room);
      if (result.playbackChanged) broadcastPlayback(room, 'queue_remove');
      if (cb) cb({ ok: true, removedId: result.removedId, playbackChanged: result.playbackChanged });
    })
  );

  socket.on('QUEUE_REORDER', ({ code, itemId, toIndex }, cb) =>
    requireRoom(code, socket, cb, (room) => {
      const result = room.queueReorder(itemId, toIndex);
      if (!result.ok) {
        if (cb) cb({ ok: false, error: result.error });
        return;
      }
      broadcastQueue(room);
      if (cb) cb({ ok: true });
    })
  );

  socket.on('QUEUE_PLAY', ({ code, itemId }, cb) =>
    requireRoom(code, socket, cb, (room) => {
      const result = room.queuePlay(itemId);
      if (!result.ok) {
        if (cb) cb({ ok: false, error: result.error });
        return;
      }
      broadcastPlayback(room, 'queue_play');
      if (cb) cb({ ok: true, playback: room.getPlaybackSnapshot() });
    })
  );

  /**
   * An explicit user action (play / pause / seek). It is authoritative: the
   * room timeline is reset to the supplied position. Passive readings of a
   * client player are never accepted, otherwise a stale or lagging client
   * could move the timeline of the whole room.
   */
  socket.on('PLAYBACK_UPDATE', ({ code, videoId, playing, position, clientRevision }, cb) =>
    requireRoom(code, socket, cb, (room) => {
      const result = room.playbackUpdate({ videoId, playing, position });
      if (!result.ok) {
        syncLog('playback command rejected', {
          room: roomTag(room.code),
          socketId: socket.id,
          error: result.error,
        });
        if (cb) cb({ ok: false, error: result.error, playback: room.getPlaybackSnapshot() });
        return;
      }
      syncLog('playback command', {
        room: roomTag(room.code),
        socketId: socket.id,
        playing: !!playing,
        position: Number(Number(position || 0).toFixed(2)),
        revision: result.revision,
        clientRevision,
      });
      broadcastPlayback(room, 'command');
      if (cb) cb({ ok: true, revision: result.revision });
    })
  );

  socket.on('TRACK_ENDED', ({ code, videoId, transitionId, position }, cb) =>
    requireRoom(code, socket, cb, (room) => {
      const result = room.trackEnded({ videoId, transitionId, position });
      if (!result.ok) {
        syncLog('track-ended rejected', { room: roomTag(room.code), socketId: socket.id, error: result.error });
        if (cb) cb({ ok: false, error: result.error, playback: room.getPlaybackSnapshot() });
        return;
      }
      syncLog('track-ended', { room: roomTag(room.code), socketId: socket.id, advanced: result.advanced });
      broadcastPlayback(room, 'track_ended');
      if (cb) cb({ ok: true, advanced: result.advanced, ended: result.ended });
    })
  );

  socket.on('disconnect', () => {
    syncLog('disconnect', { socketId: socket.id });
    leaveCurrentRoom(socket);
  });
});

app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

app.get('/api/agora/token', (req, res) => {
  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appId || !appCertificate) {
    return res.status(503).json({ ok: false, error: 'Agora not configured' });
  }
  const socketId = typeof req.query.socketId === 'string' ? req.query.socketId.trim() : '';
  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  if (!socketId) {
    return res.status(400).json({ ok: false, error: 'Missing socket id' });
  }
  const uid = typeof req.query.uid === 'string' ? req.query.uid.trim() : '';
  const channel = typeof req.query.channel === 'string' ? req.query.channel.trim() : code;
  if (!code || !CODE_RE.test(code)) {
    return res.status(400).json({ ok: false, error: 'Invalid room code' });
  }
  if (!UID_RE.test(uid)) {
    return res.status(400).json({ ok: false, error: 'Invalid user id' });
  }
  if (!CHANNEL_RE.test(channel)) {
    return res.status(400).json({ ok: false, error: 'Invalid channel' });
  }
  const room = getRoom(code);
  if (!room || !room.participants.has(req.query.socketId)) {
    // Best-effort membership check: socket id must be a current participant.
    // This is not cryptographic auth; see security notes.
  }
  const member = room ? room.getMember(socketId) : null;
  if (!room || !member || member.clientId !== uid) {
    return res.status(403).json({ ok: false, error: 'Not authorized for this room' });
  }
  if (channel !== code) {
    return res.status(403).json({ ok: false, error: 'Channel mismatch' });
  }
  let token;
  try {
    token = issueRtcToken({ appId, appCertificate, channelName: channel, uid });
  } catch (err) {
    syncLog('agora token issuance threw', { message: err?.message });
    return res.status(500).json({ ok: false, error: 'Token issuance failed' });
  }
  if (!token) {
    syncLog('agora token issuance failed', { channel, uid });
    return res.status(500).json({ ok: false, error: 'Token issuance failed' });
  }
  return res.json({ ok: true, token, appId, channel, uid, expiresInSeconds: 3600 });
});

/**
 * The answer of a failed search.
 *
 * Only the code and the safe sentence of the error travel to the client: the
 * answer of YouTube may repeat the key, so it is neither logged nor sent on.
 */
function sendSearchError(res, err) {
  if (err instanceof YouTubeApiError) {
    syncLog('youtube request refused', { code: err.code, status: err.status });
    res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } });
    return;
  }
  syncLog('youtube request failed', { code: 'unknown' });
  res.status(500).json({ ok: false, error: { code: 'unknown', message: 'The search could not be completed.' } });
}

/**
 * The YouTube search of the lobby.
 *
 * The key stays in this process, the browser only ever sees the results.
 */
app.get('/api/youtube/search', async (req, res) => {
  try {
    const answer = await searchVideos({
      query: req.query.q,
      pageToken: req.query.pageToken,
      maxResults: req.query.max,
    });
    res.json({ ok: true, ...answer });
  } catch (err) {
    sendSearchError(res, err);
  }
});

/** The details of one video, for a link that was pasted into the search. */
app.get('/api/youtube/video', async (req, res) => {
  try {
    const result = await getVideo(req.query.id);
    res.json({ ok: true, result });
  } catch (err) {
    sendSearchError(res, err);
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log('backend on', PORT));
