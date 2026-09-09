"use client";

/**
 * Hired jobs, kept locally so a wallet can list its own history.
 *
 * ERC-8183 has no per-buyer index onchain — /api/jobs can read one job by id but
 * cannot enumerate them without an event indexer. Job status always comes from
 * the chain; only the id and our labelling live here.
 */
/** Task kind for the Agent Advantage comparison. TermiX weights trading,
 *  equities and security highest, so the hire flow asks up front. */
export type AdvantageCategory = "trading" | "equities" | "security" | "general";

export type StoredJob = {
  jobId: string;
  /** Chain the escrow lives on — numeric ERC-8183 ids collide across 56/97,
   *  so identity (and dedupe below) is always chain-scoped. */
  chainId: number;
  buyerAddress: string;
  agentId: string;
  agentName: string;
  task: string;
  /** Budget in wei, as a decimal string — JSON has no bigint. */
  budgetWei: string;
  createdAt: string;
  txHash?: string;
  /** Manual baseline for the Agent Advantage comparison: what the task costs
   *  by hand. Absent on jobs hired before this existed — those simply never
   *  enter a report. */
  manualHours?: number;
  manualCostUsd?: number;
  category?: AdvantageCategory;
};

const STORAGE_KEY = "deck-jobs";
const listeners = new Set<() => void>();

export const NO_JOBS: readonly StoredJob[] = Object.freeze([]);

/** Cached for useSyncExternalStore — see the note in session-store.ts. */
let snapshot: StoredJob[] | null = null;

function isStoredJob(entry: unknown): entry is StoredJob {
  if (!entry || typeof entry !== "object") return false;
  const job = entry as Record<string, unknown>;
  return typeof job.jobId === "string" && typeof job.createdAt === "string";
}

function read(): StoredJob[] {
  if (snapshot) return snapshot;
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const jobs = Array.isArray(parsed) ? parsed.filter(isStoredJob) : [];
    snapshot = jobs.sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt))
    );
  } catch {
    snapshot = [];
  }
  return snapshot;
}

/** Stable reference for useSyncExternalStore. Filter in the component. */
export function getJobsSnapshot(): StoredJob[] {
  return read();
}

function write(jobs: StoredJob[]) {
  snapshot = jobs;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
    } catch {
      // Quota/private mode: memory still serves this session; next visit
      // refetches what the chain remembers (status) and forgets the rest.
    }
  }
  listeners.forEach((listener) => listener());
}

export function subscribeJobs(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listJobs(buyerAddress?: string): StoredJob[] {
  const all = read();
  const scoped = buyerAddress
    ? all.filter((job) => job.buyerAddress.toLowerCase() === buyerAddress.toLowerCase())
    : all;
  return scoped.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveJob(job: StoredJob) {
  const key = (entry: StoredJob) => `${entry.chainId}:${entry.jobId}`;
  write([job, ...read().filter((existing) => key(existing) !== key(job))]);
}
