import { useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useSocket } from '../hooks/useSocket';
import { readClientId } from '../utils/clientId';
import { normalizeDisplayName, saveDisplayName } from '../utils/displayName';

type CreateRoomProps = {
  /** The name this person wants to be seen under. */
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  onCreated?: (code: string, name?: string) => void;
};

export default function CreateRoom({
  displayName,
  onDisplayNameChange,
  onCreated,
}: CreateRoomProps) {
  const { socket } = useSocket();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [room, setRoom] = useState<{ code: string; link: string } | null>(null);
  const [copied, setCopied] = useState('');
  /**
   * The id of this tab. The server uses it to recognise the person, so the
   * creator stays the host after a refresh.
   */
  const clientId = useRef(readClientId());

  const visibleNameError = nameError && !normalizeDisplayName(displayName) ? nameError : '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Room name is required');
      return;
    }
    const who = normalizeDisplayName(displayName);
    if (!who) {
      setNameError('Please enter the name the others will see');
      return;
    }
    if (!socket) {
      setError('Not connected');
      return;
    }
    setError('');
    setNameError('');
    saveDisplayName(who);
    socket.emit(
      'create-room',
      { name, clientId: clientId.current, displayName: who },
      (res: any) => {
        if (!res?.ok) {
          setError(res?.error || 'Failed');
          return;
        }
        setRoom({ code: res.code, link: `${window.location.origin}/?room=${res.code}` });
        if (onCreated) onCreated(res.code, res.name);
      },
    );
  };

  const copy = async (val: string, key: string) => {
    try {
      await navigator.clipboard.writeText(val);
    } catch {}
    setCopied(key);
    setTimeout(() => setCopied(''), 1500);
  };

  return (
    <form className="ss-card-body" onSubmit={handleSubmit}>
      <div className="ss-field">
        <label className="ss-label" htmlFor="create-room-display-name">
          Your name
        </label>
        <input
          id="create-room-display-name"
          className="ss-input"
          placeholder="Enter your name"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          maxLength={24}
          aria-invalid={visibleNameError ? true : undefined}
          aria-describedby={visibleNameError ? 'create-room-name-error' : undefined}
        />
        <div className="ss-helper">
          <span>The other listeners will see this name.</span>
          <span className="ss-counter" aria-hidden="true">{displayName.length}/24</span>
        </div>
        {visibleNameError && (
          <p className="ss-error" id="create-room-name-error" role="alert">
            {visibleNameError}
          </p>
        )}
      </div>

      <div className="ss-field">
        <label className="ss-label" htmlFor="create-room-name">
          Room name
        </label>
        <input
          id="create-room-name"
          className="ss-input"
          placeholder="e.g. Late night listening"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
        />
      </div>

      {error && (
        <p className="ss-error" role="alert">
          {error}
        </p>
      )}

      <button className="ss-action-btn ss-action-btn--host" type="submit">
        CREATE YOUR ROOM <span className="ss-arrow">→</span>
      </button>

      {room && (
        <div className="ss-result">
          <span className="ss-label">Room code</span>
          <div className="ss-code-row">
            <input className="ss-input ss-room-code" readOnly value={room.code} />
            <button className="ss-copy-btn" onClick={() => copy(room.code, 'code')}>
              {copied === 'code' ? <Check size={16} /> : <Copy size={16} />}
              {copied === 'code' ? 'Copied' : 'Copy'}
            </button>
          </div>

          <span className="ss-label" style={{ marginTop: 16, display: 'block' }}>
            Invite link
          </span>
          <div className="ss-code-row">
            <input className="ss-input" readOnly value={room.link} />
            <button className="ss-copy-btn" onClick={() => copy(room.link, 'link')}>
              {copied === 'link' ? <Check size={16} /> : <Copy size={16} />}
              {copied === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
