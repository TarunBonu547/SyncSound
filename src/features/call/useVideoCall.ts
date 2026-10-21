import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { iceServers } from './iceConfig';

/**
 * Two person video call.
 *
 * The hook owns everything WebRTC: media acquisition, the peer connection,
 * the signaling listeners and the cleanup. It only uses the existing socket
 * for signaling and never touches the music playback, the queue or the room
 * lifecycle.
 */

export type CallStatus =
  /** Nothing is happening. */
  | 'idle'
  /** The camera and microphone are being requested. */
  | 'requesting'
  /** The call is ringing at the other side. */
  | 'calling'
  /** The other side is ringing us. */
  | 'ringing'
  /** Both sides accepted, the peer connection is being established. */
  | 'connecting'
  /** The peer connection is up and media is flowing. */
  | 'connected'
  /** The call is over. */
  | 'ended'
  /** The call could not be established. */
  | 'failed';

export type CallErrorCode = 'permission' | 'device' | 'network' | 'busy' | 'timeout' | 'unknown';

export type CallError = { code: CallErrorCode; message: string };

export type IncomingCall = { callId: string; media: 'video' | 'audio' };

/** How long the other side may take to answer. */
const RING_TIMEOUT_MS = 45_000;
/** How long the peer connection may take to come up. */
const CONNECT_TIMEOUT_MS = 30_000;
/** How long a dropped connection may recover before the call is given up on. */
const RECOVER_TIMEOUT_MS = 8_000;

type Role = 'caller' | 'callee' | null;

function describeMediaError(err: unknown): CallError {
  const name = (err as { name?: string })?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      code: 'permission',
      message: 'Camera and microphone access was denied. Allow access for this site to start a call.',
    };
  }
  if (name === 'SecurityError') {
    return {
      code: 'permission',
      message: 'Camera and microphone access needs a secure connection. Use HTTPS (localhost works without it).',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return { code: 'device', message: 'No camera or microphone was found on this device.' };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return { code: 'device', message: 'The camera or microphone is already in use by another application.' };
  }
  if (name === 'AbortError') {
    return { code: 'device', message: 'The camera could not be started.' };
  }
  return { code: 'unknown', message: 'The camera and microphone could not be started.' };
}

type Acquired = { stream: MediaStream | null; error: CallError | null; audioOnly: boolean };

