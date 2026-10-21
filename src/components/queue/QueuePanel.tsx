import { ListMusic } from 'lucide-react';
import type { QueueEntry } from '../../types/music';
import QueueItem from './QueueItem';

type QueuePanelProps = {
  queue: QueueEntry[];
  activeQueueItemId: string | null;
  onPlay: (itemId: string) => void;
  onMoveUp: (itemId: string) => void;
  onMoveDown: (itemId: string) => void;
  onRemove: (itemId: string) => void;
};

/** The shared queue of the room: everybody hears the same order. */
export default function QueuePanel({
  queue,
  activeQueueItemId,
  onPlay,
  onMoveUp,
  onMoveDown,
  onRemove,
}: QueuePanelProps) {
  return (
    <section className="card queue-card" aria-labelledby="queue-title">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Up next</p>
          <h2 className="section-title" id="queue-title">
            Song Queue
          </h2>
        </div>
        <p className="hint">
          {queue.length} {queue.length === 1 ? 'song' : 'songs'} lined up
        </p>
      </div>

      {queue.length === 0 ? (
        <div className="queue-empty">
          <span className="queue-empty-icon" aria-hidden="true">
            <ListMusic size={20} />
          </span>
          <p className="queue-empty-title">The queue is empty</p>
          <p className="queue-empty-hint">
            Search for a track above and it lands here for every listener of the room.
          </p>
        </div>
      ) : (
        <ul className="queue-list">
          {queue.map((item) => {
            const isCurrent = activeQueueItemId === item.id;
            return (
              <QueueItem
                key={item.id}
                item={item}
                isCurrent={isCurrent}
                onPlay={() => onPlay(item.id)}
                onMoveUp={() => onMoveUp(item.id)}
                onMoveDown={() => onMoveDown(item.id)}
                onRemove={() => onRemove(item.id)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
