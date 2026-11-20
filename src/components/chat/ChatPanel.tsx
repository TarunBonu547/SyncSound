import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Reply, Users, MessageCircle, X, Volume2, VolumeX } from 'lucide-react';
import type { ChatEntry, RoomMember } from '../../types/music';
import { avatarFor, formatTime } from '../../utils/avatar';
import { MAX_CHAT_LENGTH } from '../../hooks/useRoom';
import StatusIndicator from '../common/StatusIndicator';
import ChatEmojiPicker from './EmojiPicker';

type ChatPanelProps = {
  roomCode: string | null;
  roomName: string | null;
  members: RoomMember[];
  clientId: string;
  connected: boolean;
  messages: ChatEntry[];
  /** Remote participants who are currently typing, keyed by client id. */
  typing: Record<string, { clientId: string; name: string }>;
  draft: string;
  chatError: string | null;
  /** True while a message is on its way to the server. */
  chatSending: boolean;
  /** The message this client is composing a reply to, if any. */
  replyTo: { messageId: string; senderId: string; senderName: string; text: string } | null;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  /** Signals that the local participant started or stopped typing. */
  sendTyping: (start: boolean) => void;
  /** Selects the message the next sent message replies to. */
  onSelectReply: (message: { messageId: string; senderId: string; senderName: string; text: string }) => void;
  /** Cancels the reply that is being composed. */
  onCancelReply: () => void;
  /** True when incoming message notifications are muted. */
  muted: boolean;
  /** Toggles the mute state of incoming message notifications. */
  onToggleMute: () => void;
  /** Marks a single message as delivered or seen. */
  onAckMessage: (messageId: string, status: 'delivered' | 'seen') => void;
  /** Marks every pending local message as delivered or seen. */
  onAckAll: (status: 'delivered' | 'seen') => void;
  /** Shown when the panel is used outside of the room, e.g. in a drawer. */
  onClose?: () => void;
};

/** Shortens a quoted message, keeping whole words where possible. */
const QUOTE_PREVIEW_LENGTH = 110;

/** Trims a quoted message so the preview stays compact. */
function previewOf(text: string) {
  if (text.length <= QUOTE_PREVIEW_LENGTH) return text;
  const slice = text.slice(0, QUOTE_PREVIEW_LENGTH);
  const space = slice.lastIndexOf(' ');
  return `${space > 40 ? slice.slice(0, space) : slice}…`;
}

/** True when a grapheme cluster should be treated as an emoji for sizing. */
function isEmojiGrapheme(segment: string) {
  return /(\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}])/u.test(segment);
}

/** Renders the read-receipt tick(s) for an outgoing message. */
function MessageStatus({ status }: { status?: 'sent' | 'delivered' | 'seen' }) {
  if (!status) return null;
  if (status === 'sent') {
    return (
      <span className="chat-status" aria-label="Sent">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="5 12 10 17 19 7" />
        </svg>
      </span>
    );
  }
  if (status === 'delivered') {
    return (
      <span className="chat-status" aria-label="Delivered">
        <svg width="16" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 12 8 17 13 7" />
          <polyline points="11 12 16 17 25 7" />
        </svg>
      </span>
    );
  }
  return (
    <span className="chat-status is-seen" aria-label="Seen">
      <svg width="16" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 12 8 17 13 7" />
        <polyline points="11 12 16 17 25 7" />
      </svg>
    </span>
  );
}

/**
 * Renders chat message text. Emoji-only messages become prominent; mixed
 * messages keep normal text size but enlarge emoji graphemes.
 */
function renderChatText(text: string, emojiOnly: boolean) {
  if (emojiOnly) {
    return <span className="chat-text chat-text--emoji-only">{text}</span>;
  }
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const segments = Array.from(segmenter.segment(text), (s) => s.segment);
    return (
      <span className="chat-text">
        {segments.map((seg, i) =>
          isEmojiGrapheme(seg) ? (
            <span key={i} className="chat-emoji">
              {seg}
            </span>
          ) : (
            <span key={i}>{seg}</span>
          ),
        )}
      </span>
    );
  }
  return <span className="chat-text">{text}</span>;
}

