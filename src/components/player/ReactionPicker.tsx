import { useCallback, useState } from 'react';

/** The emojis a listener can send as a quick reaction to the song. */
const REACTION_EMOJIS = ['❤️', '🔥', '😂', '🚀', '✨', '💯'];

type ReactionPickerProps = {
  /** The emoji reaction to send. */
  onReaction: (emoji: string) => void;
  /** True while a reaction is being sent. */
  sending: boolean;
};

/** A row of quick emoji reactions near the YouTube player. */
export default function ReactionPicker({ onReaction, sending }: ReactionPickerProps) {
  const [pressed, setPressed] = useState<string | null>(null);

  const handleReaction = useCallback(
    (emoji: string) => {
      setPressed(emoji);
      setTimeout(() => setPressed(null), 400);
      onReaction(emoji);
    },
    [onReaction],
  );

  return (
    <div className="reaction-picker" aria-label="Song reactions">
      <p className="reaction-picker-label" aria-hidden="true">
        React to this song
      </p>
      <div className="reaction-picker-grid" role="grid" aria-label="Reactions">
        {REACTION_EMOJIS.map((emoji) => (
          <button
            type="button"
            key={emoji}
            className={`reaction-btn ${pressed === emoji ? 'is-pressed' : ''}`}
            onClick={() => handleReaction(emoji)}
            disabled={sending}
            title={`React with ${emoji}`}
            aria-label={`React with ${emoji}`}
          >
            <span className="reaction-emoji" aria-hidden="true">
              {emoji}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
