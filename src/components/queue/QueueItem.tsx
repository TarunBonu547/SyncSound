import { useCallback, useState } from 'react';
import { Play, ArrowUp, ArrowDown, X, Pencil, Heart, Send, Grab, Trash2 } from 'lucide-react';
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

/** Formats a dedication timestamp into a short, readable label. */
function formatNoteDate(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

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
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteMode, setNoteMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState(item.dedication?.text || '');
  const [saving, setSaving] = useState(false);
  const hasDedication = Boolean(item.dedication);

  const openNote = useCallback(() => {
    if (noteOpen) {
      setNoteOpen(false);
      return;
    }
    setDraft(item.dedication?.text || '');
    setNoteMode(hasDedication ? 'view' : 'edit');
    setNoteOpen(true);
  }, [noteOpen, hasDedication, item.dedication]);

  const handleSave = useCallback(async () => {
    const text = draft.trim();
    setSaving(true);
    try {
      await editDedication(item.id, text || null);
      setNoteMode(text ? 'view' : 'edit');
      if (!text) setNoteOpen(false);
    } finally {
      setSaving(false);
    }
  }, [draft, editDedication, item.id]);

  const handleDelete = useCallback(async () => {
    setSaving(true);
    try {
      await editDedication(item.id, null);
      setNoteOpen(false);
      setDraft('');
    } finally {
      setSaving(false);
    }
  }, [editDedication, item.id]);

  const handleCancelEdit = useCallback(() => {
    if (hasDedication) {
      setDraft(item.dedication!.text);
      setNoteMode('view');
    } else {
      setNoteOpen(false);
      setDraft('');
    }
  }, [hasDedication, item.dedication]);

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
            <span className="lounge-queue-dedication" aria-label="This song has a note">
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
        <button
          type="button"
          className={`lounge-queue-icon-btn lounge-note-btn ${hasDedication ? 'has-note' : ''} ${noteOpen ? 'is-open' : ''}`}
          onClick={openNote}
          title={hasDedication ? 'View note' : 'Add a note'}
          aria-label={hasDedication ? `View note for ${item.title}` : `Add a note to ${item.title}`}
          aria-expanded={noteOpen}
        >
          <Pencil size={14} aria-hidden="true" />
          {hasDedication && <span className="lounge-note-dot" aria-hidden="true" />}
        </button>
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
      {noteOpen && noteMode === 'view' && hasDedication && (
        <div className="lounge-note-view">
          <div className="lounge-note-view-head">
            <span className="lounge-note-view-author">{item.dedication!.authorName}</span>
            <span className="lounge-note-view-date">{formatNoteDate(item.dedication!.createdAt)}</span>
          </div>
          <p className="lounge-note-view-text">{item.dedication!.text}</p>
          <div className="lounge-note-view-actions">
            {isAuthor && (
              <>
                <button
                  type="button"
                  className="lounge-icon-btn"
                  onClick={() => { setDraft(item.dedication!.text); setNoteMode('edit'); }}
                  aria-label="Edit note"
                  title="Edit note"
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="lounge-icon-btn is-danger"
                  onClick={handleDelete}
                  disabled={saving}
                  aria-label="Delete note"
                  title="Delete note"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </>
            )}
            <button
              type="button"
              className="lounge-icon-btn"
              onClick={() => setNoteOpen(false)}
              aria-label="Close note"
              title="Close"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      {noteOpen && noteMode === 'edit' && (
        <div className="lounge-dedication-editor lounge-queue-dedication-editor lounge-note-editor">
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
                handleCancelEdit();
              }
            }}
            placeholder="Write something about this song…"
            maxLength={200}
            rows={2}
            aria-label="Note"
          />
          <span className="lounge-dedication-counter">{draft.length} / 200</span>
          <div className="lounge-dedication-editor-actions">
            <button type="button" className="lounge-icon-btn" onClick={handleCancelEdit} aria-label="Cancel">
              <X size={14} aria-hidden="true" />
            </button>
            <button type="button" className="lounge-icon-btn is-primary" onClick={handleSave} disabled={saving} aria-label="Save note">
              <Send size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}