import { useEffect, useMemo, useState } from 'react';
import type { SongReaction } from '../../types/music';

/** How long a floating reaction stays visible before fading out. */
const REACTION_TTL_MS = 8000;

type ReactionBubbleProps = {
  /** The reaction to show. */
  reaction: SongReaction & { id: string };
  /** True when this reaction was sent by the local client. */
  isSelf: boolean;
};

/** A floating emoji reaction that drifts up over the player area. */
export default function ReactionBubble({ reaction, isSelf }: ReactionBubbleProps) {
  const [visible, setVisible] = useState(true);
  /** Random starting position and drift generated once per instance. */
  const drift = useMemo(() => ({
    left: 10 + Math.random() * 80,   // 10% .. 90% of the video width
    x: (Math.random() - 0.5) * 40,   // slight horizontal drift during the animation
    extraX: (Math.random() - 0.5) * 30,
    delay: Math.random() * 200,
  }), []);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), REACTION_TTL_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  // Rockets drift diagonally, others float mostly straight up.
  const isRocket = reaction.emoji === '🚀';

  const style: React.CSSProperties & { ['--drift-x']?: string; ['--drift-extra']?: string } = {
    left: `${drift.left}%`,
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
