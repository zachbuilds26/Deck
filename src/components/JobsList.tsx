"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import ExternalArrow from "@/components/ExternalArrow";
import { formatEther } from "viem";
import { BSCSCAN_URL } from "@/lib/constants";
import { BSC_CHAIN_ID } from "@/lib/constants";
import { getJobsSnapshot, subscribeJobs, NO_JOBS, type StoredJob } from "@/lib/job-store";
import {
  getConnectedWallet,
  subscribeConnectedWallet,
  type ConnectedWallet,
} from "@/lib/wallet-store";
import type { JobStatus } from "@/lib/types";

const STATUS_STYLES: Record<string, { dot: string; text: string }> = {
  OPEN: { dot: "bg-[#4a4a4a]", text: "text-[#9d9d9d]" },
  FUNDED: { dot: "bg-[#F0B90B]", text: "text-[#e8b339]" },
  SUBMITTED: { dot: "bg-[#5b9dd9]", text: "text-[#9cc4e4]" },
  COMPLETED: { dot: "bg-[#33fba1]", text: "text-[#8fdcb8]" },
  REJECTED: { dot: "bg-[#e5484d]", text: "text-[#c98b8d]" },
  EXPIRED: { dot: "bg-[#4a4a4a]", text: "text-[#7c7c7c]" },
};

type ChainState = {
  status?: JobStatus;
  deliverableUrl?: string;
  error?: string;
};

const SUBMITTED_KEY = "deck-advantage-submitted";

/** Job ids already sent to /api/advantage. A failed POST stays unmarked, so
 *  the next visit retries it. */
function isComparisonSubmitted(jobId: string): boolean {
  try {
    const raw = window.localStorage.getItem(SUBMITTED_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return ids.includes(jobId);
  } catch {
    return false;
  }
}

function markComparisonSubmitted(jobId: string): void {
  try {
    const raw = window.localStorage.getItem(SUBMITTED_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    if (!ids.includes(jobId)) {
      window.localStorage.setItem(SUBMITTED_KEY, JSON.stringify([...ids, jobId]));
    }
  } catch {
    // Unmarked means retried next visit — annoying, never fatal.
  }
}

const inflightSubmissions = new Set<string>();

/**
 * Settles into an Agent Advantage comparison. Only jobs with a captured
 * manual baseline qualify, and only once settled (or submitted with a
 * deliverable to show) — TermiX scores real completed work, not intents.
 */
async function submitComparison(
  job: StoredJob,
  status: JobStatus,
  deliverableUrl?: string
): Promise<void> {
  if (job.manualHours === undefined || job.manualCostUsd === undefined) return;
  if (!job.txHash) return;
  if (isComparisonSubmitted(job.jobId) || inflightSubmissions.has(job.jobId)) return;
  inflightSubmissions.add(job.jobId);
  try {
    const agentHours = Math.max(
      0,
      (Date.now() - new Date(job.createdAt).getTime()) / 3_600_000
    );
    const res = await fetch("/api/advantage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: job.jobId,
        chainId: job.chainId ?? BSC_CHAIN_ID,
        agentId: job.agentId,
        agentName: job.agentName,
        description: job.task,
        category: job.category ?? "general",
        manualHours: job.manualHours,
        manualCostUsd: job.manualCostUsd,
        agentHours,
        agentCostDisplay: `${formatEther(BigInt(job.budgetWei))} $U`,
        txHash: job.txHash,
        deliverableUrl,
        status,
      }),
    });
    if (res.ok) markComparisonSubmitted(job.jobId);
  } catch {
    // Next visit retries.
  } finally {
    inflightSubmissions.delete(job.jobId);
  }
}

