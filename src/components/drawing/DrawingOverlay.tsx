import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { Pencil, Eraser, Undo2, Trash2, X, Minus, Plus } from 'lucide-react';
import LiquidScrollbar from '../common/LiquidScrollbar';
import './DrawingOverlay.css';

type Tool = 'pencil' | 'eraser';

type Point = { x: number; y: number };

type Stroke = {
  id: string;
  clientId: string;
  clientName: string;
  mode: 'draw' | 'erase';
  color: string;
  /** Width normalized to viewport width (0..0.1). */
  width: number;
  /** Points normalized to viewport (0..1). */
  points: Point[];
  seq?: number;
  epoch?: number;
  ts?: number;
  local?: boolean;
};

export type DrawingState = {
  epoch: number;
  seq: number;
  strokes: Stroke[];
};

const EMPTY_DRAWING_STATE: DrawingState = { epoch: 0, seq: 0, strokes: [] };

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
  if (!points || points.length === 0) return;
  const lineW = Math.max(1, stroke.width * w);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineW;
  ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.mode === 'erase' ? 'rgba(0,0,0,1)' : stroke.color;
  if (points.length === 1) {
    const p = denorm(points[0], w, h);
    ctx.beginPath();
    ctx.fillStyle = stroke.mode === 'erase' ? 'rgba(0,0,0,1)' : stroke.color;
    ctx.arc(p.x, p.y, lineW / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const p0 = denorm(points[0], w, h);
  ctx.beginPath();
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
  /** Authoritative drawing state from room (epoch/seq/strokes). */
  initialState?: DrawingState | null;
};

export default function DrawingOverlay({
  socket,
  roomCode,
  clientId,
  clientName,
  initialState,
}: DrawingOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const toolbarWrapperRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [size, setSize] = useState(4);

  const [drawingState, setDrawingState] = useState<DrawingState>(EMPTY_DRAWING_STATE);
  const [remoteInProgress, setRemoteInProgress] = useState<Map<string, Stroke>>(new Map());

  const strokesRef = useRef<Stroke[]>([]);
  const remoteRef = useRef<Map<string, Stroke>>(new Map());
  const drawingRef = useRef<Stroke | null>(null);
  const stateRef = useRef<DrawingState>(EMPTY_DRAWING_STATE);

  const moveBufRef = useRef<Point[]>([]);
  const moveTimerRef = useRef<number | null>(null);
  const moveStrokeIdRef = useRef<string | null>(null);

  const rafRef = useRef<number | null>(null);

  const scheduleRedraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const bw = Math.floor(w * dpr);
      const bh = Math.floor(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const stroke of strokesRef.current) drawStroke(ctx, stroke, w, h);
      for (const stroke of remoteRef.current.values()) drawStroke(ctx, stroke, w, h);
      if (drawingRef.current) drawStroke(ctx, drawingRef.current, w, h);
    });
  }, []);

  useEffect(() => {
    strokesRef.current = drawingState.strokes;
    stateRef.current = drawingState;
    scheduleRedraw();
  }, [drawingState, scheduleRedraw]);

  useEffect(() => {
    remoteRef.current = remoteInProgress;
    scheduleRedraw();
  }, [remoteInProgress, scheduleRedraw]);

  // Apply authoritative room snapshot only when it represents newer/equal-canonical state.
  useEffect(() => {
    if (!initialState || typeof initialState !== 'object') return;
    const next: DrawingState = {
      epoch: Number.isFinite(Number(initialState.epoch)) ? Number(initialState.epoch) : 0,
      seq: Number.isFinite(Number(initialState.seq)) ? Number(initialState.seq) : 0,
      strokes: Array.isArray(initialState.strokes) ? initialState.strokes : [],
    };
    setDrawingState((prev) => {
      if (next.epoch < prev.epoch) return prev;
      if (next.epoch === prev.epoch && next.seq < prev.seq) return prev;
      // If room changed (epoch reset context handled by roomCode key at parent),
      // or server has newer/canonical snapshot, accept it.
      return { ...next, strokes: [...next.strokes] };
    });
    // Remote in-progress strokes may be stale relative to a new authoritative snapshot.
    setRemoteInProgress((prev) => {
      if (next.epoch !== stateRef.current.epoch) return new Map();
      return prev;
    });
  }, [initialState]);

  // Reset local drawing interaction and local state when switching rooms.
  useEffect(() => {
    drawingRef.current = null;
    moveBufRef.current = [];
    moveStrokeIdRef.current = null;
    if (moveTimerRef.current != null) {
      window.clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
    }
    setDrawingState(EMPTY_DRAWING_STATE);
    setRemoteInProgress(new Map());
    scheduleRedraw();
  }, [roomCode, scheduleRedraw]);

  useEffect(() => {
    const onResize = () => scheduleRedraw();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [scheduleRedraw]);

  // Socket listeners for shared drawing (room-scoped, ordered by epoch/seq).
  useEffect(() => {
    if (!socket) return;

    const onStart = (payload: any) => {
      if (!payload || payload.clientId === clientId || typeof payload.id !== 'string') return;
      const epoch = Number(payload.epoch);
      if (Number.isFinite(epoch) && epoch !== stateRef.current.epoch) return;
      const mode: 'draw' | 'erase' = payload.mode === 'erase' || payload.tool === 'eraser' ? 'erase' : 'draw';
      const stroke: Stroke = {
        id: payload.id,
        clientId: String(payload.clientId || ''),
        clientName: String(payload.clientName || 'Someone'),
        mode,
        color: typeof payload.color === 'string' ? payload.color : DEFAULT_COLOR,
        width: typeof payload.width === 'number' ? payload.width : (typeof payload.size === 'number' ? payload.size : 0.005),
        points: Array.isArray(payload.points) ? payload.points : [],
        epoch: Number.isFinite(epoch) ? epoch : stateRef.current.epoch,
      };
      setRemoteInProgress((prev) => {
        const next = new Map(prev);
        next.set(stroke.id, stroke);
        return next;
      });
    };

    const onMove = (payload: any) => {
      if (!payload || payload.clientId === clientId || typeof payload.id !== 'string') return;
      const epoch = Number(payload.epoch);
      if (Number.isFinite(epoch) && epoch !== stateRef.current.epoch) return;
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
      setRemoteInProgress((prev) => {
        if (!prev.has(payload.id)) return prev;
        const next = new Map(prev);
        next.delete(payload.id);
        return next;
      });
      setDrawingState((prev) => {
        const epoch = Number(payload.epoch);
        if (Number.isFinite(epoch) && epoch !== prev.epoch) return prev;
        if (prev.strokes.some((s) => s.id === payload.id)) return prev;
        const mode: 'draw' | 'erase' = payload.mode === 'erase' || payload.tool === 'eraser' ? 'erase' : 'draw';
        const stroke: Stroke = {
          id: payload.id,
          clientId: String(payload.clientId || ''),
          clientName: String(payload.clientName || 'Someone'),
          mode,
          color: typeof payload.color === 'string' ? payload.color : DEFAULT_COLOR,
          width: typeof payload.width === 'number' ? payload.width : (typeof payload.size === 'number' ? payload.size : 0.005),
          points: Array.isArray(payload.points) ? payload.points : [],
          seq: typeof payload.seq === 'number' ? payload.seq : undefined,
          epoch: Number.isFinite(epoch) ? epoch : prev.epoch,
          ts: typeof payload.ts === 'number' ? payload.ts : undefined,
          local: String(payload.clientId || '') === clientId,
        };
        const seq = typeof stroke.seq === 'number' ? stroke.seq : prev.seq;
        return { epoch: prev.epoch, seq: Math.max(prev.seq, seq), strokes: [...prev.strokes, stroke] };
      });
    };

    const onUndo = (payload: any) => {
      const strokeId = typeof payload?.id === 'string' ? payload.id : (typeof payload?.strokeId === 'string' ? payload.strokeId : '');
      if (!strokeId) return;
      setDrawingState((prev) => {
        const epoch = Number(payload?.epoch);
        if (Number.isFinite(epoch) && epoch !== prev.epoch) return prev;
        if (!prev.strokes.some((s) => s.id === strokeId)) return prev;
        const seq = Number(payload?.seq);
        return {
          epoch: prev.epoch,
          seq: Number.isFinite(seq) ? Math.max(prev.seq, seq) : prev.seq,
          strokes: prev.strokes.filter((s) => s.id !== strokeId),
        };
      });
    };

    const onClear = (payload: any) => {
      const epoch = Number(payload?.epoch);
      const seq = Number(payload?.seq);
      setDrawingState({
        epoch: Number.isFinite(epoch) ? epoch : 0,
        seq: Number.isFinite(seq) ? seq : 0,
        strokes: [],
      });
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
  }, [socket, clientId]);

  const flushMove = useCallback(() => {
    if (!socket || !roomCode) return;
    const id = moveStrokeIdRef.current;
    if (!id || moveBufRef.current.length === 0) return;
    const pts = moveBufRef.current.slice();
    moveBufRef.current = [];
    socket.emit('DRAW_STROKE_MOVE', {
      code: roomCode,
      id,
      points: pts,
      epoch: stateRef.current.epoch,
    });
  }, [socket, roomCode]);

  const scheduleMove = useCallback((id: string, pt: Point) => {
    moveStrokeIdRef.current = id;
    moveBufRef.current.push(pt);
    if (moveTimerRef.current != null) return;
    moveTimerRef.current = window.setTimeout(() => {
      moveTimerRef.current = null;
      flushMove();
    }, 32);
  }, [flushMove]);

  const getNormPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point =>
    norm({ x: e.clientX, y: e.clientY }, window.innerWidth, window.innerHeight);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || !roomCode) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const stroke: Stroke = {
      id: uid(),
      clientId,
      clientName,
      mode: tool === 'eraser' ? 'erase' : 'draw',
      color: tool === 'eraser' ? '#000000' : color,
      width: Math.max(MIN_SIZE, Math.min(MAX_SIZE, size)) / window.innerWidth,
      points: [getNormPoint(e)],
      epoch: stateRef.current.epoch,
      local: true,
    };
    drawingRef.current = stroke;
    moveBufRef.current = [];
    moveStrokeIdRef.current = stroke.id;
    if (socket) {
      socket.emit('DRAW_STROKE_START', {
        code: roomCode,
        epoch: stateRef.current.epoch,
        stroke: {
          id: stroke.id,
          mode: stroke.mode,
          color: stroke.color,
          width: stroke.width,
          points: stroke.points,
        },
      });
    }
    scheduleRedraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
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
    scheduleRedraw();
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
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
    moveStrokeIdRef.current = null;

    if (current.points.length === 0) {
      scheduleRedraw();
      return;
    }

    // Optimistic local add for responsiveness; authoritative server emits final ordered op
    // (with seq/epoch). onEnd handler dedupes and reconciles by id.
    setDrawingState((prev) => {
      if (prev.strokes.some((s) => s.id === current.id)) return prev;
      return { ...prev, strokes: [...prev.strokes, current] };
    });

    if (socket && roomCode) {
      socket.emit('DRAW_STROKE_END', {
        code: roomCode,
        epoch: stateRef.current.epoch,
        stroke: {
          id: current.id,
          mode: current.mode,
          color: current.color,
          width: current.width,
          points: current.points,
        },
      });
    }
  };

  const undo = () => {
    if (!roomCode) return;
    if (socket) socket.emit('DRAW_UNDO', { code: roomCode, epoch: stateRef.current.epoch });
  };

  const clearAll = () => {
    if (!roomCode) return;
    if (!window.confirm('Clear the shared drawing for everyone in this room?')) return;
    if (socket) socket.emit('DRAW_CLEAR', { code: roomCode, epoch: stateRef.current.epoch });
  };

  const hasMyStroke = drawingState.strokes.some((s) => s.clientId === clientId);
  const hasAny = drawingState.strokes.length > 0 || remoteInProgress.size > 0;

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`drawing-canvas ${active ? 'is-active' : ''} ${hasAny || active ? 'is-visible' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        aria-hidden="true"
      />

      <div className={`drawing-ui ${active ? 'is-open' : ''}`}>
        {active && (
          <div ref={toolbarWrapperRef} className="drawing-toolbar-wrapper" style={{ position: 'relative', maxHeight: '60vh', overflow: 'auto' }}>
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
              <button
                type="button"
                className="drawing-tool-btn"
                onClick={undo}
                title="Undo my last stroke"
                aria-label="Undo my last stroke"
                disabled={!hasMyStroke}
              >
                <Undo2 size={18} />
              </button>
              <button
                type="button"
                className="drawing-tool-btn danger"
                onClick={clearAll}
                title="Clear all (shared)"
                aria-label="Clear all shared drawings"
                disabled={!hasAny}
              >
                <Trash2 size={18} />
              </button>
              <button
                type="button"
                className="drawing-tool-btn"
                onClick={() => setActive(false)}
                title="Close drawing mode"
                aria-label="Close drawing mode"
              >
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
            <LiquidScrollbar contentRef={toolbarWrapperRef} autoHide />
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
