import {
  Home,
  Search,
  Heart,
  ListMusic,
  Clock,
  Settings,
  LogIn,
  LogOut,
  Radio,
  Music4,
} from 'lucide-react';
import type { LibrarySection } from '../../pages/LibraryView';
import { avatarFor } from '../../utils/avatar';
import StatusIndicator from '../common/StatusIndicator';

export type NavTarget =
  | 'home'
  | 'room'
  | 'search'
  | 'liked-songs'
  | 'playlists'
  | 'recently-played'
  | 'create-room'
  | 'join-room';

type SidebarProps = {
  /** The entry that is open right now. */
  active: NavTarget;
  connected: boolean;
  roomCode: string | null;
  roomName: string | null;
  /** The id of this tab, used for the avatar of the profile. */
  clientId: string;
  /** The name this person is seen under. */
  displayName: string;
  onNavigate: (target: NavTarget) => void;
  onLibrary: (section: LibrarySection) => void;
  onSettings: () => void;
  onLeave: () => void;
};

const navItems: { id: NavTarget; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'search', label: 'Search music', icon: Search },
  { id: 'liked-songs', label: 'Liked songs', icon: Heart },
  { id: 'playlists', label: 'Your Library', icon: ListMusic },
  { id: 'recently-played', label: 'Recently played', icon: Clock },
];

/**
 * The navigation of the application.
 *
 * Every entry opens a real screen: the library opens a section of the
 * library, the room opens the room, and the room actions create or leave a
 * room. Nothing here is decoration.
 */
export default function Sidebar({
  active,
  connected,
  roomCode,
  roomName,
  clientId,
  displayName,
  onNavigate,
  onLibrary,
  onSettings,
  onLeave,
}: SidebarProps) {
  const profile = avatarFor(displayName || 'You', clientId);
  const statusLabel = !connected ? 'Reconnecting…' : roomCode ? 'Listening together' : 'Connected';

  const go = (item: (typeof navItems)[number]) => {
    if (item.id === 'home' || item.id === 'room' || item.id === 'search') {
      onNavigate(item.id);
      return;
    }
    if (item.id === 'liked-songs') onLibrary('liked');
    else if (item.id === 'playlists') onLibrary('playlists');
    else if (item.id === 'recently-played') onLibrary('recent');
  };

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-brand">
        <span className="sidebar-mark" aria-hidden="true">
          <Music4 size={18} />
        </span>
        <span className="sidebar-wordmark">
          <em>Sync</em>Sound
        </span>
      </div>

      <p className="side-label">Navigation</p>
      <nav className="side-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              className={`side-link ${isActive ? 'is-active' : ''}`}
              onClick={() => go(item)}
              aria-current={isActive ? 'page' : undefined}
              title={item.label}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <p className="side-label">Room</p>
      <nav className="side-nav">
        {roomCode ? (
          <button
            className={`side-link ${active === 'room' ? 'is-active' : ''}`}
            onClick={() => onNavigate('room')}
            title={`Back to room ${roomCode}`}
          >
            <Radio size={17} aria-hidden="true" />
            <span className="side-link-text">
              {roomName || 'Your room'}
              <em className="side-link-note">{roomCode}</em>
            </span>
          </button>
        ) : (
          <>
            <button
              className={`side-link ${active === 'create-room' ? 'is-active' : ''}`}
              onClick={() => onNavigate('create-room')}
              title="Create a room"
            >
              <Radio size={17} aria-hidden="true" />
              <span>Create room</span>
            </button>
            <button
              className={`side-link ${active === 'join-room' ? 'is-active' : ''}`}
              onClick={() => onNavigate('join-room')}
              title="Join a room"
            >
              <LogIn size={17} aria-hidden="true" />
              <span>Join room</span>
            </button>
          </>
        )}
      </nav>

      <div className="side-status">
        <StatusIndicator connected={connected} label={statusLabel} live={!!roomCode} />
        <button className="side-link" onClick={onSettings} title="Room settings" aria-label="Room settings">
          <Settings size={17} aria-hidden="true" />
          <span>Settings</span>
        </button>
        {roomCode && (
          <button className="side-link" onClick={onLeave} title="Leave the room" aria-label="Leave the room">
            <LogOut size={17} aria-hidden="true" />
            <span>Leave room</span>
          </button>
        )}
        <div className="side-profile" title={displayName ? `You are ${displayName}` : 'You'}>
          <span className="side-avatar" style={{ background: profile.color }} aria-hidden="true">
            {profile.initials}
          </span>
          <span className="side-profile-text">
            <strong>{displayName || 'You'}</strong>
            <em>This device</em>
          </span>
        </div>
      </div>
    </aside>
  );
}
