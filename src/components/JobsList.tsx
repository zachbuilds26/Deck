"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import ExternalArrow from "@/components/ExternalArrow";
import { formatEther } from "viem";
import { BSCSCAN_URL } from "@/lib/constants";
import { BSC_CHAIN_ID } from "@/lib/constants";
import { claimJobRefund, createAltanaClient, settleJob } from "@/lib/altana";
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
  expiredAt?: string;
  error?: string;
};

const SUBMITTED_KEY = "deck-advantage-submitted";
const RECLAIMED_KEY = "deck-refunded-jobs";

/**
 * The escrow fuse, in words. Static as of page load (the page re-reads the
 * chain on every visit, so it never goes stale by much). Exists because a
 * ~1h fuse and a ~24h fuse look identical until one of them surprises you.
 */
function fuseLabel(expiredAt?: string): string | null {
  if (!expiredAt) return null;
  const ms = Date.parse(expiredAt) - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "Past deadline";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `Funds free in ~${hours}h ${minutes}m`;
  if (minutes > 0) return `Funds free in ~${minutes}m`;
  return "Funds free soon";
}

function loadReclaimed(): string[] {
  try {
    const raw = window.localStorage.getItem(RECLAIMED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * The kernel's WrongStatus selector. On the refund path it means exactly one
 * thing: this job already left Funded (claimed, settled, disputed) — there is
 * nothing left to pull. Shown as fact, never as a hex dump.
 */
const ALREADY_CLAIMED_SELECTOR = "0x8e78f0cb";

function isAlreadyClaimed(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return text.toLowerCase().includes(ALREADY_CLAIMED_SELECTOR);
}

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
  const [acting, setActing] = useState<{
    jobId: string;
    action: "approve" | "dispute" | "refund";
  } | null>(null);
  // Jobs whose escrow already came home. The kernel leaves the budget field
  // untouched on refund, so "claimed" is invisible onchain — this memory is
  // what retires the button instead of letting it revert forever.
  const [claimed, setClaimed] = useState<string[]>(loadReclaimed);

  /** Past deadline, unspent, unsettled: the escrow is reclaimable. Never shown
   *  for settled jobs (nothing left to claim), submitted ones (settle the
   *  deliverable instead), or jobs already pulled home this session. */
  function isRefundable(jobId: string, state: ChainState | undefined): boolean {
    if (claimed.includes(jobId)) return false;
    if (!state?.status || !state.expiredAt) return false;
    if (state.status === "COMPLETED" || state.status === "REJECTED") return false;
    if (state.status === "SUBMITTED") return false;
    return Date.now() > Date.parse(state.expiredAt);
  }

  function markClaimed(jobId: string): void {
    setClaimed((prev) => {
      if (prev.includes(jobId)) return prev;
      const next = [...prev, jobId];
      try {
        window.localStorage.setItem(RECLAIMED_KEY, JSON.stringify(next));
      } catch {
        // Memory still retires the button for this session.
      }
      return next;
    });
  }
  const [actError, setActError] = useState<Record<string, string>>({});

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
            expiredAt: payload.data?.expiredAt,
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

  /**
   * Release (approve) or contest (dispute) a submitted job's escrow. One
   * wallet signature each, then the status is re-read from the chain — which
   * is also what feeds the Advantage auto-submit on COMPLETED.
   */
  async function act(job: StoredJob, action: "approve" | "dispute" | "refund") {
    if (!wallet || acting) return;
    setActing({ jobId: job.jobId, action });
    setActError((prev) => {
      const next = { ...prev };
      delete next[job.jobId];
      return next;
    });
    try {
      if (action === "refund") {
        await claimJobRefund(
          createAltanaClient(),
          wallet.wallet,
          wallet.signer,
          BigInt(job.jobId)
        );
        markClaimed(job.jobId);
      } else {
        await settleJob(
          createAltanaClient(),
          wallet.wallet,
          wallet.signer,
          BigInt(job.jobId),
          action
        );
      }
      await refresh([job.jobId]);
    } catch (caught) {
      // Already home: the kernel rejects repeat claims with WrongStatus, so a
      // repeat is proof of success, not failure — retire the button and say so.
      if (action === "refund" && isAlreadyClaimed(caught)) {
        markClaimed(job.jobId);
        setActError((prev) => {
          const next = { ...prev };
          delete next[job.jobId];
          return next;
        });
      } else {
        setActError((prev) => ({
          ...prev,
          [job.jobId]: caught instanceof Error ? caught.message : "Action failed.",
        }));
      }
    } finally {
      setActing(null);
    }
  }

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
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-[#999]">
                  Job {job.jobId} · {formatEther(BigInt(job.budgetWei))} $U escrowed
                </p>
                {status === "FUNDED" && fuseLabel(state?.expiredAt) && (
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-[#8f8f8f]">
                    {fuseLabel(state?.expiredAt)}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-3">
                {status === "SUBMITTED" && wallet && (
                  <>
                    <button
                      type="button"
                      onClick={() => act(job, "approve")}
                      disabled={acting !== null}
                      className="chamfer-sm h-9 bg-[#F0B90B] px-4 text-[11px] font-bold text-black transition-[transform,opacity] enabled:hover:opacity-90 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {acting?.jobId === job.jobId && acting.action === "approve"
                        ? "Releasing…"
                        : "Release escrow"}
                    </button>
                    <button
                      type="button"
                      onClick={() => act(job, "dispute")}
                      disabled={acting !== null}
                      className="h-9 shrink-0 px-1 text-[11px] font-bold text-[#ff8d8d] underline-offset-4 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
                    >
                      {acting?.jobId === job.jobId && acting.action === "dispute"
                        ? "Disputing…"
                        : "Dispute"}
                    </button>
                  </>
                )}
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
                {claimed.includes(job.jobId) ? (
                  <span className="flex h-9 items-center gap-1.5 text-[11px] font-bold uppercase text-[#33fba1]">
                    <span aria-hidden="true">✓</span> Reclaimed
                  </span>
                ) : (
                  isRefundable(job.jobId, state) &&
                  wallet && (
                    <button
                      type="button"
                      onClick={() => act(job, "refund")}
                      disabled={acting !== null}
                      title="Deadline passed with no delivery — pull the escrow back"
                      className="chamfer-sm h-9 border border-[#5c4a10] px-4 text-[11px] font-bold text-[#F0B90B] transition-colors hover:border-[#8a6f18] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {acting?.jobId === job.jobId ? "Reclaiming…" : "Reclaim escrow"}
                    </button>
                  )
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
            {actError[job.jobId] && (
              <p role="alert" className="mt-3 text-[11px] leading-5 text-[#ff8d8d]">
                {actError[job.jobId]}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
