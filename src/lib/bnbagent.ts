import {
  ERC8183_ADDRESSES,
  JOB_STATUS,
  erc8183Addresses,
  type Erc8183Job,
  type JobStatusName,
} from "@altananetwork/sdk";
import { formatEther } from "viem";
import type { Job } from "./types";

// Re-export SDK constants
export { JOB_STATUS, ERC8183_ADDRESSES, erc8183Addresses };

// ============================================
// JOB STATUS
// ============================================

export const JOB_STATES = {
  OPEN: 0,
  FUNDED: 1,
  SUBMITTED: 2,
  COMPLETED: 3,
  REJECTED: 4,
  EXPIRED: 5,
} as const;

/**
 * Parse job status number to readable string.
 */
export function parseJobStatus(statusCode: number): JobStatusName {
  return JOB_STATUS[statusCode] || "OPEN";
}

// ============================================
// FORMATTING
// ============================================

/**
 * Format budget from raw wei to human-readable. Garbage in renders as-is,
 * never throws a money page.
 */
export function formatBudget(budgetWei: bigint | string, token: string = "$U"): string {
  try {
    const amount = Number(formatEther(BigInt(budgetWei)));
    if (!Number.isFinite(amount)) return `${String(budgetWei)} ${token}`;
    return `${amount.toFixed(4)} ${token}`;
  } catch {
    return `${String(budgetWei)} ${token}`;
  }
}

/**
 * Convert SDK Erc8183Job to our app's Job type.
 *
 * Only submittedAt comes from the chain. Creation/funding/completion times
 * are NOT on the job record — earlier versions invented them (expiredAt minus
 * a day, "now" on every read), so timelines shifted between renders. Unknown
 * stays unknown; the timeline renders what exists.
 */
export function sdkJobToAppJob(sdkJob: Erc8183Job): Job {
  return {
    jobId: sdkJob.id.toString(),
    buyer: sdkJob.client,
    provider: sdkJob.provider,
    task: sdkJob.description,
    budget: sdkJob.budget.toString(),
    status: sdkJob.statusName,
    deliverableUrl: undefined, // fetched separately
    createdAt: "",
    fundedAt: undefined,
    submittedAt: sdkJob.submittedAt > 0n ? new Date(Number(sdkJob.submittedAt) * 1000).toISOString() : undefined,
    completedAt: undefined,
    txHash: "", // not available from read
  };
}

/**
 * Format job for API response with timeline.
 */
export function formatJobResponse(job: Job): {
  id: string;
  status: string;
  task: string;
  budget: string;
  buyer: string;
  provider: string;
  timeline: { event: string; time: string }[];
} {
  const timeline: { event: string; time: string }[] = [];

  if (job.createdAt) timeline.push({ event: "Created", time: job.createdAt });
  if (job.fundedAt) timeline.push({ event: "Funded", time: job.fundedAt });
  if (job.submittedAt) timeline.push({ event: "Submitted", time: job.submittedAt });
  if (job.completedAt) timeline.push({ event: "Completed", time: job.completedAt });

  return {
    id: job.jobId,
    status: job.status,
    task: job.task,
    budget: formatBudget(job.budget),
    buyer: job.buyer,
    provider: job.provider,
    timeline,
  };
}
