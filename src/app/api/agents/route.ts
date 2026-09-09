import { NextRequest, NextResponse } from "next/server";
import { listAgents, searchAgents, ScanApiError } from "@/lib/scan8004";
import { BSC_CHAIN_ID } from "@/lib/constants";
import type { ApiResponse, Agent } from "@/lib/types";

// GET /api/agents?page=1&limit=20&chainId=56&category=rebalancing&q=search
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page")) || 1;
    const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
    // NaN is not nullish, so `Number("abc") ?? fallback` stays NaN — validate.
    const chainIdRaw = searchParams.get("chainId");
    const chainId = chainIdRaw ? Number(chainIdRaw) : undefined;
    if (chainIdRaw && !Number.isFinite(chainId)) {
      return NextResponse.json(
        { data: [], error: "Invalid chainId" },
        { status: 400 }
      );
    }
    const owner = searchParams.get("owner") || undefined;
    const category = searchParams.get("category") || undefined;
    const query = searchParams.get("q");

    let agents: Agent[];
    let total = 0;
    let hasMore = false;
    let snapshot: { capturedAt: string } | undefined;

    // If search query, use semantic search
    if (query && query.trim().length > 0) {
      agents = await searchAgents(
        query.trim(),
        limit,
        chainId === 56 || chainId === 97 ? chainId : BSC_CHAIN_ID
      );
      total = agents.length;
    } else {
      const result = await listAgents({
        page,
        limit,
        chainId,
        owner,
        category,
      });
      agents = result.agents;
      total = result.total;
      hasMore = result.hasMore;
      snapshot = result.snapshot;
    }

    const response: ApiResponse<Agent[]> = {
      data: agents,
      pagination: {
        page,
        limit,
        total,
        hasMore,
      },
      // Only set when the registry was unreachable and these came from the
      // committed snapshot, so the UI can say so instead of implying live data.
      ...(snapshot ? { snapshot } : {}),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching agents:", error);

    if (error instanceof ScanApiError && error.status === 429) {
      return NextResponse.json(
        {
          data: [],
          error:
            "The agent registry is rate limiting Deck right now. Wait a moment and try again.",
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { data: [], error: "Could not reach the agent registry. Please try again." },
      { status: 502 }
    );
  }
}
