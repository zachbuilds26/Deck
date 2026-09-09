import { NextResponse } from "next/server";
import { TOKENS, AGENT_CATEGORIES } from "@/lib/constants";
import { CONTRACTS } from "@/lib/contracts";
import type { ApiResponse } from "@/lib/types";

// GET /api/defi/pancakeswap — PancakeSwap agent categories + contract context
//
// This endpoint provides the PancakeSwap ecosystem context for the marketplace.
// Real agents are discovered via 8004scan search with these keywords.
// The categories below map to the hackathon's required agent types.

export async function GET() {
  try {
    const data = {
      protocols: {
        pancakeswap: {
          router: CONTRACTS.PANCAKESWAP_ROUTER,
          routerV3: CONTRACTS.PANCAKESWAP_ROUTER_V3,
          factory: CONTRACTS.PANCAKESWAP_FACTORY,
        },
        venus: {
          comptroller: CONTRACTS.VENUS_COMPTROLLER,
        },
      },
      tokens: {
        USDT: TOKENS.USDT,
        USDC: TOKENS.USDC,
        U: TOKENS.U,
      },
      categories: AGENT_CATEGORIES,
    };

    return NextResponse.json({ data } satisfies ApiResponse<typeof data>);
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { data: null, error: "Failed to fetch PancakeSwap data" },
      { status: 500 }
    );
  }
}
