import { useEffect, useRef } from 'react';
import { Send, Users, MessageCircle } from 'lucide-react';
import type { ChatEntry, RoomMember } from '../../types/music';
import { avatarFor, formatTime } from '../../utils/avatar';
import { MAX_CHAT_LENGTH } from '../../hooks/useRoom';
import StatusIndicator from '../common/StatusIndicator';

type ChatPanelProps = {
  roomCode: string | null;
  roomName: string | null;
  members: RoomMember[];
  clientId: string;
  connected: boolean;
  messages: ChatEntry[];
  draft: string;
  chatError: string | null;
  /** True while a message is on its way to the server. */
  chatSending: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  /** Shown when the panel is used outside of the room, e.g. in a drawer. */
  onClose?: () => void;
};

/**
 * The chat of the room.
 *
 * The server owns the chat: a message only shows up when the server accepted
 * it, and the history of the room arrives with the room. The list scrolls on
 * its own, so a long conversation never moves the player or the queue.
 */
export default function ChatPanel({
  roomCode,
  roomName,
  members,
  clientId,
  connected,
  messages,
  draft,
  chatError,
  chatSending,
  onDraftChange,
  onSend,
  onClose,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastId = messages.length ? messages[messages.length - 1].id : null;

  // The newest message is always in sight.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [lastId]);

  const count = Math.max(1, members.length);
  const inRoom = !!roomCode;

  return (
    <section className="card chat-card" aria-labelledby="chat-title">
      <div className="chat-head">
        <div className="chat-head-text">
          <p className="eyebrow">Live chat</p>
          <h2 className="section-title" id="chat-title">
            {roomName || 'Your room'}
          </h2>
          <div className="chat-head-meta">
            <StatusIndicator
              connected={connected}
              label={connected ? 'Connected' : 'Reconnecting…'}
              live={inRoom}
            />
            <span className="room-member-count">
              <Users size={13} aria-hidden="true" />
              {count} {count === 1 ? 'listener' : 'listeners'}
            </span>
          </div>
        </div>
        {onClose && (
          <button className="btn icon sm chat-drawer-close" onClick={onClose} title="Close the chat" aria-label="Close the chat">
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>

      {members.length > 0 && (
        <ul className="chat-members" aria-label="Members of the room">
          {members.map((member) => {
            const avatar = avatarFor(member.name, member.clientId);
            const isSelf = member.clientId === clientId;
            return (
              <li className="chat-member" key={member.clientId} title={isSelf ? `${member.name} (you)` : member.name}>
                <span className="chat-member-avatar" style={{ background: avatar.color }} aria-hidden="true">
                  {avatar.initials}
                </span>
                <span className="chat-member-name">{member.name}</span>
                {isSelf && <span className="chat-member-you">you</span>}
                <span className="presence is-online" aria-hidden="true" />
              </li>
            );
          })}
        </ul>
      )}

      <div className="chat-scroll" ref={scrollRef} role="log" aria-live="polite" aria-label="Messages of the room">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <span className="chat-empty-icon" aria-hidden="true">
              <MessageCircle size={20} />
            </span>
            <p className="chat-empty-title">No messages yet</p>
            <p className="chat-empty-hint">Say hello to the people in the room.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`chat-msg ${m.isSelf ? 'is-self' : ''}`}
              style={{ alignSelf: m.isSelf ? 'flex-end' : 'flex-start' }}
            >
              {!m.isSelf && (
                <span className="chat-avatar" style={{ background: m.color }} aria-hidden="true">
                  {m.initials}
                </span>
              )}
              <div className={`chat-bubble ${m.isSelf ? 'is-self' : ''}`}>
                <p className="chat-author">
                  {m.userName} · {formatTime(m.timestamp)}
                </p>
                <p>{m.text}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {chatError && (
        <p className="error-text chat-error" role="alert">
          {chatError}
        </p>
      )}
      {!connected && (
        <p className="hint chat-error" role="status">
          The connection is broken. Messages are sent again once it is back.
        </p>
      )}

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <input
          className="input"
          value={draft}
          aria-label="Message"
          maxLength={MAX_CHAT_LENGTH}
          disabled={!inRoom}
          placeholder={inRoom ? 'Message the room…' : 'Join a room to chat'}
          onChange={(e) => onDraftChange(e.target.value)}
        />
        <button
          className="btn icon primary"
          type="submit"
          disabled={!inRoom || chatSending}
          title="Send message"
          aria-label="Send message"
        >
          <Send size={15} />
        </button>
      </form>
    </section>
  );
}
