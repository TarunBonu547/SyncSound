import { useEffect, useRef, useState } from 'react';
import { LogIn } from 'lucide-react';
import { useSocket } from '../hooks/useSocket';
import { readClientId } from '../utils/clientId';
import { normalizeDisplayName, saveDisplayName } from '../utils/displayName';
import DisplayNameField from '../components/common/DisplayNameField';

function detectCode(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('code') || params.get('room') || '';
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
    const target = (wanted ?? code).trim();
    if (!target) {
      setStatus('error');
      setMessage('Room code is required');
      return;
    }
    // The name of the person is asked for before the room is entered, so the
    // other listeners see a name and not a number.
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

  // An invite link joins the room right away, so the other person only has
  // to open the link. The name of the last visit is used, so the listeners
  // know who arrived.
  useEffect(() => {
    if (!linkCode.current || !socket || linkJoinStarted) return;
    linkJoinStarted = true;
    const who = normalizeDisplayName(displayName);
    if (!who) {
      // Without a name the room is not entered: the person chooses one first.
      setNameError('Please enter the name the others will see');
      return;
    }
    join(linkCode.current);
    // The join runs once for the link, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  return (
    <div className="card room-card fade-in-up">
      <p className="eyebrow">Join</p>
      <h2>Enter a room</h2>
      <p className="card-sub">Have a room code? Enter it and you will join the room on the same track, at the same moment.</p>

      <DisplayNameField
        id="join-room-display-name"
        value={displayName}
        onChange={onDisplayNameChange}
        error={nameError}
      />

      <label className="field-label" htmlFor="join-room-code">
        Room code
      </label>
      <input
        id="join-room-code"
        className="input"
          placeholder="Room code (e.g. SS-AB12CD)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      {status === 'error' && (
        <p className="error-text" role="alert" style={{ marginTop: 8 }}>
          {message}
        </p>
      )}
      {status === 'joined' && (
        <p className="success-text" style={{ marginTop: 8 }}>
          {message}
        </p>
      )}
      <button className="btn primary" onClick={() => join()} disabled={status === 'joining'}>
        <LogIn size={16} /> {status === 'joining' ? 'Joining...' : 'Join Room'}
      </button>
    </div>
  );
}
