import { useEffect, useRef, useState, useCallback } from 'react';

type LiquidScrollbarProps = {
  /** The scrollable content element ref */
  contentRef: React.RefObject<HTMLElement | null>;
  /** Optional custom className for the scrollbar rail */
  className?: string;
  /** Width of the scrollbar rail in pixels */
  railWidth?: number;
  /** Whether the scrollbar should be hidden when not scrolling */
  autoHide?: boolean;
  /** Minimum thumb height percentage (0-100) */
  minThumbPercent?: number;
  /** Unique ID for the scrollable content (for aria-controls) */
  contentId?: string;
};

export default function LiquidScrollbar({
  contentRef,
  className = '',
  railWidth = 8,
  autoHide = false,
  minThumbPercent = 0,
  contentId,
}: LiquidScrollbarProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const waterRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [currentLevel, setCurrentLevel] = useState(0);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [ariaValueNow, setAriaValueNow] = useState(0);
  const targetLevelRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const lastDirectionRef = useRef(0);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotionRef = useRef(false);
  const updateWaterRef = useRef<() => void>(() => {});

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const getScrollProgress = useCallback(() => {
    const content = contentRef.current;
    if (!content) return 0;
    const maxScroll = content.scrollHeight - content.clientHeight;
    if (maxScroll <= 0) return 0;
    return Math.max(0, Math.min(1, content.scrollTop / maxScroll));
  }, [contentRef]);

  const animateWaterRef = useRef<() => void>(() => {});

  useEffect(() => {
    animateWaterRef.current = () => {
      const difference = targetLevelRef.current - currentLevel;
      const nextLevel = currentLevel + difference * 0.14;

      setCurrentLevel(Math.abs(difference) < 0.05 ? targetLevelRef.current : nextLevel);

      if (Math.abs(difference) >= 0.05) {
        animationFrameRef.current = requestAnimationFrame(animateWaterRef.current);
      } else {
        animationFrameRef.current = null;
      }
    };
  }, [currentLevel]);

  const showScrollbar = useCallback(() => {
    setIsVisible(true);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => setIsVisible(false), 800);
  }, []);

  useEffect(() => {
    updateWaterRef.current = () => {
      const content = contentRef.current;
      const water = waterRef.current;
      const rail = railRef.current;
      if (!content || !water || !rail) return;

      const progress = getScrollProgress();
      const targetLevel = progress * 100;
      targetLevelRef.current = targetLevel;

      const direction = targetLevel > currentLevel ? 1 : targetLevel < currentLevel ? -1 : 0;

      if (direction !== 0 && direction !== lastDirectionRef.current) {
        water.classList.remove('rising', 'falling');
        void water.offsetWidth;
        water.classList.add(direction > 0 ? 'rising' : 'falling');
        lastDirectionRef.current = direction;
      }

      setAriaValueNow(Math.round(targetLevel));

      if (reducedMotionRef.current) {
        setCurrentLevel(targetLevel);
        return;
      }

      if (!animationFrameRef.current) {
        animationFrameRef.current = requestAnimationFrame(animateWaterRef.current);
      }

      if (autoHide) {
        showScrollbar();
      }
    };
  }, [currentLevel, autoHide, contentRef, getScrollProgress, showScrollbar]);

  const scrollToPointer = (clientY: number) => {
    const content = contentRef.current;
    const rail = railRef.current;
    if (!content || !rail) return;

    const rect = rail.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const maxScroll = content.scrollHeight - content.clientHeight;
    content.scrollTop = progress * maxScroll;
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    scrollToPointer(event.clientY);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (isDragging) {
      scrollToPointer(event.clientY);
    }
  };

  const stopDragging = () => {
    setIsDragging(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const content = contentRef.current;
    if (!content) return;

    const step = content.clientHeight * 0.8;
    switch (event.key) {
      case 'ArrowDown':
        content.scrollTop += step;
        event.preventDefault();
        break;
      case 'ArrowUp':
        content.scrollTop -= step;
        event.preventDefault();
        break;
      case 'Home':
        content.scrollTop = 0;
        event.preventDefault();
        break;
      case 'End':
        content.scrollTop = content.scrollHeight;
        event.preventDefault();
        break;
    }
  };

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const checkOverflow = () => {
      setHasOverflow(content.scrollHeight > content.clientHeight);
    };

    const handleScroll = () => {
      checkOverflow();
      updateWaterRef.current?.();
    };
    
    checkOverflow();
    content.addEventListener('scroll', handleScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      checkOverflow();
      updateWaterRef.current?.();
    });
    resizeObserver.observe(content);

    updateWaterRef.current?.();

    return () => {
      content.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [contentRef]);

  if (!hasOverflow) return null;

  const railStyle: React.CSSProperties = {
    position: 'absolute',
    top: 16,
    right: 0,
    bottom: 16,
    width: railWidth,
    overflow: 'hidden',
    border: '1px solid #c6e3e8',
    borderRadius: 30,
    background: 'linear-gradient(90deg, #f5e8e7, #fff9f5 50%, #f4e5e5)',
    boxShadow: 'inset 1px 0 3px #ffffff, 0 2px 6px #75556808',
    cursor: 'pointer',
    touchAction: 'none',
    userSelect: 'none',
    opacity: isVisible || isDragging ? 1 : autoHide ? 0 : 1,
    transition: autoHide ? 'opacity 0.3s ease' : 'none',
  };

  const waterStyle: React.CSSProperties = {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: `${currentLevel}%`,
    minHeight: minThumbPercent > 0 ? `${minThumbPercent}%` : 0,
    overflow: 'hidden',
    borderRadius: '0 0 30px 30px',
    background: 'linear-gradient(90deg, #55b9cf, #9be3ed 45%, #4caec7)',
    boxShadow: 'inset 2px 0 4px #ffffff40',
    willChange: 'height',
  };

  return (
    <div
      ref={railRef}
      className={`liquid-scrollbar ${className}`}
      role="scrollbar"
      aria-label="Scroll position"
      aria-controls={contentId}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ariaValueNow}
      tabIndex={0}
      style={railStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onPointerLeave={stopDragging}
      onKeyDown={handleKeyDown}
      onMouseEnter={showScrollbar}
    >
      <div ref={waterRef} className="water" style={waterStyle}>
        <div className="water-highlight" />
        <span className="bubble" />
        <span className="bubble" />
        <span className="bubble" />
        <span className="bubble" />
        <span className="bubble" />
      </div>
    </div>
  );
}