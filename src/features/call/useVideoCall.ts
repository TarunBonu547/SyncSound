import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import AgoraRTC from 'agora-rtc-sdk-ng';
import type { IAgoraRTCClient, ICameraVideoTrack, IMicrophoneAudioTrack, IRemoteAudioTrack } from 'agora-rtc-sdk-ng';
import { API_URL } from '../../utils/youtubeSearch';

export type CallStatus =
  | 'idle' | 'requesting' | 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended' | 'failed';
export type CallErrorCode = 'permission' | 'device' | 'network' | 'busy' | 'timeout' | 'unknown';
export type CallError = { code: CallErrorCode; message: string };
export type IncomingCall = { callId: string; media: 'video' | 'audio' };

const RING_TIMEOUT_MS = 45_000;

type Role = 'caller' | 'callee' | null;

function describeMediaError(err: unknown): CallError {
  const name = (err as { name?: string })?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return { code: 'permission', message: 'Camera and microphone access was denied.' };
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return { code: 'device', message: 'No camera or microphone found.' };
  return { code: 'unknown', message: 'Camera and microphone could not be started.' };
}

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
  const [audioOnly, setAudioOnly] = useState(false);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const localAudioRef = useRef<IMicrophoneAudioTrack | null>(null);
  const localVideoRef = useRef<ICameraVideoTrack | null>(null);
  const callIdRef = useRef<string | null>(null);
  const roleRef = useRef<Role>(null);
  const incomingRef = useRef<IncomingCall | null>(null);
  const micRef = useRef(true);
  const cameraRef = useRef(true);
  const ringTimerRef = useRef<number | null>(null);
  const connectTimerRef = useRef<number | null>(null);
  const statusRef = useRef<CallStatus>(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const clearTimers = useCallback(() => {
    if (ringTimerRef.current !== null) window.clearTimeout(ringTimerRef.current);
    if (connectTimerRef.current !== null) window.clearTimeout(connectTimerRef.current);
    ringTimerRef.current = null;
    connectTimerRef.current = null;
  }, []);

  const teardown = useCallback(async () => {
    clearTimers();
    try { if (localAudioRef.current) { localAudioRef.current.stop(); localAudioRef.current.close(); } } catch {}
    try { if (localVideoRef.current) { localVideoRef.current.stop(); localVideoRef.current.close(); } } catch {}
    localAudioRef.current = null;
    localVideoRef.current = null;
    const client = clientRef.current;
    if (client) {
      try { await client.leave(); } catch {}
      try { client.removeAllListeners(); } catch {}
      clientRef.current = null;
    }
    callIdRef.current = null;
    roleRef.current = null;
    incomingRef.current = null;
    setIncoming(null);
    setLocalStream(null);
    setRemoteStream(null);
    setRemoteAudioBlocked(false);
    micRef.current = true;
    cameraRef.current = true;
    setMicEnabled(true);
    setCameraEnabled(true);
    setRemoteMicEnabled(true);
    setRemoteCameraEnabled(true);
    setAudioOnly(false);
    setStatus('idle');
  }, [clearTimers]);

  const acquireMedia = useCallback(async (wantVideo: boolean) => {
    try {
      const audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      let videoTrack: ICameraVideoTrack | null = null;
      let audioOnly = false;
      if (wantVideo) {
        try { videoTrack = await AgoraRTC.createCameraVideoTrack(); } catch { audioOnly = true; }
      }
      localAudioRef.current = audioTrack;
      localVideoRef.current = videoTrack;
      const stream = new MediaStream();
      // expose via tracks not MediaStream; UI uses localStream for preview? Keep null-ish but set a dummy
      setLocalStream(stream);
      return { ok: true, audioOnly, error: null as CallError | null };
    } catch (err) {
      return { ok: false, audioOnly: false, error: describeMediaError(err) };
    }
  }, []);

  const fetchToken = useCallback(async (channel: string, uid: string) => {
    const socketId = socket?.id || '';
    const url = `${API_URL}/api/agora/token?code=${encodeURIComponent(roomCode || '')}&channel=${encodeURIComponent(channel)}&uid=${encodeURIComponent(uid)}&socketId=${encodeURIComponent(socketId)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error(data?.error || 'token failed');
    return data;
  }, [socket, roomCode]);

  const joinAgora = useCallback(async (channel: string, uid: string) => {
    const appId = import.meta.env.VITE_AGORA_APP_ID as string;
    const { token } = await fetchToken(channel, uid);
    const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    clientRef.current = client;
    client.on('user-published', async (user, mediaType) => {
      await client.subscribe(user, mediaType);
      if (mediaType === 'video') {
const stream = new MediaStream();
setRemoteStream(stream);
      }
      if (mediaType === 'audio') {
        (user.audioTrack as IRemoteAudioTrack)?.play();
      }
      setStatus('connected');
    });
    client.on('user-unpublished', () => {});
    client.on('user-left', () => {
      setRemoteStream(null);
    });
    await client.join(appId, channel, token, uid as string);
    const tracks: (IMicrophoneAudioTrack | ICameraVideoTrack)[] = [];
    if (localAudioRef.current) tracks.push(localAudioRef.current);
    if (localVideoRef.current) tracks.push(localVideoRef.current);
    if (tracks.length) await client.publish(tracks);
  }, [fetchToken]);

  const startCall = useCallback(async () => {
    if (!socket || !roomCode) return;
    setError(null);
    setStatus('requesting');
    const { ok, audioOnly: noVideo, error: mediaError } = await acquireMedia(true);
    if (!ok) { setError(mediaError); setStatus('failed'); return; }
    setAudioOnly(noVideo);
    if (mediaError) setError(mediaError);
    setStatus('calling');
    socket.emit('call:invite', { code: roomCode, media: noVideo ? 'audio' : 'video' }, async (res: { ok?: boolean; callId?: string; error?: string }) => {
      if (!res?.ok) { await teardown(); setError({ code: 'busy', message: res?.error || 'could not start' }); setStatus('failed'); return; }
      callIdRef.current = res.callId || null;
      roleRef.current = 'caller';
      try { await joinAgora(roomCode as string, socket.id as string); } catch { await teardown(); setError({ code: 'network', message: 'join failed' }); setStatus('failed'); return; }
      ringTimerRef.current = window.setTimeout(async () => {
        if (statusRef.current === 'connected' || statusRef.current === 'connecting') return;
        await teardown(); setError({ code: 'timeout', message: 'Nobody answered.' }); setStatus('failed');
      }, RING_TIMEOUT_MS);
    });
  }, [socket, roomCode, acquireMedia, teardown, joinAgora]);

  const acceptCall = useCallback(async () => {
    const call = incomingRef.current;
    if (!socket || !roomCode || !call) return;
    setStatus('requesting');
    const { ok, audioOnly: noVideo, error: mediaError } = await acquireMedia(call.media !== 'audio');
    if (!ok) { setError(mediaError); setStatus('failed'); incomingRef.current = null; setIncoming(null); socket.emit('call:decline', { code: roomCode, callId: call.callId }); return; }
    setAudioOnly(noVideo);
    if (mediaError) setError(mediaError);
    callIdRef.current = call.callId;
    roleRef.current = 'callee';
    incomingRef.current = null;
    setIncoming(null);
    setStatus('connecting');
    socket.emit('call:accept', { code: roomCode, callId: call.callId }, async (res: { ok?: boolean; error?: string }) => {
      if (!res?.ok) { await teardown(); setError({ code: 'busy', message: res?.error || 'could not accept' }); setStatus('failed'); return; }
      try { await joinAgora(roomCode as string, socket.id as string); } catch { await teardown(); setError({ code: 'network', message: 'join failed' }); setStatus('failed'); }
    });
  }, [socket, roomCode, acquireMedia, teardown, joinAgora]);

  const declineCall = useCallback(() => {
    const call = incomingRef.current;
    if (socket && roomCode && call) socket.emit('call:decline', { code: roomCode, callId: call.callId });
    incomingRef.current = null;
    setIncoming(null);
    setStatus('idle');
  }, [socket, roomCode]);

  const endCall = useCallback(() => {
    const callId = callIdRef.current;
    if (socket && roomCode && callId) socket.emit('call:hangup', { code: roomCode, callId });
    teardown();
    setStatus('ended');
  }, [socket, roomCode, teardown]);

  const toggleMic = useCallback(() => {
    const t = localAudioRef.current;
    if (!t) return;
    t.setEnabled(!micRef.current);
    micRef.current = !micRef.current;
    setMicEnabled(micRef.current);
    if (socket && roomCode && callIdRef.current) socket.emit('call:media', { code: roomCode, callId: callIdRef.current, mic: micRef.current, camera: cameraRef.current });
  }, [socket, roomCode]);

  const toggleCamera = useCallback(() => {
    const t = localVideoRef.current;
    if (!t) return;
    t.setEnabled(!cameraRef.current);
    cameraRef.current = !cameraRef.current;
    setCameraEnabled(cameraRef.current);
    if (socket && roomCode && callIdRef.current) socket.emit('call:media', { code: roomCode, callId: callIdRef.current, mic: micRef.current, camera: cameraRef.current });
  }, [socket, roomCode]);

  const reportRemoteAudioBlocked = useCallback((b: boolean) => setRemoteAudioBlocked(b), []);
  const dismiss = useCallback(() => { if (callIdRef.current) return; setError(null); setStatus('idle'); }, []);

  // signaling listeners
  useEffect(() => {
    if (!socket || !roomCode) return;
    const onIncoming = (p: { callId?: string; media?: 'video' | 'audio' }) => {
      if (!p?.callId) return;
      const c: IncomingCall = { callId: p.callId, media: p.media === 'audio' ? 'audio' : 'video' };
      incomingRef.current = c;
      setIncoming(c);
      setError(null);
      setStatus('ringing');
    };
    const onAccepted = (p: { callId?: string }) => {
      if (p?.callId && callIdRef.current === p.callId) setStatus('connecting');
    };
    const onDeclined = (p: { callId?: string }) => {
      if (p?.callId && callIdRef.current === p.callId) { teardown(); setError({ code: 'busy', message: 'declined' }); setStatus('ended'); }
    };
    const onEnded = (p: { callId?: string; reason?: string }) => {
      if (p?.callId && callIdRef.current && p.callId !== callIdRef.current) return;
      teardown();
      if (p?.reason === 'timeout') { setError({ code: 'timeout', message: 'Nobody answered.' }); setStatus('failed'); } else setStatus('ended');
    };
    const onMedia = (p: { callId?: string; mic?: boolean; camera?: boolean }) => {
      if (p?.callId && callIdRef.current !== p.callId) return;
      setRemoteMicEnabled(p?.mic !== false);
      setRemoteCameraEnabled(p?.camera !== false);
    };
    socket.on('call:incoming', onIncoming);
    socket.on('call:accepted', onAccepted);
    socket.on('call:declined', onDeclined);
    socket.on('call:ended', onEnded);
    socket.on('call:media', onMedia);
    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:accepted', onAccepted);
      socket.off('call:declined', onDeclined);
      socket.off('call:ended', onEnded);
      socket.off('call:media', onMedia);
    };
  }, [socket, roomCode, teardown]);

  useEffect(() => { return () => { teardown(); }; }, [teardown]);

  return {
    status, error, incoming, localStream, remoteStream, micEnabled, cameraEnabled,
    remoteMicEnabled, remoteCameraEnabled, remoteAudioBlocked, audioOnly,
    startCall, acceptCall, declineCall, endCall, toggleMic, toggleCamera,
    reportRemoteAudioBlocked, dismiss,
  };
}

export type VideoCall = ReturnType<typeof useVideoCall>;
