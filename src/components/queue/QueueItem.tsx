import { useCallback, useState } from 'react';
import { Play, ArrowUp, ArrowDown, X, Pencil, Heart, Send } from 'lucide-react';
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
    <li className={`queue-row queue-item ${isCurrent ? 'is-current' : ''}`}>
      <span className="queue-index" aria-hidden="true">
        {isCurrent ? <span className="queue-equalizer" /> : null}
      </span>
      <img className="queue-thumb" src={item.thumbnail} alt="" />
      <div className="queue-text">
        <p className="queue-title">
          {item.title}
          {isCurrent && <span className="now-badge">Now playing</span>}
          {hasDedication && (
            <span className="queue-dedication" aria-label="This song has a dedication">
              <Heart size={12} aria-hidden="true" />
            </span>
          )}
        </p>
        <p className="queue-channel">
          {item.channel}
          {duration ? ` · ${duration}` : ''}
        </p>
      </div>
      <div className="queue-actions">
        <button
          className="music-icon-btn primary"
          onClick={onPlay}
          title="Play now"
          aria-label={`Play ${item.title}`}
        >
          <Play size={20} />
        </button>
        {hasDedication && isAuthor && (
          <button
            type="button"
            className="music-icon-btn"
            onClick={() => { setDraft(item.dedication!.text); setEditing(true); }}
            title="Edit dedication"
            aria-label={`Edit dedication for ${item.title}`}
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
        )}
        <button
          className="music-icon-btn"
          onClick={onMoveUp}
          title="Move up"
          aria-label={`Move ${item.title} up`}
        >
          <ArrowUp size={18} />
        </button>
        <button
          className="music-icon-btn"
          onClick={onMoveDown}
          title="Move down"
          aria-label={`Move ${item.title} down`}
        >
          <ArrowDown size={18} />
        </button>
        <button
          className="music-icon-btn danger"
          onClick={onRemove}
          title="Remove from queue"
          aria-label={`Remove ${item.title} from queue`}
        >
          <X size={18} />
        </button>
      </div>
      {editing && hasDedication && isAuthor && (
        <div className="queue-dedication-editor">
          <textarea
            className="input dedication-textarea"
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
          <span className="dedication-counter">
            {draft.length} / 200
          </span>
          <div className="queue-dedication-editor-actions">
            <button type="button" className="btn icon sm" onClick={() => { setDraft(item.dedication!.text); setEditing(false); }} aria-label="Cancel">
              <X size={14} aria-hidden="true" />
            </button>
            <button type="button" className="btn icon sm primary" onClick={handleSave} aria-label="Save dedication">
              <Send size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
