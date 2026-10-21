/**
 * Two person video call signaling.
 *
 * This module is deliberately separate from the music protocol: it only
 * relays the handful of messages that are needed to establish one WebRTC
 * session between the two members of a room. No music event, queue operation
 * or playback state is touched here.
 *
 * Rules:
 * - Only members of the same room may signal, and only to the other member.
 * - A room carries at most one call at a time.
 * - Every payload is validated before it is relayed.
 * - SDP, ICE candidates and credentials are never logged.
 */
const { randomUUID } = require('crypto');

/** An SDP offer or answer is a few kilobytes, an ICE candidate far less. */
const MAX_SIGNAL_BYTES = 96 * 1024;
/** How long a call may ring before it is given up on. */
const RING_TIMEOUT_MS = 45 * 1000;

const CODE_RE = /^[A-Za-z0-9-]{2,64}$/;
const CALL_ID_RE = /^[0-9a-f-]{8,64}$/i;

/**
 * @typedef {object} CallSession
 * @property {string} callId
 * @property {string} code
 * @property {string} initiatorId
 * @property {string} peerId
 * @property {'ringing'|'connecting'|'active'} status
 * @property {NodeJS.Timeout} timer
 */

/** @type {Map<string, CallSession>} */
const sessions = new Map();

/** A short, non reversible label so calls can be told apart without leaking ids. */
function callTag(callId) {
  let h = 0;
  for (let i = 0; i < callId.length; i++) h = (h * 31 + callId.charCodeAt(i)) >>> 0;
  return 'c' + h.toString(36);
}

function readCode(payload) {
  // Room codes are upper case; a hand typed code often is not.
  const code = payload && typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
  return CODE_RE.test(code) ? code : null;
}

function readCallId(payload) {
  const id = payload && typeof payload.callId === 'string' ? payload.callId : '';
  return CALL_ID_RE.test(id) ? id : null;
}

function readMedia(payload) {
  return payload && payload.media === 'audio' ? 'audio' : 'video';
}

function readBoolean(value) {
  return value === true;
}

function clearSession(code) {
  const session = sessions.get(code);
  if (!session) return null;
  if (session.timer) clearTimeout(session.timer);
  sessions.delete(code);
  return session;
}

/**
 * Finds the call session a message belongs to. A message is only accepted
 * when the sender is one of the two participants of that exact call, so a
 * stale or replayed message cannot reach anybody.
 */
function resolveSession(payload, socketId) {
  const code = readCode(payload);
  const callId = readCallId(payload);
  if (!code || !callId) return { session: null, reason: 'Invalid call reference' };
  const session = sessions.get(code);
  if (!session || session.callId !== callId) return { session: null, reason: 'Call no longer available' };
  if (session.initiatorId !== socketId && session.peerId !== socketId) {
    return { session: null, reason: 'Call no longer available' };
  }
  return { session, reason: null };
}

/** Validates an SDP offer or answer. */
function readDescription(payload) {
  const type = payload && payload.type === 'answer' ? 'answer' : payload && payload.type === 'offer' ? 'offer' : null;
  const sdp = payload && typeof payload.sdp === 'string' ? payload.sdp : '';
  if (!type || !sdp || sdp.length > MAX_SIGNAL_BYTES) return null;
  return { type, sdp };
}

/** Validates a single ICE candidate. */
function readCandidate(payload) {
  const candidate = payload && payload.candidate;
  // A null candidate is the end of candidates marker and is relayed as is.
  if (candidate === null) return { candidate: null };
  if (!candidate || typeof candidate !== 'object') return null;
  const line = typeof candidate.candidate === 'string' ? candidate.candidate : '';
  if (!line || line.length > 8192) return null;
  const out = { candidate: line };
  if (typeof candidate.sdpMid === 'string') out.sdpMid = candidate.sdpMid.slice(0, 64);
  if (Number.isInteger(candidate.sdpMLineIndex)) out.sdpMLineIndex = candidate.sdpMLineIndex;
  if (typeof candidate.usernameFragment === 'string') out.usernameFragment = candidate.usernameFragment.slice(0, 64);
  return { candidate: out };
}

/**
 * Registers the call signaling handlers on one socket.
 *
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {{ getRoom: (code: string) => any, syncLog?: (event: string, data?: unknown) => void }} deps
 */
