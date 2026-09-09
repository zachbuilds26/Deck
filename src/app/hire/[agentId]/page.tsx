import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { AgentDetail } from "@/lib/types";
import HireAgentPanel from "@/components/HireAgentPanel";
import AgentAvatar from "@/components/AgentAvatar";
import BrandMark from "@/components/BrandMark";
import { displayAgentId } from "@/lib/agent-id";
import { BSC_CHAIN_ID } from "@/lib/constants";
import { getAgent as fetchAgent } from "@/lib/scan8004";

/**
 * Reads the registry directly — the old self-fetch through NEXT_PUBLIC_APP_URL
 * broke in production whenever the env was unset, added a network hop, and
 * cached a money page off its own API. Same pattern as the agent detail page.
 */
async function getAgent(agentId: string): Promise<{ agent: AgentDetail } | null> {
  try {
    const agent = (await fetchAgent(BSC_CHAIN_ID, agentId)) as AgentDetail;
    return { agent };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ agentId: string }> }): Promise<Metadata> {
  const { agentId } = await params;
  const result = await getAgent(agentId);
  if (!result) return { title: "Hire Agent · Deck" };
  return { title: `Hire ${result.agent.name} · Deck`, description: result.agent.description };
}

export default async function HireAgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const result = await getAgent(agentId);
  if (!result) notFound();

  const { agent } = result;

  return (
    <div className="min-h-screen">
      {/* Hero band at 1120px with a bottom rule — the same shape /sessions,
          /agent-advantage and /defi/pancakeswap use. The page used to be a
          centred 760px column, which left the panel's 320px sidebar with a ~360px
          form column: a job brief typed into a box narrower than a phone. */}
      <section className="border-b border-[#1c1c1c]">
        <div className="mx-auto max-w-[1120px] px-5 py-8 sm:px-8 sm:py-10 lg:px-12">
          <Link
            href={`/agents/${agent.chainId}/${displayAgentId(agent.agentId)}`}
            className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#999] transition-colors hover:text-white"
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back to agent
          </Link>

          <p className="mt-7 flex items-center gap-2 text-[11px] font-bold uppercase leading-none text-[#F0B90B]">
            <BrandMark id="bnb" size={16} label={false} />
            Hire / ERC-8183 escrow
          </p>
          <h1 className="mt-4 text-[30px] font-bold leading-[1.1] text-[#f5f5f5] sm:text-[40px]">
            Hire {agent.name}
          </h1>

          <div className="mt-7 flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-5">
            <div className="deck-frame h-14 w-14 flex-shrink-0 overflow-hidden border border-[#2f2f2f] bg-[#141414]">
              <AgentAvatar
                src={agent.image}
                name={agent.name}
                identity={agent.agentId}
                width={56}
                height={56}
                sizeClassName="h-full w-full object-cover"
                fallbackClassName="flex h-full w-full items-center justify-center text-[15px]"
              />
            </div>
            <p className="max-w-2xl text-[13px] leading-6 text-[#999]">{agent.description}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1120px] px-5 py-8 sm:px-8 sm:py-10 lg:px-12">
        <HireAgentPanel agent={agent} />
      </section>
    </div>
  );
}
