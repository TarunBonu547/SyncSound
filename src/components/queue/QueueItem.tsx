import { Play, ArrowUp, ArrowDown, X } from 'lucide-react';
import { formatDuration } from '../../utils/youtubeSearch';
import type { QueueEntry } from '../../types/music';

type QueueItemProps = {
  item: QueueEntry;
  isCurrent: boolean;
  onPlay: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
};

/** One track of the shared queue. */
export default function QueueItem({
  item,
  isCurrent,
  onPlay,
  onMoveUp,
  onMoveDown,
  onRemove,
}: QueueItemProps) {
  const duration = formatDuration(item.durationSeconds);
  return (
    <li className={`queue-row queue-item ${isCurrent ? 'is-current' : ''}`}>
      <span className="queue-index" aria-hidden="true">
        {isCurrent ? <span className="queue-equalizer" /> : null}
      </span>
      <img className="queue-thumb" src={item.thumbnail} alt="" />
      <div className="queue-text">
        <p className="queue-title">
          {item.title} {isCurrent && <span className="now-badge">Now playing</span>}
        </p>
        <p className="queue-channel">
          {item.channel}
          {duration ? ` · ${duration}` : ''}
        </p>
      </div>
      <div className="queue-actions">
        <button
          className="btn icon sm"
          onClick={onPlay}
          title="Play now"
          aria-label={`Play ${item.title}`}
        >
          <Play size={14} />
        </button>
        <button
          className="btn icon sm"
          onClick={onMoveUp}
          title="Move up"
          aria-label={`Move ${item.title} up`}
        >
          <ArrowUp size={14} />
        </button>
        <button
          className="btn icon sm"
          onClick={onMoveDown}
          title="Move down"
          aria-label={`Move ${item.title} down`}
        >
          <ArrowDown size={14} />
        </button>
        <button
          className="btn icon sm"
          onClick={onRemove}
          title="Remove from queue"
          aria-label={`Remove ${item.title} from queue`}
        >
          <X size={14} />
        </button>
      </div>
    </li>
  );
}
