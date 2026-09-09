"use client";

/**
 * Which agents actually have a picture, learned from the browser.
 *
 * Ordering by whether `agent.image` is set does not work: 8004scan hands out
 * `/media/agents/56/{id}/image` for every agent whether or not anything is stored
 * there, so nearly every agent "has an avatar" and most of those URLs return
 * nothing.
 *
 * Probing them server-side did not work either, for two measured reasons — their
 * media endpoint returned 500, 200, 200, timeout, 200, 500 for the SAME url on six
 * consecutive calls, and 40 parallel probes per page load contended with the
 * browser's own image requests against a 180/minute ceiling, which broke avatars
 * that had been fine.
 *
 * So ask the only client that knows for certain: the browser, which is loading
 * these images anyway. Every <img> reports whether it rendered, the verdict is
 * remembered, and the next render orders by it. Zero extra requests, and the
 * answer is the actual paint result rather than a guess about a flaky endpoint.
 */
const KEY = "deck-avatar-status";

type Verdict = "ok" | "failed";

const verdicts = new Map<string, Verdict>();
const listeners = new Set<() => void>();
/** Bumped on every change so useSyncExternalStore sees a new snapshot. */
let version = 0;
let loaded = false;
let flushTimer: number | null = null;

function hydrate() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    for (const [id, verdict] of Object.entries(JSON.parse(raw) as Record<string, Verdict>)) {
      if (verdict === "ok" || verdict === "failed") verdicts.set(id, verdict);
    }
  } catch {
    // A corrupt entry is not worth failing a render over.
  }
}

/** Batched, and only ever writes the PROVEN entries — see markAvatar. A first
 *  paint can settle a hundred images at once, and writing per image would
 *  serialise the whole map a hundred times. */
function scheduleFlush() {
  if (typeof window === "undefined" || flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    try {
      const proven: Record<string, Verdict> = {};
      for (const [id, verdict] of verdicts) {
        if (verdict === "ok") proven[id] = verdict;
      }
      sessionStorage.setItem(KEY, JSON.stringify(proven));
    } catch {
      // Private mode, or quota. The in-memory map still works for this session.
    }
  }, 400);
}

export function markAvatar(id: string, ok: boolean) {
  if (!id) return;
  hydrate();

  // A successful load is PROOF an image exists. A failure is not proof of the
  // opposite: their media endpoint returned 500, 200, 200, timeout, 200, 500 for
  // the same URL on six consecutive calls, so any given failure may just be the
  // outage. Treating the two symmetrically meant one unlucky refresh recorded
  // `failed`, persisted it, and permanently demoted an agent that does have a
  // picture — which is exactly the "it was showing, now it isn't" behaviour.
  //
  // So `ok` wins once and sticks; `failed` never overwrites it, and never reaches
  // storage. Ordering can only improve as the session goes on.
  if (verdicts.get(id) === "ok") return;

  const next: Verdict = ok ? "ok" : "failed";
  if (verdicts.get(id) === next) return;
  verdicts.set(id, next);
  version += 1;
  if (ok) scheduleFlush();
  for (const listener of listeners) listener();
}

/** 0 = has a picture, 1 = not yet known, 2 = confirmed broken.
 *
 *  Unknown sits in the middle on purpose. An agent nobody has rendered yet should
 *  not be punished like one that has been proven pictureless. */
export function avatarRank(id: string): number {
  hydrate();
  const verdict = verdicts.get(id);
  if (verdict === "ok") return 0;
  if (verdict === "failed") return 2;
  return 1;
}

export function subscribeAvatarStatus(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function avatarStatusVersion(): number {
  return version;
}

export function serverAvatarStatusVersion(): number {
  return 0;
}
