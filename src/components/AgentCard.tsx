"use client";

import Link from "next/link";
import type { Agent } from "@/lib/types";
import { displayAgentId } from "@/lib/agent-id";
import { endpointStatus } from "@/lib/agent-status";
import { saveMarketplaceScroll } from "@/lib/marketplace-scroll";
import AgentAvatar from "@/components/AgentAvatar";

export default function AgentCard({ agent }: { agent: Agent }) {
  const primaryService = agent.services.find((service) =>
    ["MCP", "A2A", "X402"].includes(service)
  );
  const hasRating = agent.score > 0;
  const status = endpointStatus(agent);
  const paidTitle = agent.paidPayments
    ? `Took ${agent.paidPayments} real x402 payment${agent.paidPayments === 1 ? "" : "s"} on BSC — someone spent money here`
    : undefined;

  // Fixed height: every card identical, paid badge or not. The meta row is
  // nowrap + clipped by the overflow above, so taller content can never
  // stretch one card (and its avatar) past the rest.
  // Bare token id in the URL — the composite form (56:0xregistry:675) addresses
  // the same agent but produced a second, confusing URL for every profile.
  return (
    <Link
      href={`/agents/${agent.chainId}/${displayAgentId(agent.agentId)}`}
      onClick={saveMarketplaceScroll}
      className="deck-frame group flex h-[132px] items-stretch overflow-hidden rounded-[6px] border border-[#262626] bg-[#181818] text-left outline-none transition-colors hover:border-[#3c3c3c] hover:bg-[#1b1b1b] focus-visible:outline-none"
    >
      <div className="flex w-[126px] flex-shrink-0 items-stretch bg-[#1d2127]">
        <AgentAvatar
          src={agent.image}
          name={agent.name}
          identity={agent.agentId}
          width={126}
          height={132}
          sizeClassName="h-full w-full object-cover"
          fallbackClassName="flex h-full w-full items-center justify-center text-[26px]"
        />
      </div>

      <div className="min-w-0 flex-1 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[18px] font-semibold leading-none text-[#f5f5f5]">
            {agent.name}
          </h3>
          <span
            title={status.title}
            className={`flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${status.text}`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            <span className="sr-only sm:not-sr-only">{status.label}</span>
          </span>
        </div>
        <p className="mt-2 min-h-[40px] max-w-[760px] text-[12px] leading-5 text-[#8f8f8f] line-clamp-2">
          {agent.description || "No description available for this agent."}
        </p>

        {/* One line everywhere. Mobile runs smaller with the short "Paid" label
            so rating, feedback, proof and ID share the row like before. */}
        <div className="mt-3 flex flex-nowrap items-center gap-1.5 overflow-hidden text-[9px] font-semibold text-[#d8d8d8] sm:gap-3 sm:text-[11px]">
          {hasRating ? (
            <span
              className="shrink-0 whitespace-nowrap text-[#F0B90B]"
              aria-label={`${agent.score.toFixed(1)} out of 5 stars`}
            >
              <span aria-hidden="true">★</span> {agent.score.toFixed(1)}
            </span>
          ) : (
            <span className="shrink-0 whitespace-nowrap text-[#777]">Unrated</span>
          )}
          <span className="h-3 w-px shrink-0 bg-[#3b3b3b] sm:h-4" />
          <span className="shrink-0 whitespace-nowrap">{agent.feedbackCount} feedback</span>
          {!!agent.paidPayments && (
            <>
              <span className="h-3 w-px shrink-0 bg-[#3b3b3b] sm:h-4" />
              <span title={paidTitle} className="shrink-0 whitespace-nowrap text-[#33fba1] sm:hidden">
                Paid
              </span>
              <span title={paidTitle} className="hidden shrink-0 whitespace-nowrap text-[#33fba1] sm:inline">
                Paid onchain
              </span>
            </>
          )}
          <span className="h-3 w-px shrink-0 bg-[#3b3b3b] sm:h-4" />
          <span
            title={`Agent ID ${agent.agentId}`}
            className="shrink-0 whitespace-nowrap"
          >
            Agent ID: {displayAgentId(agent.agentId)}
          </span>
        </div>
      </div>

      <div className="flex flex-shrink-0 flex-col items-end gap-2 px-4 py-3.5 sm:w-[118px] sm:px-5">
        {primaryService ? (
          <span className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#F0B90B]">
            {primaryService}
          </span>
        ) : (
          <span className="mt-1 text-[11px] font-semibold text-[#777]">Available</span>
        )}

        {agent.x402Supported && primaryService !== "X402" && (
          <span
            title="Pay this agent per call using the x402 standard"
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#9d9d9d]"
          >
            <svg
              aria-hidden="true"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2.5" y="6" width="19" height="12.5" rx="1.5" />
              <path d="M2.5 10.5h19" />
            </svg>
            x402
          </span>
        )}


      </div>
    </Link>
  );
}
