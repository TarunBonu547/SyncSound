import { StickyNote, Palette, Type, Shapes, Sticker, Image, ListChecks, MoreHorizontal } from 'lucide-react';

export type CreativeTool =
  | 'sticky-note'
  | 'draw'
  | 'text'
  | 'shapes'
  | 'stickers'
  | 'images'
  | 'checklist'
  | 'more';

type CreativeToolbarProps = {
  activeTool: CreativeTool | null;
  onToolChange: (tool: CreativeTool) => void;
};

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

/**
 * Compact icon-based toolbar for the Creative Space.
 *
 * Each tool opens its corresponding functionality. The panel stays narrow
 * so it never competes with the video player for horizontal space.
 */
export default function CreativeToolbar({ activeTool, onToolChange }: CreativeToolbarProps) {
  return (
    <div className="creative-toolbar" role="toolbar" aria-label="Creative Space tools">
      <div className="creative-toolbar-inner">
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`creative-tool-btn ${activeTool === tool.id ? 'is-active' : ''}`}
            onClick={() => onToolChange(tool.id)}
            title={tool.label}
            aria-label={tool.label}
            aria-pressed={activeTool === tool.id}
          >
            <span className="creative-tool-icon" aria-hidden="true">
              {tool.icon}
            </span>
            <span className="creative-tool-label">{tool.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}