import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { readClientId } from '../utils/clientId';
import { normalizeDisplayName, saveDisplayName } from '../utils/displayName';
import '../styles/mobile-start.css';

function detectCode(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('code') || params.get('room') || '';
}

type MobileStartProps = {
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  onRoomEntered: (code: string, name?: string | null) => void;
};

let linkJoinStarted = false;

export default function MobileStart({ displayName, onDisplayNameChange, onRoomEntered }: MobileStartProps) {
  const { socket } = useSocket();
  const [joinCode, setJoinCode] = useState(detectCode());
  const [joinStatus, setJoinStatus] = useState<'idle' | 'joining' | 'error' | 'joined'>('idle');
  const [joinMessage, setJoinMessage] = useState('');
  const [showJoinPanel, setShowJoinPanel] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<{ code: string; name?: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [username, setUsername] = useState(displayName);
  const linkCode = useRef(detectCode());
  const clientId = useRef(readClientId());
  const roomCodeInputRef = useRef<HTMLInputElement>(null);

  // Sync username with parent displayName
  useEffect(() => {
    if (displayName && displayName !== username) {
      setUsername(displayName);
    }
  }, [displayName]);

  // Persist username to localStorage
  useEffect(() => {
    if (username.trim()) {
      saveDisplayName(username);
    }
  }, [username]);

  const handleCreateRoom = () => {
    const who = normalizeDisplayName(username);
    if (!who) {
      setJoinMessage('Please enter your name');
      return;
    }
    if (!socket) {
      setJoinMessage('Not connected');
      return;
    }
    setIsCreating(true);
    setJoinMessage('');
    saveDisplayName(who);
    onDisplayNameChange(who);
    socket.emit('create-room', { name: 'Mobile Room', clientId: clientId.current, displayName: who }, (res: any) => {
      setIsCreating(false);
      if (!res?.ok) {
        setJoinMessage(res?.error || 'Failed to create room');
        return;
      }
      setCreatedRoom({ code: res.code, name: res.name });
      setShowJoinPanel(false);
    });
  };

  const handleJoinRoom = (wanted?: string) => {
    const target = (wanted ?? joinCode).trim();
    if (!target) {
      setJoinStatus('error');
      setJoinMessage('Room code is required');
      return;
    }
    const who = normalizeDisplayName(username);
    if (!who) {
      setJoinStatus('error');
      setJoinMessage('Please enter your name');
      return;
    }
    if (!socket) {
      setJoinStatus('error');
      setJoinMessage('Not connected');
      return;
    }
    setJoinStatus('joining');
    setJoinMessage('');
    saveDisplayName(who);
    onDisplayNameChange(who);
    socket.emit('join-room', { code: target, clientId: clientId.current, displayName: who }, (res: any) => {
      if (!res?.ok) {
        setJoinStatus('error');
        setJoinMessage(res?.error || 'Failed to join room');
        return;
      }
      setJoinStatus('joined');
      setJoinMessage('Joined room ' + res.code);
      onRoomEntered(res.code, res.name);
      setShowJoinPanel(false);
    });
  };

  const handleEnterRoom = () => {
    const who = normalizeDisplayName(username);
    if (!who) {
      setJoinMessage('Please enter your name');
      return;
    }
    if (createdRoom) {
      onRoomEntered(createdRoom.code, createdRoom.name);
    } else if (joinStatus === 'joined') {
      // Already joined via link, room should be entered
      const code = linkCode.current || joinCode;
      if (code) {
        onRoomEntered(code.toUpperCase());
      } else {
        setJoinMessage('No room to enter. Create or join a room first.');
      }
    } else {
      setJoinMessage('Please create or join a room first.');
    }
  };

  const formatRoomCode = (value: string) => {
    const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    let formatted = raw;
    if (raw.length > 2) {
      formatted = raw.slice(0, 2) + '-' + raw.slice(2);
    }
    return formatted;
  };

  useEffect(() => {
    if (!linkCode.current || !socket) return;
    const who = normalizeDisplayName(username);
    if (!who) {
      setJoinMessage('Please enter your name');
      return;
    }
    if (linkJoinStarted) return;
    linkJoinStarted = true;
    setJoinMessage('');
    handleJoinRoom(linkCode.current);
  }, [socket, username]);

  useEffect(() => {
    if (showJoinPanel && roomCodeInputRef.current) {
      roomCodeInputRef.current.focus();
    }
  }, [showJoinPanel]);

  const displayCode = createdRoom?.code || joinCode || 'SS-XXXX';
  const hasActiveRoom = createdRoom || joinStatus === 'joined';

  return (
    <div className="ms-page">
      <div className="ms-orb one" aria-hidden="true" />
      <div className="ms-orb two" aria-hidden="true" />

      <header className="ms-header">
        <div className="ms-brand">
          <div className="ms-brand-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div className="ms-brand-name">Sync<span>Sound</span></div>
        </div>
        <div className="ms-status">
          <span className="ms-status-dot" aria-hidden="true" />
          Together
        </div>
      </header>

      <main className="ms-main">
        <div className="ms-eyebrow">
          <span className="ms-eyebrow-line" aria-hidden="true" />
          A little closer, wherever you are
        </div>

        <h1>
          Your songs.<br />
          Our <span>moments.</span>
        </h1>

        <p className="ms-description">
          Some songs feel different when you listen together. Create your little space and let the music bring you closer.
        </p>

        <div className="ms-listening-card">
          <div className="ms-artwork" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div className="ms-listening-info">
            <div className="ms-listening-label">Your own little space</div>
            <div className="ms-listening-title">Listen together</div>
            <div className="ms-listening-subtitle">One song, two hearts, the same moment.</div>
          </div>
        </div>

        {/* Username field */}
        <div className="ms-username-field">
          <label htmlFor="ms-username" className="ms-username-label">
            Your name
          </label>
          <input
            id="ms-username"
            type="text"
            className="ms-username-input"
            placeholder="Enter your name"
            value={username}
            onChange={(e) => {
              const val = e.target.value;
              setUsername(val);
              onDisplayNameChange(val);
            }}
            autoComplete="name"
            spellCheck={false}
            maxLength={20}
          />
        </div>

        <div className="ms-actions">
          <button className="ms-primary-btn" onClick={handleCreateRoom} disabled={isCreating}>
            <span className="ms-btn-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            {isCreating ? 'Creating…' : 'Create a room'}
          </button>

          <button className="ms-secondary-btn" onClick={() => setShowJoinPanel(!showJoinPanel)}>
            <span className="ms-btn-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
                <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
              </svg>
            </span>
            Join a room
          </button>
        </div>

        {/* Enter Room button */}
        <button
          className={`ms-enter-btn ${hasActiveRoom ? 'ready' : ''}`}
          onClick={handleEnterRoom}
          disabled={!hasActiveRoom}
        >
          <span className="ms-enter-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
              <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
            </svg>
          </span>
          <span>Enter Room</span>
          {hasActiveRoom && <span className="ms-enter-badge">Ready</span>}
        </button>

        <div className={`ms-join-panel ${showJoinPanel ? 'show' : ''}`}>
          <div className="ms-join-heading">Come on in</div>
          <p className="ms-join-description">Enter the room code your person shared with you.</p>

          <form className="ms-join-form" onSubmit={(e) => { e.preventDefault(); handleJoinRoom(); }}>
            <input
              ref={roomCodeInputRef}
              type="text"
              id="ms-room-code"
              className="ms-code-input"
              placeholder="ENTER ROOM CODE"
              maxLength={7}
              autoComplete="off"
              spellCheck={false}
              value={joinCode}
              onChange={(e) => setJoinCode(formatRoomCode(e.target.value))}
            />
            <button type="submit" className="ms-join-submit" disabled={joinStatus === 'joining'}>
              {joinStatus === 'joining' ? 'Joining…' : 'Join our room'}
            </button>
          </form>

          {(joinStatus === 'error' || joinStatus === 'joined') && (
            <div className={`ms-message ${joinStatus}`} role="alert">
              {joinMessage}
            </div>
          )}
        </div>

        {hasActiveRoom && (
          <div className="ms-room-preview show">
            <div className="ms-room-top">
              <div>
                <div className="ms-room-label">Your room code</div>
                <div className="ms-room-code">{displayCode}</div>
              </div>
              <div className="ms-status">
                <span className="ms-status-dot" aria-hidden="true" />
                Connected
              </div>
            </div>
            <div className="ms-room-people">
              <div className="ms-avatar-stack">
                <div className="ms-avatar" aria-hidden="true" />
                <div className="ms-avatar" aria-hidden="true" />
              </div>
              Your little listening space is ready.
            </div>
          </div>
        )}

        {joinMessage && joinStatus !== 'joined' && joinStatus !== 'error' && !showJoinPanel && !createdRoom && (
          <div className="ms-message error" role="alert" style={{ marginTop: '16px', animation: 'msFloatIn 0.3s ease' }}>
            {joinMessage}
          </div>
        )}
      </main>

      <footer className="ms-footer">
        <div className="ms-footer-line" aria-hidden="true" />
        <p className="ms-footer-text">
          Made for the moments<br />
          <span>you wish could last a little longer.</span>
        </p>
      </footer>
    </div>
  );
}