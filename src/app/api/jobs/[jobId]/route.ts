import { NextRequest, NextResponse } from "next/server";
import { BSC_CHAIN_ID } from "@/lib/constants";
import { getErc8183Job, getErc8183DeliverableUrl, BNB, BNB_TESTNET } from "@altananetwork/sdk";

const deckNetwork = BSC_CHAIN_ID === 56 ? BNB : BNB_TESTNET;
import { sdkJobToAppJob } from "@/lib/bnbagent";
import type { ApiResponse, Job } from "@/lib/types";

// GET /api/jobs/[jobId] — read job from chain
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId: jobIdStr } = await params;
    let jobId: bigint;
    try {
      jobId = BigInt(jobIdStr);
    } catch {
      return NextResponse.json(
        { data: null, error: "Invalid job ID" },
        { status: 400 }
      );
    }

    const sdkJob = await getErc8183Job(deckNetwork, jobId);
    const appJob = sdkJobToAppJob(sdkJob);

    // Isolated: a deliverable-indexer blip must not masquerade as a missing job.
    try {
      const deliverableUrl = await getErc8183DeliverableUrl(deckNetwork, jobId);
      if (deliverableUrl) {
        appJob.deliverableUrl = deliverableUrl;
      }
    } catch (error) {
      console.warn("Deliverable lookup failed:", error);
    }

    return NextResponse.json({ data: appJob } satisfies ApiResponse<Job>);
  } catch (error) {
    console.error("Error fetching job:", error);
    return NextResponse.json(
      { data: null, error: "Job not found" },
      { status: 404 }
    );
  }
}
