import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef } from 'react';
import EmojiPicker from 'emoji-picker-react';
import type { EmojiClickData } from 'emoji-picker-react';
import { X } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery';

type ChatEmojiPickerProps = {
  /** Ref to the smiley trigger button, used to anchor the floating picker. */
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  /** Whether the picker is currently open. */
  open: boolean;
  /** Called when the user selects an emoji, with the native emoji string. */
  onSelect: (emoji: string) => void;
  /** Called when the picker should close (escape / outside click / close button). */
  onClose: () => void;
  /** Last committed picker position, retained across open/close while chat stays open. */
  position: { x: number; y: number } | null;
  /** Reports the committed position while the user drags or anchors the picker. */
  onPositionChange: (position: { x: number; y: number }) => void;
};

const PANEL_WIDTH = 320;

/** Clamp a value between min and max. */
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

/**
 * SyncSound-themed emoji picker.
 *
 * Renders emoji-picker-react (a maintained, full Unicode emoji library with
 * search, category navigation, skin-tone and recently-used support) as a
 * portaled, position:fixed floating window above the chat. The window is
 * draggable through its header, keeps its last position while the chat stays
 * open, and never leaves the viewport. Clicking outside or pressing Escape
 * closes it.
 */
export default function ChatEmojiPicker({
  anchorRef,
  open,
  onSelect,
  onClose,
  position,
  onPositionChange,
}: ChatEmojiPickerProps) {
  const isMobile = useMediaQuery('(max-width: 720px)');
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  /** Pointer data captured when a drag starts. */
  const dragRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);

  /** Tracks whether the picker has been anchored for the current open session. */
  const anchoredRef = useRef(false);

  // --------------------------------------------------------------------------
  // Positioning
  // --------------------------------------------------------------------------

  /** First open: anchor near the smiley button, clamped into the viewport. */
  useEffect(() => {
    if (!open) {
      anchoredRef.current = false;
      return;
    }
    if (anchoredRef.current) return;
    const panel = containerRef.current;
    const panelHeight = panel ? panel.offsetHeight : PANEL_WIDTH * 1.4;
    let x = 0;
    let y = clamp(window.innerHeight - panelHeight, 0, window.innerHeight - panelHeight);

    if (!isMobile) {
      const button = anchorRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      x = clamp(rect.left + rect.width / 2 - PANEL_WIDTH / 2, 0, window.innerWidth - PANEL_WIDTH);
      y = clamp(rect.top - panelHeight - 12, 0, window.innerHeight - panelHeight);
    }

    onPositionChange({ x, y });
    anchoredRef.current = true;
  }, [open, onPositionChange, anchorRef, isMobile]);

  /** Keep the picker inside the viewport when the window is resized. */
  useEffect(() => {
    if (!open || isMobile || !position) return;
    const onResize = () => {
      const panel = containerRef.current;
      if (!panel) return;
      onPositionChange({
        x: clamp(position.x, 0, window.innerWidth - panel.offsetWidth),
        y: clamp(position.y, 0, window.innerHeight - panel.offsetHeight),
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, position, isMobile, onPositionChange]);

  // --------------------------------------------------------------------------
  // Dragging (header handle only; search/emoji/category/scroll are exempt)
  // --------------------------------------------------------------------------

  const onDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const header = headerRef.current;
      const target = e.target as Element | null;
      if (!header || !header.contains(target)) return;
      if (target && target.closest('[data-no-drag]')) return;
      e.preventDefault();
      const panel = containerRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      dragRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        x: rect.left,
        y: rect.top,
      };
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const panel = containerRef.current;
      if (!panel) return;
      const dx = e.clientX - dragRef.current.clientX;
      const dy = e.clientY - dragRef.current.clientY;
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;

      let nx = isMobile ? 0 : clamp(dragRef.current.x + dx, 0, window.innerWidth - pw);
      let ny = clamp(dragRef.current.y + dy, 0, window.innerHeight - ph);
      onPositionChange({ x: nx, y: ny });
    };
    const onEnd = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, [onPositionChange, isMobile]);

  // --------------------------------------------------------------------------
  // Close on outside click or Escape
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const handlePointerDown = (e: PointerEvent) => {
      const container = containerRef.current;
      const button = anchorRef.current;
      const target = e.target as Node | null;
      const insidePicker = container && container.contains(target);
      const insideButton = button && button.contains(target);
      if (!insidePicker && !insideButton) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [open, anchorRef, onClose]);

  const handleEmojiClick = useCallback(
    (emoji: EmojiClickData) => {
      onSelect(emoji.emoji);
    },
    [onSelect],
  );

  if (!open) return null;

  const panelStyle: React.CSSProperties = {};
  if (isMobile) {
    panelStyle.left = 0;
    panelStyle.right = 0;
    panelStyle.bottom = 'auto';
    panelStyle.top = position ? position.y : window.innerHeight - PANEL_WIDTH * 1.4;
    panelStyle.width = '100vw';
    panelStyle.maxWidth = '100vw';
  } else if (position) {
    panelStyle.top = position.y;
    panelStyle.left = position.x;
    panelStyle.width = PANEL_WIDTH;
  }

  const closeButton = (
    <button
      type="button"
      className="chat-emoji-close"
      data-no-drag
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      title="Close the emoji picker"
      aria-label="Close the emoji picker"
    >
      <X size={18} aria-hidden="true" />
    </button>
  );

  const panel = (
    <div
      ref={containerRef}
      className="chat-emoji-panel"
      style={panelStyle}
      onPointerDown={onDragStart}
    >
      <header ref={headerRef} className="chat-emoji-header" data-drag-handle>
        <span className="chat-emoji-handle" aria-hidden="true" />
        <span className="chat-emoji-header-title">Emoji picker</span>
        {closeButton}
      </header>
      <EmojiPicker
        colorScheme="light"
        theme="light"
        emojiStyle="native"
        onEmojiClick={handleEmojiClick}
        suggestedEmojisMode="recent"
        searchDisabled={false}
        skinTonesDisabled={false}
        previewConfig={{ showPreview: false, defaultEmoji: '😊', defaultCaption: '' }}
        className="chat-emoji-picker-core"
      />
    </div>
  );

  // Desktop: portal to body so the panel can float above the chat sidebar.
  if (!isMobile) {
    return createPortal(panel, document.body);
  }
  // Mobile: portal to body as a bottom sheet that respects screen boundaries.
  return createPortal(panel, document.body);
}
