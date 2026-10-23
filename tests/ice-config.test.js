/**
 * ICE configuration test: the servers the browser uses for a call.
 *
 * Run with: node tests/ice-config.test.js
 */
import { iceServers, hasTurnServer } from '../src/features/call/iceConfig.ts';

let failures = 0;
function check(name, cond, extra) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
}

// No configuration: the public STUN servers are used.
const none = iceServers({});
check('no configuration falls back to STUN', none.length === 1 && Array.isArray(none[0].urls), none);
check('the default is a STUN server', JSON.stringify(none[0].urls).includes('stun:'), none);

// A full JSON list is parsed, including TURN with credentials.
const full = iceServers({
  VITE_ICE_SERVERS: JSON.stringify([
    { urls: 'stun:stun.example.com:3478' },
    { urls: ['turn:turn.example.com:3478', 'turns:turn.example.com:5349'], username: 'user', credential: 'secret' },
  ]),
});
check('a full list keeps every server', full.length === 2, full);
check('the TURN server keeps its credentials', full[1].username === 'user' && full[1].credential === 'secret', full[1]);
check('a TURN url array is kept as an array', Array.isArray(full[1].urls), full[1].urls);

// A single TURN server via the alternative variables.
const alt = iceServers({
  VITE_TURN_URL: 'turn:turn.example.com:3478',
  VITE_TURN_USERNAME: 'alice',
  VITE_TURN_CREDENTIAL: 'wonderland',
});
check('a single TURN server is added', alt.length === 1 && JSON.stringify(alt[0].urls).includes('turn:'), alt);
check('its username is kept', alt[0].username === 'alice', alt[0]);
check('its credential is kept', alt[0].credential === 'wonderland', alt[0]);

// A malformed JSON value is ignored and the defaults are used.
const bad = iceServers({ VITE_ICE_SERVERS: '{not json' });
check('a malformed value falls back to STUN', bad.length === 1 && JSON.stringify(bad[0].urls).includes('stun:'), bad);

// An empty list falls back to STUN.
const empty = iceServers({ VITE_ICE_SERVERS: '[]' });
check('an empty list falls back to STUN', empty.length === 1 && JSON.stringify(empty[0].urls).includes('stun:'), empty);

// A TURN server added via the list is not duplicated by the alternative.
const dup = iceServers({
  VITE_ICE_SERVERS: JSON.stringify([{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' }]),
  VITE_TURN_URL: 'turn:turn.example.com:3478',
  VITE_TURN_USERNAME: 'other',
  VITE_TURN_CREDENTIAL: 'other',
});
check('a TURN server is not duplicated', dup.length === 1, dup);

// hasTurnServer reports correctly.
check('hasTurnServer is true with a TURN server', hasTurnServer({ VITE_ICE_SERVERS: JSON.stringify([{ urls: 'turn:turn.example.com:3478' }]) }) === true);
check('hasTurnServer is false without one', hasTurnServer({}) === false);

// Credentials are never logged by iceServers (it only returns them).
const logged = JSON.stringify(iceServers({ VITE_ICE_SERVERS: JSON.stringify([{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'c' }]) }));
check('credentials are returned for the browser to use', logged.includes('"credential":"c"'), 'returned');

console.log(failures === 0 ? '\nALL ICE CONFIG CHECKS PASSED' : `\n${failures} ICE CONFIG CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
