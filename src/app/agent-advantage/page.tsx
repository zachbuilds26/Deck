"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BrandMark from "@/components/BrandMark";
import ExternalArrow from "@/components/ExternalArrow";
import type { AdvantageReport } from "@/lib/types";

/** Receipts live on different explorers per chain — the report says which. */
function explorerTxUrl(chainId: number, txHash: string): string {
  const base = chainId === 97 ? "https://testnet.bscscan.com" : "https://bscscan.com";
  return `${base}/tx/${txHash}`;
}

type AdvantageResponse = {
  data?: AdvantageReport[];
  message?: string;
  error?: string;
};

function TaskComparison({ report }: { report: AdvantageReport }) {
  return (
    <article className="deck-frame border border-[#2f2f2f] bg-[#141414] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#2f2f2f] pb-5">
        <div>
          <p className="text-[10px] font-bold uppercase text-[#666]">Verified agent outcome</p>
          <h2 className="mt-2 text-xl font-bold text-[#f5f5f5]">{report.agentName}</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 border border-[#225d44] bg-[#10291f] px-2 py-1 text-[9px] font-bold uppercase text-[#33fba1]">
          <BrandMark id="bnb" size={12} label={false} />
          {report.chainId === 97 ? "Settled on BSC Testnet" : "Settled on BSC"}
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-bold uppercase text-[#666]">Avg. time saved</p>
          <p className="mt-2 text-lg font-bold text-[#F0B90B]">{report.summary.avgTimeSaved}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase text-[#666]">Avg. cost saved</p>
          <p className="mt-2 text-lg font-bold text-[#F0B90B]">{report.summary.avgCostSaved}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase text-[#666]">Success rate</p>
          <p className="mt-2 text-lg font-bold text-[#F0B90B]">{report.summary.successRate}</p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto border border-[#2f2f2f]">
        <div className="min-w-[610px]">
          <div className="grid grid-cols-[1.4fr_1fr_1fr] border-b border-[#2f2f2f] bg-[#0d0d0d] px-4 py-3 text-[10px] font-bold uppercase text-[#666]">
            <span>Task</span><span>Manual</span><span>Agent</span>
          </div>
          {report.tasks.map((task, index) => (
            <div key={`${task.description}-${index}`} className="grid grid-cols-[1.4fr_1fr_1fr] border-b border-[#2f2f2f] px-4 py-4 last:border-b-0">
              <div className="pr-4">
                <p className="text-xs font-semibold text-[#f5f5f5]">{task.description}</p>
                <p className="mt-1 text-[10px] uppercase text-[#666]">{task.category}</p>
              </div>
              <div className="text-[11px] leading-5 text-[#999]">
                <p>{task.manual.time}</p><p>{task.manual.cost}</p><p>{task.manual.quality}</p>
              </div>
              <div className="text-[11px] leading-5 text-[#d3d3d3]">
                <p>{task.agent.time}</p><p>{task.agent.cost}</p><p>{task.agent.quality}</p>
                <p>
                  <a
                    href={explorerTxUrl(report.chainId, task.agent.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-bold text-[#33fba1] underline underline-offset-4"
                  >
                    Receipt
                    <ExternalArrow />
                  </a>
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

export default function AgentAdvantagePage() {
  // null until the first fetch lands: an empty box must mean "none", never
  // "still loading" flashing on every visit.
  const [reports, setReports] = useState<AdvantageReport[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/advantage", { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as AdvantageResponse;
        if (!response.ok) throw new Error(payload.error || "Unable to load reports");
        setReports(payload.data || []);
      })
      .catch(() => {
        // Empty box below covers failure too — with zero reports there is
        // nothing to distinguish, and the CTA is the right answer either way.
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="min-h-screen">
      {/* No border-b: content sits directly under the hero copy, same as /sessions. */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden="true" className="pixel-field -right-16 -top-10 rotate-12 opacity-40" />
        <div className="mx-auto max-w-[1120px] px-5 pb-0 pt-16 sm:px-8 sm:pb-0 sm:pt-24 lg:px-12">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase leading-none text-[#F0B90B]">
            <BrandMark id="termix" size={17} label={false} />
            TermiX / Agent Advantage
          </p>
          <h1 className="mt-5 max-w-3xl text-[38px] font-bold leading-[1.08] text-[#f5f5f5] sm:whitespace-nowrap sm:text-[54px]">
            Agent Advantage reports.
          </h1>
          <p className="mt-6 max-w-2xl text-[14px] leading-7 text-[#999] sm:text-[15px]">
            Deck compares completed agent jobs with the equivalent manual workflow. Every report is tied to a settled ERC-8183 engagement on BNB Smart Chain.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1120px] px-5 pb-12 pt-2 sm:px-8 sm:pb-16 sm:pt-2 lg:px-12">
        <div className="mt-4 grid gap-4">
          {(reports ?? []).map((report) => <TaskComparison key={report.agentId} report={report} />)}
          {reports === null && (
            <div className="deck-frame border border-[#2f2f2f] bg-[#141414] px-6 py-14 text-center">
              <p className="animate-pulse text-[10px] font-bold uppercase text-[#666]">
                Loading reports…
              </p>
            </div>
          )}
          {reports !== null && reports.length === 0 && (
            <div className="deck-frame border border-[#2f2f2f] bg-[#141414] px-6 py-14 text-center">
              <h3 className="text-xl font-bold text-[#f5f5f5]">No verified comparisons yet.</h3>
              <p className="mx-auto mt-3 max-w-xl text-[13px] leading-6 text-[#999]">
                Complete three jobs — including one trading, equities, or security
                task — and the proof writes itself here.
              </p>
              <Link
                href="/"
                className="chamfer mt-7 inline-flex h-11 items-center bg-[#F0B90B] px-6 text-[12px] font-bold text-black transition-[transform,opacity] hover:opacity-90 active:scale-[0.98]"
              >
                Browse agents to hire
              </Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
