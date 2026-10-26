import { X } from 'lucide-react';
import type { ToastTone } from '../../types/music';

type ToastProps = {
  id: string;
  message: string;
  tone?: ToastTone;
  onDismiss: () => void;
};

export default function Toast({ message, tone = 'info', onDismiss }: ToastProps) {
  return (
    <div className={`toast toast-${tone}`} role="status" aria-live="polite">
      <span className="toast-message">{message}</span>
      <button className="btn icon toast-dismiss" onClick={onDismiss} title="Dismiss" aria-label="Dismiss">
        <X size={18} />
      </button>
    </div>
  );
}
