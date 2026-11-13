import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Pencil, Eraser, Undo2, Trash2, X, Minus, Plus } from 'lucide-react';
import './DrawingOverlay.css';

type Tool = 'pencil' | 'eraser';

type Point = { x: number; y: number };

type Stroke = {
  tool: Tool;
  color: string;
  size: number;
  points: Point[];
};

const DEFAULT_COLOR = '#2f6f86';
const MIN_SIZE = 2;
const MAX_SIZE = 24;
const COLORS = ['#2f6f86', '#2a2340', '#d97a9e', '#b76e79', '#7a8f6a', '#c98a5b', '#ffffff'];

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const { points } = stroke;
  if (points.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.size;
  ctx.strokeStyle = stroke.color;
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.beginPath();
  if (points.length === 1) {
    ctx.fillStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color;
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

export default function DrawingOverlay() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState(false);
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [size, setSize] = useState(4);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<{ stroke: Stroke; pointerId: number } | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
    if (drawingRef.current) drawStroke(ctx, drawingRef.current.stroke);
  }, []);

  useEffect(() => {
    redraw();
  }, [strokes, redraw]);

  useEffect(() => {
    const onResize = () => redraw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [redraw]);

  const getPoint = (e: ReactPointerEvent<HTMLCanvasElement>): Point => ({
    x: e.clientX,
    y: e.clientY,
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!active) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const stroke: Stroke = {
      tool,
      color: tool === 'eraser' ? '#000000' : color,
      size,
      points: [getPoint(e)],
    };
    drawingRef.current = { stroke, pointerId: e.pointerId };
    redraw();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = drawingRef.current;
    if (!current || current.pointerId !== e.pointerId) return;
    e.preventDefault();
    const native = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [native];
    for (const ev of events) {
      current.stroke.points.push({ x: ev.clientX, y: ev.clientY });
    }
    redraw();
  };

  const finishStroke = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = drawingRef.current;
    if (!current || current.pointerId !== e.pointerId) return;
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    const completed = current.stroke;
    drawingRef.current = null;
    if (completed.points.length > 0) {
      setStrokes((prev) => [...prev, completed]);
    } else {
      forceTick((t) => t + 1);
    }
  };

  const undo = () => setStrokes((prev) => prev.slice(0, -1));
  const clearAll = () => {
    drawingRef.current = null;
    setStrokes([]);
  };

  const hasDrawings = strokes.length > 0;

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`drawing-canvas ${active ? 'is-active' : ''} ${hasDrawings || active ? 'is-visible' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        aria-hidden="true"
      />

      <div className={`drawing-ui ${active ? 'is-open' : ''}`}>
        {active && (
          <div className="drawing-toolbar" role="toolbar" aria-label="Drawing tools">
            <div className="drawing-tools">
              <button
                type="button"
                className={`drawing-tool-btn ${tool === 'pencil' ? 'is-selected' : ''}`}
                onClick={() => setTool('pencil')}
                title="Pencil"
                aria-label="Pencil"
                aria-pressed={tool === 'pencil'}
              >
                <Pencil size={18} />
              </button>
              <button
                type="button"
                className={`drawing-tool-btn ${tool === 'eraser' ? 'is-selected' : ''}`}
                onClick={() => setTool('eraser')}
                title="Eraser"
                aria-label="Eraser"
                aria-pressed={tool === 'eraser'}
              >
                <Eraser size={18} />
              </button>
              <button type="button" className="drawing-tool-btn" onClick={undo} title="Undo" aria-label="Undo" disabled={strokes.length === 0}>
                <Undo2 size={18} />
              </button>
              <button type="button" className="drawing-tool-btn danger" onClick={clearAll} title="Clear all" aria-label="Clear all" disabled={strokes.length === 0}>
                <Trash2 size={18} />
              </button>
              <button type="button" className="drawing-tool-btn" onClick={() => setActive(false)} title="Close drawing mode" aria-label="Close drawing mode">
                <X size={18} />
              </button>
            </div>

            <div className="drawing-row">
              <span className="drawing-label">Size</span>
              <button type="button" className="drawing-mini-btn" onClick={() => setSize((s) => Math.max(MIN_SIZE, s - 1))} aria-label="Decrease brush size">
                <Minus size={14} />
              </button>
              <input
                type="range"
                min={MIN_SIZE}
                max={MAX_SIZE}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="drawing-range"
                aria-label="Brush size"
              />
              <button type="button" className="drawing-mini-btn" onClick={() => setSize((s) => Math.min(MAX_SIZE, s + 1))} aria-label="Increase brush size">
                <Plus size={14} />
              </button>
            </div>

            <div className="drawing-row drawing-colors">
              <span className="drawing-label">Color</span>
              <div className="drawing-swatches">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`drawing-swatch ${color === c && tool !== 'eraser' ? 'is-selected' : ''}`}
                    style={{ background: c }}
                    onClick={() => { setColor(c); setTool('pencil'); }}
                    aria-label={`Color ${c}`}
                  />
                ))}
                <label className="drawing-color-picker" title="Custom color">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => { setColor(e.target.value); setTool('pencil'); }}
                    aria-label="Choose custom color"
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          className={`drawing-fab ${active ? 'is-active' : ''}`}
          onClick={() => setActive((a) => !a)}
          title={active ? 'Close drawing mode' : 'Open drawing mode'}
          aria-label={active ? 'Close drawing mode' : 'Open drawing mode'}
          aria-pressed={active}
        >
          <Pencil size={20} />
        </button>
      </div>
    </>
  );
}
