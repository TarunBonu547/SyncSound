import type { QueueEntry } from '../../types/music';
import QueueItem from './QueueItem';

type QueuePanelProps = {
  queue: QueueEntry[];
  activeQueueItemId: string | null;
  onPlay: (itemId: string) => void;
  onMoveUp: (itemId: string) => void;
  onMoveDown: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  /** The id of this client, used to decide who may edit a dedication. */
  clientId: string;
  /** Edits or removes the dedication on a queued item. */
  editDedication: (itemId: string, text: string | null) => Promise<string | null>;
};

/** The shared queue of the room: everybody hears the same order. */
export default function QueuePanel({
  queue,
  activeQueueItemId,
  onPlay,
  onMoveUp,
  onMoveDown,
  onRemove,
  clientId,
  editDedication,
}: QueuePanelProps) {
  return (
    <section className="lounge-queue-panel lounge-queue-card" aria-labelledby="queue-title">
      <div className="lounge-section-heading">
        <div>
          <p className="lounge-eyebrow">Up Next</p>
          <h2 className="lounge-section-title" id="queue-title">
            Song Queue
          </h2>
        </div>
        <span className="lounge-section-count">
          {queue.length} {queue.length === 1 ? 'song' : 'songs'}
        </span>
      </div>

      {queue.length === 0 ? (
        <div className="lounge-empty-queue">
          <span className="lounge-empty-queue-icon" aria-hidden="true">
            ♪
          </span>
          <h3 className="lounge-empty-queue-title">Your queue is waiting.</h3>
          <p className="lounge-empty-queue-hint">Search for a track above and add it here.</p>
        </div>
      ) : (
        <ul className="lounge-queue-list">
          {queue.map((item) => {
            const isCurrent = activeQueueItemId === item.id;
            return (
              <QueueItem
                key={item.id}
                item={item}
                isCurrent={isCurrent}
                isAuthor={Boolean(item.dedication && item.dedication.authorId === clientId)}
                onPlay={() => onPlay(item.id)}
                onMoveUp={() => onMoveUp(item.id)}
                onMoveDown={() => onMoveDown(item.id)}
                onRemove={() => onRemove(item.id)}
                editDedication={editDedication}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}