type StatusIndicatorProps = {
  /** True when the socket is connected. */
  connected: boolean;
  /** The text next to the dot. */
  label: string;
  /** A live room is more than just "connected". */
  live?: boolean;
  /** A short description for the screen readers. */
  title?: string;
};

/**
 * The connection status of the client.
 *
 * The dot carries the state, the text carries the meaning. A room that is
 * really live gets the mint colour and a soft ring.
 */
export default function StatusIndicator({ connected, label, live = false, title }: StatusIndicatorProps) {
  const state = !connected ? 'is-offline' : live ? 'is-live' : 'is-online';
  return (
    <span className="status-pill" title={title ?? label}>
      <span className={`status-dot ${state}`} aria-hidden="true" />
      {label}
    </span>
  );
}
