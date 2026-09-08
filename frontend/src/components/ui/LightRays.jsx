import { useEffect, useRef } from 'react';

const DEFAULT_RAYS = Object.freeze([
  [-0.24, 0.10, 0.025], [-0.08, 0.24, 0.032], [0.11, 0.48, 0.022],
  [0.35, 0.78, 0.017], [0.52, 0.97, 0.012],
]);

export default function LightRays({ className = '', intensity = 0.7, style = {} }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    try {
      if (typeof window !== 'undefined' && window.matchMedia &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return undefined;
      }
    } catch (_) { /* ignore */ }

    let context = null;
    try { context = canvas.getContext('2d', { alpha: true }); }
    catch (_) { context = null; }
    if (!context) return undefined;

    let frameId = null;
    let mounted = true;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let lastTime = 0;
    let phase = 0;
    let observer = null;

    const resize = () => {
      if (!mounted || !canvas) return;
      try {
        const rect = canvas.getBoundingClientRect();
        width = Math.max(1, Math.floor(rect.width || 1));
        height = Math.max(1, Math.floor(rect.height || 1));
        dpr = Math.min(Number(window.devicePixelRatio) || 1, 1.5);
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        if (typeof context.setTransform === 'function') {
          context.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      } catch (_) { /* ignore resize failures */ }
    };

    const draw = (time) => {
      if (!mounted || !context) return;
      try {
        const delta = Math.min(48, Number(time - lastTime) || 16);
        lastTime = time;
        phase += delta * 0.00012;

        if (typeof context.clearRect === 'function') {
          context.clearRect(0, 0, width, height);
        }

        const focalX = width * (0.64 + Math.sin(phase) * 0.035);
        const focalY = height * (0.36 + Math.cos(phase * 0.7) * 0.03);

        const rays = Array.isArray(DEFAULT_RAYS) ? DEFAULT_RAYS : [];

        if (rays.length > 0 && typeof rays.forEach === 'function') {
          rays.forEach((rayTuple, index) => {
            try {
              const [start, end, alpha] = Array.isArray(rayTuple) ? rayTuple : [0, 0, 0];
              const drift = Math.sin(phase * (1.1 + index * 0.07) + index) * 0.045;
              const gradient = context.createLinearGradient(
                focalX, focalY,
                width * (Number(start) + 0.5 + drift), height
              );
              gradient.addColorStop(0, `rgba(255,255,255,${Number(alpha || 0) * Number(intensity || 0)})`);
              gradient.addColorStop(1, 'rgba(255,255,255,0)');
              context.fillStyle = gradient;
              context.beginPath();
              context.moveTo(focalX, focalY);
              context.lineTo(width * (Number(start) + drift), height);
              context.lineTo(width * (Number(end) + drift), height);
              context.closePath();
              context.fill();
            } catch (_) { /* skip bad rays */ }
          });
        }
      } catch (_) { /* swallow draw errors */ }

      if (mounted) {
        frameId = window.requestAnimationFrame(draw);
      }
    };

    try {
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(resize);
        observer.observe(canvas);
      }
    } catch (_) { /* ResizeObserver not available */ }

    resize();
    try {
      frameId = window.requestAnimationFrame(draw);
    } catch (_) { /* requestAnimationFrame not available */ }

    return () => {
      mounted = false;
      if (frameId !== null && typeof window.cancelAnimationFrame === 'function') {
        try { window.cancelAnimationFrame(frameId); } catch (_) { /* ignore */ }
      }
      frameId = null;
      if (observer && typeof observer.disconnect === 'function') {
        try { observer.disconnect(); } catch (_) { /* ignore */ }
      }
      observer = null;
      if (context && typeof context.clearRect === 'function') {
        try { context.clearRect(0, 0, width, height); } catch (_) { /* ignore */ }
      }
      context = null;
    };
  }, [intensity]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={style} />;
}
