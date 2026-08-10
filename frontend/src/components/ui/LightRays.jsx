import { useEffect, useRef } from 'react';

/**
 * A deliberately small, defensive canvas background. It has no WebGL/OGL
 * dependency: failure to acquire a drawing context simply leaves the hero
 * with its normal CSS background.
 */
export default function LightRays({ className = '', intensity = 0.7, style = {} }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return undefined;

    let frameId = null;
    let mounted = true;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let lastTime = 0;
    let phase = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time) => {
      if (!mounted) return;
      const delta = Math.min(48, time - lastTime || 16);
      lastTime = time;
      phase += delta * 0.00012;
      context.clearRect(0, 0, width, height);

      const focalX = width * (0.64 + Math.sin(phase) * 0.035);
      const focalY = height * (0.36 + Math.cos(phase * 0.7) * 0.03);
      const rays = [
        [-0.24, 0.10, 0.025], [-0.08, 0.24, 0.032], [0.11, 0.48, 0.022],
        [0.35, 0.78, 0.017], [0.52, 0.97, 0.012],
      ];
      rays.forEach(([start, end, alpha], index) => {
        const drift = Math.sin(phase * (1.1 + index * 0.07) + index) * 0.045;
        const gradient = context.createLinearGradient(focalX, focalY, width * (start + 0.5 + drift), height);
        gradient.addColorStop(0, `rgba(255,255,255,${alpha * intensity})`);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.beginPath();
        context.moveTo(focalX, focalY);
        context.lineTo(width * (start + drift), height);
        context.lineTo(width * (end + drift), height);
        context.closePath();
        context.fill();
      });
      frameId = window.requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    frameId = window.requestAnimationFrame(draw);

    return () => {
      mounted = false;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      observer.disconnect();
      context.clearRect(0, 0, width, height);
    };
  }, [intensity]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={style} />;
}
