import { useEffect, useRef } from 'react';

const PARTICLE_COUNT = 38;

function randomBetween(a, b) {
  return a + Math.random() * (b - a);
}

export default function ParticlesBackground() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const particles = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Init particles
    particles.current = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: randomBetween(0, window.innerWidth),
      y: randomBetween(0, window.innerHeight),
      r: randomBetween(1.5, 4),
      dx: randomBetween(-0.3, 0.3),
      dy: randomBetween(-0.4, -0.1),
      opacity: randomBetween(0.08, 0.22),
      pulse: randomBetween(0, Math.PI * 2),
      pulseSpeed: randomBetween(0.008, 0.02),
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.current.forEach((p) => {
        p.pulse += p.pulseSpeed;
        const alpha = p.opacity + Math.sin(p.pulse) * 0.06;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(24, 95%, 55%, ${alpha})`;
        ctx.fill();

        p.x += p.dx;
        p.y += p.dy;

        // Wrap around
        if (p.y < -10) p.y = canvas.height + 10;
        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
      });

      animRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    />
  );
}
