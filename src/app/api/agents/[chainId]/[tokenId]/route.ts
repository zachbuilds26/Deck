import { NextRequest, NextResponse } from "next/server";
import { getAgent, getAgentFeedback, ScanApiError } from "@/lib/scan8004";
import { displayAgentId } from "@/lib/agent-id";
import type { ApiResponse, AgentDetail, AgentFeedback } from "@/lib/types";

// GET /api/agents/[chainId]/[tokenId]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ chainId: string; tokenId: string }> }
) {
  try {
    const { chainId, tokenId } = await params;
    const chainIdNum = Number(chainId);

    if (!chainIdNum || !tokenId) {
      return NextResponse.json(
        { data: null, error: "Invalid chainId or tokenId" },
        { status: 400 }
      );
    }

    // The route receives the composite id (56:0xregistry:137); /feedbacks needs
    // the bare token id. Feedback failing must not take the whole profile down.
    const [agent, feedback] = await Promise.all([
      getAgent(chainIdNum, tokenId),
      getAgentFeedback(chainIdNum, displayAgentId(tokenId)).catch((error: unknown) => {
        console.warn("Agent feedback unavailable:", error);
        return [] as AgentFeedback[];
      }),
    ]);

    const response: ApiResponse<AgentDetail> & { feedback: AgentFeedback[] } = {
      data: agent,
      feedback,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching agent:", error);
    if (error instanceof ScanApiError && error.status === 404) {
      return NextResponse.json(
        { data: null, error: "Agent not found in the registry" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { data: null, error: "The registry is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}
