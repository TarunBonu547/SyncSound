import { useState } from 'react';
import { Play, Heart, ListMusic, History, Sparkles } from 'lucide-react';
import type { Track } from '../types/music';

export type LibrarySection = 'liked' | 'playlists' | 'recent';

type Props = {
  section: LibrarySection;
  onSectionChange: (section: LibrarySection) => void;
  /** The tracks this person hearted. */
  favorites: Track[];
  /** The tracks this person heard in a room, newest first. */
  recent: Track[];
  /** Playing needs a room, so the library asks for one. */
  inRoom: boolean;
  /** Plays the track in the room. Resolves with a reason on error. */
  onPlay: (id: string) => Promise<string | null>;
  onRemoveFavorite: (id: string) => void;
  onGoHome: () => void;
};

const TABS: { id: LibrarySection; label: string }[] = [
  { id: 'liked', label: 'Liked Songs' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'recent', label: 'Recently Played' },
];

/**
 * Your Library.
 *
 * Everything in here comes from what really happened: the tracks this person
 * hearted and the tracks this person heard. A playlist is not part of
 * SyncSound, so that part stays empty instead of pretending.
 */
export default function LibraryView({
  section,
  onSectionChange,
  favorites,
  recent,
  inRoom,
  onPlay,
  onRemoveFavorite,
  onGoHome,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tracks = section === 'liked' ? favorites : recent;

  /** Plays the track in the room and reports what the server said. */
  const play = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const message = await onPlay(id);
      if (message) setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card library-card fade-in-up">
      <p className="eyebrow">Your Library</p>
      <h2 className="section-title">Your library</h2>
      <p className="card-sub">
        The tracks you hearted and the tracks you heard. They stay on this device.
      </p>

      <div className="library-tabs" role="tablist" aria-label="Library sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            id={`library-tab-${tab.id}`}
            aria-selected={section === tab.id}
            aria-controls={`library-panel-${tab.id}`}
            tabIndex={section === tab.id ? 0 : -1}
            className={`library-tab ${section === tab.id ? 'is-active' : ''}`}
            onClick={() => onSectionChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        className="library-panel"
        role="tabpanel"
        id={`library-panel-${section}`}
        aria-labelledby={`library-tab-${section}`}
      >
        {section === 'playlists' && (
          <div className="library-empty">
            <span className="library-empty-icon" aria-hidden="true">
              <ListMusic size={20} />
            </span>
            <p className="library-empty-title">No playlists yet</p>
            <p className="library-empty-hint">
              SyncSound has no playlists. The shared queue of a room is the closest thing to one.
            </p>
            <button className="btn soft" onClick={onGoHome}>
              Open a room
            </button>
          </div>
        )}

        {section === 'liked' && tracks.length === 0 && (
          <div className="library-empty">
            <span className="library-empty-icon" aria-hidden="true">
              <Heart size={20} />
            </span>
            <p className="library-empty-title">Nothing liked yet</p>
            <p className="library-empty-hint">
              Heart a track while it plays and it stays here for the next time.
            </p>
          </div>
        )}

        {section === 'recent' && tracks.length === 0 && (
          <div className="library-empty">
            <span className="library-empty-icon" aria-hidden="true">
              <History size={20} />
            </span>
            <p className="library-empty-title">Nothing played yet</p>
            <p className="library-empty-hint">The tracks of your room show up here as they play.</p>
          </div>
        )}

        {section !== 'playlists' && tracks.length > 0 && (
          <ul className="library-list">
            {tracks.map((track) => (
              <li className="library-row" key={track.id}>
                <img className="queue-thumb" src={track.thumbnail} alt="" />
                <div className="queue-text">
                  <p className="queue-title">{track.title}</p>
                  <p className="queue-channel">{track.channel}</p>
                </div>
                <div className="queue-actions">
                  {section === 'liked' && (
                    <button
                      className="btn icon sm like-btn is-liked"
                      onClick={() => onRemoveFavorite(track.id)}
                      title="Remove from liked songs"
                      aria-label={`Remove ${track.title} from liked songs`}
                    >
                      <Heart size={14} fill="currentColor" />
                    </button>
                  )}
                  <button
                    className="btn icon sm"
                    onClick={() => play(track.id)}
                    disabled={!inRoom || busy}
                    title={inRoom ? 'Play in the room' : 'Join a room first'}
                    aria-label={`Play ${track.title}`}
                  >
                    <Play size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="error-text" role="alert" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}

        {section !== 'playlists' && !inRoom && (
          <p className="hint library-hint">
            <Sparkles size={13} /> Join a room to play these tracks for everybody.
          </p>
        )}
      </div>
    </div>
  );
}
