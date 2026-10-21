import { MAX_DISPLAY_NAME } from '../../utils/displayName';

type DisplayNameFieldProps = {
  /** The id of the input, so the label can point at it. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** The reason the name is not accepted, if there is one. */
  error?: string | null;
  /** True while the name is used to enter a room. */
  autoFocus?: boolean;
};

/**
 * The name a person is seen under.
 *
 * The name is text of the user: it is never used to identify anybody and it
 * is only ever shown as text. The field is shared by the two ways into a
 * room, so both of them ask for a name in the same way.
 */
export default function DisplayNameField({
  id,
  value,
  onChange,
  error,
  autoFocus,
}: DisplayNameFieldProps) {
  const length = value.trim().length;

  return (
    <div className="name-field">
      <label className="field-label" htmlFor={id}>
        Your name
      </label>
      <input
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Alex"
        maxLength={MAX_DISPLAY_NAME}
        autoComplete="nickname"
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <div className="name-field-foot">
        <span className="hint">The other listeners will see this name.</span>
        <span className="name-counter" aria-hidden="true">
          {length}/{MAX_DISPLAY_NAME}
        </span>
      </div>
      {error && (
        <p className="error-text" id={`${id}-error`} role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
