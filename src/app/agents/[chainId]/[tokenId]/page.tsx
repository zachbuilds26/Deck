import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import type { AgentDetail, AgentFeedback } from "@/lib/types";
import AgentAvatar from "@/components/AgentAvatar";
import MarketplaceBackLink from "@/components/MarketplaceBackLink";
import CopyButton from "@/components/CopyButton";
import ExternalArrow from "@/components/ExternalArrow";
import FeedbackList from "@/components/FeedbackList";
import { displayAgentId } from "@/lib/agent-id";
import { timeAgo } from "@/lib/agent-status";
import { BSCSCAN_URL, BSC_CHAIN_ID } from "@/lib/constants";
import { getAgent as fetchAgent, getAgentFeedback, getAgentStats, ScanApiError } from "@/lib/scan8004";

const hireHref = (agentId: string) => `/hire/${agentId}`;

function HireButton({ agentId }: { agentId: string }) {
  return (
    <Link
      href={hireHref(agentId)}
      className="chamfer mt-4 inline-flex h-12 w-full items-center justify-center bg-[#F0B90B] px-6 text-[13px] font-bold text-black transition-[transform,opacity] hover:opacity-90 active:scale-[0.98]"
    >
      Hire Agent
    </Link>
  );
}

/**
 * Reads the registry directly instead of self-fetching through the API route:
 * one fewer HTTP hop, same 5-minute cache. Returns null when the id is not
 * even well-formed, so junk URLs fail fast without touching the network.
 */
async function getProfile(
  chainId: string,
  tokenId: string
): Promise<{ agent: AgentDetail } | { error: "not-found" | "unavailable" }> {
  if (!Number(chainId) || !tokenId) return { error: "not-found" };
  try {
    const agent = (await fetchAgent(Number(chainId), tokenId)) as AgentDetail;
    return { agent };
  } catch (error) {
    return { error: error instanceof ScanApiError && error.status === 404 ? "not-found" : "unavailable" };
  }
}

// Memoized per request: generateMetadata and the page below ask for the same
// profile, and without this the registry pays for it twice per pageview.
const getCachedProfile = cache(getProfile);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ chainId: string; tokenId: string }>;
}): Promise<Metadata> {
  const { chainId, tokenId } = await params;
  const result = await getCachedProfile(chainId, tokenId);
  if ("error" in result) return { title: result.error === "not-found" ? "Agent Not Found" : "Agent Temporarily Unavailable" };
  return {
    title: `${result.agent.name} · Deck`,
    description: result.agent.description,
  };
}

/**
 * Streams in after the profile paints. The feedback scan (50 records,
 * slowest upstream call on this page) used to hold the entire page hostage —
 * profile, avatar, hire button, everything waited for it. Now the page
 * sends after ONE upstream call and this fills in when it lands.
 */
async function FeedbackSection({
  chainId,
  tokenId,
  expectedCount,
}: {
  chainId: string;
  tokenId: string;
  /** The agent record's own feedback count. An empty read against a nonzero
   *  count is a suspect answer, not an empty agent. */
  expectedCount: number;
}) {
  // One retry with a breath between: this endpoint flakes, and a transient
  // failure used to land in the catch below and print "No feedback yet" for
  // an agent holding dozens of records. Failure and emptiness are different
  // facts and now get different boxes.
  // strictEmpty when the agent's own record claims feedback: an empty page is
  // then a failure to retry, never a fact to render. Genuinely empty agents
  // (count 0) take the lenient path and its honest empty box below.
  const strictEmpty = expectedCount > 0;
  let feedback: AgentFeedback[] | null = null;
  for (let attempt = 0; attempt < 2 && feedback === null; attempt += 1) {
    try {
      feedback = await getAgentFeedback(Number(chainId), displayAgentId(tokenId), {
        strictEmpty,
      });
    } catch (caught) {
      // A 429 means our own burst tripped the key's window (typically right
      // after a marketplace cold fill) — back off past it instead of failing
      // into the amber box immediately. Anything else keeps the short wait.
      const limited = caught instanceof ScanApiError && caught.status === 429;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, limited ? 8000 : 1500));
      }
    }
  }
  if (feedback === null) {
    return (
      <div className="deck-frame mt-5 border border-[#4a2f08] bg-[#100d04] px-5 py-12 text-center text-sm text-[#e8b339]">
        Feedback couldn&apos;t be loaded right now. Reload the page to try again.
      </div>
    );
  }
  if (feedback.length === 0 && expectedCount > 0) {
    // A flaky 200-with-nothing gets cached as fact for 5 minutes — the exact
    // lie behind "3 feedback" up top and "none" down here. One uncached read
    // arbitrates; if it still comes back empty, say loading failed rather
    // than claiming an agent with a nonzero count has nothing.
    const fresh = await getAgentFeedback(Number(chainId), displayAgentId(tokenId), {
      fresh: true,
      strictEmpty: true,
    }).catch(() => null);
    if (fresh && fresh.length > 0) return <FeedbackList feedback={fresh} />;
    return (
      <div className="deck-frame mt-5 border border-[#4a2f08] bg-[#100d04] px-5 py-12 text-center text-sm text-[#e8b339]">
        Feedback couldn&apos;t be loaded right now. Reload the page to try again.
      </div>
    );
  }
  if (feedback.length === 0) {
    return (
      <div className="deck-frame mt-5 border border-[#2f2f2f] bg-[#141414] px-5 py-12 text-center text-sm text-[#666]">
        No feedback yet for this agent.
      </div>
    );
  }
  return <FeedbackList feedback={feedback} />;
}

