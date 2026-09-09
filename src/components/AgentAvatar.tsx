"use client";

import { useEffect, useRef, useState } from "react";

import { markAvatar } from "@/lib/avatar-status";

/**
 * Deliberately a plain <img>, not next/image.
 *
 * next/image proxies through Next's optimiser, and 8004scan's media endpoint is
 * slow enough that it returns "upstream image response timed out" and the avatar
 * fails entirely. Deck proxies through /api/avatar instead (cached, allowlisted,
 * single-flight), and a dead URL still falls back to the monogram below.
 */

/** Monogram palette. Muted enough to sit inside a near-monochrome page without
 *  competing with the yellow accent, distinct enough that two agents side by side
 *  do not read as the same tile. */
const TILES = [
  { bg: "#1d2a33", ink: "#8fc7e8" },
  { bg: "#2a2430", ink: "#c4a6d8" },
  { bg: "#232e26", ink: "#8fd8a8" },
  { bg: "#302a20", ink: "#e0bb7a" },
  { bg: "#2b2426", ink: "#dda1a8" },
  { bg: "#1f2b2d", ink: "#8fd3cf" },
  { bg: "#282a20", ink: "#c7d189" },
  { bg: "#262631", ink: "#a7aee6" },
];

/** Stable hue per agent, so the same agent always gets the same tile — across
 *  reloads, pages and sort orders. Keyed on the identity string rather than the
 *  display name, because two agents can share a name. Exported for FeedbackList,
 *  which tiles reviewers the same way. */
export function tileFor(key: string) {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return TILES[Math.abs(hash) % TILES.length];
}

/** Up to two letters: initials from a multi-word name, otherwise the first two
 *  characters. "Venus powered by HeyAnon" reads better as VP than as V, and a
 *  single letter across a whole page of cards is indistinguishable noise. */
export function monogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const bare = words[0] ?? name;
  return bare.slice(0, 2).toUpperCase();
}

/**
 * Every avatar loads through Deck's own proxy, never straight from the
 * registry's media host. Their endpoint is a per-request coin flip, and
 * twenty browsers rolling independently is why photos vanished on refresh.
 * The proxy rolls once server-side and caches for a day — repeat views (and
 * retries) never touch the upstream at all.
 */
function proxied(src: string, fresh: boolean): string {
  return `/api/avatar?u=${encodeURIComponent(src)}${fresh ? "&fresh=1" : ""}`;
}

export default function AgentAvatar({
  src,
  name,
  identity,
  width,
  height,
  sizeClassName,
  fallbackClassName,
  eager,
}: {
  src?: string;
  name: string;
  /** Stable key for the colour. Falls back to the name when not supplied. */
  identity?: string;
  width?: number;
  height?: number;
  sizeClassName: string;
  fallbackClassName: string;
  /** Above the fold (detail hero). Skips lazy-loading and jumps the queue. */
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  /**
   * First load plus one uncached retry. Flakiness now lives behind the proxy
   * (cached day-long, retried server-side), so the client no longer needs the
   * old four-attempt storm — which, under the media host's rate ceiling, was
   * actively contributing to the failures it was retrying. The monogram
   * underneath keeps any wait invisible.
   */
  const [attempt, setAttempt] = useState(0);
  const retryTimer = useRef<number | null>(null);
  /** False until the bytes arrive. The monogram underneath is the paint the
   *  reader actually sees first — a 5-second image load used to mean a
   *  5-second empty box, now it means a 5-second monogram fading into a photo. */
  const [loaded, setLoaded] = useState(false);
  const key = identity || name;

  useEffect(
    () => () => {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    },
    []
  );

  // Roughly four in five registry avatars are a URL with nothing behind it, so
  // this is the common case, not the error case. It gets to look intentional:
  // two letters, a stable colour, and a tint of the ink behind the glyphs.
  const tile = tileFor(key);
  const monogramEl = (
    <div
      aria-hidden="true"
      className={fallbackClassName}
      style={{ backgroundColor: tile.bg, color: tile.ink }}
    >
      <span className="font-bold tracking-tight">{monogram(name)}</span>
    </div>
  );

  if (!src || failed) return monogramEl;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {monogramEl}
      {/* eslint-disable-next-line @next/next/no-img-element -- see note above */}
      <img
        src={proxied(src, attempt > 0)}
        alt=""
        width={width}
        height={height}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        decoding="async"
        className={`${sizeClassName} absolute inset-0 transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        // The browser is the only thing that knows whether these URLs resolve, and
        // it is loading them anyway — so report the outcome for ordering instead of
        // probing the same endpoint again server-side. See lib/avatar-status.ts.
        onLoad={() => {
          if (retryTimer.current !== null) {
            window.clearTimeout(retryTimer.current);
            retryTimer.current = null;
          }
          markAvatar(key, true);
          setLoaded(true);
        }}
        onError={() => {
          markAvatar(key, false);
          if (attempt < 1) {
            setLoaded(false);
            retryTimer.current = window.setTimeout(() => {
              retryTimer.current = null;
              setAttempt((current) => current + 1);
            }, 1500);
            return;
          }
          setFailed(true);
        }}
        key={attempt}
      />
    </div>
  );
}