export default function ChatPanel({
  roomCode,
  roomName,
  members,
  clientId,
  connected,
  messages,
  typing,
  draft,
  chatError,
  chatSending,
  replyTo,
  onDraftChange,
  onSend,
  sendTyping,
  onSelectReply,
  onCancelReply,
  muted,
  onToggleMute,
  onAckMessage,
  onAckAll,
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

  const [showEmoji, setShowEmoji] = useState(false);
  /** True once the component has mounted; history loaded on mount never animates. */
  const [mounted, setMounted] = useState(false);
  /** Last committed emoji picker position, retained while the chat stays open. */
  const [pickerPosition, setPickerPosition] = useState<{ x: number; y: number } | null>(null);
  /** Ref to the smiley trigger button, used to anchor the floating picker. */
  const inputRef = useRef<HTMLInputElement | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  /** Cursor position to restore after a controlled draft update from emoji insertion. */
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  /** Whether the local participant has already emitted TYPING_START (transition tracking). */
  const isLocallyTypingRef = useRef(false);
  /** Debounce timer that emits TYPING_STOP after ~2s of inactivity. */
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Message ids that have already played their entrance animation. */
  const animatedRef = useRef<Set<string>>(new Set());

  /** Inserts an emoji at the current caret position, preserving typed text. */
  const insertEmoji = useCallback(
    (emoji: string) => {
      const el = inputRef.current;
      if (!el) return;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const value = el.value;
      const next = value.slice(0, start) + emoji + value.slice(end);
      onDraftChange(next);
      pendingSelection.current = { start: start + emoji.length, end: start + emoji.length };
      // Keep the picker open so the user can select multiple emojis in a row.
    },
    [onDraftChange],
  );

  /** Marks every pending local message as delivered when the chat is opened. */
  useEffect(() => {
    if (!roomCode) return;
    onAckAll('delivered');
  }, [roomCode, onAckAll]);

  /** Wraps onDraftChange so typing transitions emit TYPING_START/TYPING_STOP. */
  const onDraftChangeWithTyping = useCallback(
    (value: string) => {
      onDraftChange(value);
      const isTyping = value.trim().length > 0;
      if (isTyping && !isLocallyTypingRef.current) {
        isLocallyTypingRef.current = true;
        sendTyping(true);
      }
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (isTyping) {
        typingTimerRef.current = setTimeout(() => {
          isLocallyTypingRef.current = false;
          sendTyping(false);
          typingTimerRef.current = null;
        }, 2000);
      } else {
        isLocallyTypingRef.current = false;
        sendTyping(false);
        typingTimerRef.current = null;
      }
    },
    [onDraftChange, sendTyping],
  );

  // Marks the component as mounted. History that arrives while mounted is
  // false (during the initial render) never plays its entrance animation.
  useEffect(() => {
    setMounted(true);
  }, []);

  // After every render, mark all currently rendered messages as animated so
  // they never replay their entrance animation on subsequent re-renders.
  useEffect(() => {
    messages.forEach((m) => animatedRef.current.add(m.id));
  }, [messages]);

  // Restores the caret position after the controlled draft re-renders with the
  // inserted emoji, so typing can continue from the right place.
  useEffect(() => {
    if (pendingSelection.current && inputRef.current) {
      const { start, end } = pendingSelection.current;
      inputRef.current.setSelectionRange(start, end);
      pendingSelection.current = null;
    }
  }, [draft]);

  // Stops the local typing indicator when the panel unmounts (room left, drawer closed).
  useEffect(() => {
    return () => {
      isLocallyTypingRef.current = false;
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
      sendTyping(false);
    };
  }, [sendTyping]);

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

  /** Tracks which messages have already been reported as seen. */
  const seenRef = useRef<Set<string>>(new Set());
  /** Intersection observer that marks visible messages as seen. */
  const observerRef = useRef<IntersectionObserver | null>(null);

  // When the chat is open, mark every pending outgoing message as delivered
  // once, so the sender sees the double grey tick.
  useEffect(() => {
    if (!roomCode) return;
    onAckAll('delivered');
  }, [roomCode, onAckAll]);

  // Watch the chat scroll container for messages entering the viewport and
  // mark them as seen. Only outgoing messages get a receipt; incoming ones
  // do not display an outgoing status.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const toAck: string[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.id.replace(/^msg-/, '');
          const message = messages.find((m) => m.id === id);
          if (!message || !message.isSelf) continue;
          if (message.status === 'seen') continue;
          if (seenRef.current.has(id)) continue;
          seenRef.current.add(id);
          toAck.push(id);
        }
        if (toAck.length) {
          toAck.forEach((id) => onAckMessage(id, 'seen'));
        }
      },
      { root: scrollEl, rootMargin: '0px 0px -10% 0px', threshold: 0.6 },
    );
    observerRef.current = observer;

    // Observe every outgoing message that is not yet seen.
    const timer = window.setTimeout(() => {
      messages.forEach((m) => {
        if (m.isSelf && m.status !== 'seen') {
          const el = document.getElementById(`msg-${m.id}`);
          if (el) observer.observe(el);
        }
      });
    }, 150);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [messages, onAckMessage]);

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
              <Users size={14} aria-hidden="true" />
              {count} {count === 1 ? 'listener' : 'listeners'}
            </span>
          </div>
        </div>
        {onClose && (
          <button className="btn icon chat-drawer-close" onClick={onClose} title="Close the chat" aria-label="Close the chat">
            <span aria-hidden="true">×</span>
          </button>
        )}
        <button
          className="btn icon sm chat-mute"
          onClick={onToggleMute}
          title={muted ? 'Unmute message notifications' : 'Mute message notifications'}
          aria-label={muted ? 'Unmute message notifications' : 'Mute message notifications'}
          aria-pressed={muted}
        >
          {muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
          <span className="sr-only">{muted ? 'Unmute' : 'Mute'}</span>
        </button>
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
          messages.map((m, i) => {
            const quote = m.replyTo;
            const isReplyingToMe = Boolean(replyTo && replyTo.messageId === m.id);
            const prev = messages[i - 1];
            const prevSender = prev ? (prev.isSelf ? clientId : prev.userId) : null;
            const thisSender = m.isSelf ? clientId : m.userId;
            /** Shows the sender name only for the first message of a run
               from the same person, keeping consecutive messages tight. */
            const showHeader = prevSender !== thisSender;
            /** Only newly arrived messages animate; history never replays. */
            const isNew = mounted && !animatedRef.current.has(m.id);
            const trimmed = m.text.trim();
            /** Emoji-only messages get a subtler scale-in; text+emoji messages do not. */
            const isEmojiOnly =
              trimmed.length > 0 &&
              [...trimmed].every(
                (ch) => /\p{Emoji}/u.test(ch) || '\uFE0F\u200D\u20E3 '.includes(ch),
              );
            const animClass = isNew
              ? isEmojiOnly
                ? 'chat-msg--emoji-in'
                : m.isSelf
                  ? 'chat-msg--scale-in'
                  : 'chat-msg--fade-in'
              : '';
            return (
              <div
                id={`msg-${m.id}`}
                key={m.id}
                className={`chat-msg ${m.isSelf ? 'is-self' : ''} ${isReplyingToMe ? 'is-replied-to' : ''} ${animClass}`}
                style={{ alignSelf: m.isSelf ? 'flex-end' : 'flex-start' }}
              >
                {!m.isSelf && (
                  <span className="chat-avatar" style={{ background: m.color }} aria-hidden="true">
                    {m.initials}
                  </span>
                )}
                <div className={`chat-bubble ${m.isSelf ? 'is-self' : ''} ${isEmojiOnly ? 'is-emoji-only' : ''}`}>
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
                      <Reply size={16} aria-hidden="true" />
                      <span className="sr-only">Reply</span>
                    </button>
                  </div>
                  {showHeader && (
                    <div className="chat-bubble-head">
                      <span className="chat-author">{m.userName}</span>
                      <span className="chat-time-wrap">
                        <time className="chat-time">{formatTime(m.timestamp)}</time>
                        {m.isSelf && <MessageStatus status={m.status} />}
                      </span>
                    </div>
                  )}
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
                  <p>{renderChatText(m.text, isEmojiOnly)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {Object.values(typing).length > 0 && (
        <div className="chat-typing" role="status" aria-live="polite">
          <span className="chat-typing-dot" aria-hidden="true" />
          <span className="chat-typing-dot" aria-hidden="true" />
          <span className="chat-typing-dot" aria-hidden="true" />
          <span className="chat-typing-text">
            {Object.values(typing).length === 1
              ? `${Object.values(typing)[0].name} is typing…`
              : `${Object.values(typing)
                  .map((t) => t.name)
                  .join(' and ')} are typing…`}
          </span>
        </div>
      )}

      <ChatEmojiPicker
        anchorRef={anchorRef}
        open={showEmoji}
        position={pickerPosition}
        onPositionChange={setPickerPosition}
        onSelect={insertEmoji}
        onClose={() => setShowEmoji(false)}
      />

      {replyTo && (
        <div className="chat-reply-preview" role="status" aria-live="polite">
          <button
            type="button"
            className="chat-reply-cancel"
            onClick={onCancelReply}
            title="Cancel reply"
            aria-label="Cancel reply"
          >
            <X size={18} aria-hidden="true" />
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
          setShowEmoji(false);
          isLocallyTypingRef.current = false;
          if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
          typingTimerRef.current = null;
          sendTyping(false);
          onSend();
        }}
      >
        <button
          ref={anchorRef}
          type="button"
          className="btn icon sm chat-smiley"
          onClick={() => setShowEmoji((show) => !show)}
          title="Add a smiley"
          aria-label="Add a smiley"
        >
          😊
        </button>
        <input
          ref={inputRef}
          className="input"
          value={draft}
          aria-label="Message"
          maxLength={MAX_CHAT_LENGTH}
          disabled={!inRoom}
          placeholder={inRoom ? 'Message the room…' : 'Join a room to chat'}
          onChange={(e) => onDraftChangeWithTyping(e.target.value)}
        />
        <button
          className="btn icon primary"
          type="submit"
          disabled={!inRoom || chatSending}
          title="Send message"
          aria-label="Send message"
        >
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}
