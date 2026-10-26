export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover: string;
  liked?: boolean;
}

/** A personal note attached to one queued song. */
export interface SongDedication {
  /** The dedication text, never empty after validation. */
  text: string;
  /** The client id of the listener who wrote it. */
  authorId: string;
  /** The display name of the author, shown beside the note. */
  authorName: string;
  /** When the note was written, epoch milliseconds. */
  createdAt: number;
}

/** A track of the shared queue: a YouTube video with its metadata. */
export interface Track {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  /** The length of the video, when it is known. */
  durationSeconds?: number | null;
  /** Optional dedication attached to this queued occurrence of the video. */
  dedication?: SongDedication;
}

/** An entry of the shared room queue. */
export interface QueueEntry {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationSeconds?: number | null;
  /** Optional dedication attached to this queue item. */
  dedication?: SongDedication;
}

/**
 * The authoritative room state as broadcast by the server.
 *
 * The server owns the timeline: `position` is the position at `updatedAt`,
 * and while the room plays the expected position grows with the wall clock.
 */
export interface PlaybackState {
  currentQueueItemId: string | null;
  videoId: string | null;
  playing: boolean;
  /** 'playing' | 'paused' | 'ended' - the room is finished on 'ended'. */
  status?: 'playing' | 'paused' | 'ended';
  position: number;
  updatedAt: number;
  revision: number;
  transitionId: string | null;
  reason?: string;
  serverNow?: number;
}

/** The message a chat entry replies to, when it is a reply. */
export interface ChatReply {
  /** The id of the original message, never an array index. */
  messageId: string;
  senderId: string;
  senderName: string;
  text: string;
}

/** A chat message as stored by the server. */
export interface ChatEntry {
  id: string;
  userId: string;
  userName: string;
  /** The initials of the sender, shown in the avatar bubble. */
  initials: string;
  /** The colour of the avatar bubble, derived from the sender. */
  color: string;
  text: string;
  timestamp: number;
  isSelf: boolean;
  /** Optional metadata of the message this entry replies to. Legacy messages
     do not have it, so it stays optional and absent entries render as before. */
  replyTo?: ChatReply;
}

/** A member of a room, exactly as the server reports it. */
export interface RoomMember {
  id: string;
  clientId: string;
  name: string;
  isHost: boolean;
}

export interface Participant {
  id: string;
  name: string;
  avatar: string;
  isHost: boolean;
  online: boolean;
  status: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  avatar: string;
  text: string;
  timestamp: number;
  isSelf: boolean;
}

/** The tone of a short lived message in the corner of the screen. */
export type ToastTone = 'info' | 'success' | 'error';

export interface ToastMessage {
  id: string;
  text: string;
  tone: ToastTone;
}
