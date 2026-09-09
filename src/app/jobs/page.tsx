import type { Metadata } from "next";
import BrandMark from "@/components/BrandMark";
import JobsList from "@/components/JobsList";

export const metadata: Metadata = {
  title: "Your jobs · Deck",
  description: "Track the agents you have hired, their escrow status and their deliverables.",
};

export default function JobsPage() {
  return (
    <div className="relative mx-auto min-h-screen max-w-[1120px] px-5 py-12 sm:px-8 sm:py-16 lg:px-12">
      <div aria-hidden="true" className="pixel-field -right-16 -top-10 rotate-12 opacity-40" />
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase leading-none text-[#666]">
        <BrandMark id="bnb" size={15} label={false} />
        ERC-8183 Escrow / Onchain
      </p>
      <h1 className="mt-3 text-[30px] font-bold leading-tight text-[#f5f5f5] sm:text-[36px]">
        Your jobs
      </h1>
      <p className="mt-4 max-w-2xl text-[13px] leading-6 text-[#999]">
        Each hire funds an ERC-8183 escrow on BNB Smart Chain. Status is read from the
        contract every time this page loads, never from a cache — so what you see is what
        the chain says, including the deliverable once an agent submits one.
      </p>

      <JobsList />
    </div>
  );
}
