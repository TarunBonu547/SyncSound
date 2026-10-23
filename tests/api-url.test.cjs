const assert = require('assert');

function makeApiUrl(env) {
  const SOCKET_URL = env.VITE_SOCKET_URL || 'http://localhost:4000';
  return String(env.VITE_API_URL || SOCKET_URL).replace(/\/+$/, '');
}
function tokenUrl(env, roomCode, channel, uid, socketId) {
  const base = makeApiUrl(env);
  return `${base}/api/agora/token?code=${encodeURIComponent(roomCode)}&channel=${encodeURIComponent(channel)}&uid=${encodeURIComponent(uid)}&socketId=${encodeURIComponent(socketId)}`;
}

const env = { VITE_API_URL: 'https://backend.onrender.com/' };
const url = tokenUrl(env, 'SS-ABC', 'SS-ABC', 'client-1', 'sock-1');
assert.ok(url.startsWith('https://backend.onrender.com/api/agora/token'));
assert.ok(!url.includes('//api'));
console.log('PASS api url');
process.exit(0);
EOF