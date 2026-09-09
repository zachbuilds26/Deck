"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef, useSyncExternalStore } from "react";

import AgentCard from "@/components/AgentCard";
import { BrandStack } from "@/components/BrandMark";
import FilterBar from "@/components/FilterBar";
import HeroDither from "@/components/HeroDither";
import { BSC_CHAIN_ID } from "@/lib/constants";
import { isLiveAgent } from "@/lib/agent-status";
import { DECK_CHAIN } from "@/lib/chain";
import {
  avatarRank,
  avatarStatusVersion,
  serverAvatarStatusVersion,
  subscribeAvatarStatus,
} from "@/lib/avatar-status";
import {
  clearMarketplaceRestore,
  peekMarketplaceRestore,
  readMarketplaceList,
  scrollToWhenReady,
  setMarketplaceList,
} from "@/lib/marketplace-scroll";
import type { Agent } from "@/lib/types";

function agentIdentity(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*#\d+\s*$/i, "")
    .replace(/\.(?:agent|bot|ai)$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function agentContentFingerprint(agent: Agent): string {
  const description = agent.description
    .toLowerCase()
    .replace(/risk profile:\s*(?:conservative|moderate|aggressive)\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  // Mirrors the server threshold in scan8004.ts — see the note there. An exact
  // description match collapses at 24 characters, which is what catches the
  // "Purr-Fect Claw cloud instance agent" fleet.
  return description.length >= 24 ? description : "";
}

/** The four ecosystems Deck is built on, in the order they matter here — BNB
 *  Chain leads because everything else sits on it. */
const TRACK_LOGOS = ["bnb", "termix", "pancakeswap", "altana"] as const;

/** Layout effects run after the DOM is committed but BEFORE paint, which is the
 *  only place a scroll restore can happen without the reader seeing one frame at
 *  the top. It does not exist on the server, so fall back there. */
const useRestoreEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function HomePage() {
  /** Pending restore, resolved once before the first paint.
   *
   *  `snapshot` is the list as the reader last saw it (see marketplace-scroll:
   *  module reference first, sessionStorage fallback). With it, the list is on
   *  screen in the first frame and the saved offset is immediately reachable —
   *  which is what stops the hero and a spinner sitting there for the length of a
   *  refetch. Without it, `scrollToWhenReady` waits for the height instead. */
  const [restore] = useState(() => {
    if (typeof window === "undefined") return null;
    const target = peekMarketplaceRestore();
    if (target === null) return null;
    return { target, snapshot: readMarketplaceList() };
  });
  const cached = restore?.snapshot ?? null;

  const [agents, setAgents] = useState<Agent[]>(cached?.agents ?? []);
  const [loading, setLoading] = useState(!cached);
  // Separate from `loading` so an infinite-scroll page append does not dim the
  // whole list. `refreshing` is only true while a filter/search swap is in flight.
  const [refreshing, setRefreshing] = useState(!cached);
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? true);
  const [category, setCategory] = useState(cached?.category ?? "all");
  const [searchQuery, setSearchQuery] = useState(cached?.searchQuery ?? "");
  const [sortBy, setSortBy] = useState(cached?.sortBy ?? "default");
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Set when the agents on screen came from the committed snapshot rather than
   *  the live registry. Shown, never hidden — cached data presented as current is
   *  worse than an honest outage notice. */
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  // Re-render when an avatar reports in, so the sort below picks it up.
  useSyncExternalStore(subscribeAvatarStatus, avatarStatusVersion, serverAvatarStatusVersion);
  const requestVersion = useRef(0);
  const loadingRef = useRef(false);
  /** Set when the list came back from the snapshot, so the mount effect does not
   *  immediately refetch and blank what it just restored. */
  const skipNextFetch = useRef(Boolean(cached));
  // A ref, not state: the page number is never rendered, and setState here would
  // fire inside the reset effect below (react-hooks/set-state-in-effect).
  const pageRef = useRef(1);

  const fetchAgents = useCallback(
    async (
      pageNum: number,
      reset: boolean,
      version: number,
      signal?: AbortSignal
    ) => {
      if (!reset && loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      if (reset) {
        setRefreshing(true);
        setLoadError(null);
      }
      try {
        const params = new URLSearchParams({
          limit: "20",
          page: String(pageNum),
          chainId: String(BSC_CHAIN_ID),
        });
        params.set("category", category);
        if (searchQuery.trim()) params.set("q", searchQuery.trim());

        const res = await fetch(`/api/agents?${params}`, { signal });
        const data = await res.json();
        if (version !== requestVersion.current) return;

        if (!res.ok) {
          setHasMore(false);
          setLoadError(
            data?.error || "Could not load agents from the registry. Please try again."
          );
          return;
        }

        const newAgents = data.data || [];
        setAgents((prev) => {
          const next = reset ? newAgents : [...prev, ...newAgents];
          const unique = new Map<string, Agent>();
          const contentFingerprints = new Set<string>();
          next.forEach((agent: Agent) => {
            const identity = agentIdentity(agent.name) || agent.agentId;
            const contentFingerprint = agentContentFingerprint(agent);
            if (
              !unique.has(identity) &&
              (!contentFingerprint || !contentFingerprints.has(contentFingerprint))
            ) {
              unique.set(identity, agent);
              if (contentFingerprint) contentFingerprints.add(contentFingerprint);
            }
          });
          return Array.from(unique.values());
        });
        setHasMore(searchQuery.trim() ? false : (data.pagination?.hasMore ?? false));
        // Present only when the registry was unreachable and the API served its
        // committed snapshot. Recorded so the page can say so.
        setSnapshotAt(data.snapshot?.capturedAt ?? null);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setHasMore(false);
          setLoadError("Could not reach the agent registry. Please try again.");
        }
      } finally {
        if (version === requestVersion.current) {
          loadingRef.current = false;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [category, searchQuery]
  );

  useEffect(() => {
    // The list was handed back from the snapshot, already matching these filters.
    // Refetching here would blank it and undo the restore we are about to do.
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }

    const controller = new AbortController();
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    loadingRef.current = false;
    pageRef.current = 1;
    const timer = window.setTimeout(
      () => fetchAgents(1, true, version, controller.signal),
      searchQuery.trim() ? 280 : 0
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [category, searchQuery, fetchAgents]);

  // Put the reader back where they were. Runs once, and only when a restore was
  // actually requested — `scrollToWhenReady` waits for the document to be tall
  // enough rather than scrolling into a page that has not rendered yet.
  // The flag is consumed on EVERY mount, restore or not: a back-click whose
  // navigation never landed would otherwise scroll a later plain visit to a
  // stale position.
  useRestoreEffect(() => {
    clearMarketplaceRestore();
    if (!restore) return;
    return scrollToWhenReady(restore.target);
  }, [restore]);

  // Keep the live list current so a card click can snapshot it. pageRef is read
  // here rather than tracked as state because it only matters at restore time.
  useEffect(() => {
    setMarketplaceList({
      agents,
      category,
      searchQuery,
      sortBy,
      hasMore,
      page: pageRef.current,
    });
  }, [agents, category, searchQuery, sortBy, hasMore]);

  useEffect(() => {
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >=
        document.body.offsetHeight - 500
      ) {
        if (!loading && hasMore) {
          const next = pageRef.current + 1;
          pageRef.current = next;
          fetchAgents(next, false, requestVersion.current);
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [loading, hasMore, fetchAgents]);

  const retryLoad = useCallback(() => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    loadingRef.current = false;
    pageRef.current = 1;
    setHasMore(true);
    fetchAgents(1, true, version);
  }, [fetchAgents]);

  const displayed = [...agents];

  // An explicit sort wins outright — no liveness or picture pass on top of it.
  // Those passes re-sorted everything afterward, which is what buried paid
  // agents under the live block when "Paid First" was picked. Default keeps
  // the full curation: live first, then picture verdicts.
  if (sortBy === "paid") {
    // Stable: the unpaid hold the server's evidence order below the paid.
    displayed.sort((a, b) => (b.paidPayments ?? 0) - (a.paidPayments ?? 0));
  } else if (sortBy === "score") {
    // Name breaks ties, so equals never flip order between refills — Ave.ai
    // (A) holds ahead of Buyback (B) at 4.0 regardless of scan luck.
    displayed.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  } else if (sortBy === "feedback") {
    displayed.sort((a, b) => b.feedbackCount - a.feedbackCount || a.name.localeCompare(b.name));
  } else if (sortBy === "newest") {
    displayed.sort(
      (a, b) => (Date.parse(b.registeredAt || "") || 0) - (Date.parse(a.registeredAt || "") || 0)
    );
  } else {

    // Live agents first — the marketplace leads with what can execute right
    // now — then, inside each group, agents whose picture actually rendered,
    // then the not-yet-known, then the ones confirmed broken. Both are STABLE
    // sorts, so the evidence order the server produced survives inside every
    // group: among the live, paid and rated still lead.
    //
    // The verdicts come from the browser (lib/avatar-status.ts), which is the only
    // thing that knows: `agent.image` is a URL the registry hands out for every
    // agent whether or not an image exists behind it. Reading the store through
    // useSyncExternalStore means the list re-sorts as the first screen's images
    // settle, and on every later visit the answers are already cached so the order
    // is right from the first paint.
    displayed.sort(
      (a, b) =>
        Number(isLiveAgent(b)) - Number(isLiveAgent(a)) ||
        avatarRank(a.agentId) - avatarRank(b.agentId)
    );
  }

  // Sorts double as filters: picking one shows only agents that qualify —
  // paid means paid, rated means rated, feedback means feedback. Newest is
  // pure order (every agent has a registration date). Default shows everything.
  const visible =
    sortBy === "paid"
      ? displayed.filter((a) => (a.paidPayments ?? 0) > 0)
      : sortBy === "score"
        ? displayed.filter((a) => a.score > 0)
        : sortBy === "feedback"
          ? displayed.filter((a) => a.feedbackCount > 0)
          : displayed;

  return (
    <div className="min-h-screen">
      <section className="relative isolate -mt-[72px] overflow-hidden pt-[72px]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
          <HeroDither />
          <div className="absolute inset-0 bg-[radial-gradient(62%_48%_at_50%_72%,rgba(240,185,11,0.26),transparent_68%)] mix-blend-screen" />
          <div className="absolute inset-0 bg-[radial-gradient(70%_58%_at_50%_30%,#000_0%,rgba(0,0,0,0.84)_43%,transparent_76%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />
        </div>
        {/* Full viewport height so the filter bar sits below the fold — the
            filters only appear once you scroll into the agent list. */}
        {/* Heavier bottom padding lifts the optical center toward the header. */}
        <div className="relative z-10 mx-auto flex min-h-[calc(100svh-72px)] max-w-[1440px] flex-col justify-center px-5 pb-28 pt-16 text-center sm:px-8 lg:px-12">
          <div className="mb-5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-2">
            <BrandStack ids={TRACK_LOGOS} size={22} priority />
            {/* leading-none, or the 11px text carries half a line of slack above
                and below its glyphs and `items-center` centres that slack rather
                than the letters — which reads as the caps sitting low next to the
                badges. Uppercase has no descenders, so the box and the glyphs
                only agree once the line box is collapsed. */}
            <p className="text-[11px] font-bold uppercase leading-none text-[#999]">
              BNB Chain / Agent Marketplace
            </p>
          </div>
          <h1 className="mx-auto max-w-4xl text-[34px] font-bold leading-[1.12] text-[#f5f5f5] sm:text-[48px] lg:text-[56px]">
            Find the agent for the job.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[13px] leading-6 text-[#d3d3d3] sm:text-[15px]">
            Discover, compare, and hire onchain AI agents with verifiable track records.
          </p>
          <div className="mt-8 flex items-center justify-center">
            <a
              href="#agents"
              className="chamfer group inline-flex items-center gap-2 bg-[#F0B90B] px-6 py-3 text-[13px] font-bold text-black transition-[transform,opacity] hover:opacity-90 active:scale-[0.98]"
            >
              Explore Agents
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-y-0.5"
              >
                <path
                  d="M8 3.4v9.2M4.3 8.9 8 12.6l3.7-3.7"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          </div>
        </div>
      </section>

      <FilterBar
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        activeCategory={category}
        onCategoryChange={(nextCategory) => {
          pageRef.current = 1;
          setCategory(nextCategory);
        }}
        sortBy={sortBy}
        onSortChange={setSortBy}
      />

      <section id="agents" className="mx-auto max-w-[1440px] px-5 py-10 sm:px-8 lg:px-12">
        {/* Said plainly rather than tucked away. The registry is unreliable enough
            that a visitor will meet this, and cached agents presented as current
            would be the one thing worse than the outage. */}
        {snapshotAt && (
          <div className="deck-frame mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 border border-[#3a2f08] bg-[#100d04] px-4 py-3">
            <p className="text-[10px] font-bold uppercase leading-none text-[#e8b339]">
              Registry unreachable — showing cached agents
            </p>
            <p className="text-[11px] leading-none text-[#8a7a52]">
              Captured {new Date(snapshotAt).toLocaleString()}. These were live on BNB Smart Chain
              then; ratings and status may have moved since.
            </p>
          </div>
        )}

        <div className="mb-7 flex items-end justify-between gap-5">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#666]">
              Registry / {DECK_CHAIN.testnet ? "BSC Testnet" : "BSC"}
            </p>
            <h2 className="mt-2 text-[22px] font-bold text-[#f5f5f5]">Available agents</h2>
          </div>
          {/* Static: the middle of the page already carries the loading state,
              so this never swaps to a spinner. */}
          <p className="hidden items-center gap-2 text-[11px] text-[#666] sm:flex">
            LIVE ENDPOINT REQUIRED
          </p>
        </div>
        {loading && visible.length === 0 ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-4">
            <div className="h-5 w-5 animate-spin border-2 border-[#2f2f2f] border-t-[#F0B90B]" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#666]">
              Loading agents…
            </p>
          </div>
        ) : loadError && visible.length === 0 ? (
          <div
            role="alert"
            className="deck-frame border border-[#2f2f2f] bg-[#141414] px-6 py-16 text-center"
          >
            <svg
              aria-hidden="true"
              className="mx-auto text-[#8f8f8f]"
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" />
              <path d="M12 9.5v4" />
              <path d="M12 16.6h.01" />
            </svg>
            <p className="mt-5 text-sm text-[#d3d3d3]">{loadError}</p>
            <button
              onClick={retryLoad}
              className="mt-6 h-10 border border-[#3c3c3c] px-5 text-[12px] font-semibold text-[#f5f5f5] transition-colors hover:border-[#666] hover:bg-[#1b1b1b]"
            >
              Try again
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="deck-frame border border-[#2f2f2f] bg-[#141414] px-6 py-20 text-center">
            <p className="text-sm text-[#999]">No agents found.</p>
            <p className="mx-auto mt-2 max-w-md text-[12px] leading-5 text-[#666]">
              {searchQuery.trim()
                ? "Nothing matches that search — try fewer words or browse everything."
                : "This filter has nothing to show right now."}
            </p>
            <button
              type="button"
              onClick={() => {
                pageRef.current = 1;
                setSearchQuery("");
                setCategory("all");
                setSortBy("default");
              }}
              className="mt-6 h-10 border border-[#3c3c3c] px-5 text-[12px] font-semibold text-[#f5f5f5] transition-colors hover:border-[#666] hover:bg-[#1b1b1b]"
            >
              Clear search &amp; filters
            </button>
          </div>
        ) : (
          // content-start: without it a short list (2 search hits, 3 paid)
          // stretches its cards to fill the min-height. Rows pack at the top.
          <div
            aria-busy={refreshing}
            className={`grid min-h-[420px] content-start gap-2 transition-opacity duration-150 ${
              refreshing ? "pointer-events-none opacity-30" : "opacity-100"
            }`}
          >
            {visible.map((agent) => (
              <AgentCard
                key={`${agent.chainId}-${agent.agentId}`}
                agent={agent}
              />
            ))}
          </div>
        )}

        {/* Pagination only. A reset shows its spinner in the header row instead, so
            switching filters cannot add height at the bottom of the page. */}
        {loading && !refreshing && (
          <div className="flex justify-center py-10">
            <div className="h-5 w-5 animate-spin border-2 border-[#2f2f2f] border-t-[#F0B90B]" />
          </div>
        )}

        {loadError && visible.length > 0 && !loading && (
          <div className="flex flex-col items-center gap-3 py-10">
            <p className="text-[12px] text-[#8f8f8f]">{loadError}</p>
            <button
              onClick={retryLoad}
              className="h-10 border border-[#3c3c3c] px-5 text-[12px] font-semibold text-[#f5f5f5] transition-colors hover:border-[#666] hover:bg-[#1b1b1b]"
            >
              Try again
            </button>
          </div>
        )}

        {!hasMore && !loadError && visible.length > 0 && (
          <p className="py-10 text-center text-[11px] font-semibold text-[#666]">
            END OF RESULTS
          </p>
        )}
      </section>
    </div>
  );
}
