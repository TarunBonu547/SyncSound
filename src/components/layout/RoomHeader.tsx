import { Headphones, Users, Video, Link2 } from 'lucide-react';
import type { RoomMember } from '../../types/music';
import { avatarFor } from '../../utils/avatar';
import StatusIndicator from '../common/StatusIndicator';
import { useState, useEffect } from 'react';

type RoomHeaderProps = {
  roomCode: string | null;
  roomName: string | null;
  members: RoomMember[];
  connected: boolean;
  onOpenCall: () => void;
  onCopyLink: () => void;
};

export default function RoomHeader({ roomCode, roomName, members, connected, onOpenCall, onCopyLink }: RoomHeaderProps) {
  const count = Math.max(1, members.length);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      const timer = window.setTimeout(() => setCopied(false), 1800);
      return () => window.clearTimeout(timer);
    }
  }, [copied]);

  return (
    <section className="lounge-room-header">
      <div className="lounge-room-header-main">
        <div className="lounge-room-header-text">
          <p className="lounge-eyebrow">
            <span className={`lounge-live-dot ${connected ? 'is-live' : 'is-offline'}`} aria-hidden="true" />
            Now Playing Together
          </p>
          <h1 className="lounge-room-title">{roomName || 'Your room'}</h1>
          <div className="lounge-room-meta">
            <span className="lounge-room-code" title="The code of the room">
              {roomCode || '—'}
            </span>
            <StatusIndicator
              connected={connected}
              label={connected ? 'On Air' : 'Reconnecting…'}
              live={!!roomCode}
            />
            <span className="lounge-room-listeners" key={count}>
              <Users size={14} aria-hidden="true" />
              {count} {count === 1 ? 'listener' : 'listeners'}
            </span>
          </div>
        </div>

        <div className="lounge-room-header-right">
          <button
            className="lounge-header-btn lounge-header-btn--video"
            onClick={onOpenCall}
            title="Start a video call"
            aria-label="Start a video call"
            disabled={!roomCode}
          >
            <Video size={16} aria-hidden="true" />
            <span>Video Call</span>
          </button>
          <button
            className={`lounge-header-btn lounge-header-btn--share ${copied ? 'is-copied' : ''}`}
            onClick={onCopyLink}
            title={copied ? 'Link copied!' : 'Copy room link'}
            aria-label={copied ? 'Link copied!' : 'Copy room link'}
            disabled={!roomCode}
          >
            <Link2 size={16} aria-hidden="true" />
            <span>{copied ? 'Copied!' : 'Share Link'}</span>
          </button>

          <span className="lounge-listening-label">
            <Headphones size={15} aria-hidden="true" />
            Listening together
          </span>
          <div className="lounge-room-avatars" aria-label="Members of the room">
            {members.slice(0, 5).map((member) => {
              const avatar = avatarFor(member.name, member.clientId);
              return (
                <span
                  key={member.clientId}
                  className="lounge-room-avatar"
                  style={{ background: avatar.color }}
                  title={member.isHost ? `${member.name} (host)` : member.name}
                >
                  {avatar.initials}
                </span>
              );
            })}
            {members.length > 5 && <span className="lounge-room-avatar is-more">+{members.length - 5}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
