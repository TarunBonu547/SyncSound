import { useCallback, useEffect, useRef } from 'react';
import { Send, Reply, Users, MessageCircle, X } from 'lucide-react';
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
  /** The message this client is composing a reply to, if any. */
  replyTo: { messageId: string; senderId: string; senderName: string; text: string } | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  /** Selects the message the next sent message replies to. */
  onSelectReply: (message: { messageId: string; senderId: string; senderName: string; text: string }) => void;
  /** Cancels the reply that is being composed. */
  onCancelReply: () => void;
  /** Shown when the panel is used outside of the room, e.g. in a drawer. */
  onClose?: () => void;
};

/** The longest snippet shown inside a quoted reply preview. */
const QUOTE_PREVIEW_LENGTH = 110;

/** Shortens a quoted message, keeping whole words where possible. */
function previewOf(text: string): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= QUOTE_PREVIEW_LENGTH) return clean;
  return clean.slice(0, QUOTE_PREVIEW_LENGTH).trimEnd() + '…';
}

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
  replyTo,
  onDraftChange,
  onSend,
  onSelectReply,
  onCancelReply,
  onClose,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastId = messages.length ? messages[messages.length - 1].id : null;

  // The newest message is always in sight.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [lastId]);

  /** Scrolls to the original message of a reply and briefly highlights it. */
  const scrollToMessage = useCallback(
    (messageId: string) => {
      if (highlightTimer.current) {
        clearTimeout(highlightTimer.current);
        highlightTimer.current = null;
      }
      const el = document.getElementById(`msg-${messageId}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('chat-msg--highlighted');
      highlightTimer.current = setTimeout(() => {
        el.classList.remove('chat-msg--highlighted');
        highlightTimer.current = null;
      }, 1500);
    },
    [],
  );

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
          messages.map((m) => {
            const quote = m.replyTo;
            const isReplyingToMe = Boolean(replyTo && replyTo.messageId === m.id);
            return (
              <div
                id={`msg-${m.id}`}
                key={m.id}
                className={`chat-msg ${m.isSelf ? 'is-self' : ''} ${isReplyingToMe ? 'is-replied-to' : ''}`}
                style={{ alignSelf: m.isSelf ? 'flex-end' : 'flex-start' }}
              >
                {!m.isSelf && (
                  <span className="chat-avatar" style={{ background: m.color }} aria-hidden="true">
                    {m.initials}
                  </span>
                )}
                <div className={`chat-bubble ${m.isSelf ? 'is-self' : ''}`}>
                  <div className="chat-actions">
                    <button
                      type="button"
                      className="chat-reply-btn"
                      onClick={() =>
                        onSelectReply({
                          messageId: m.id,
                          senderId: m.userId,
                          senderName: m.userName,
                          text: m.text,
                        })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectReply({
                            messageId: m.id,
                            senderId: m.userId,
                            senderName: m.userName,
                            text: m.text,
                          });
                        }
                      }}
                      title="Reply to this message"
                      aria-label={`Reply to ${m.userName}`}
                      aria-controls={`msg-${m.id}`}
                    >
                      <Reply size={14} aria-hidden="true" />
                      <span className="sr-only">Reply</span>
                    </button>
                  </div>
                  <p className="chat-author">
                    {m.userName} · {formatTime(m.timestamp)}
                  </p>
                  {quote && (
                    <div
                      className="chat-quote"
                      onClick={() => scrollToMessage(quote.messageId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          scrollToMessage(quote.messageId);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Reply to ${quote.senderName}`}
                    >
                      <span className="chat-quote-sender">{quote.senderName}</span>
                      <p className="chat-quote-text">{previewOf(quote.text)}</p>
                    </div>
                  )}
                  <p>{m.text}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {replyTo && (
        <div className="chat-reply-preview" role="status" aria-live="polite">
          <button
            type="button"
            className="chat-reply-cancel"
            onClick={onCancelReply}
            title="Cancel reply"
            aria-label="Cancel reply"
          >
            <X size={15} aria-hidden="true" />
            <span className="sr-only">Cancel reply</span>
          </button>
          <div className="chat-reply-info">
            <span className="chat-reply-label">Replying to {replyTo.senderName}</span>
            <p className="chat-reply-text">{previewOf(replyTo.text)}</p>
          </div>
        </div>
      )}

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
