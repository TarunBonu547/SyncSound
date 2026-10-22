const { randomUUID } = require('crypto');

/** A position can never be further along than a full day. */
const MAX_POSITION_SECONDS = 24 * 60 * 60;
/** The chat only keeps the last messages of a room. */
const MAX_CHAT_MESSAGES = 200;
/** A single chat message may not be longer than this. */
const MAX_CHAT_LENGTH = 500;

/**
 * The artwork of a queue item may only come from the image hosts of YouTube.
 *
 * The browser sends the address it knows. Without this check a client could
 * put any address into the queue, and every other client would load it.
 */
function safeThumbnail(value, videoId) {
  const fallback = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  if (typeof value !== 'string' || !value.startsWith('https://')) return fallback;
  try {
    const host = new URL(value).hostname.toLowerCase();
    const allowed =
      host === 'i.ytimg.com' ||
      host.endsWith('.ytimg.com') ||
      host === 'img.youtube.com' ||
      host === 'yt3.ggpht.com';
    return allowed ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Server-authoritative playback state for one room.
 *
 * The room owns the timeline: `positionSeconds` is the position at `updatedAt`,
 * and while the room is playing the expected position grows with wall-clock
 * time. Clients never push "the current player reading" as an authoritative
 * command - only explicit user actions and the track lifecycle are commands.
 */
class RoomState {
  constructor(code, name = 'Room') {
    this.code = code;
    this.name = name;
    this.participants = new Set();
    /** The details of every member: socket id -> member. */
    this.members = new Map();
    /** The identity of a client: client id -> { name, isHost }. */
    this.identities = new Map();
    /** The client id of the room creator. */
    this.hostClientId = null;
    /** Counts the guests so every member gets a stable name. */
    this.guestCounter = 0;
    /** The chat of this room, oldest first. */
    this.chat = [];
    this.queue = [];
    this.currentQueueItemId = null;
    this.currentVideoId = null;
    this.playbackStatus = 'ended';
    this.positionSeconds = 0;
    this.updatedAt = Date.now();
    this.revision = 0;
    this.queueRevision = 0;
    this.transitionId = null;
  }

  /**
   * Adds a member to the room.
   *
   * The client id identifies a person across a refresh, so a member that
   * comes back keeps its name and its host role. The display name is the name
   * the person wants to be seen under; it never identifies anybody, so two
   * members may carry the same one.
   */
  addMember(socketId, { clientId = null, isCreator = false, name = null } = {}) {
    const id = clientId || `socket:${socketId}`;
    this.participants.add(socketId);

    let identity = this.identities.get(id);
    if (!identity) {
      const isHost = isCreator || this.hostClientId === null;
      if (isHost) this.hostClientId = id;
      // A client without a name keeps the name of its role. Only the members
      // that really need a fallback are counted, so the numbers of the
      // fallback names follow each other.
      let identityName = name;
      if (!identityName) {
        if (isHost) {
          identityName = 'Host';
        } else {
          this.guestCounter += 1;
          identityName = `Listener ${this.guestCounter}`;
        }
      }
      identity = { name: identityName, isHost };
      this.identities.set(id, identity);
    } else if (name && name !== identity.name) {
      // The member chose another name: the identity of the client follows it.
      identity.name = name;
    }

    const previous = this.members.get(socketId);
    const member = {
      id: socketId,
      clientId: id,
      name: identity.name,
      isHost: identity.isHost,
      // A member that is already known keeps the moment it joined.
      joinedAt: previous ? previous.joinedAt : Date.now(),
    };
    this.members.set(socketId, member);
    return member;
  }

  /** Removes a member. The identity is kept, so a return keeps the name. */
  removeMember(socketId) {
    this.participants.delete(socketId);
    const member = this.members.get(socketId);
    this.members.delete(socketId);
    return member || null;
  }

  /** The member of a socket, if it is in this room. */
  getMember(socketId) {
    return this.members.get(socketId) || null;
  }

  /** The members of the room: the host first, then the others in join order. */
  getParticipants() {
    return [...this.members.values()]
      .sort((a, b) => (a.isHost === b.isHost ? a.joinedAt - b.joinedAt : a.isHost ? -1 : 1))
      .map((m) => ({
        id: m.id,
        clientId: m.clientId,
        name: m.name,
        isHost: m.isHost,
        joinedAt: m.joinedAt,
      }));
  }

  /** Stores a chat message and drops the oldest ones when the room gets big. */
  addChatMessage(message) {
    this.chat.push(message);
    if (this.chat.length > MAX_CHAT_MESSAGES) {
      this.chat.splice(0, this.chat.length - MAX_CHAT_MESSAGES);
    }
    return message;
  }

  /** The chat of the room, oldest first. */
  getChatHistory() {
    return this.chat.map((m) => ({ ...m }));
  }

  /** Bump the playback revision and re-anchor the timeline to now. */
  bump() {
    this.revision += 1;
    this.updatedAt = Date.now();
  }

  getQueueSnapshot() {
    return this.queue.map((q) => ({ ...q }));
  }

  getPlaybackSnapshot() {
    return {
      code: this.code,
      currentQueueItemId: this.currentQueueItemId,
      videoId: this.currentVideoId,
      playing: this.playbackStatus === 'playing',
      status: this.playbackStatus,
      position: this.positionSeconds,
      updatedAt: this.updatedAt,
      revision: this.revision,
      transitionId: this.transitionId,
    };
  }

  /**
   * Where every client of this room should be right now.
   * @param {number} [now] epoch milliseconds
   */
  getExpectedPosition(now = Date.now()) {
    if (this.playbackStatus !== 'playing') return this.positionSeconds;
    const elapsed = Math.max(0, (now - this.updatedAt) / 1000);
    return this.positionSeconds + elapsed;
  }

  validateItem(item) {
    if (!item || typeof item !== 'object') return null;
    const videoId = typeof item.videoId === 'string' ? item.videoId.trim() : '';
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
    const rawTitle = typeof item.title === 'string' ? item.title.replace(/\s+/g, ' ').trim() : '';
    const title = rawTitle ? rawTitle.slice(0, 200) : videoId;
    const rawChannel = typeof item.channel === 'string' ? item.channel.replace(/\s+/g, ' ').trim() : '';
    const channel = rawChannel ? rawChannel.slice(0, 200) : '';
    const thumbnailUrl = safeThumbnail(
      typeof item.thumbnail === 'string' ? item.thumbnail : item.thumbnailUrl,
      videoId,
    );
    const durationSeconds = Number.isFinite(item.duration)
      ? item.duration
      : Number.isFinite(item.durationSeconds)
        ? item.durationSeconds
        : null;
    return { videoId, title, channel, thumbnailUrl, durationSeconds };
  }

  queueAdd(item) {
    const v = this.validateItem(item);
    if (!v) return { ok: false, error: 'Invalid item' };
    const qi = { id: randomUUID(), ...v };
    this.queue.push(qi);
    this.queueRevision += 1;
    return { ok: true, item: qi };
  }

  queueRemove(itemId) {
    const idx = this.queue.findIndex((q) => q.id === itemId);
    if (idx === -1) return { ok: false, error: 'Item not found' };
    const wasCurrent = this.currentQueueItemId === itemId;
    this.queue.splice(idx, 1);
    this.queueRevision += 1;

    let playbackChanged = false;
    if (wasCurrent) {
      // The active track disappeared: hand over to the item that took its
      // place, or stop the room when the queue is empty.
      const next = this.queue[idx] || null;
      this.currentQueueItemId = next ? next.id : null;
      this.currentVideoId = next ? next.videoId : null;
      this.positionSeconds = 0;
      this.playbackStatus = next ? 'playing' : 'ended';
      this.transitionId = randomUUID();
      this.bump();
      playbackChanged = true;
    }
    return { ok: true, removedId: itemId, playbackChanged };
  }

  queueReorder(itemId, toIndex) {
    const idx = this.queue.findIndex((q) => q.id === itemId);
    if (idx === -1) return { ok: false, error: 'Item not found' };
    const ti = Number.isInteger(toIndex) ? toIndex : parseInt(toIndex, 10);
    if (!Number.isInteger(ti) || ti < 0 || ti >= this.queue.length) {
      return { ok: false, error: 'Invalid index' };
    }
    const [item] = this.queue.splice(idx, 1);
    this.queue.splice(ti, 0, item);
    this.queueRevision += 1;
    return { ok: true };
  }

  /** Selecting a queue item is a track change: new video, position 0, playing. */
  queuePlay(itemId) {
    const item = this.queue.find((q) => q.id === itemId);
    if (!item) return { ok: false, error: 'Item not found' };
    const same = this.currentQueueItemId === itemId && this.currentVideoId === item.videoId;
    if (same && this.playbackStatus === 'playing') return { ok: true, changed: false };
    this.currentQueueItemId = itemId;
    this.currentVideoId = item.videoId;
    this.positionSeconds = 0;
    this.playbackStatus = 'playing';
    this.transitionId = randomUUID();
    this.bump();
    return { ok: true, changed: true };
  }

  /**
   * An explicit user action (play / pause / seek). It is authoritative: the
   * room timeline is reset to the supplied position.
   */
  playbackUpdate({ videoId, playing, position }) {
    if (videoId && this.currentVideoId && videoId !== this.currentVideoId) {
      return { ok: false, error: 'Video mismatch' };
    }
    if (videoId && !this.currentVideoId) {
      // The room has no track yet - adopt the one the client is on.
      this.currentVideoId = videoId;
    }
    if (this.playbackStatus === 'ended' && playing) {
      // The room ran out of tracks. Pressing play starts the current track
      // again instead of resuming at a position that is already over.
      this.positionSeconds = 0;
    } else if (typeof position === 'number' && Number.isFinite(position) && position >= 0) {
      this.positionSeconds = position;
    }
    this.playbackStatus = playing ? 'playing' : 'paused';
    this.bump();
    return { ok: true, revision: this.revision };
  }

  /**
   * A passive reading of a client player position is never accepted: the room
   * timeline belongs to the server. A lagging client corrects itself towards
   * the room, it does not move the room.
   */

  trackEnded({ videoId, transitionId, position }) {
    if (videoId !== this.currentVideoId) return { ok: false, error: 'Stale ended event' };
    if (transitionId && transitionId !== this.transitionId) return { ok: false, error: 'Stale transition' };
    const currentIdx = this.queue.findIndex((q) => q.id === this.currentQueueItemId);
    const next = currentIdx >= 0 ? this.queue[currentIdx + 1] : null;
    if (next) {
      this.currentQueueItemId = next.id;
      this.currentVideoId = next.videoId;
      this.positionSeconds = 0;
      this.playbackStatus = 'playing';
      this.transitionId = randomUUID();
      this.bump();
      return { ok: true, advanced: true, ended: false };
    }
    // Last track of the queue: the room stops. The final position is the one
    // the video really ended at, so the playhead does not jump back.
    const end = Number.isFinite(position) && position >= 0
      ? Math.min(position, MAX_POSITION_SECONDS)
      : this.getExpectedPosition();
    this.positionSeconds = end;
    this.playbackStatus = 'ended';
    this.bump();
    return { ok: true, advanced: false, ended: true };
  }
}

module.exports = { RoomState, MAX_CHAT_LENGTH, MAX_CHAT_MESSAGES };