export default function JobsList() {
  const wallet = useSyncExternalStore(
    subscribeConnectedWallet,
    getConnectedWallet,
    () => null as ConnectedWallet | null
  );
  const jobs = useSyncExternalStore(
    subscribeJobs,
    getJobsSnapshot,
    () => NO_JOBS as StoredJob[]
  );

  const [chain, setChain] = useState<Record<string, ChainState>>({});

  const mine = wallet
    ? jobs.filter((job) => job.buyerAddress.toLowerCase() === wallet.address.toLowerCase())
    : [];

  // Status always comes from the chain — the local store only remembers which ids
  // belong to this wallet, because ERC-8183 has no per-buyer index. Settled
  // jobs with a manual baseline additionally report themselves to
  // /api/advantage, which is what populates the TermiX comparison page.
  const refresh = useCallback(async (jobIds: string[]) => {
    const known = getJobsSnapshot();
    const jobsToRead = jobIds
      .map((jobId) => known.find((job) => job.jobId === jobId))
      .filter((job): job is StoredJob => Boolean(job));
    const results = await Promise.all(
      jobsToRead.map(async (job) => {
        try {
          const res = await fetch(`/api/jobs?jobId=${encodeURIComponent(job.jobId)}`);
          const payload = await res.json();
          if (!res.ok) throw new Error(payload?.error || "Could not read this job");
          const state: ChainState = {
            status: payload.data?.status,
            deliverableUrl: payload.data?.deliverableUrl,
          };
          setChain((prev) => ({ ...prev, [job.jobId]: state }));
          return { job, state };
        } catch (caught) {
          setChain((prev) => ({
            ...prev,
            [job.jobId]: { error: caught instanceof Error ? caught.message : "Read failed" },
          }));
          return { job, state: null as ChainState | null };
        }
      })
    );

    for (const { job, state } of results) {
      if (
        state?.status === "COMPLETED" ||
        (state?.status === "SUBMITTED" && state.deliverableUrl)
      ) {
        void submitComparison(job, state.status, state.deliverableUrl);
      }
    }
  }, []);

  const ids = mine.map((job) => job.jobId).join(",");
  useEffect(() => {
    if (ids) void refresh(ids.split(","));
  }, [ids, refresh]);

  if (!wallet) {
    return (
      <div className="deck-frame mt-6 border border-[#2f2f2f] bg-[#141414] px-6 py-16 text-center">
        <p className="text-sm text-[#999]">Connect your wallet to see the jobs you have funded.</p>
      </div>
    );
  }

  if (mine.length === 0) {
    return (
      <div className="deck-frame mt-6 border border-[#2f2f2f] bg-[#141414] px-6 py-16 text-center">
        <p className="text-sm text-[#999]">You have not hired an agent yet.</p>
        <Link
          href="/"
          className="chamfer mt-6 inline-flex h-11 items-center bg-[#F0B90B] px-6 text-[12px] font-bold text-black transition-[transform,opacity] hover:opacity-90 active:scale-[0.98]"
        >
          Browse the marketplace
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      {mine.map((job) => {
        const state = chain[job.jobId];
        const status = state?.status;
        const style = status ? STATUS_STYLES[status] : undefined;

        return (
          <article key={job.jobId} className="deck-frame border border-[#2f2f2f] bg-[#141414] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-[15px] font-semibold text-[#f5f5f5]">
                    {job.agentName}
                  </h2>
                  <span
                    className={`flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase ${style?.text ?? "text-[#666]"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${style?.dot ?? "bg-[#333]"}`}
                    />
                    {status ?? (state?.error ? "Unreadable" : "Reading…")}
                  </span>
                </div>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-[#666]">
                  Job {job.jobId} · {formatEther(BigInt(job.budgetWei))} $U escrowed
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {state?.deliverableUrl && (
                  <a
                    href={state.deliverableUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 border border-[#225d44] px-4 text-[11px] font-bold text-[#33fba1] transition-colors hover:bg-[#10291f]"
                  >
                    Deliverable
                    <ExternalArrow />
                  </a>
                )}
                {job.txHash && (
                  <a
                    href={`${BSCSCAN_URL}/tx/${job.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#F0B90B] underline underline-offset-4"
                  >
                    Funding tx
                    <ExternalArrow />
                  </a>
                )}
              </div>
            </div>

            <p className="mt-4 border-t border-[#242424] pt-4 text-[12px] leading-6 text-[#999]">
              {job.task}
            </p>

            {state?.error && (
              <p role="alert" className="mt-3 text-[11px] leading-5 text-[#e8b339]">
                Could not read this job onchain — {state.error}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