function registerCallSignaling(io, socket, { getRoom, syncLog = () => {} }) {
  /** Rejects a message with a short reason, never with internal details. */
  const fail = (cb, reason) => {
    if (cb) cb({ ok: false, error: reason });
  };

  /** The room of a socket, or null when it is not a member. */
  const memberRoom = (code) => {
    if (!code) return null;
    const room = getRoom(code);
    if (!room || !room.participants.has(socket.id)) return null;
    return room;
  };

  /** Relays a signaling payload to the other participant of the call. */
  const relay = (payload, cb, event, read) => {
    const { session, reason } = resolveSession(payload, socket.id);
    if (!session) {
      fail(cb, reason || 'Call no longer available');
      return;
    }
    const room = memberRoom(session.code);
    if (!room) {
      fail(cb, 'Not in room');
      return;
    }
    const target = session.initiatorId === socket.id ? session.peerId : session.initiatorId;
    if (!room.participants.has(target)) {
      fail(cb, 'The other participant is no longer in the room');
      return;
    }
    const data = read(payload);
    if (!data) {
      fail(cb, 'Invalid payload');
      return;
    }
    io.to(target).emit(event, { callId: session.callId, ...data });
    if (cb) cb({ ok: true });
  };

  // --- start a call --------------------------------------------------------
  socket.on('call:invite', (payload, cb) => {
    const code = readCode(payload);
    const room = memberRoom(code);
    if (!room) {
      fail(cb, 'Not in room');
      return;
    }
    if (sessions.has(code)) {
      fail(cb, 'A call is already in progress');
      return;
    }
    const peerId = [...room.participants].find((id) => id !== socket.id);
    if (!peerId) {
      fail(cb, 'Waiting for someone else to join the room');
      return;
    }

    const callId = randomUUID();
    const session = {
      callId,
      code,
      initiatorId: socket.id,
      peerId,
      status: 'ringing',
      timer: null,
    };
    sessions.set(code, session);
    session.timer = setTimeout(() => {
      const current = sessions.get(code);
      if (!current || current.callId !== callId) return;
      clearSession(code);
      io.to(current.initiatorId).emit('call:ended', { callId, reason: 'timeout' });
      io.to(current.peerId).emit('call:ended', { callId, reason: 'timeout' });
    }, RING_TIMEOUT_MS);
    if (typeof session.timer.unref === 'function') session.timer.unref();

    syncLog('call invite', { room: callTag(callId), participants: room.participants.size });
    io.to(peerId).emit('call:incoming', { callId, media: readMedia(payload) });
    if (cb) cb({ ok: true, callId });
  });

  // --- accept or decline ----------------------------------------------------
  socket.on('call:accept', (payload, cb) => {
    const { session, reason } = resolveSession(payload, socket.id);
    if (!session) {
      fail(cb, reason || 'Call no longer available');
      return;
    }
    if (session.peerId !== socket.id || session.status !== 'ringing') {
      fail(cb, 'Call no longer available');
      return;
    }
    session.status = 'connecting';
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    syncLog('call accepted', { call: callTag(session.callId) });
    io.to(session.initiatorId).emit('call:accepted', { callId: session.callId });
    if (cb) cb({ ok: true, callId: session.callId });
  });

  socket.on('call:decline', (payload, cb) => {
    const { session, reason } = resolveSession(payload, socket.id);
    if (!session) {
      fail(cb, reason || 'Call no longer available');
      return;
    }
    if (session.peerId !== socket.id) {
      fail(cb, 'Call no longer available');
      return;
    }
    clearSession(session.code);
    syncLog('call declined', { call: callTag(session.callId) });
    io.to(session.initiatorId).emit('call:declined', { callId: session.callId });
    if (cb) cb({ ok: true });
  });

  // --- hang up ---------------------------------------------------------------
  socket.on('call:hangup', (payload, cb) => {
    const { session, reason } = resolveSession(payload, socket.id);
    if (!session) {
      fail(cb, reason || 'Call no longer available');
      return;
    }
    const target = session.initiatorId === socket.id ? session.peerId : session.initiatorId;
    clearSession(session.code);
    syncLog('call hangup', { call: callTag(session.callId) });
    io.to(target).emit('call:ended', { callId: session.callId, reason: 'hangup' });
    if (cb) cb({ ok: true });
  });

  // --- media state (mute, camera off) ----------------------------------------
  socket.on('call:media', (payload, cb) => {
    const { session, reason } = resolveSession(payload, socket.id);
    if (!session) {
      fail(cb, reason || 'Call no longer available');
      return;
    }
    const target = session.initiatorId === socket.id ? session.peerId : session.initiatorId;
    io.to(target).emit('call:media', {
      callId: session.callId,
      mic: readBoolean(payload.mic),
      camera: readBoolean(payload.camera),
    });
    if (cb) cb({ ok: true });
  });

  // --- connection setup ------------------------------------------------------
  socket.on('call:offer', (payload, cb) => relay(payload, cb, 'call:offer', readDescription));
  socket.on('call:answer', (payload, cb) => relay(payload, cb, 'call:answer', readDescription));
  socket.on('call:ice', (payload, cb) => relay(payload, cb, 'call:ice', readCandidate));

  // --- a participant leaves --------------------------------------------------
  socket.on('disconnect', () => {
    for (const [code, session] of sessions) {
      if (session.initiatorId !== socket.id && session.peerId !== socket.id) continue;
      const target = session.initiatorId === socket.id ? session.peerId : session.initiatorId;
      clearSession(code);
      syncLog('call ended by disconnect', { call: callTag(session.callId) });
      io.to(target).emit('call:ended', { callId: session.callId, reason: 'peer-left' });
    }
  });
}

module.exports = { registerCallSignaling, RING_TIMEOUT_MS };
