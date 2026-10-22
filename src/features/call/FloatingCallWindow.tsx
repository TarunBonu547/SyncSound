import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  Phone,
  X,
  Minimize,
  Maximize,
  Loader2,
  Volume2,
  GripHorizontal,
} from 'lucide-react';
import type { VideoCall } from './useVideoCall';
import './call.css';

type FloatingCallWindowProps = {
  call: VideoCall;
  /** The window is only rendered while this is true. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomCode: string | null;
  /** The name of the other person in the room, when it is known. */
  peerName?: string | null;
};

const MIN_WIDTH = 280;
const MIN_HEIGHT = 360;
const MAX_WIDTH = 560;
const MINIMIZED_HEIGHT = 64;
/** The space the window keeps to the edges of the screen. */
const MARGIN = 16;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * The video call as a floating window.
 *
 * The window lives above the application: it is positioned with `fixed`, so
 * opening, moving or resizing it never moves the player, the queue or the
 * chat. It is hidden completely until the video call is asked for, and
 * closing it only hides the window - an active call keeps running.
 */
export default function FloatingCallWindow({
  call,
  open,
  onOpenChange,
  roomCode,
  peerName,
}: FloatingCallWindowProps) {
  const {
    status,
    error,
    incoming,
    localStream,
    remoteStream,
    micEnabled,
    cameraEnabled,
    remoteMicEnabled,
    remoteCameraEnabled,
    remoteAudioBlocked,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMic,
    toggleCamera,
    dismiss,
    reportRemoteAudioBlocked,
  } = call;

  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);

  const [frame, setFrame] = useState({ x: 0, y: 0, width: 400, height: 560 });
  const [minimized, setMinimized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);

  const gestureRef = useRef<{
    mode: 'move' | string | null;
    startX: number;
    startY: number;
    startXPos: number;
    startYPos: number;
    startW: number;
    startH: number;
    target: HTMLElement | null;
  }>({ mode: null, startX: 0, startY: 0, startXPos: 0, startYPos: 0, startW: 0, startH: 0, target: null });

  const busy = status === 'requesting' || status === 'calling' || status === 'connecting';
  const live = status === 'calling' || status === 'ringing' || status === 'connecting' || status === 'connected';

  /** The size the window may have right now. */
  const limits = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      maxW: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, vw - MARGIN * 2)),
      maxH: Math.max(MIN_HEIGHT, Math.min(Math.floor(vh * 0.86), vh - MARGIN * 2)),
    };
  };

  // Place the window above the mini player when it opens.
  useEffect(() => {
    if (!open || !windowRef.current) return;
    const { maxW, maxH } = limits();
    const width = Math.min(frame.width, maxW);
    const height = Math.min(frame.height, maxH);
    setFrame({
      width,
      height,
      x: clamp(window.innerWidth - width - MARGIN, 0, Math.max(0, window.innerWidth - width)),
      // The mini player is 92px high, the window sits above it.
      y: clamp(window.innerHeight - height - 104, 0, Math.max(0, window.innerHeight - height)),
    });
    windowRef.current.focus();
    // The window is placed once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the window inside the viewport when the viewport changes.
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const { maxW, maxH } = limits();
      setFrame((f) => {
        const width = clamp(f.width, MIN_WIDTH, maxW);
        const height = clamp(f.height, MIN_HEIGHT, maxH);
        return {
          width,
          height,
          x: clamp(f.x, 0, Math.max(0, window.innerWidth - width)),
          y: clamp(f.y, 0, Math.max(0, window.innerHeight - height)),
        };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  // Attach the streams to the video elements.
  useEffect(() => {
    const el = remoteVideoRef.current;
    if (!el) return;
    if (el.srcObject !== remoteStream) el.srcObject = remoteStream;
    if (!remoteStream) return;
    if (typeof console !== 'undefined') {
      console.debug('[call] remote video element', {
        hasStream: Boolean(remoteStream),
        tracks: remoteStream.getTracks().map((t) => t.kind),
        status,
      });
    }
    const attempt = el.play();
    if (attempt) {
      attempt
        .then(() => reportRemoteAudioBlocked(false))
        .catch((err) => {
          if (typeof console !== 'undefined') console.debug('[call] remote play() rejected', { name: (err as { name?: string })?.name });
          reportRemoteAudioBlocked(true);
        });
    }
  }, [remoteStream, reportRemoteAudioBlocked, status]);

  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    if (el.srcObject !== localStream) el.srcObject = localStream;
    if (localStream) {
      const attempt = el.play();
      if (attempt) attempt.catch(() => undefined);
    }
  }, [localStream, status]);

  // Escape hides the window without ending a live call.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const startGesture = useCallback((e: ReactPointerEvent, mode: 'move' | string) => {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // The capture is a convenience, the window listeners do the work.
    }
    const rect = windowRef.current!.getBoundingClientRect();
    gestureRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startXPos: rect.left,
      startYPos: rect.top,
      startW: rect.width,
      startH: rect.height,
      target,
    };
    setDragging(mode === 'move');
    setResizing(mode !== 'move');
  }, []);

  const onMove = useCallback((e: PointerEvent) => {
    const g = gestureRef.current;
    if (!g.mode || !windowRef.current) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { maxW, maxH } = limits();

    let x = g.startXPos;
    let y = g.startYPos;
    let w = g.startW;
    let h = g.startH;

    const apply = (mode: string) => {
      if (mode === 'move') {
        x = clamp(g.startXPos + dx, 0, Math.max(0, vw - w));
        y = clamp(g.startYPos + dy, 0, Math.max(0, vh - h));
      } else if (mode.includes('e')) {
        w = clamp(g.startW + dx, MIN_WIDTH, maxW);
      } else if (mode.includes('w')) {
        w = clamp(g.startW - dx, MIN_WIDTH, maxW);
        x = clamp(g.startXPos + dx, 0, Math.max(0, vw - w));
      }
      if (mode.includes('s')) {
        h = clamp(g.startH + dy, MIN_HEIGHT, maxH);
      } else if (mode.includes('n')) {
        h = clamp(g.startH - dy, MIN_HEIGHT, maxH);
        y = clamp(g.startYPos + dy, 0, Math.max(0, vh - h));
      }
      x = clamp(x, 0, Math.max(0, vw - w));
      y = clamp(y, 0, Math.max(0, vh - h));
    };
    apply(g.mode);

    setFrame((f) => {
      const next = { ...f, x, y };
      if (g.mode !== 'move') {
        next.width = w;
        next.height = h;
      }
      return next;
    });
  }, []);

  const onUp = useCallback(() => {
    const g = gestureRef.current;
    if (g.target) {
      try {
        g.target.releasePointerCapture(0);
      } catch {
        // The capture may already be gone.
      }
    }
    gestureRef.current = {
      mode: null,
      startX: 0,
      startY: 0,
      startXPos: 0,
      startYPos: 0,
      startW: 0,
      startH: 0,
      target: null,
    };
    setDragging(false);
    setResizing(false);
  }, []);

  useEffect(() => {
    if (!dragging && !resizing) return;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, resizing, onMove, onUp]);

  const statusText = () => {
    switch (status) {
      case 'idle':
        return 'Private call in this room.';
      case 'requesting':
        return 'Asking for camera and microphone…';
      case 'calling':
        return 'Ringing the other person…';
      case 'ringing':
        return 'Incoming call.';
      case 'connecting':
        return 'Connecting the call…';
      case 'connected':
        return peerName ? `Call with ${peerName}` : 'Call connected.';
      case 'ended':
        return 'The call has ended.';
      case 'failed':
        return 'The call did not work out.';
    }
  };

  /** Hides the window. An active call keeps running. */
  const close = () => {
    if (!live) dismiss();
    onOpenChange(false);
  };

  const resumeAudio = () => {
    const el = remoteVideoRef.current;
    if (!el) return;
    const attempt = el.play();
    if (attempt) {
      attempt.then(() => reportRemoteAudioBlocked(false)).catch(() => undefined);
    }
  };

  // Hidden completely until the user opens the video call.
  if (!open) {
    if (status === 'ringing' && incoming) {
      return (
        <div className="incoming-call-banner" role="alert" aria-label="Incoming video call">
          <span className="banner-dot" aria-hidden="true" />
          <span>Incoming {incoming.media === 'audio' ? 'audio' : 'video'} call.</span>
          <button className="btn" onClick={declineCall}>
            <PhoneOff size={15} aria-hidden="true" /> Decline
          </button>
          <button className="btn primary" onClick={acceptCall}>
            <Phone size={15} aria-hidden="true" /> Accept
          </button>
        </div>
      );
    }
    if (live) {
      // The call is running and the window is hidden: a small dock brings it
      // back without ending anything.
      return (
        <div className="call-dock" role="status">
          <span className="banner-dot" aria-hidden="true" />
          <span>Call is running</span>
          <button className="btn sm" onClick={() => onOpenChange(true)}>
            Show
          </button>
        </div>
      );
    }
    return null;
  }

  const height = minimized ? MINIMIZED_HEIGHT : frame.height;

  return (
    <div
      ref={windowRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Video call"
      className={`floating-call ${minimized ? 'is-minimized' : ''} ${dragging ? 'is-dragging' : ''}`}
      style={{ left: frame.x, top: frame.y, width: frame.width, height }}
    >
      <div className="floating-call-title-bar">
        <div
          className="floating-call-drag"
          onPointerDown={(e) => startGesture(e, 'move')}
          role="presentation"
        >
          <span className="floating-call-grip" aria-hidden="true">
            <GripHorizontal size={14} />
          </span>
          <span className="floating-call-mark" aria-hidden="true">
            <Video size={15} />
          </span>
          <div className="floating-call-head-text">
            <p className="floating-call-title">Video Call</p>
            <p className="floating-call-status">{statusText()}</p>
          </div>
        </div>
        <div className="floating-call-buttons">
          <button
            className="btn icon sm"
            onClick={() => setMinimized((m) => !m)}
            title={minimized ? 'Restore the window' : 'Minimize the window'}
            aria-label={minimized ? 'Restore the window' : 'Minimize the window'}
          >
            {minimized ? <Maximize size={14} aria-hidden="true" /> : <Minimize size={14} aria-hidden="true" />}
          </button>
          <button className="btn icon sm" onClick={close} title="Close the window" aria-label="Close the window">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="floating-call-body">
        {error && (
          <p className="call-error" role="alert">
            {error.message}
          </p>
        )}

        {status === 'idle' && (
          <div className="call-body call-body-center">
            <span className="call-illustration" aria-hidden="true">
              <Video size={26} />
            </span>
            <p className="call-hint">
              Only the two people in room <strong>{roomCode || '—'}</strong> can reach each other. The music
              keeps playing while you talk.
            </p>
            <button className="btn primary" onClick={startCall} disabled={!roomCode}>
              <Phone size={15} aria-hidden="true" /> Start call
            </button>
          </div>
        )}

        {status === 'requesting' && (
          <div className="call-body call-body-center">
            <Loader2 size={22} className="call-spinner" />
            <p className="call-hint">Waiting for camera and microphone permission.</p>
          </div>
        )}

        {status === 'calling' && (
          <div className="call-body call-body-center">
            <Loader2 size={22} className="call-spinner" />
            <p className="call-hint">Waiting for the other person to pick up.</p>
            <button className="btn" onClick={endCall}>
              <PhoneOff size={16} aria-hidden="true" /> Cancel
            </button>
          </div>
        )}

        {status === 'ringing' && (
          <div className="call-body call-body-center">
            <span className="call-pulse" aria-hidden="true">
              <Phone size={20} />
            </span>
            <p className="call-hint">Incoming {incoming?.media === 'audio' ? 'audio' : 'video'} call.</p>
            <div className="call-action-row">
              <button className="btn" onClick={declineCall}>
                <PhoneOff size={16} aria-hidden="true" /> Decline
              </button>
              <button className="btn primary" onClick={acceptCall}>
                <Phone size={16} aria-hidden="true" /> Accept
              </button>
            </div>
          </div>
        )}

        {status === 'connecting' && (
          <div className="call-body call-body-center">
            <Loader2 size={22} className="call-spinner" />
            <p className="call-hint">Setting up the secure peer connection…</p>
          </div>
        )}

        {status === 'connected' && (
          <div className="call-body call-body-media">
            <div className="call-video">
              <video ref={remoteVideoRef} className="call-video-el" autoPlay playsInline muted={false} />
              {!remoteCameraEnabled && (
                <div className="call-video-off">
                  <VideoOff size={20} aria-hidden="true" />
                  <span>The camera is off</span>
                </div>
              )}
              {!remoteMicEnabled && (
                <span className="call-remote-muted" title="The microphone is muted">
                  <MicOff size={14} aria-hidden="true" />
                </span>
              )}
              {localStream && (
                <div className="call-preview">
                  <video ref={localVideoRef} className="call-preview-el" autoPlay playsInline muted />
                  {!cameraEnabled && (
                    <span className="call-preview-off" aria-hidden="true">
                      <VideoOff size={16} />
                    </span>
                  )}
                </div>
              )}
            </div>

            {remoteAudioBlocked && (
              <button className="call-audio-nudge" onClick={resumeAudio}>
                <Volume2 size={15} aria-hidden="true" /> Tap to hear the other person
              </button>
            )}

            <div className="call-controls">
              <button
                className={`btn icon call-control ${micEnabled ? '' : 'is-off'}`}
                onClick={toggleMic}
                title={micEnabled ? 'Mute the microphone' : 'Unmute the microphone'}
                aria-label={micEnabled ? 'Mute the microphone' : 'Unmute the microphone'}
                aria-pressed={!micEnabled}
              >
                {micEnabled ? <Mic size={17} aria-hidden="true" /> : <MicOff size={17} aria-hidden="true" />}
              </button>
              <button
                className={`btn icon call-control ${cameraEnabled ? '' : 'is-off'}`}
                onClick={toggleCamera}
                title={cameraEnabled ? 'Turn the camera off' : 'Turn the camera on'}
                aria-label={cameraEnabled ? 'Turn the camera off' : 'Turn the camera on'}
                aria-pressed={!cameraEnabled}
              >
                {cameraEnabled ? <Video size={17} aria-hidden="true" /> : <VideoOff size={17} aria-hidden="true" />}
              </button>
              <button
                className="btn icon call-control is-hangup"
                onClick={endCall}
                title="End the call"
                aria-label="End the call"
              >
                <PhoneOff size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {(status === 'ended' || status === 'failed') && (
          <div className="call-body call-body-center">
            <p className="call-hint">
              {status === 'failed' ? 'The call did not work out.' : 'The call has ended.'}
            </p>
            <div className="call-action-row">
              {status === 'failed' && (
                <button className="btn primary" onClick={startCall} disabled={busy}>
                  <Phone size={16} aria-hidden="true" /> Try again
                </button>
              )}
              <button className="btn" onClick={close}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="resize-handle nw" onPointerDown={(e) => startGesture(e, 'nw')} />
      <div className="resize-handle ne" onPointerDown={(e) => startGesture(e, 'ne')} />
      <div className="resize-handle sw" onPointerDown={(e) => startGesture(e, 'sw')} />
      <div className="resize-handle se" onPointerDown={(e) => startGesture(e, 'se')} />
      <div className="resize-handle n" onPointerDown={(e) => startGesture(e, 'n')} />
      <div className="resize-handle s" onPointerDown={(e) => startGesture(e, 's')} />
      <div className="resize-handle w" onPointerDown={(e) => startGesture(e, 'w')} />
      <div className="resize-handle e" onPointerDown={(e) => startGesture(e, 'e')} />
    </div>
  );
}
