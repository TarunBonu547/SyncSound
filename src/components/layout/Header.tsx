import { useCallback, useEffect, useState } from 'react';
import { Bell, BookOpen, CircleUserRound, House, LogOut, Menu, Settings, X } from 'lucide-react';

type HeaderView = 'home' | 'room' | 'search' | 'library';

type ProfileShape = {
  color: string;
  initials: string;
};

type HeaderProps = {
  view: HeaderView;
  onHome: () => void;
  onLibrary: () => void;
  notice: string | null;
  setNotice: (message: string | null) => void;
  profile: ProfileShape;
  displayName: string;
  profileOpen: boolean;
  onProfileToggle: () => void;
  onLeaveRoom: () => void;
  onSettings: () => void;
  roomCode: string | null;
  isNarrow: boolean;
  mobileNav: boolean;
  onMobileNavToggle: () => void;
};

const NAV_ITEMS: { id: HeaderView; icon: React.ReactNode; label: string }[] = [
  { id: 'home', icon: <House size={22} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />, label: 'Home' },
  { id: 'library', icon: <BookOpen size={22} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />, label: 'Your Library' },
];

export default function Header({
  view,
  onHome,
  onLibrary,
  notice,
  setNotice,
  profile,
  displayName,
  profileOpen,
  onProfileToggle,
  onLeaveRoom,
  onSettings,
  roomCode,
  isNarrow,
  mobileNav,
  onMobileNavToggle,
}: HeaderProps) {
  const [noticeOpen, setNoticeOpen] = useState(false);

  const closeNotice = useCallback(() => {
    setNoticeOpen(false);
    setNotice(null);
  }, [setNotice]);

  useEffect(() => {
    if (!noticeOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!document.getElementById('app-header')?.contains(target)) {
        setNoticeOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [noticeOpen]);

  const toggleNotice = useCallback(() => {
    if (!notice) return;
    setNoticeOpen((prev) => !prev);
  }, [notice]);

  return (
    <header id="app-header" className="app-header" aria-label="Main navigation">
      {/* LEFT SECTION */}
      <div className="header-left">
        <button
          className="menu-button"
          onClick={onMobileNavToggle}
          aria-label="Toggle menu"
          aria-expanded={mobileNav}
        >
          {mobileNav ? <X size={22} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /> : <Menu size={22} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />}
        </button>

        <a
          className="brand"
          onClick={onHome}
          role="link"
          aria-label="SyncSound home"
          tabIndex={-1}
        >
          <svg
            className="brand-wave"
            viewBox="0 0 48 48"
            fill="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="waveGradient" x1="0" y1="0" x2="48" y2="48">
                <stop offset="0%" stopColor="#E59AB8" />
                <stop offset="55%" stopColor="#C1A5D9" />
                <stop offset="100%" stopColor="#8F8DC8" />
              </linearGradient>
            </defs>
            <g fill="url(#waveGradient)">
              <rect className="wave-bar" x={3} y={20} width={4} height={8} rx={2} />
              <rect className="wave-bar" x={10} y={13} width={4} height={22} rx={2} />
              <rect className="wave-bar" x={17} y={7} width={4} height={34} rx={2} />
              <rect className="wave-bar" x={24} y={15} width={4} height={18} rx={2} />
              <rect className="wave-bar" x={31} y={10} width={4} height={28} rx={2} />
              <rect className="wave-bar" x={38} y={19} width={4} height={10} rx={2} />
            </g>
          </svg>
          <span className="brand-name">
            <span className="sync">Sync</span>
            <span className="sound">Sound</span>
          </span>
        </a>
      </div>

      {/* CENTER NAVIGATION */}
      {!isNarrow && (
        <nav className="navigation" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const active = view === item.id;
            return (
              <button
                key={item.id}
                className={`nav-item ${active ? 'active' : ''}`}
                onClick={item.id === 'home' ? onHome : onLibrary}
                aria-current={active ? 'page' : undefined}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* RIGHT SECTION */}
      <div className="header-right">
        <button
          className={`icon-button notice ${notice ? 'has-notice' : ''}`}
          onClick={toggleNotice}
          aria-label="Notifications"
          aria-pressed={!!notice}
        >
          <Bell size={22} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          {notice && <span className="notice-dot" aria-hidden="true"> </span>}
        </button>
        {noticeOpen && notice && (
          <div className="notice-popover" role="tooltip" aria-live="polite">
            <span className="notice-message">{notice}</span>
            <button className="notice-dismiss" onClick={closeNotice} aria-label="Dismiss notice">
              <X size={16} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
            </button>
          </div>
        )}

        <div className="profile-dropdown">
          <button
            className="avatar"
            onClick={onProfileToggle}
            title={displayName ? `You are ${displayName}` : 'You'}
            aria-label="Profile menu"
            aria-expanded={profileOpen}
            aria-haspopup="true"
            style={{ background: profile.color }}
          >
            {profile.initials}
          </button>
          {profileOpen && (
            <div className="profile-dropdown-menu" role="menu">
              <div className="profile-dropdown-header">
                <div className="profile-dropdown-name">{displayName || 'You'}</div>
                <div className="profile-dropdown-email">Listener</div>
              </div>
              <div className="profile-dropdown-divider" />
              <button
                className="profile-dropdown-item"
                role="menuitem"
                onClick={() => {
                  onProfileToggle();
                  onLibrary();
                }}
              >
                <CircleUserRound size={18} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /> Your Library
              </button>
              <button
                className="profile-dropdown-item"
                role="menuitem"
                onClick={() => {
                  onProfileToggle();
                  onSettings();
                }}
              >
                <Settings size={18} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /> Settings
              </button>
              <div className="profile-dropdown-divider" />
              {roomCode && (
                <button
                  className="profile-dropdown-item danger"
                  role="menuitem"
                  onClick={() => {
                    onProfileToggle();
                    onLeaveRoom();
                  }}
                >
                  <LogOut size={18} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /> Leave Room
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
