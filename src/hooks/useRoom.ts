import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ChatEntry, PlaybackState, QueueEntry, RoomMember, Track } from '../types/music';
import { avatarFor } from '../utils/avatar';

/** A chat message may not be longer than this (the server enforces it too). */
export const MAX_CHAT_LENGTH = 500;

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
  const [draft, setDraft] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatSending, setChatSending] = useState(false);

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
      return {
        id: String(item.id ?? ''),
        title: String(item.title ?? ''),
        channel: String(item.channel ?? ''),
        thumbnail: String(item.thumbnailUrl ?? item.thumbnail ?? ''),
        durationSeconds:
          typeof item.durationSeconds === 'number' ? item.durationSeconds : null,
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
      return {
        id: raw.id,
        userId,
        userName,
        initials,
        color,
        text: typeof raw.text === 'string' ? raw.text : '',
        timestamp,
        isSelf: userId !== '' && userId === clientId,
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
          if (answer.playback) playbackRef.current(answer.playback as PlaybackState);
          applyPresence(answer);
          // The server owns the chat: on every join the history replaces what
          // is on screen, so a reconnect never shows a message twice.
          if (Array.isArray(answer.messages)) {
            const history = answer.messages
              .map((message) => toChatEntry(message))
              .filter((entry): entry is ChatEntry => entry !== null);
            setMessages(history);
          }
        },
      );
    };

    // Join on mount and again after every reconnect: the server keeps the
    // room alive, but a new socket id has to be registered again.
    join();
    socket.on('connect', join);

    const onPlaybackUpdate = (payload: unknown) => {
      playbackRef.current(payload as PlaybackState);
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

    socket.on('playback-update', onPlaybackUpdate);
    socket.on('queue-update', onQueueUpdate);
    socket.on('room-update', onRoomUpdate);
    socket.on('chat:message', onChatMessage);

    return () => {
      socket.off('connect', join);
      socket.off('playback-update', onPlaybackUpdate);
      socket.off('queue-update', onQueueUpdate);
      socket.off('room-update', onRoomUpdate);
      socket.off('chat:message', onChatMessage);
    };
  }, [socket, roomCode, clientId, applyQueue, applyPresence, toChatEntry]);

  // --- actions ----------------------------------------------------------------
  /** Enters a room. The room is joined by the effect above. */
  const enterRoom = useCallback((code: string, name?: string | null) => {
    const wanted = code.trim().toUpperCase();
    if (!wanted) return;
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
    setQueue([]);
    queueRef.current = [];
  }, [socket, roomCode]);

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
    socket.emit('chat:send', { code: roomCode, text }, (res: unknown) => {
      setChatSending(false);
      const answer = (res ?? {}) as Record<string, unknown>;
      if (!answer.ok) {
        setChatError(String(answer.error || 'The message could not be sent'));
        return;
      }
      // The message is cleared only when the server took it, so a failed
      // send keeps the text and can be retried.
      setDraft('');
    });
  }, [socket, roomCode, draft]);

  /** The item that enters the queue. */
  const queueItemOf = useCallback(
    (track: Track) => ({
      videoId: track.id,
      title: track.title,
      channel: track.channel,
      thumbnail: track.thumbnail,
      duration: track.durationSeconds ?? undefined,
    }),
    [],
  );

  /**
   * Adds a track to the queue of the room. The promise resolves with the
   * reason when the server refused the track, so the search and the library
   * can show what went wrong.
   */
  const addTrackToQueue = useCallback(
    (track: Track): Promise<string | null> => {
      if (!socket || !roomCode) return Promise.resolve('Join a room first');
      return new Promise((resolve) => {
        socket.emit('QUEUE_ADD', { code: roomCode, item: queueItemOf(track) }, (res: unknown) => {
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
    (track: Track): Promise<string | null> => {
      if (!socket || !roomCode) return Promise.resolve('Join a room first');
      return new Promise((resolve) => {
        socket.emit('QUEUE_ADD', { code: roomCode, item: queueItemOf(track) }, (res: unknown) => {
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

  return {
    roomCode,
    roomName,
    members,
    participantCount,
    queue,
    queueRef,
    messages,
    draft,
    setDraft,
    chatError,
    chatSending,
    enterRoom,
    leaveRoom,
    sendMessage,
    addTrackToQueue,
    playTrack,
    playQueueItem,
    moveQueueItem,
    removeQueueItem,
  };
}

export type RoomState = ReturnType<typeof useRoom>;
