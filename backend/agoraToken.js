const { RtcTokenBuilder, RtcRole } = require('agora-token');

const APP_ID_RE = /^[a-f0-9]{32}$/i;
const CHANNEL_RE = /^[A-Za-z0-9_-]{2,64}$/;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN_TTL_SECONDS = 3600;

function issueRtcToken({ appId, appCertificate, channelName, uid }) {
  if (!appId || !appCertificate) return null;
  const expire = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return RtcTokenBuilder.buildTokenWithUserAccount(
    appId,
    appCertificate,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    expire,
    expire
  );
}

module.exports = { issueRtcToken, APP_ID_RE, CHANNEL_RE, UID_RE, TOKEN_TTL_SECONDS };
