import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ChatEntry, PlaybackState, QueueEntry, RoomMember, SongDedication, Track } from '../types/music';
import { avatarFor } from '../utils/avatar';

/** A chat message may not be longer than this (the server enforces it too). */
export const MAX_CHAT_LENGTH = 500;
/** A dedication on a queued song may not be longer than this. */
export const MAX_DEDICATION_LENGTH = 200;

export type UseRoomOptions = {
  /** The one socket of the tab. The room never opens a second one. */
  socket: Socket | null;
  /** The id of this tab: the server uses it to recognise the person. */
  clientId: string;
  /**
   * The name the person wants to be seen under.
   *
   * The name is only text: the server shows it, it never identifies anybody.
   */
  displayName: string;
  /**
   * The authoritative playback state of the room. The player owns it, so the
   * hook only forwards it.
   */
  onPlayback: (state: PlaybackState) => void;
  /** Reports a failure that has no place of its own. */
  onError: (message: string) => void;
};

/**
 * The room of this client.
 *
 * The hook owns everything that belongs to the room as a group: the room
 * code, the name, the members, the shared queue and the chat. The playback
 * state is only forwarded, because the player owns it.
 *
 * Exactly one listener is registered per socket event, and every listener is
 * removed when the room or the socket goes away, so a room change never
 * leaves a second listener behind.
 */
