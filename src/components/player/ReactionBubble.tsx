import { useEffect, useMemo, useState } from 'react';
import type { SongReaction } from '../../types/music';

/** How long a floating reaction stays visible before fading out. */
const REACTION_TTL_MS = 3000;

type ReactionBubbleProps = {
  /** The reaction to show. */
  reaction: SongReaction;
  /** True when this reaction was sent by the local client. */
  isSelf: boolean;
};

/** A floating emoji reaction that drifts up over the player area. */
export default function ReactionBubble({ reaction, isSelf }: ReactionBubbleProps) {
  const [visible, setVisible] = useState(true);
  /** Random offset generated once per instance so the path is stable. */
  const drift = useMemo(() => ({
    x: (Math.random() - 0.5) * 90,
    extraX: (Math.random() - 0.5) * 50,
    delay: Math.random() * 250,
  }), []);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), REACTION_TTL_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  // Rockets drift diagonally, others float mostly straight up.
  const isRocket = reaction.emoji === '🚀';

  const style: React.CSSProperties & { ['--drift-x']?: string; ['--drift-extra']?: string } = {
    left: `calc(50% + ${drift.x}px)`,
    top: '88%',
    animationDelay: `${drift.delay}ms`,
    '--drift-x': `${drift.x}px`,
    '--drift-extra': `${drift.extraX}px`,
  };

  return (
    <div
      className={`reaction-float ${isRocket ? 'reaction-float-rocket' : ''} ${isSelf ? 'reaction-float-self' : ''}`}
      style={style}
      role="status"
      aria-label={`${reaction.clientName} reacted ${reaction.emoji}`}
      aria-live="polite"
    >
      <span className="reaction-float-emoji" aria-hidden="true" style={{ fontSize: '40px' }}>
        {reaction.emoji}
      </span>
    </div>
  );
}
