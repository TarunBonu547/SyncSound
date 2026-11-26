import { useCallback, useState } from 'react';
import { Play, ArrowUp, ArrowDown, X, Pencil, Heart, Send, Grab } from 'lucide-react';
import { formatDuration } from '../../utils/youtubeSearch';
import type { QueueEntry } from '../../types/music';

type QueueItemProps = {
  item: QueueEntry;
  isCurrent: boolean;
  /** True when the viewer wrote the dedication on this item. */
  isAuthor: boolean;
  onPlay: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  /** Edits or removes the dedication on this item. */
  editDedication: (itemId: string, text: string | null) => Promise<string | null>;
};

/** One track of the shared queue. */
export default function QueueItem({
  item,
  isCurrent,
  isAuthor,
  onPlay,
  onMoveUp,
  onMoveDown,
  onRemove,
  editDedication,
}: QueueItemProps) {
  const duration = formatDuration(item.durationSeconds);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.dedication?.text || '');
  const hasDedication = Boolean(item.dedication);

  const handleSave = useCallback(async () => {
    const text = draft.trim();
    if (!text) {
      await editDedication(item.id, null);
      setEditing(false);
      return;
    }
    await editDedication(item.id, text);
    setEditing(false);
  }, [draft, editDedication, item.id]);

  return (
    <li className={`lounge-queue-item ${isCurrent ? 'is-current' : ''}`}>
      <span className="lounge-queue-drag-handle" aria-label="Reorder track" role="button" tabIndex={0}>
        <Grab size={14} aria-hidden="true" />
      </span>
      {isCurrent ? (
        <span className="lounge-queue-art is-current" aria-hidden="true">
          <img className="lounge-queue-art-img" src={item.thumbnail} alt="" />
          <span className="lounge-queue-eq">
            <span />
            <span />
            <span />
          </span>
        </span>
      ) : (
        <img className="lounge-queue-art" src={item.thumbnail} alt="" />
      )}
      <div className="lounge-queue-details">
        <strong>
          {item.title}
          {isCurrent && <span className="lounge-now-badge">Now playing</span>}
          {hasDedication && (
            <span className="lounge-queue-dedication" aria-label="This song has a dedication">
              <Heart size={11} aria-hidden="true" />
            </span>
          )}
        </strong>
        <small>
          {item.channel}
          {duration ? ` · ${duration}` : ''}
        </small>
      </div>
      <div className="lounge-queue-actions">
        <button
          className="lounge-queue-icon-btn is-primary"
          onClick={onPlay}
          title="Play now"
          aria-label={`Play ${item.title}`}
        >
          <Play size={16} />
        </button>
        {hasDedication && isAuthor && (
          <button
            type="button"
            className="lounge-queue-icon-btn"
            onClick={() => { setDraft(item.dedication!.text); setEditing(true); }}
            title="Edit dedication"
            aria-label={`Edit dedication for ${item.title}`}
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
        )}
        <button
          className="lounge-queue-icon-btn"
          onClick={onMoveUp}
          title="Move up"
          aria-label={`Move ${item.title} up`}
        >
          <ArrowUp size={14} />
        </button>
        <button
          className="lounge-queue-icon-btn"
          onClick={onMoveDown}
          title="Move down"
          aria-label={`Move ${item.title} down`}
        >
          <ArrowDown size={14} />
        </button>
        <button
          className="lounge-queue-icon-btn is-danger"
          onClick={onRemove}
          title="Remove from queue"
          aria-label={`Remove ${item.title} from queue`}
        >
          <X size={15} />
        </button>
      </div>
      {editing && hasDedication && isAuthor && (
        <div className="lounge-dedication-editor lounge-queue-dedication-editor">
          <textarea
            className="lounge-dedication-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSave();
              }
              if (e.key === 'Escape') {
                setDraft(item.dedication!.text);
                setEditing(false);
              }
            }}
            placeholder="This song reminds me of you…"
            maxLength={200}
            rows={2}
            aria-label="Edit dedication"
          />
          <span className="lounge-dedication-counter">{draft.length} / 200</span>
          <div className="lounge-dedication-editor-actions">
            <button type="button" className="lounge-icon-btn" onClick={() => { setDraft(item.dedication!.text); setEditing(false); }} aria-label="Cancel">
              <X size={14} aria-hidden="true" />
            </button>
            <button type="button" className="lounge-icon-btn is-primary" onClick={handleSave} aria-label="Save dedication">
              <Send size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}