export function useRoom({ socket, clientId, displayName, onPlayback, onError }: UseRoomOptions) {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [participantCount, setParticipantCount] = useState(1);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  /** Reactions to the song that plays: emoji -> [{ clientId, clientName, timestamp }]. */
  const [reactions, setReactions] = useState<Record<string, { clientId: string; clientName: string; timestamp: number }[]>>({});
  const [draft, setDraft] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatSending, setChatSending] = useState(false);
  /** The message this client is composing a reply to, if any. */
  const [replyTo, setReplyTo] = useState<{ messageId: string; senderId: string; senderName: string; text: string } | null>(null);

  /**
   * The queue, readable right now.
   *
   * The player looks the current track up in the queue when the room changes
   * the track. A state value would be one render old at that moment, so the
   * list is kept in a ref as well.
   */
  const queueRef = useRef<QueueEntry[]>([]);

  /** The playback handler, readable from the socket listeners. */
  const playbackRef = useRef(onPlayback);
  const errorRef = useRef(onError);
  /** The newest display name, readable from the socket listeners. */
  const displayNameRef = useRef(displayName);
  /** The video id of the song that plays, used to clear reactions on track change. */
  const videoIdRef = useRef<string | null>(null);

  useEffect(() => {
    playbackRef.current = onPlayback;
    errorRef.current = onError;
  });

  useEffect(() => {
    // The name is read when the room is joined, so a name that is changed
    // later does not throw the member out of the room.
    displayNameRef.current = displayName;
  }, [displayName]);

  /** Stores the queue and keeps the ref in sync for the state handlers. */
  const applyQueue = useCallback((list: unknown) => {
    if (!Array.isArray(list)) return;
    const mapped: QueueEntry[] = list.map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      let dedication: QueueEntry['dedication'] | undefined;
      if (item.dedication && typeof item.dedication === 'object') {
        const d = item.dedication as Record<string, unknown>;
        if (
          typeof d.text === 'string' &&
          typeof d.authorId === 'string' &&
          typeof d.authorName === 'string' &&
          typeof d.createdAt === 'number'
        ) {
          dedication = { text: d.text, authorId: d.authorId, authorName: d.authorName, createdAt: d.createdAt };
        }
      }
      return {
        id: String(item.id ?? ''),
        title: String(item.title ?? ''),
        channel: String(item.channel ?? ''),
        thumbnail: String(item.thumbnailUrl ?? item.thumbnail ?? ''),
        durationSeconds:
          typeof item.durationSeconds === 'number' ? item.durationSeconds : null,
        ...(dedication && { dedication }),
      };
    });
    queueRef.current = mapped;
    setQueue(mapped);
  }, []);

  /** Turns a message of the server into a chat entry of this client. */
  const toChatEntry = useCallback(
    (message: unknown): ChatEntry | null => {
      if (!message || typeof message !== 'object') return null;
      const raw = message as Record<string, unknown>;
      if (typeof raw.id !== 'string' || !raw.id) return null;
      const userId = typeof raw.userId === 'string' ? raw.userId : '';
      const userName = typeof raw.userName === 'string' ? raw.userName : 'Listener';
      const timestamp = Number.isFinite(raw.timestamp) ? Number(raw.timestamp) : Date.now();
      const { initials, color } = avatarFor(userName, userId);
      const rawReply = raw.replyTo;
      let replyTo: ChatEntry['replyTo'] | undefined;
      if (
        rawReply &&
        typeof rawReply === 'object' &&
        typeof (rawReply as Record<string, unknown>).messageId === 'string' &&
        typeof (rawReply as Record<string, unknown>).senderId === 'string' &&
        typeof (rawReply as Record<string, unknown>).senderName === 'string' &&
        typeof (rawReply as Record<string, unknown>).text === 'string'
      ) {
        replyTo = {
          messageId: (rawReply as Record<string, unknown>).messageId as string,
          senderId: (rawReply as Record<string, unknown>).senderId as string,
          senderName: (rawReply as Record<string, unknown>).senderName as string,
          text: (rawReply as Record<string, unknown>).text as string,
        };
      }
      return {
        id: raw.id,
        userId,
        userName,
        initials,
        color,
        text: typeof raw.text === 'string' ? raw.text : '',
        timestamp,
        isSelf: userId !== '' && userId === clientId,
        ...(replyTo && { replyTo }),
      };
    },
    [clientId],
  );

  /** The presence of the room, exactly as the server reports it. */
  const applyPresence = useCallback((payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const raw = payload as Record<string, unknown>;
    if (typeof raw.count === 'number') setParticipantCount(raw.count);
    if (Array.isArray(raw.participants)) setMembers(raw.participants as RoomMember[]);
  }, []);

  // --- the socket listeners --------------------------------------------------
  useEffect(() => {
    if (!socket || !roomCode) return;

    const join = () => {
      socket.emit(
        'join-room',
        { code: roomCode, clientId, displayName: displayNameRef.current },
        (res: unknown) => {
          const answer = (res ?? {}) as Record<string, unknown>;
          if (!answer.ok) {
            errorRef.current(String(answer.error || 'Could not join room'));
            return;
          }
          // The server is the authority for the name of the room.
          if (typeof answer.name === 'string' && answer.name) setRoomName(answer.name);
          // The queue comes first: it already knows the title of the track the
          // room is playing, so the stage never shows a placeholder.
          applyQueue(answer.queue);
          if (answer.playback) {
            const pb = answer.playback as PlaybackState;
            playbackRef.current(pb);
            videoIdRef.current = pb.videoId || null;
          }
          applyPresence(answer);
          // The server owns the chat: on every join the history replaces what
          // is on screen, so a reconnect never shows a message twice.
          if (Array.isArray(answer.messages)) {
            const history = answer.messages
              .map((message) => toChatEntry(message))
              .filter((entry): entry is ChatEntry => entry !== null);
            setMessages(history);
          }
          // Reactions are transient: they never survive a (re)join.
          setReactions({});
        },
      );
    };

    // Join on mount and again after every reconnect: the server keeps the
    // room alive, but a new socket id has to be registered again.
    join();
    socket.on('connect', join);

    const onPlaybackUpdate = (payload: unknown) => {
      const state = payload as PlaybackState;
      playbackRef.current(state);
      // A new video means a new song: drop old reactions.
      if (state.videoId && videoIdRef.current !== null && state.videoId !== videoIdRef.current) {
        setReactions({});
      }
      videoIdRef.current = state.videoId || null;
    };
    const onQueueUpdate = (payload: unknown) => {
      const raw = (payload ?? {}) as Record<string, unknown>;
      applyQueue(raw.queue);
    };
    const onRoomUpdate = (payload: unknown) => {
      applyPresence(payload);
    };
    const onChatMessage = (payload: unknown) => {
      const entry = toChatEntry(payload);
      if (!entry) return;
      // The server sends every message once, but a duplicated broadcast must
      // not become a second bubble.
      setMessages((prev) => (prev.some((x) => x.id === entry.id) ? prev : [...prev, entry]));
    };

    /** A reaction to the current song. The server already rate limits, so the
       client only stores and renders it. Reactions expire after TTL. */
    const onReaction = (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const raw = payload as Record<string, unknown>;
      const emoji = typeof raw.emoji === 'string' ? raw.emoji : '';
      const clientId = typeof raw.clientId === 'string' ? raw.clientId : '';
      const clientName = typeof raw.clientName === 'string' ? raw.clientName : '';
      const timestamp = Number.isFinite(raw.timestamp) ? Number(raw.timestamp) : Date.now();
      if (!emoji || !clientId) return;
      setReactions((prev) => {
        const next = { ...prev };
        const list = [...(next[emoji] || [])];
        // Replace an existing reaction from the same client (update in place).
        const idx = list.findIndex((r) => r.clientId === clientId);
        if (idx !== -1) list[idx] = { clientId, clientName, timestamp };
        else list.push({ clientId, clientName, timestamp });
        next[emoji] = list;
        return next;
      });
    };

    socket.on('playback-update', onPlaybackUpdate);
    socket.on('queue-update', onQueueUpdate);
    socket.on('room-update', onRoomUpdate);
    socket.on('chat:message', onChatMessage);
    socket.on('song:reaction', onReaction);

    return () => {
      socket.off('connect', join);
      socket.off('playback-update', onPlaybackUpdate);
      socket.off('queue-update', onQueueUpdate);
      socket.off('room-update', onRoomUpdate);
      socket.off('chat:message', onChatMessage);
      socket.off('song:reaction', onReaction);
    };
  }, [socket, roomCode, clientId, applyQueue, applyPresence, toChatEntry]);

  // --- actions ----------------------------------------------------------------
  /** Enters a room. The room is joined by the effect above. */
  const enterRoom = useCallback((code: string, name?: string | null) => {
    const wanted = code.trim().toUpperCase();
    if (!wanted) return;
    // A new room never keeps the reply target of the previous one.
    setReplyTo(null);
    setRoomCode(wanted);
    setRoomName(name ? name : null);
  }, []);

  /** Leaves the room on purpose and returns to the lobby. */
  const leaveRoom = useCallback(() => {
    if (socket && roomCode) socket.emit('leave-room', { code: roomCode });
    setRoomCode(null);
    setRoomName(null);
    setMembers([]);
    setParticipantCount(1);
    setMessages([]);
    setChatError(null);
    setChatSending(false);
    setDraft('');
    setReplyTo(null);
    setQueue([]);
    queueRef.current = [];
    setReactions({});
  }, [socket, roomCode]);

  /**
   * Selects the message this client is replying to. The caller passes the full
   * message data, so a reply target is captured exactly once and cannot drift
   * while messages arrive or the list re-renders.
   */
  const selectReply = useCallback((message: { messageId: string; senderId: string; senderName: string; text: string }) => {
    setReplyTo(message);
  }, []);

  /** Cancels the reply that is being composed, without touching the draft. */
  const cancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  /**
   * Sends a chat message. The server owns the chat, so the message is only
   * shown when the server accepted it and delivered it to the room.
   */
  const sendMessage = useCallback(() => {
    const text = draft.trim();
    if (!text) {
      setChatError('Message cannot be empty');
      return;
    }
    if (text.length > MAX_CHAT_LENGTH) {
      setChatError(`Message is too long (max ${MAX_CHAT_LENGTH} characters)`);
      return;
    }
    if (!socket || !roomCode) {
      setChatError('You are not in a room');
      return;
    }
    setChatError(null);
    setChatSending(true);
    socket.emit(
      'chat:send',
      {
        code: roomCode,
        text,
        ...(replyTo && { replyTo: { messageId: replyTo.messageId, senderId: replyTo.senderId, senderName: replyTo.senderName, text: replyTo.text } }),
      },
      (res: unknown) => {
        setChatSending(false);
        const answer = (res ?? {}) as Record<string, unknown>;
        if (!answer.ok) {
          // The selection is kept on failure, so the user can retry the reply.
          setChatError(String(answer.error || 'The message could not be sent'));
          return;
        }
        // The draft and the reply target are cleared only when the server took
        // the message, so a failed send keeps both and can be retried.
        setDraft('');
        setReplyTo(null);
      }
    );
  }, [socket, roomCode, draft, replyTo]);

  /** The item that enters the queue, with an optional dedication attached. */
  const queueItemOf = useCallback(
    (track: Track, dedication?: SongDedication) => ({
      videoId: track.id,
      title: track.title,
      channel: track.channel,
      thumbnail: track.thumbnail,
      duration: track.durationSeconds ?? undefined,
      ...(dedication && { dedication }),
    }),
    [],
  );

  /**
   * Adds a track to the queue of the room. The promise resolves with the
   * reason when the server refused the track, so the search and the library
   * can show what went wrong.
   */
  const addTrackToQueue = useCallback(
    (track: Track, dedication?: SongDedication): Promise<string | null> => {
      if (!socket || !roomCode) return Promise.resolve('Join a room first');
      return new Promise((resolve) => {
        socket.emit('QUEUE_ADD', { code: roomCode, item: queueItemOf(track, dedication) }, (res: unknown) => {
          const answer = (res ?? {}) as Record<string, unknown>;
          if (!answer.ok) {
            resolve(String(answer.error || 'The track could not be added'));
            return;
          }
          resolve(null);
        });
      });
    },
    [socket, roomCode, queueItemOf],
  );

  /** Adds a track and starts it for everybody in the room. */
  const playTrack = useCallback(
    (track: Track, dedication?: SongDedication): Promise<string | null> => {
      if (!socket || !roomCode) return Promise.resolve('Join a room first');
      return new Promise((resolve) => {
        socket.emit('QUEUE_ADD', { code: roomCode, item: queueItemOf(track, dedication) }, (res: unknown) => {
          const answer = (res ?? {}) as Record<string, unknown>;
          if (!answer.ok) {
            resolve(String(answer.error || 'The track could not be added'));
            return;
          }
          const item = (answer.item ?? {}) as Record<string, unknown>;
          socket.emit('QUEUE_PLAY', { code: roomCode, itemId: String(item.id) }, (res2: unknown) => {
            const answer2 = (res2 ?? {}) as Record<string, unknown>;
            if (!answer2.ok) {
              resolve(String(answer2.error || 'The track could not be started'));
              return;
            }
            resolve(null);
          });
        });
      });
    },
    [socket, roomCode, queueItemOf],
  );

  /** Starts a track of the shared queue. */
  const playQueueItem = useCallback(
    (itemId: string) => {
      if (!socket || !roomCode) return;
      socket.emit('QUEUE_PLAY', { code: roomCode, itemId }, (res: unknown) => {
        const answer = (res ?? {}) as Record<string, unknown>;
        if (!answer.ok) errorRef.current(String(answer.error || 'The track could not be started'));
      });
    },
    [socket, roomCode],
  );

  /** Moves a track of the shared queue one place up or down. */
  const moveQueueItem = useCallback(
    (itemId: string, direction: -1 | 1) => {
      if (!socket || !roomCode) return;
      const index = queueRef.current.findIndex((item) => item.id === itemId);
      if (index === -1) return;
      const toIndex = Math.min(queueRef.current.length - 1, Math.max(0, index + direction));
      if (toIndex === index) return;
      socket.emit('QUEUE_REORDER', { code: roomCode, itemId, toIndex });
    },
    [socket, roomCode],
  );

  /** Takes a track out of the shared queue. */
  const removeQueueItem = useCallback(
    (itemId: string) => {
      if (!socket || !roomCode) return;
      socket.emit('QUEUE_REMOVE', { code: roomCode, itemId });
    },
    [socket, roomCode],
  );

  /**
   * Edits or removes the dedication on a queued song. Pass an empty string or
   * null to remove the dedication. Only the author may edit it.
   */
  const editDedication = useCallback(
    (itemId: string, text: string | null): Promise<string | null> => {
      if (!socket || !roomCode) return Promise.resolve('Join a room first');
      return new Promise((resolve) => {
        socket.emit(
          'QUEUE_EDIT_DEDICATION',
          { code: roomCode, itemId, dedication: text },
          (res: unknown) => {
            const answer = (res ?? {}) as Record<string, unknown>;
            if (!answer.ok) {
              resolve(String(answer.error || 'The dedication could not be saved'));
              return;
            }
            resolve(null);
          }
        );
      });
    },
    [socket, roomCode],
  );

  /**
   * Sends a quick emoji reaction to the song that plays. The server rate
   * limits per client, so a rapid tap does not spam the room.
   */
  const sendReaction = useCallback(
    (emoji: string): Promise<string | null> => {
      if (!socket || !roomCode) return Promise.resolve('Join a room first');
      return new Promise((resolve) => {
        socket.emit('SONG_REACTION', { code: roomCode, emoji }, (res: unknown) => {
          const answer = (res ?? {}) as Record<string, unknown>;
          if (!answer.ok) {
            resolve(String(answer.error || 'The reaction could not be sent'));
            return;
          }
          resolve(null);
        });
      });
    },
    [socket, roomCode],
  );

  return {
    roomCode,
    roomName,
    members,
    participantCount,
    queue,
    queueRef,
    messages,
    reactions,
    draft,
    setDraft,
    chatError,
    chatSending,
    replyTo,
    selectReply,
    cancelReply,
    enterRoom,
    leaveRoom,
    sendMessage,
    addTrackToQueue,
    playTrack,
    playQueueItem,
    moveQueueItem,
    removeQueueItem,
    editDedication,
    sendReaction,
  };
}

export type RoomState = ReturnType<typeof useRoom>;
