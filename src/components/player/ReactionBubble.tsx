import { useEffect, useState } from 'react';
import type { SongReaction } from '../../types/music';

/** How long a reaction bubble stays on screen before floating away. */
const REACTION_TTL_MS = 4000;

type ReactionBubbleProps = {
  /** The reaction to show. */
  reaction: SongReaction;
  /** True when this reaction was sent by the local client. */
  isSelf: boolean;
};

/** A lightweight, temporary reaction bubble that floats up and fades out. */
export default function ReactionBubble({ reaction, isSelf }: ReactionBubbleProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), REACTION_TTL_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`reaction-bubble ${isSelf ? 'reaction-bubble-self' : ''}`}
      role="status"
      aria-label={`${reaction.clientName} reacted ${reaction.emoji}`}
      aria-live="polite"
    >
      <span className="reaction-bubble-emoji" aria-hidden="true">
        {reaction.emoji}
      </span>
      <span className="reaction-bubble-name">{reaction.clientName}</span>
    </div>
  );
}
