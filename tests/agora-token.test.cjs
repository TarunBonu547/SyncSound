const { issueRtcToken, CHANNEL_RE, UID_RE } = require('../backend/agoraToken.js');

let failures = 0;
function check(name, cond, extra) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ''}`);
}

const APP_ID = 'a'.repeat(32);
const APP_CERT = 'b'.repeat(32);

// Missing config
check('no appId returns null', issueRtcToken({ appId: '', appCertificate: APP_CERT, channelName: 'ROOM', uid: 'u1' }) === null);
check('no cert returns null', issueRtcToken({ appId: APP_ID, appCertificate: '', channelName: 'ROOM', uid: 'u1' }) === null);

// Valid token
const tok = issueRtcToken({ appId: APP_ID, appCertificate: APP_CERT, channelName: 'SS-ABC', uid: 'client-1' });
check('valid request returns token string', typeof tok === 'string' && tok.length > 0);
check('token does not contain cert', !tok.includes(APP_CERT));
check('uid pattern ok', UID_RE.test('client-1'));
check('channel pattern ok', CHANNEL_RE.test('SS-ABC'));

// Expiration/role not directly inspectable; ensure token string stable prefix '006' (agora token v2)
check('token has agora prefix', typeof tok === 'string' && tok.startsWith('007'));

// Invalid patterns
check('invalid channel rejected by regex', !CHANNEL_RE.test('bad channel'));
check('invalid uid rejected by regex', !UID_RE.test(''));

console.log(failures === 0 ? '\nALL AGORA TOKEN CHECKS PASSED' : `\n${failures} AGORA TOKEN CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
EOF