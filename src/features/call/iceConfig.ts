/**
 * ICE server configuration.
 *
 * The list is read from the environment at runtime, never hard coded, so a
 * deployment can point the client at its own STUN and TURN servers.
 *
 * Environment variables (Vite exposes everything prefixed with VITE_):
 *   VITE_ICE_SERVERS  JSON array of { urls, username?, credential? }.
 *   VITE_TURN_URL     A single TURN server, used when VITE_ICE_SERVERS does
 *                     not contain one.
 *   VITE_TURN_USERNAME
 *   VITE_TURN_CREDENTIAL
 *
 * Development falls back to public STUN servers. Those are enough for a call
 * inside a normal network, but a TURN server is required for reliable calls
 * across restrictive networks (symmetric NAT, some corporate firewalls).
 *
 * TURN credentials are visible to the browser by design - the client has to
 * authenticate against the TURN server. Use short lived, time limited
 * credentials and keep them out of source control: put them into the
 * environment of the deployment, never into the repository.
 */
export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

/** Public STUN servers, only used when nothing else is configured. */
const DEFAULT_ICE_SERVERS: IceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

function readUrls(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string' && entry.length > 0);
  return [];
}

/**
 * The ICE servers for this deployment. An invalid or missing configuration
 * falls back to the public STUN servers instead of failing the call.
 */
export function iceServers(): IceServer[] {
  const servers: IceServer[] = [];

  const raw = import.meta.env.VITE_ICE_SERVERS;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (!entry || typeof entry !== 'object') continue;
          const urls = readUrls((entry as { urls?: unknown }).urls);
          if (!urls.length) continue;
          const server: IceServer = { urls: urls.length === 1 ? urls[0] : urls };
          const username = (entry as { username?: unknown }).username;
          const credential = (entry as { credential?: unknown }).credential;
          if (typeof username === 'string' && username) server.username = username;
          if (typeof credential === 'string' && credential) server.credential = credential;
          servers.push(server);
        }
      }
    } catch {
      // A malformed value is ignored: the defaults below still work.
    }
  }

  const turnUrl = import.meta.env.VITE_TURN_URL;
  if (typeof turnUrl === 'string' && turnUrl && !servers.some((s) => JSON.stringify(s.urls).includes('turn:'))) {
    const server: IceServer = { urls: turnUrl };
    const username = import.meta.env.VITE_TURN_USERNAME;
    const credential = import.meta.env.VITE_TURN_CREDENTIAL;
    if (typeof username === 'string' && username) server.username = username;
    if (typeof credential === 'string' && credential) server.credential = credential;
    servers.push(server);
  }

  return servers.length ? servers : DEFAULT_ICE_SERVERS;
}

/** True when the deployment has a TURN server configured. */
export function hasTurnServer(): boolean {
  return iceServers().some((server) => JSON.stringify(server.urls).includes('turn:'));
}
