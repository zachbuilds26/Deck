"use client";

import { useEffect, useRef } from "react";

const BAYER = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
];

/** Sine by table lookup.
 *
 *  The old draw called Math.sin twice per cell, and a 1440x900 hero at a 3px
 *  cell is 144,000 cells — 288,000 trig calls every frame, 17 million a second.
 *  That is what made scrolling stutter: the main thread never got a break.
 *  This is a shimmer behind a headline, so a 4096-entry table is more precision
 *  than the effect can show. */
const SIN_BITS = 13;
const SIN_SIZE = 1 << SIN_BITS;
const SIN_MASK = SIN_SIZE - 1;
const SIN_SCALE = SIN_SIZE / (Math.PI * 2);
const SIN = new Float32Array(SIN_SIZE);
for (let i = 0; i < SIN_SIZE; i += 1) SIN[i] = Math.sin((i / SIN_SIZE) * Math.PI * 2);
const sin = (radians: number) => SIN[(radians * SIN_SCALE) & SIN_MASK];

export default function HeroDither() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cell = 3;
    let cols = 0;
    let rows = 0;
    let frame = 0;
    let active = false;

    /** Everything that depends only on a cell's position, computed once per
     *  resize instead of 30 times a second: the two wave arguments, the dither
     *  threshold, the alpha bucket, and the pixel origin. */
    let waveArg = new Float32Array(0);
    let swirlArg = new Float32Array(0);
    let gain = new Float32Array(0);
    let base = new Float32Array(0);
    let threshold = new Float32Array(0);
    let alpha = new Float32Array(0);
    let originX = new Int16Array(0);
    let originY = new Int16Array(0);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      cols = Math.ceil(width / cell);
      rows = Math.ceil(height / cell);

      const count = cols * rows;
      waveArg = new Float32Array(count);
      swirlArg = new Float32Array(count);
      gain = new Float32Array(count);
      base = new Float32Array(count);
      threshold = new Float32Array(count);
      alpha = new Float32Array(count);
      originX = new Int16Array(count);
      originY = new Int16Array(count);

      const centerX = cols * 0.5;
      const centerY = rows * 0.7;
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const i = y * cols + x;
          const nx = (x - centerX) / cols;
          const ny = (y - centerY) / rows;
          const distance = Math.sqrt(nx * nx * 0.9 + ny * ny * 1.35);
          const profile = Math.max(0, 1 - 2.35 * distance);
          waveArg[i] = 26 * distance;
          swirlArg[i] = (x / cols) * 8 + ny * 3;
          // density = (0.49 + 0.28*wave + 0.12*swirl) * gain + base
          gain[i] = 0.28 + 0.72 * profile;
          base[i] = 0.22 * profile;
          threshold[i] = (BAYER[y & 7][x & 7] + 0.5) / 64;
          alpha[i] = Math.min(1, 0.2 + 0.72 * profile);
          originX[i] = x * cell;
          originY[i] = y * cell;
        }
      }
    };

    const size = cell - 0.65;

    // Per-cell alpha and per-cell fillRect, exactly as the original drew it. Only
    // the ARITHMETIC is optimised (precomputed geometry above, sine by table);
    // every pixel this puts on screen is the same one it always did.
    const draw = (time: number) => {
      const phase = time * 0.0006;
      const wavePhase = 4 * phase;
      const swirlPhase = phase * 2;
      const count = cols * rows;

      ctx.clearRect(0, 0, cols * cell, rows * cell);
      ctx.fillStyle = "#F0B90B";

      for (let i = 0; i < count; i += 1) {
        const density =
          (0.49 + 0.28 * sin(waveArg[i] - wavePhase) + 0.12 * sin(swirlArg[i] + swirlPhase)) *
            gain[i] +
          base[i];
        if (density > threshold[i]) {
          ctx.globalAlpha = alpha[i];
          ctx.fillRect(originX[i], originY[i], size, size);
        }
      }
      ctx.globalAlpha = 1;
    };

    const animate = (time: number) => {
      if (!active) return;
      draw(time);
      frame = requestAnimationFrame(animate);
    };
    const start = () => {
      if (active || reduce || document.hidden) return;
      active = true;
      frame = requestAnimationFrame(animate);
    };
    const stop = () => {
      active = false;
      cancelAnimationFrame(frame);
    };

    resize();
    draw(0);

    let onScreen = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        if (onScreen) start();
        else stop();
      },
      { threshold: 0.05 }
    );
    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (!active) draw(0);
    });
    // A hidden tab still fires rAF in some browsers, and always wastes work in
    // the rest. Nothing here is worth a background core.
    const onVisibility = () => (document.hidden || !onScreen ? stop() : start());

    observer.observe(host);
    resizeObserver.observe(host);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      observer.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="block h-full w-full" />;
}
