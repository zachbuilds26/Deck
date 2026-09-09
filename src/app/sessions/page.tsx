import type { Metadata } from "next";
import BrandMark from "@/components/BrandMark";
import SessionsList from "@/components/SessionsList";

export const metadata: Metadata = {
  title: "Agent permissions · Deck",
  description:
    "See exactly what each agent you hired may spend and call, and revoke it in one transaction.",
};

export default function SessionsPage() {
  return (
    <div className="min-h-screen">
      {/* No border-b: the empty state sits directly under the hero copy with
          nothing drawn between them. */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden="true" className="pixel-field -right-16 -top-10 rotate-12 opacity-40" />
        <div className="mx-auto max-w-[1120px] px-5 pb-0 pt-12 sm:px-8 sm:pt-16 lg:px-12">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase leading-none text-[#F0B90B]">
            {/* label={false} throughout this page: the text beside each mark
                already says "Altana", and a duplicate alt makes a screen reader
                announce the brand twice in a row. */}
            <BrandMark id="altana" size={17} label={false} />
            Altana Keystore / Onchain
          </p>
          <h1 className="mt-5 max-w-3xl text-[38px] font-bold leading-[1.08] text-[#f5f5f5] sm:text-[54px]">
            Granted permissions.
          </h1>
          <p className="mt-6 max-w-2xl text-[14px] leading-7 text-[#999] sm:text-[15px]">
            Scoped session keys cap what hired agents may spend and touch — verified
            onchain, revocable in one transaction.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1120px] px-5 pb-12 pt-2 sm:px-8 sm:pb-16 sm:pt-2 lg:px-12">
        <SessionsList />
      </section>
    </div>
  );
}
