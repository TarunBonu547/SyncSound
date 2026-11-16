import { useCallback, useRef, useState } from 'react';

/** The emojis a listener can send as a quick reaction to the song. */
const REACTION_EMOJIS = ['❤️', '🔥', '😂', '🚀', '✨', '💯'];

type Burst = { id: number; emoji: string; x: number; y: number; delay: number; scale: number };

type ReactionPickerProps = {
  /** The emoji reaction to send. */
  onReaction: (emoji: string) => void;
  /** True while a reaction is being sent. */
  sending: boolean;
};

/** A row of quick emoji reactions near the YouTube player. */
export default function ReactionPicker({ onReaction, sending }: ReactionPickerProps) {
  const [pressed, setPressed] = useState<string | null>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<number[]>([]);

  const handleReaction = useCallback(
    (emoji: string) => {
      setPressed(emoji);
      window.setTimeout(() => setPressed(null), 300);
      onReaction(emoji);

      // Local click burst feedback (reactions are still synced between participants via backend)
      const base = ++idRef.current;
      const parts: Burst[] = Array.from({ length: 6 }).map((_, i) => ({
        id: base * 10 + i,
        emoji,
        x: (Math.random() - 0.5) * 70,
        y: -30 - Math.random() * 45,
        delay: Math.random() * 80,
        scale: 0.7 + Math.random() * 0.6,
      }));
      setBursts((prev) => [...prev, ...parts]);
      const t = window.setTimeout(() => {
        setBursts((prev) => prev.filter((b) => !parts.some((p) => p.id === b.id)));
      }, 800);
      timersRef.current.push(t);
      // keep timer list small
      if (timersRef.current.length > 20) {
        const old = timersRef.current.shift();
        if (old) window.clearTimeout(old);
      }
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
            {pressed === emoji && bursts.some((b) => b.emoji === emoji) && (
              <span className="reaction-burst" aria-hidden="true">
                {bursts
                  .filter((b) => b.emoji === emoji)
                  .slice(-6)
                  .map((b) => (
                    <span
                      key={b.id}
                      style={{
                        ['--bx' as any]: `${b.x}px`,
                        ['--by' as any]: `${b.y}px`,
                        animationDelay: `${b.delay}ms`,
                        transform: `scale(${b.scale})`,
                      }}
                    >
                      {b.emoji}
                    </span>
                  ))}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
