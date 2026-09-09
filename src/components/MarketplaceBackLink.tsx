"use client";

import Link from "next/link";
import { requestMarketplaceRestore } from "@/lib/marketplace-scroll";

export default function MarketplaceBackLink() {
  return (
    <Link
      href="/"
      // scroll={false} is the whole reason this works. Next's Link defaults to
      // scroll: true and jumps to the top AFTER the destination's effects run, so
      // it silently overwrote the restored position every time.
      scroll={false}
      onClick={requestMarketplaceRestore}
      className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#999] transition-colors hover:text-white"
    >
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      Marketplace
    </Link>
  );
}
