import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Socket } from 'socket.io-client';
import { Pencil, Eraser, Undo2, Trash2, X, Minus, Plus } from 'lucide-react';
import './DrawingOverlay.css';

type Tool = 'pencil' | 'eraser';

type Point = { x: number; y: number };

type Stroke = {
  id: string;
  tool: Tool;
  color: string;
  /** Width normalized to viewport width. */
  size: number;
  /** Points normalized to viewport (0..1). */
  points: Point[];
  clientId: string;
  clientName: string;
  local?: boolean;
};

const DEFAULT_COLOR = '#2f6f86';
const MIN_SIZE = 2;
const MAX_SIZE = 24;
const COLORS = ['#2f6f86', '#2a2340', '#d97a9e', '#b76e79', '#7a8f6a', '#c98a5b', '#ffffff'];

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function denorm(p: Point, w: number, h: number) {
  return { x: p.x * w, y: p.y * h };
}

function norm(p: Point, w: number, h: number) {
  return { x: w ? p.x / w : 0, y: h ? p.y / h : 0 };
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, w: number, h: number) {
  const { points } = stroke;
  if (points.length === 0) return;
  const lineW = Math.max(1, stroke.size * w);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineW;
  ctx.strokeStyle = stroke.color;
  ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.beginPath();
  if (points.length === 1) {
    const p = denorm(points[0], w, h);
    ctx.fillStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color;
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.arc(p.x, p.y, lineW / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const p0 = denorm(points[0], w, h);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < points.length - 1; i++) {
    const p = denorm(points[i], w, h);
    const n = denorm(points[i + 1], w, h);
    ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
  }
  const last = denorm(points[points.length - 1], w, h);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

export type DrawingOverlayProps = {
  socket: Socket | null;
  roomCode: string | null;
  clientId: string;
  clientName: string;
  /** Authoritative strokes from room state (e.g. on join/reconnect). */
  initialStrokes?: Stroke[];
};

export default function DrawingOverlay({
  socket,
  roomCode,
  clientId,
  clientName,
  initialStrokes,
}: DrawingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState(false);
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [size, setSize] = useState(4);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [remoteInProgress, setRemoteInProgress] = useState<Map<string, Stroke>>(new Map());

  const strokesRef = useRef<Stroke[]>([]);
  const remoteRef = useRef<Map<string, Stroke>>(new Map());
  const drawingRef = useRef<Stroke | null>(null);
  const moveBufRef = useRef<{ id: string; points: Point[] }>({ id: '', points: [] });
  const moveTimerRef = useRef<number | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);
  useEffect(() => {
    remoteRef.current = remoteInProgress;
  }, [remoteInProgress]);

  // Reset/replace strokes when room or authoritative state changes.
  useEffect(() => {
    setStrokes(Array.isArray(initialStrokes) ? initialStrokes.map((s) => ({ ...s, local: s.clientId === clientId })) : []);
    setRemoteInProgress(new Map());
    drawingRef.current = null;
  }, [roomCode, initialStrokes, clientId]);

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
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke, w, h);
    for (const stroke of remoteRef.current.values()) drawStroke(ctx, stroke, w, h);
    if (drawingRef.current) drawStroke(ctx, drawingRef.current, w, h);
  }, []);

  useEffect(() => {
    redraw();
  }, [strokes, remoteInProgress, redraw, forceTick]);

  useEffect(() => {
    const onResize = () => redraw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [redraw]);

  // Socket listeners for shared drawing (room-scoped).
  useEffect(() => {
    if (!socket || !roomCode) return;

    const onStart = (payload: any) => {
      if (!payload || payload.clientId === clientId || typeof payload.id !== 'string') return;
      const stroke: Stroke = {
        id: payload.id,
        tool: payload.tool === 'eraser' ? 'eraser' : 'pencil',
        color: typeof payload.color === 'string' ? payload.color : DEFAULT_COLOR,
        size: typeof payload.size === 'number' ? payload.size : 0.005,
        points: Array.isArray(payload.points) ? payload.points : [],
        clientId: payload.clientId,
        clientName: payload.clientName || 'Someone',
      };
      setRemoteInProgress((prev) => {
        const next = new Map(prev);
        next.set(stroke.id, stroke);
        return next;
      });
    };

    const onMove = (payload: any) => {
      if (!payload || payload.clientId === clientId || typeof payload.id !== 'string') return;
      const pts: Point[] = Array.isArray(payload.points) ? payload.points : [];
      if (!pts.length) return;
      setRemoteInProgress((prev) => {
        const existing = prev.get(payload.id);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(payload.id, { ...existing, points: existing.points.concat(pts) });
        return next;
      });
    };

    const onEnd = (payload: any) => {
      if (!payload || typeof payload.id !== 'string') return;
      const stroke: Stroke = {
        id: payload.id,
        tool: payload.tool === 'eraser' ? 'eraser' : 'pencil',
        color: typeof payload.color === 'string' ? payload.color : DEFAULT_COLOR,
        size: typeof payload.size === 'number' ? payload.size : 0.005,
        points: Array.isArray(payload.points) ? payload.points : [],
        clientId: payload.clientId || '',
        clientName: payload.clientName || 'Someone',
      };
      setRemoteInProgress((prev) => {
        if (!prev.has(stroke.id)) return prev;
        const next = new Map(prev);
        next.delete(stroke.id);
        return next;
      });
      if (payload.clientId === clientId) return; // already added locally
      setStrokes((prev) => (prev.some((s) => s.id === stroke.id) ? prev : [...prev, stroke]));
    };

    const onUndo = (payload: any) => {
      const strokeId = typeof payload?.strokeId === 'string' ? payload.strokeId : '';
      if (!strokeId) return;
      setStrokes((prev) => prev.filter((s) => s.id !== strokeId));
    };

    const onClear = () => {
      setStrokes([]);
      setRemoteInProgress(new Map());
      drawingRef.current = null;
    };

    socket.on('DRAW_STROKE_START', onStart);
    socket.on('DRAW_STROKE_MOVE', onMove);
    socket.on('DRAW_STROKE_END', onEnd);
    socket.on('DRAW_UNDO', onUndo);
    socket.on('DRAW_CLEAR', onClear);
    return () => {
      socket.off('DRAW_STROKE_START', onStart);
      socket.off('DRAW_STROKE_MOVE', onMove);
      socket.off('DRAW_STROKE_END', onEnd);
      socket.off('DRAW_UNDO', onUndo);
      socket.off('DRAW_CLEAR', onClear);
    };
  }, [socket, roomCode, clientId]);

  const flushMove = useCallback(() => {
    if (!socket || !roomCode) return;
    const buf = moveBufRef.current;
    if (!buf.id || buf.points.length === 0) return;
    socket.emit('DRAW_STROKE_MOVE', { code: roomCode, id: buf.id, points: buf.points.slice() });
    buf.points = [];
  }, [socket, roomCode]);

  const scheduleMove = useCallback((id: string, pt: Point) => {
    if (!socket || !roomCode) return;
    const buf = moveBufRef.current;
    if (buf.id !== id) {
      buf.id = id;
      buf.points = [];
    }
    buf.points.push(pt);
    if (moveTimerRef.current == null) {
      moveTimerRef.current = window.setTimeout(() => {
        moveTimerRef.current = null;
        flushMove();
      }, 40);
    }
  }, [socket, roomCode, flushMove]);

  const getNormPoint = (e: ReactPointerEvent<HTMLCanvasElement>): Point =>
    norm({ x: e.clientX, y: e.clientY }, window.innerWidth, window.innerHeight);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!active) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const stroke: Stroke = {
      id: uid(),
      tool,
      color: tool === 'eraser' ? '#000000' : color,
      size: Math.max(MIN_SIZE, Math.min(MAX_SIZE, size)) / window.innerWidth,
      points: [getNormPoint(e)],
      clientId,
      clientName,
      local: true,
    };
    drawingRef.current = stroke;
    moveBufRef.current = { id: stroke.id, points: [] };
    if (socket && roomCode) {
      socket.emit('DRAW_STROKE_START', { code: roomCode, stroke: { id: stroke.id, tool: stroke.tool, color: stroke.color, size: stroke.size, points: stroke.points } });
    }
    redraw();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = drawingRef.current;
    if (!current) return;
    e.preventDefault();
    const native = e.nativeEvent as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [native];
    for (const ev of events) {
      const pt = norm({ x: ev.clientX, y: ev.clientY }, window.innerWidth, window.innerHeight);
      current.points.push(pt);
      scheduleMove(current.id, pt);
    }
    redraw();
  };

  const finishStroke = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = drawingRef.current;
    if (!current) return;
    const canvas = canvasRef.current;
    if (canvas) {
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    if (moveTimerRef.current != null) {
      window.clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
    }
    flushMove();
    drawingRef.current = null;
    if (current.points.length > 0) {
      setStrokes((prev) => [...prev, current]);
      if (socket && roomCode) {
        socket.emit('DRAW_STROKE_END', { code: roomCode, stroke: { id: current.id, tool: current.tool, color: current.color, size: current.size, points: current.points } });
      }
    } else {
      forceTick((t) => t + 1);
    }
  };

  const undo = () => {
    // Undo own last stroke (local/shared)
    setStrokes((prev) => {
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].clientId === clientId) { idx = i; break; }
      }
      if (idx === -1) return prev;
      const next = prev.slice();
      next.splice(idx, 1);
      return next;
    });
    if (socket && roomCode) socket.emit('DRAW_UNDO', { code: roomCode });
  };

  const clearAll = () => {
    if (!window.confirm('Clear the shared drawing for everyone in this room?')) return;
    setStrokes([]);
    setRemoteInProgress(new Map());
    drawingRef.current = null;
    if (socket && roomCode) socket.emit('DRAW_CLEAR', { code: roomCode });
  };

  const activeStrokes = useMemo(() => {
    if (!active) return [] as { name: string; mine: boolean }[];
    const seen = new Map<string, { name: string; mine: boolean }>();
    for (const s of strokes) {
      if (!seen.has(s.clientId)) seen.set(s.clientId, { name: s.clientId === clientId ? 'You' : (s.clientName || 'Someone'), mine: s.clientId === clientId });
    }
    for (const s of remoteInProgress.values()) {
      if (!seen.has(s.clientId)) seen.set(s.clientId, { name: s.clientName || 'Someone', mine: false });
    }
    if (drawingRef.current && !seen.has(clientId)) seen.set(clientId, { name: 'You', mine: true });
    return Array.from(seen.values());
  }, [active, strokes, remoteInProgress, clientId, forceTick]);

  const hasDrawings = strokes.length > 0 || remoteInProgress.size > 0;

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
            {activeStrokes.length > 0 && (
              <div className="drawing-presence" title="People who have drawn">
                {activeStrokes.map((p, i) => (
                  <span key={i} className={`drawing-presence-dot ${p.mine ? 'is-mine' : ''}`} title={p.name}>{p.name}</span>
                ))}
              </div>
            )}
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
              <button type="button" className="drawing-tool-btn" onClick={undo} title="Undo my last stroke" aria-label="Undo my last stroke" disabled={!strokes.some(s => s.clientId === clientId)}>
                <Undo2 size={18} />
              </button>
              <button type="button" className="drawing-tool-btn danger" onClick={clearAll} title="Clear all (shared)" aria-label="Clear all shared drawings" disabled={strokes.length === 0 && remoteInProgress.size === 0}>
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
          title={active ? 'Close drawing mode' : 'Open shared drawing mode'}
          aria-label={active ? 'Close drawing mode' : 'Open shared drawing mode'}
          aria-pressed={active}
        >
          <Pencil size={20} />
        </button>
      </div>
    </>
  );
}