export function useVideoCall({ socket, roomCode }: { socket: Socket | null; roomCode: string | null }) {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [error, setError] = useState<CallError | null>(null);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [remoteMicEnabled, setRemoteMicEnabled] = useState(true);
  const [remoteCameraEnabled, setRemoteCameraEnabled] = useState(true);
  const [remoteAudioBlocked, setRemoteAudioBlocked] = useState(false);
  /** The camera is not available, the call runs on audio only. */
  const [audioOnly, setAudioOnly] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const roleRef = useRef<Role>(null);
  const incomingRef = useRef<IncomingCall | null>(null);
  const micRef = useRef(true);
  const cameraRef = useRef(true);
  /** ICE candidates that arrived before the remote description was set. */
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionRef = useRef(false);
  const ringTimerRef = useRef<number | null>(null);
  const connectTimerRef = useRef<number | null>(null);
  const recoverTimerRef = useRef<number | null>(null);
  /** The current status, readable from long lived timers without resubscribing. */
  const statusRef = useRef<CallStatus>(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearTimers = useCallback(() => {
    if (ringTimerRef.current !== null) window.clearTimeout(ringTimerRef.current);
    if (connectTimerRef.current !== null) window.clearTimeout(connectTimerRef.current);
    if (recoverTimerRef.current !== null) window.clearTimeout(recoverTimerRef.current);
    ringTimerRef.current = null;
    connectTimerRef.current = null;
    recoverTimerRef.current = null;
  }, []);

  /** Releases the camera and the microphone. */
  const stopLocalMedia = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // The track may already be gone.
        }
      });
    }
    localStreamRef.current = null;
    setLocalStream(null);
  }, []);

  /** Closes the peer connection and drops everything it produced. */
  const closePeer = useCallback(() => {
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // Closing twice is harmless.
      }
    }
    pendingCandidatesRef.current = [];
    remoteDescriptionRef.current = false;
    remoteStreamRef.current = null;
    setRemoteStream(null);
    setRemoteAudioBlocked(false);
  }, []);

  /** Tears the call down without telling the other side. */
  const teardown = useCallback(() => {
    clearTimers();
    closePeer();
    stopLocalMedia();
    callIdRef.current = null;
    roleRef.current = null;
    incomingRef.current = null;
    setIncoming(null);
    micRef.current = true;
    cameraRef.current = true;
    setMicEnabled(true);
    setCameraEnabled(true);
    setRemoteMicEnabled(true);
    setRemoteCameraEnabled(true);
    setAudioOnly(false);
    setStatus('idle');
  }, [clearTimers, closePeer, stopLocalMedia]);

  /**
   * Asks for the camera and the microphone. When only the camera fails the
   * call continues without video instead of dying.
   */
  const acquireMedia = useCallback(async (wantVideo: boolean): Promise<Acquired> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return {
        stream: null,
        audioOnly: false,
        error: { code: 'device', message: 'This browser cannot access a camera or a microphone.' },
      };
    }
    const audio: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio,
        video: wantVideo ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false,
      });
      return { stream, error: null, audioOnly: false };
    } catch (err) {
      const failure = describeMediaError(err);
      if (!wantVideo) return { stream: null, error: failure, audioOnly: false };
      // The camera can fail on its own: an audio only call is still a call.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
        return {
          stream,
          audioOnly: true,
          error: { code: failure.code, message: `${failure.message} The call continues without video.` },
        };
      } catch {
        return { stream: null, error: failure, audioOnly: false };
      }
    }
  }, []);

  /** Sends our microphone and camera state to the other side. */
  const sendMediaState = useCallback(() => {
    const callId = callIdRef.current;
    if (!socket || !roomCode || !callId) return;
    socket.emit('call:media', { code: roomCode, callId, mic: micRef.current, camera: cameraRef.current });
  }, [socket, roomCode]);

  /** Creates the peer connection. There is never more than one. */
  const createPeer = useCallback(() => {
    const existing = pcRef.current;
    if (existing) {
      try {
        existing.close();
      } catch {
        // Closing twice is harmless.
      }
    }
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    pcRef.current = pc;
    remoteDescriptionRef.current = false;
    pendingCandidatesRef.current = [];

    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, stream);
        } catch {
          // A track that cannot be added is reported by the missing stream.
        }
      });
    }

    pc.onicecandidate = (event) => {
      const callId = callIdRef.current;
      if (!event.candidate || !socket || !roomCode || !callId) return;
      socket.emit('call:ice', { code: roomCode, callId, candidate: event.candidate.toJSON() });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        if (recoverTimerRef.current !== null) {
          window.clearTimeout(recoverTimerRef.current);
          recoverTimerRef.current = null;
        }
        setStatus('connected');
        setError(null);
        return;
      }
      if (state === 'failed') {
        setError({ code: 'network', message: 'The call could not be established. Check your network and try again.' });
        setStatus('failed');
        return;
      }
      if (state === 'disconnected') {
        // The connection may recover on its own, so it is given a moment.
        if (recoverTimerRef.current !== null) window.clearTimeout(recoverTimerRef.current);
        recoverTimerRef.current = window.setTimeout(() => {
          recoverTimerRef.current = null;
          setError({ code: 'network', message: 'The connection was interrupted.' });
          setStatus('failed');
        }, RECOVER_TIMEOUT_MS);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        setError({ code: 'network', message: 'No network path to the other side was found.' });
        setStatus('failed');
      }
    };

    return pc;
  }, [socket, roomCode]);

  /** Adds ICE candidates that arrived before the remote description. */
  const flushCandidates = useCallback(async () => {
    const pc = pcRef.current;
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    if (!pc || !queued.length) return;
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // A rejected candidate is not fatal, the others may still work.
      }
    }
  }, []);

  // --- signaling -------------------------------------------------------------
  useEffect(() => {
    if (!socket || !roomCode) return;

    const fail = (message: string, code: CallErrorCode = 'unknown') => {
      teardown();
      setError({ code, message });
      setStatus('failed');
    };

    const onIncoming = (payload: { callId?: string; media?: 'video' | 'audio' }) => {
      if (!payload?.callId) return;
      // Both sides rang at the same time: the incoming call wins, the
      // outgoing one is dropped by the server on its own.
      if (roleRef.current === 'caller') {
        roleRef.current = null;
        callIdRef.current = null;
        if (ringTimerRef.current !== null) window.clearTimeout(ringTimerRef.current);
        ringTimerRef.current = null;
        stopLocalMedia();
        setLocalStream(null);
      }
      const call: IncomingCall = { callId: payload.callId, media: payload.media === 'audio' ? 'audio' : 'video' };
      incomingRef.current = call;
      setIncoming(call);
      setError(null);
      setStatus('ringing');
    };

    const onAccepted = async (payload: { callId?: string }) => {
      if (!payload?.callId || callIdRef.current !== payload.callId) return;
      setStatus('connecting');
      const pc = createPeer();
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('call:offer', { code: roomCode, callId: payload.callId, type: 'offer', sdp: offer.sdp });
      } catch {
        fail('The call could not be started.', 'network');
      }
    };

    const onDeclined = (payload: { callId?: string }) => {
      if (!payload?.callId || callIdRef.current !== payload.callId) return;
      teardown();
      setError({ code: 'busy', message: 'The call was declined.' });
      setStatus('ended');
    };

    const onEnded = (payload: { callId?: string; reason?: string }) => {
      if (payload?.callId && callIdRef.current && payload.callId !== callIdRef.current) return;
      const reason = payload?.reason;
      teardown();
      if (reason === 'timeout') {
        setError({ code: 'timeout', message: 'Nobody answered the call.' });
        setStatus('failed');
        return;
      }
      setStatus('ended');
    };

    const onOffer = async (payload: { callId?: string; type?: string; sdp?: string }) => {
      if (!payload?.callId || !payload.sdp) return;
      if (callIdRef.current && callIdRef.current !== payload.callId) return;
      callIdRef.current = payload.callId;
      const pc = createPeer();
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
        remoteDescriptionRef.current = true;
        await flushCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('call:answer', { code: roomCode, callId: payload.callId, type: 'answer', sdp: answer.sdp });
        setStatus('connecting');
      } catch {
        fail('The call could not be answered.', 'network');
      }
    };

    const onAnswer = async (payload: { callId?: string; type?: string; sdp?: string }) => {
      if (!payload?.callId || !payload.sdp) return;
      if (callIdRef.current !== payload.callId) return;
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
        remoteDescriptionRef.current = true;
        await flushCandidates();
      } catch {
        fail('The call could not be answered.', 'network');
      }
    };

    const onIce = async (payload: { callId?: string; candidate?: RTCIceCandidateInit | null }) => {
      if (!payload?.callId || callIdRef.current !== payload.callId) return;
      if (!payload.candidate) return;
      const pc = pcRef.current;
      if (!pc) return;
      if (!remoteDescriptionRef.current) {
        // The remote description is not ready yet: remember the candidate.
        pendingCandidatesRef.current.push(payload.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch {
        // A single bad candidate does not break the connection.
      }
    };

    const onMedia = (payload: { callId?: string; mic?: boolean; camera?: boolean }) => {
      if (!payload?.callId || callIdRef.current !== payload.callId) return;
      setRemoteMicEnabled(payload.mic !== false);
      setRemoteCameraEnabled(payload.camera !== false);
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:accepted', onAccepted);
    socket.on('call:declined', onDeclined);
    socket.on('call:ended', onEnded);
    socket.on('call:offer', onOffer);
    socket.on('call:answer', onAnswer);
    socket.on('call:ice', onIce);
    socket.on('call:media', onMedia);

    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:accepted', onAccepted);
      socket.off('call:declined', onDeclined);
      socket.off('call:ended', onEnded);
      socket.off('call:offer', onOffer);
      socket.off('call:answer', onAnswer);
      socket.off('call:ice', onIce);
      socket.off('call:media', onMedia);
    };
  }, [socket, roomCode, createPeer, flushCandidates, teardown, stopLocalMedia]);

  // --- actions ---------------------------------------------------------------
  const startCall = useCallback(async () => {
    if (!socket || !roomCode) return;
    if (pcRef.current || callIdRef.current) return; // a call is already running
    setError(null);
    setStatus('requesting');
    const { stream, error: mediaError, audioOnly: noVideo } = await acquireMedia(true);
    if (!stream) {
      setError(mediaError);
      setStatus('failed');
      return;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setAudioOnly(noVideo);
    if (mediaError) setError(mediaError);
    setStatus('calling');
    socket.emit('call:invite', { code: roomCode, media: noVideo ? 'audio' : 'video' }, (res: { ok?: boolean; callId?: string; error?: string }) => {
      if (!res?.ok) {
        teardown();
        setError({ code: 'busy', message: res?.error || 'The call could not be started.' });
        setStatus('failed');
        return;
      }
      callIdRef.current = res.callId || null;
      roleRef.current = 'caller';
      sendMediaState();
      ringTimerRef.current = window.setTimeout(() => {
        ringTimerRef.current = null;
        if (callIdRef.current !== res.callId) return;
        teardown();
        setError({ code: 'timeout', message: 'Nobody answered the call.' });
        setStatus('failed');
      }, RING_TIMEOUT_MS);
    });
  }, [socket, roomCode, acquireMedia, sendMediaState, teardown]);

  const acceptCall = useCallback(async () => {
    const call = incomingRef.current;
    if (!socket || !roomCode || !call) return;
    if (pcRef.current || callIdRef.current) return;
    setStatus('requesting');
    const { stream, error: mediaError, audioOnly: noVideo } = await acquireMedia(call.media !== 'audio');
    if (!stream) {
      setError(mediaError);
      setStatus('failed');
      incomingRef.current = null;
      setIncoming(null);
      socket.emit('call:decline', { code: roomCode, callId: call.callId });
      return;
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    setAudioOnly(noVideo);
    if (mediaError) setError(mediaError);
    callIdRef.current = call.callId;
    roleRef.current = 'callee';
    incomingRef.current = null;
    setIncoming(null);
    setStatus('connecting');
    socket.emit('call:accept', { code: roomCode, callId: call.callId }, (res: { ok?: boolean; error?: string }) => {
      if (!res?.ok) {
        teardown();
        setError({ code: 'busy', message: res?.error || 'The call could not be accepted.' });
        setStatus('failed');
        return;
      }
      sendMediaState();
      connectTimerRef.current = window.setTimeout(() => {
        connectTimerRef.current = null;
        if (statusRef.current === 'connected') return;
        teardown();
        setError({ code: 'timeout', message: 'The call could not be connected in time.' });
        setStatus('failed');
      }, CONNECT_TIMEOUT_MS);
    });
  }, [socket, roomCode, acquireMedia, sendMediaState, teardown]);

  const declineCall = useCallback(() => {
    const call = incomingRef.current;
    if (socket && roomCode && call) {
      socket.emit('call:decline', { code: roomCode, callId: call.callId });
    }
    incomingRef.current = null;
    setIncoming(null);
    setStatus('idle');
  }, [socket, roomCode]);

  const endCall = useCallback(() => {
    const callId = callIdRef.current;
    if (socket && roomCode && callId) {
      socket.emit('call:hangup', { code: roomCode, callId });
    }
    teardown();
    setStatus('ended');
  }, [socket, roomCode, teardown]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    const track = stream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    micRef.current = track.enabled;
    setMicEnabled(track.enabled);
    sendMediaState();
  }, [sendMediaState]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    cameraRef.current = track.enabled;
    setCameraEnabled(track.enabled);
    sendMediaState();
  }, [sendMediaState]);

  /** The panel reports that the browser blocked the automatic audio playback. */
  const reportRemoteAudioBlocked = useCallback((blocked: boolean) => {
    setRemoteAudioBlocked(blocked);
  }, []);

  /** Clears the finished state so the panel can be closed. */
  const dismiss = useCallback(() => {
    if (callIdRef.current) return; // an active call must be ended first
    setError(null);
    setStatus('idle');
  }, []);

  // Leaving the room ends the call: the other side is told, the camera and
  // the microphone are released. The teardown runs in a task, so the state
  // update does not happen while the effect itself is running.
  const activeRoomRef = useRef<string | null>(roomCode);
  useEffect(() => {
    if (activeRoomRef.current === roomCode) return;
    const previous = activeRoomRef.current;
    activeRoomRef.current = roomCode;
    if (!previous) return;
    const timer = window.setTimeout(() => {
      const callId = callIdRef.current;
      if (socket && callId) {
        socket.emit('call:hangup', { code: previous, callId });
      }
      teardown();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [roomCode, teardown, socket]);

  // The camera and the microphone are released when the panel goes away.
  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  return {
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
    audioOnly,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMic,
    toggleCamera,
    reportRemoteAudioBlocked,
    dismiss,
  };
}

export type VideoCall = ReturnType<typeof useVideoCall>;
