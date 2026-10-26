import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, X, Pencil } from 'lucide-react';
import type { SongDedication } from '../../types/music';

type DedicationCardProps = {
  /** The dedication to show. */
  dedication: SongDedication;
  /** True when the viewer is the author of the dedication. */
  isAuthor: boolean;
  /** Dismisses the card without removing the dedication. */
  onDismiss: () => void;
  /** Saves an edited dedication text. */
  onSave: (text: string) => void;
  /** Removes the dedication entirely. */
  onRemove: () => void;
};

/** A small card shown when a dedicated song starts playing. */
export default function DedicationCard({
  dedication,
  isAuthor,
  onDismiss,
  onSave,
  onRemove,
}: DedicationCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(dedication.text);
  const dismissRef = useRef<HTMLButtonElement | null>(null);

  // Focus the dismiss button on mount so keyboard users can exit quickly.
  useEffect(() => {
    dismissRef.current?.focus();
  }, []);

  const handleSave = useCallback(() => {
    const text = draft.trim();
    if (!text) {
      onRemove();
      setEditing(false);
      return;
    }
    onSave(text);
    setEditing(false);
  }, [draft, onSave, onRemove]);

  return (
    <div className="dedication-card" role="status" aria-live="polite" aria-label="Song dedication">
      <div className="dedication-card-body">
        <span className="dedication-card-icon" aria-hidden="true">
          <Heart size={16} />
        </span>
        <div className="dedication-card-content">
          <p className="dedication-card-title">A little note for you ❤️</p>
          {editing ? (
            <div className="dedication-card-edit">
              <textarea
                className="dedication-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSave();
                  }
                  if (e.key === 'Escape') {
                    setDraft(dedication.text);
                    setEditing(false);
                  }
                }}
                placeholder="This song reminds me of you…"
                maxLength={200}
                rows={3}
                aria-label="Dedication"
              />
              <span className="dedication-card-counter">
                {draft.length} / 200
              </span>
              <div className="dedication-card-actions">
                <button type="button" className="btn icon sm" onClick={() => { setDraft(dedication.text); setEditing(false); }} aria-label="Cancel">
                  <X size={16} aria-hidden="true" />
                </button>
                <button type="button" className="btn icon sm primary" onClick={handleSave} aria-label="Save dedication">
                  <Pencil size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <p className="dedication-card-text">{dedication.text}</p>
          )}
          <p className="dedication-card-author">
            — {dedication.authorName}
          </p>
        </div>
        <div className="dedication-card-controls">
          {isAuthor && (
            <button
              type="button"
              className="btn icon sm"
              onClick={() => { setDraft(dedication.text); setEditing(true); }}
              title="Edit dedication"
              aria-label="Edit dedication"
            >
              <Pencil size={16} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="btn icon sm dedication-card-dismiss"
            ref={dismissRef}
            onClick={onDismiss}
            title="Dismiss"
            aria-label="Dismiss dedication"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
