import { useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useSocket } from '../hooks/useSocket';
import { readClientId } from '../utils/clientId';
import { normalizeDisplayName, saveDisplayName } from '../utils/displayName';
import DisplayNameField from '../components/common/DisplayNameField';

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

  /**
   * A name that is written is not a wrong name any more.
   *
   * The field of the lobby and the field of this card share the name, so the
   * error of the last attempt goes away as soon as there is a name, no matter
   * where it was typed.
   */
  const visibleNameError = nameError && !normalizeDisplayName(displayName) ? nameError : '';

  const generate = () => {
    if (!name.trim()) {
      setError('Room name is required');
      return;
    }
    // The name of the person is asked for before the room is entered, so the
    // other listeners see a name and not a number.
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
    <div className="card room-card fade-in-up">
      <p className="eyebrow">New room</p>
      <h2>Start a room</h2>
      <p className="card-sub">Name your room, then share the code or the link so someone can join you.</p>

      <DisplayNameField
        id="create-room-display-name"
        value={displayName}
        onChange={onDisplayNameChange}
        error={visibleNameError}
      />

      <label className="field-label" htmlFor="create-room-name">
        Room name
      </label>
      <input
        id="create-room-name"
        className="input"
          placeholder="e.g. Sunday morning"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      {error && (
        <p className="error-text" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
      <button className="btn primary" onClick={generate}>
        Create Room
      </button>

      {room && (
        <div className="room-result">
          <span className="field-label">Room code</span>
          <div className="copy-row">
            <input className="input room-code" readOnly value={room.code} />
            <button className="btn" onClick={() => copy(room.code, 'code')}>
              {copied === 'code' ? <Check size={16} /> : <Copy size={16} />} {copied === 'code' ? 'Copied' : 'Copy'}
            </button>
          </div>

          <span className="field-label" style={{ marginTop: 16, display: 'block' }}>
            Invite link
          </span>
          <div className="copy-row">
            <input className="input" readOnly value={room.link} />
            <button className="btn" onClick={() => copy(room.link, 'link')}>
              {copied === 'link' ? <Check size={16} /> : <Copy size={16} />} {copied === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
