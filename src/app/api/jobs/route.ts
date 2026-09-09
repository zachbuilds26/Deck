import { NextRequest, NextResponse } from "next/server";
import { BSC_CHAIN_ID } from "@/lib/constants";
import { getErc8183Job } from "@altananetwork/sdk";
import { BNB, BNB_TESTNET } from "@altananetwork/sdk";

const deckNetwork = BSC_CHAIN_ID === 56 ? BNB : BNB_TESTNET;
import { sdkJobToAppJob } from "@/lib/bnbagent";
import type { ApiResponse, Job } from "@/lib/types";

// GET /api/jobs?wallet=0x...&status=FUNDED&jobId=123
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobIdStr = searchParams.get("jobId");

    // If specific jobId requested, read from chain
    if (jobIdStr) {
      const jobId = BigInt(jobIdStr);
      try {
        const sdkJob = await getErc8183Job(deckNetwork, jobId);
        const appJob = sdkJobToAppJob(sdkJob);

        // Try to get deliverable URL
        const { getErc8183DeliverableUrl } = await import("@altananetwork/sdk");
        const deliverableUrl = await getErc8183DeliverableUrl(deckNetwork, jobId);
        if (deliverableUrl) {
          appJob.deliverableUrl = deliverableUrl;
        }

        return NextResponse.json({ data: appJob } satisfies ApiResponse<Job>);
      } catch {
        return NextResponse.json(
          { data: null, error: "Job not found onchain" },
          { status: 404 }
        );
      }
    }

    // List jobs — in production, index from events or use a subgraph
    // For now, return empty with instructions
    return NextResponse.json({
      data: [],
      message: "Job listing requires event indexing. Use jobId param to read individual jobs.",
      instruction: "Read specific jobs via GET /api/jobs?jobId=<number>",
    });
  } catch (error) {
    console.error("Error fetching jobs:", error);
    return NextResponse.json(
      { data: [], error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}
