const assert = require('assert');

function makeApiUrl(env) {
  const SOCKET_URL = env.VITE_SOCKET_URL || 'http://localhost:4000';
  return String(env.VITE_API_URL || SOCKET_URL).replace(/\/+$/, '');
}
function tokenUrl(env, roomCode, channel, uid, socketId) {
  const base = makeApiUrl(env);
  return `${base}/api/agora/token?code=${encodeURIComponent(roomCode)}&channel=${encodeURIComponent(channel)}&uid=${encodeURIComponent(uid)}&socketId=${encodeURIComponent(socketId)}`;
}

const env = { VITE_API_URL: 'https://syncsound-iu6l.onrender.com', VITE_SOCKET_URL: 'http://localhost:4000' };
const url = tokenUrl(env, 'SS-ABC', 'SS-ABC', 'client-1', 'sock-1');
assert.strictEqual(url, 'https://syncsound-iu6l.onrender.com/api/agora/token?code=SS-ABC&channel=SS-ABC&uid=client-1&socketId=sock-1');
assert.ok(url.startsWith('https://syncsound-iu6l.onrender.com/api/agora/token'));
assert.strictEqual((url.match(/\/api\/agora\/token/g) || []).length, 1);
assert.ok(!url.includes('//api'));
console.log('PASS agora token url');
process.exit(0);
EOF