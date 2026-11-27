import { useEffect, useRef, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { readClientId } from '../utils/clientId';
import { normalizeDisplayName, saveDisplayName } from '../utils/displayName';

/** Room codes are short and only have letters, digits and dashes. */
const CODE_RE = /^[A-Za-z0-9-]{2,64}$/;

function detectCode(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('code') || params.get('room') || '';
}

/**
 * Normalises a room input that may be a bare room code (SS-XXXX) or a full
 * room URL (https://sync-sound-lime.vercel.app/room/SS-XXXX), with optional
 * query parameters, fragments, trailing slashes, and surrounding whitespace.
 * Returns the extracted room code, or null when the input is invalid.
 */
function normalizeRoomInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let code: string;

  try {
    const url = new URL(trimmed);
    const pathMatch = url.pathname.match(/\/room\/([A-Za-z0-9-]+)\/?$/);
    if (!pathMatch) return null;
    code = pathMatch[1];
  } catch {
    code = trimmed;
  }

  code = code.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

type JoinRoomProps = {
  /** The name this person wants to be seen under. */
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  onJoined?: (code: string, name?: string) => void;
};

/** The invite link is followed once per page load, not on every visit. */
let linkJoinStarted = false;

export default function JoinRoom({ displayName, onDisplayNameChange, onJoined }: JoinRoomProps) {
  const { socket } = useSocket();
  const [code, setCode] = useState(detectCode());
  const [status, setStatus] = useState<'idle' | 'joining' | 'error' | 'joined'>('idle');
  const [message, setMessage] = useState('');
  const [nameError, setNameError] = useState('');
  /** The room code that came from the url, so the join only runs once. */
  const linkCode = useRef(detectCode());
  const clientId = useRef(readClientId());

  const join = (wanted?: string) => {
    const target = normalizeRoomInput(wanted ?? code);
    if (!target) {
      setStatus('error');
      setMessage('Enter a valid room code (SS-XXXX) or a full room URL');
      return;
    }
    const who = normalizeDisplayName(displayName);
    if (!who) {
      setStatus('error');
      setNameError('Please enter the name the others will see');
      setMessage('');
      return;
    }
    if (!socket) {
      setStatus('error');
      setMessage('Not connected');
      return;
    }
    setStatus('joining');
    setMessage('');
    setNameError('');
    saveDisplayName(who);
    socket.emit('join-room', { code: target, clientId: clientId.current, displayName: who }, (res: any) => {
      if (!res?.ok) {
        setStatus('error');
        setMessage(res?.error || 'Failed');
        return;
      }
      setStatus('joined');
      setMessage('Joined room ' + res.code);
      if (onJoined) onJoined(res.code, res.name);
    });
  };

  const visibleNameError = nameError && !normalizeDisplayName(displayName) ? nameError : '';

  // An invite link joins the room right away, so the other person only has
  // to open the link. The name of the last visit is used, so the listeners
  // know who arrived.
  useEffect(() => {
    if (!linkCode.current || !socket) return;
    const who = normalizeDisplayName(displayName);
    if (!who) {
      setNameError('Please enter the name the others will see');
      return;
    }
    if (linkJoinStarted) return;
    linkJoinStarted = true;
    setNameError('');
    join(linkCode.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, displayName]);

  return (
    <form className="ss-card-body">
      <div className="ss-field">
        <label className="ss-label" htmlFor="join-room-display-name">
          Your name
        </label>
        <input
          id="join-room-display-name"
          className="ss-input"
          placeholder="Enter your name"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          maxLength={24}
          aria-invalid={visibleNameError ? true : undefined}
          aria-describedby={visibleNameError ? 'join-room-display-name-error' : undefined}
        />
        <div className="ss-helper">
          <span>The other listeners will see this name.</span>
          <span className="ss-counter" aria-hidden="true">{displayName.length}/24</span>
        </div>
        {visibleNameError && (
          <p className="ss-error" id="join-room-display-name-error" role="alert">
            {visibleNameError}
          </p>
        )}
      </div>

      <div className="ss-field">
        <label className="ss-label" htmlFor="join-room-code">
          Room code or link
        </label>
        <input
          id="join-room-code"
          className="ss-input"
          placeholder="SS-1234 or https://sync-sound-lime.vercel.app/room/SS-1234"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <div className="ss-helper">
          <span>Paste a room code or a shared room link.</span>
        </div>
      </div>

      {status === 'error' && (
        <p className="ss-error" role="alert">
          {message}
        </p>
      )}
      {status === 'joined' && (
        <p className="ss-success" role="alert">
          {message}
        </p>
      )}

      <button className="ss-action-btn ss-action-btn--guest" type="submit" onClick={(e) => { e.preventDefault(); join(); }} disabled={status === 'joining'}>
        ↪ JOIN THE SESSION <span className="ss-arrow">→</span>
      </button>
    </form>
  );
}
