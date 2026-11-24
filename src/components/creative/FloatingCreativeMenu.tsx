import { useCallback, useEffect, useRef, useState } from 'react';
import { StickyNote, Palette, Type, Shapes, Sticker, Image, ListChecks, MoreHorizontal, Pencil, X } from 'lucide-react';
import type { CreativeTool } from './CreativeToolbar';

const tools: { id: CreativeTool; icon: React.ReactNode; label: string }[] = [
  { id: 'sticky-note', icon: <StickyNote size={18} />, label: 'Sticky Note' },
  { id: 'draw', icon: <Palette size={18} />, label: 'Draw' },
  { id: 'text', icon: <Type size={18} />, label: 'Text' },
  { id: 'shapes', icon: <Shapes size={18} />, label: 'Shapes' },
  { id: 'stickers', icon: <Sticker size={18} />, label: 'Stickers' },
  { id: 'images', icon: <Image size={18} />, label: 'Images' },
  { id: 'checklist', icon: <ListChecks size={18} />, label: 'Checklist' },
  { id: 'more', icon: <MoreHorizontal size={18} />, label: 'More' },
];

type FloatingCreativeMenuProps = {
  activeTool: CreativeTool | null;
  onToolChange: (tool: CreativeTool) => void;
};

/**
 * Floating creation menu triggered by a circular pencil button.
 *
 * Closed state: only the pencil button is visible (bottom-right).
 * Open state: a premium floating panel appears above the button with all
 * creation tools arranged in a grid. Clicking outside, pressing Escape,
 * or selecting a tool closes the menu.
 */
export default function FloatingCreativeMenu({ activeTool, onToolChange }: FloatingCreativeMenuProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (buttonRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, close]);

  const toggle = () => setOpen((prev) => !prev);

  const selectTool = (tool: CreativeTool) => {
    onToolChange(tool);
    close();
  };

  return (
    <div className="floating-creative" style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 60 }}>
      {/* Floating pencil button */}
      <button
        ref={buttonRef}
        className={`floating-creative-btn ${open ? 'is-open' : ''}`}
        onClick={toggle}
        aria-label={open ? 'Close creation tools' : 'Open creation tools'}
        aria-expanded={open}
        title={open ? 'Close creation tools' : 'Creation tools'}
      >
        {open ? <X size={20} aria-hidden="true" /> : <Pencil size={20} aria-hidden="true" />}
      </button>

      {/* Popup panel */}
      {open && (
        <div
          ref={panelRef}
          className="floating-creative-panel"
          role="menu"
          aria-label="Creation tools"
        >
          <div className="floating-creative-grid">
            {tools.map((tool) => (
              <button
                key={tool.id}
                className={`floating-creative-tool ${activeTool === tool.id ? 'is-active' : ''}`}
                onClick={() => selectTool(tool.id)}
                role="menuitem"
                aria-label={tool.label}
                aria-pressed={activeTool === tool.id}
              >
                <span className="floating-creative-tool-icon" aria-hidden="true">
                  {tool.icon}
                </span>
                <span className="floating-creative-tool-label">{tool.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