function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#F0B90B" stroke="none">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}



export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ chainId: string; tokenId: string }>;
}) {
  const { chainId, tokenId } = await params;
  // Stats ride alongside the profile: one small endpoint, no added latency,
  // and it resolves to null (never throws) when the registry has nothing.
  const [result, stats] = await Promise.all([
    getCachedProfile(chainId, tokenId),
    getAgentStats(Number(chainId), displayAgentId(tokenId)),
  ]);

  // Genuinely missing agents 404 (status, SEO, fetchers); only a sick
  // registry gets the inline "try again" page.
  if ("error" in result && result.error === "not-found") {
    notFound();
  }

  if ("error" in result) {
    return (
      <div className="mx-auto max-w-[1120px] px-5 py-24 text-center sm:px-8">
        <p className="text-[11px] font-bold uppercase text-[#666]">Registry unavailable</p>
        <h1 className="mt-3 text-3xl font-bold">Agent details are temporarily unavailable.</h1>
        <p className="mt-3 text-sm text-[#999]">
          8004scan did not return this agent. Its registry occasionally errors on individual agents — refreshing usually works.
        </p>
        <Link
          href="/"
          className="chamfer mt-7 inline-flex h-11 items-center bg-[#F0B90B] px-6 text-sm font-bold text-black transition-[transform,opacity] hover:opacity-90 active:scale-[0.98]"
        >
          Back to Marketplace
        </Link>
      </div>
    );
  }

  const { agent } = result;
  const hasScore = agent.score > 0;

  return (
    <div className="min-h-screen">
      <section className="relative isolate overflow-hidden border-b border-[#1c1c1c]">
        <div className="pixel-field -right-20 -top-12 rotate-12 opacity-40" />
        <div className="mx-auto max-w-[1120px] px-5 py-10 sm:px-8 sm:py-14">
          <MarketplaceBackLink />


          <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_270px] lg:items-end">
            <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start">
              <div className="h-20 w-20 flex-shrink-0 overflow-hidden border border-[#2f2f2f] bg-[#141414]">
                <AgentAvatar
                  src={agent.image}
                  name={agent.name}
                  identity={agent.agentId}
                  width={80}
                  height={80}
                  sizeClassName="h-full w-full object-cover"
                  fallbackClassName="flex h-full w-full items-center justify-center text-[20px]"
                  eager
                />
              </div>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-[#666]">
                  <span>
                    Agent ID: {displayAgentId(agent.agentId)} /{" "}
                    {Number(chainId) === 97 ? "BSC Testnet" : "BSC"}
                  </span>
                  <CopyButton value={displayAgentId(agent.agentId)} label="Copy agent ID" />
                </p>
                <h1 className="mt-2 break-words text-[32px] font-bold leading-tight text-[#f5f5f5] sm:text-[42px]">{agent.name}</h1>
                <p className="mt-3 max-w-2xl text-[14px] leading-6 text-[#999]">{agent.description}</p>
                {stats?.lastActive && timeAgo(stats.lastActive) && (
                  <p
                    className="mt-2 text-[11px] font-bold text-[#b5b5b5]"
                    title={
                      stats.totalChats > 0
                        ? `${stats.totalChats} chats · ${stats.totalMessages} messages on record`
                        : "Last recorded activity"
                    }
                  >
                    Active {timeAgo(stats.lastActive)}
                  </p>
                )}
                <div className="mt-5 flex flex-wrap items-center gap-3 text-[11px] font-semibold">
                  {hasScore ? (
                    <span className="flex items-center gap-1.5 text-[#d3d3d3]"><StarIcon /> {agent.score.toFixed(1)} · {agent.feedbackCount} FEEDBACK</span>
                  ) : (
                    <span className="text-[#666]">
                      UNRATED{agent.feedbackCount > 0 ? ` · ${agent.feedbackCount} FEEDBACK` : ""}
                    </span>
                  )}
                  {agent.services.map((s) => (
                    <span
                      key={s}
                      className="border border-[#2f2f2f] bg-[#141414] px-2 py-1 uppercase text-[#F0B90B]"
                    >
                      {s}
                    </span>
                  ))}
                  {!!agent.paidPayments && (
                    <span
                      title={`Took ${agent.paidPayments} real x402 payment${agent.paidPayments === 1 ? "" : "s"} on BSC — someone spent money here`}
                      className="border border-[#225d44] bg-[#10291f] px-2 py-1 uppercase text-[#33fba1]"
                    >
                      Paid onchain
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="deck-frame border border-[#2f2f2f] bg-[#141414] p-4">
              <p className="text-[10px] font-bold uppercase text-[#666]">Secure onchain engagement</p>
              <HireButton agentId={displayAgentId(agent.agentId)} />
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1120px] px-5 py-10 sm:px-8 sm:py-14">
        <div className="grid border-l border-t border-[#2f2f2f] md:grid-cols-3">
          <div className="border-b border-r border-[#2f2f2f] bg-[#141414] p-5">
            <p className="text-[10px] font-bold uppercase text-[#666]">Owner wallet</p>
            {agent.owner ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-[#d3d3d3]">
                <span className="truncate">{`${agent.owner.slice(0, 6)}…${agent.owner.slice(-4)}`}</span>
                <CopyButton value={agent.owner} label="Copy owner address" />
              </p>
            ) : (
              <p className="mt-3 text-sm text-[#d3d3d3]">Not published</p>
            )}
          </div>
          <div className="border-b border-r border-[#2f2f2f] bg-[#141414] p-5">
            <p className="text-[10px] font-bold uppercase text-[#666]">Explorers</p>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[13px] font-semibold">
              {agent.owner ? (
                <a
                  href={`${BSCSCAN_URL}/address/${agent.owner}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Owner wallet on BscScan"
                  className="inline-flex items-center gap-1.5 text-[#d3d3d3] transition-colors hover:text-[#F0B90B]"
                >
                  BscScan
                  <ExternalArrow />
                </a>
              ) : (
                <span className="text-[#555]">No wallet to inspect</span>
              )}
              {BSC_CHAIN_ID === 56 && (
                <a
                  href={`https://8004scan.io/agents/bsc/${displayAgentId(agent.agentId)}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Agent on 8004scan"
                  className="inline-flex items-center gap-1.5 text-[#d3d3d3] transition-colors hover:text-[#F0B90B]"
                >
                  8004scan
                  <ExternalArrow />
                </a>
              )}
            </p>
          </div>
          <div className="border-b border-r border-[#2f2f2f] bg-[#141414] p-5">
            <p className="text-[10px] font-bold uppercase text-[#666]">Registered</p>
            <p className="mt-3 text-sm text-[#d3d3d3]">
              {agent.registeredAt
                ? new Date(agent.registeredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : "Unknown"}
            </p>
          </div>
        </div>

        <div className="mt-14">
          <p className="text-[10px] font-bold uppercase text-[#666]">Reputation / Onchain</p>
          <h2 className="mt-2 text-[22px] font-bold">Feedback</h2>
          <Suspense
            fallback={
              <div className="deck-frame mt-5 border border-[#2f2f2f] bg-[#141414] px-5 py-12 text-center text-sm text-[#666]">
                Loading feedback…
              </div>
            }
          >
            <FeedbackSection chainId={chainId} tokenId={tokenId} expectedCount={agent.feedbackCount} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
