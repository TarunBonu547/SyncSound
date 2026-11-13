import { Copy, Check, Video, Users } from 'lucide-react';
import type { RoomMember } from '../../types/music';
import { avatarFor } from '../../utils/avatar';
import StatusIndicator from '../common/StatusIndicator';

type RoomHeaderProps = {
  roomCode: string | null;
  roomName: string | null;
  members: RoomMember[];
  connected: boolean;
  /** True when the invite link really made it into the clipboard. */
  linkCopied: boolean;
  onCopyInvite: () => void;
  onVideoCall: () => void;
};

/**
 * The head of the room.
 *
 * It carries the three things a person needs to share the room: the name, the
 * code and the button that copies the invite link. The members of the room
 * are shown as initials, so it is obvious who is listening.
 */
export default function RoomHeader({
  roomCode,
  roomName,
  members,
  connected,
  linkCopied,
  onCopyInvite,
  onVideoCall,
}: RoomHeaderProps) {
  const count = Math.max(1, members.length);

  return (
    <header className="room-header card">
      <div className="room-header-main">
        <div className="room-header-text">
          <p className="eyebrow">Now playing together</p>
          <h1 className="room-title">{roomName || 'Your room'}</h1>
          <div className="room-header-meta">
            <span className="room-code-chip" title="The code of the room">
              {roomCode || '—'}
            </span>
            <StatusIndicator
              connected={connected}
              label={connected ? 'Connected' : 'Reconnecting…'}
              live={!!roomCode}
            />
            <span className="room-member-count">
              <Users size={14} aria-hidden="true" />
              {count} {count === 1 ? 'listener' : 'listeners'}
            </span>
          </div>
        </div>

        <div className="room-header-actions">
          <div className="room-avatars" aria-label="Members of the room">
            {members.slice(0, 5).map((member) => {
              const avatar = avatarFor(member.name, member.clientId);
              return (
                <span
                  key={member.clientId}
                  className="room-avatar"
                  style={{ background: avatar.color }}
                  title={member.isHost ? `${member.name} (host)` : member.name}
                >
                  {avatar.initials}
                </span>
              );
            })}
            {members.length > 5 && <span className="room-avatar is-more">+{members.length - 5}</span>}
          </div>
          <button className="btn" onClick={onCopyInvite} title="Copy the invite link">
            {linkCopied ? <Check size={16} /> : <Copy size={16} />}
            {linkCopied ? 'Link copied' : 'Invite'}
          </button>
          <button className="btn primary" onClick={onVideoCall} title="Start a video call">
            <Video size={16} aria-hidden="true" />
            <span>Video Call</span>
          </button>
        </div>
      </div>
    </header>
  );
}
