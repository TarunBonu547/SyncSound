import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { syncDebug } from '../utils/syncDebug';

const URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

/**
 * One socket per browser tab, shared by every component.
 *
 * Previously each component (App, CreateRoom, JoinRoom) opened its own
 * connection, which made the server count one human as several participants
 * and made the room that was created differ from the room that was joined.
 */
let sharedSocket: Socket | null = null;

function getSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io(URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
    });
    sharedSocket.on('connect', () => syncDebug('socket connected', { id: sharedSocket?.id }));
    sharedSocket.on('disconnect', (reason) => syncDebug('socket disconnected', { reason }));
    sharedSocket.on('connect_error', (err) => syncDebug('socket connect_error', { message: err.message }));
    sharedSocket.on('reconnect', (attempt) => syncDebug('socket reconnect', { attempt }));
  }
  return sharedSocket;
}

export function useSocket() {
  const [socket] = useState<Socket>(() => getSocket());
  const [connected, setConnected] = useState(() => socket.connected);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    // The browser knows about a lost network before the socket heartbeat
    // does, so the room shows the reconnecting state right away.
    const onOffline = () => {
      syncDebug('browser went offline');
      setConnected(false);
    };
    const onOnline = () => {
      syncDebug('browser came online');
      setConnected(socket.connected);
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [socket]);

  return { socket, connected };
}
