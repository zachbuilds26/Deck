import { NextRequest, NextResponse } from "next/server";

// GET /api/avatar?u=<encoded 8004scan media URL>[&fresh=1]
//
// The registry's media endpoint is a coin flip per request (200, 500,
// timeout on consecutive calls for the SAME url), and every visitor's
// browser rolling those dice independently is why avatars vanish on refresh.
// This route rolls once, server-side, and remembers: one upstream fetch fans
// out to every viewer, flakiness is absorbed by cache + a single retry, and
// repeat views never touch the upstream at all.
//
// NOT an open proxy: only https://api.8004scan.io/api/v1/media/* is fetched.
// Anything else is a 400 without a single byte leaving the building.

const ALLOWED_HOST = "api.8004scan.io";
const ALLOWED_PREFIX = "/api/v1/media/";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;
const UPSTREAM_TIMEOUT_MS = 15_000;

type CachedImage = { bytes: ArrayBuffer; contentType: string; storedAt: number };
const cache = new Map<string, CachedImage>();
const negativeCache = new Map<string, number>();
const inflight = new Map<string, Promise<CachedImage | null>>();

function remember(url: string, image: CachedImage): void {
  cache.set(url, image);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
}

async function fetchUpstream(url: string): Promise<CachedImage | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Deck/1.0", Accept: "image/*" },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (res.status >= 500) continue;
      if (!res.ok) return null;
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) return null;
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength === 0) return null;
      return { bytes, contentType, storedAt: Date.now() };
    } catch {
      // Timeout or reset — the retry above is the tolerance.
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const raw = new URL(request.url).searchParams.get("u") ?? "";
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Invalid image URL" }, { status: 400 });
  }
  if (
    target.protocol !== "https:" ||
    target.hostname !== ALLOWED_HOST ||
    !target.pathname.startsWith(ALLOWED_PREFIX) ||
    raw.length > 500
  ) {
    return NextResponse.json({ error: "Image host not allowed" }, { status: 400 });
  }

  const key = target.toString();
  if (!fresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) {
      return new NextResponse(hit.bytes, {
        headers: {
          "Content-Type": hit.contentType,
          "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        },
      });
    }
    const failedAt = negativeCache.get(key);
    if (failedAt !== undefined && Date.now() - failedAt < NEGATIVE_TTL_MS) {
      return NextResponse.json({ error: "Image unavailable" }, { status: 502 });
    }
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchUpstream(key).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, pending);
  }
  const image = await pending;
  if (!image) {
    // Failed even fresh, or failed cached path: remember the miss briefly so
    // the ~80% of registry URLs that are dead stop costing upstream reads on
    // every page view. Real images are unaffected — successes write the cache.
    negativeCache.set(key, Date.now());
    return NextResponse.json({ error: "Image unavailable" }, { status: 502 });
  }
  remember(key, image);
  negativeCache.delete(key);
  return new NextResponse(image.bytes, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
