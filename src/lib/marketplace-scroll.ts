"use client";

import type { Agent } from "@/lib/types";

/**
 * Marketplace scroll restoration.
 *
 * AgentCard records the position and the list on the way out; MarketplaceBackLink
 * asks for them back on the way in.
 */
const SCROLL_KEY = "deck-marketplace-scroll";
const LIST_KEY = "deck-marketplace-list";
const RESTORE_KEY = "deck-marketplace-restore";

/** Where the reader was. Module scope, so a client-side route change keeps it. */
let savedY = 0;
/**
 * Whether the next marketplace mount should restore that position.
 *
 * Mirrored to sessionStorage, because module scope alone was not reliable: in
 * `next dev` the route chunk is compiled on demand and Fast Refresh
 * re-evaluates modules, so this flag came back false after a round trip. The
 * page then refetched instead of restoring, and the reader watched the dark
 * hero for as long as the request took. The storage copy survives that.
 */
let pending = false;

export interface MarketplaceList {
  agents: Agent[];
  category: string;
  searchQuery: string;
  sortBy: string;
  hasMore: boolean;
  page: number;
}

/** The list as currently rendered. Kept as a live reference — no serialising on
 *  every keystroke or scroll-append. */
let live: MarketplaceList | null = null;

export function setMarketplaceList(next: MarketplaceList) {
  live = next;
}

/**
 * The list to render on a return visit, or null to fetch fresh.
 *
 * Two tiers, because the module copy alone was not reliable. In `next dev` the
 * route chunk is compiled on demand and Fast Refresh re-evaluates modules, so
 * `live` came back null after a round trip — the page then refetched, and the
 * reader watched the hero for as long as the request took. The sessionStorage
 * copy survives module re-evaluation and a full reload.
 */
export function readMarketplaceList(): MarketplaceList | null {
  if (live && live.agents.length > 0) return live;
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MarketplaceList;
    return Array.isArray(parsed?.agents) && parsed.agents.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function saveMarketplaceScroll() {
  if (typeof window === "undefined") return;
  savedY = window.scrollY;
  try {
    sessionStorage.setItem(SCROLL_KEY, String(savedY));
    // Serialised HERE, on the one click that navigates away, rather than on every
    // render. This is the only moment the cost is worth paying.
    if (live && live.agents.length > 0) sessionStorage.setItem(LIST_KEY, JSON.stringify(live));
  } catch {
    // Private-mode storage can throw, and a quota error on a large list must not
    // break navigation. The module copy above still covers the common path.
  }
}

export function requestMarketplaceRestore() {
  if (typeof window === "undefined") return;
  if (savedY <= 0) {
    const stored = Number(sessionStorage.getItem(SCROLL_KEY) ?? "0");
    if (Number.isFinite(stored)) savedY = stored;
  }
  pending = savedY > 0;
  // The durable copy — read back on mount even if the module was re-evaluated
  // in between. Removed when the marketplace consumes it (see below), so a
  // plain visit to "/" never inherits a stale scroll.
  try {
    if (pending) sessionStorage.setItem(RESTORE_KEY, "1");
    else sessionStorage.removeItem(RESTORE_KEY);
  } catch {
    // Module copy above still covers the common path.
  }
}

/**
 * The pending position, WITHOUT clearing it.
 *
 * Non-destructive on purpose. This gets called from a state initialiser, and
 * React Strict Mode invokes those twice — a consuming read threw the position
 * away on the first call and returned null on the second, so the restore silently
 * never happened in development. The storage flag covers a wiped module: if the
 * in-memory copy died, the position is re-read from sessionStorage.
 */
export function peekMarketplaceRestore(): number | null {
  if (typeof window !== "undefined" && !pending) {
    try {
      if (sessionStorage.getItem(RESTORE_KEY) === "1") {
        const stored = Number(sessionStorage.getItem(SCROLL_KEY) ?? "0");
        if (Number.isFinite(stored) && stored > 0) {
          savedY = stored;
          pending = true;
        }
      }
    } catch {
      // No storage, no restore.
    }
  }
  return pending && savedY > 0 ? savedY : null;
}

export function clearMarketplaceRestore() {
  pending = false;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(RESTORE_KEY);
    } catch {
      // Already gone or unavailable — either way there is nothing to restore.
    }
  }
}

/**
 * Scroll to `target` once the document is tall enough, then hold it there.
 *
 * Two separate things were undoing the restore:
 *
 *  1. Scrolling before the agent list existed. The page is barely taller than the
 *     hero at mount, so the browser CLAMPS the scroll to what is there and the
 *     reader lands at the top. Hence waiting for the height.
 *  2. Next's own scroll handling. `<Link>` defaults to `scroll: true` and resets
 *     to the top AFTER the new route's effects run, so it overwrote whatever we
 *     set. The back link now passes `scroll={false}`, and the hold loop below
 *     re-asserts the position for a few frames in case anything else resets it.
 *
 * Gives up rather than fighting a page that will never grow — a filter with two
 * results, say. ~3s of waiting at 60fps.
 */
export function scrollToWhenReady(target: number): () => void {
  if (typeof window === "undefined") return () => undefined;

  let waited = 0;
  let held = 0;
  let raf = 0;
  let reached = false;

  const furthest = () => document.documentElement.scrollHeight - window.innerHeight;

  // Try synchronously FIRST. When the list came back from a snapshot the height
  // already exists, and this runs inside a layout effect — before paint — so the
  // very first frame the reader sees is already at the right offset. Waiting for
  // requestAnimationFrame here is what left a visible flash at the top.
  if (furthest() >= target - 2) {
    window.scrollTo(0, target);
    reached = true;
  }

  const tick = () => {
    if (!reached) {
      if (furthest() >= target - 2) {
        window.scrollTo(0, target);
        reached = true;
      } else if (++waited > 180) {
        return;
      }
    } else {
      // Re-assert only if something moved us, so a user who starts scrolling
      // immediately is not yanked back.
      if (Math.abs(window.scrollY - target) > 2 && held < 6) window.scrollTo(0, target);
      if (++held > 8) return;
    }
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
