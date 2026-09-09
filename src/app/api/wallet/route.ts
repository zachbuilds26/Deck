import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, erc20Abi, fallback, formatUnits, http, isAddress } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { BSC_CHAIN_ID, BSC_RPC_URL, TOKENS } from "@/lib/constants";
import type { ApiResponse, WalletInfo } from "@/lib/types";

// GET /api/wallet?address=0x… — real onchain balances for any BSC address.
//
// Wallet *creation* stays client-side: the passkey admin signer only exists in
// the browser. This route is read-only.
const deckChain = BSC_CHAIN_ID === 56 ? bsc : bscTestnet;

const client = createPublicClient({
  chain: deckChain,
  transport: fallback(
    BSC_CHAIN_ID === 56
      ? [
          http("https://bsc-rpc.publicnode.com"),
          http("https://bsc-dataseed.binance.org"),
          http("https://bsc.drpc.org"),
        ]
      : [http(BSC_RPC_URL), http("https://bsc-testnet.bnbchain.org")]
  ),
});

const TRACKED = [
  { symbol: "U", address: TOKENS.U },
  { symbol: "USDT", address: TOKENS.USDT },
  { symbol: "USDC", address: TOKENS.USDC },
] as const;

export async function GET(request: NextRequest) {
  const address = new URL(request.url).searchParams.get("address");

  if (!address || !isAddress(address)) {
    return NextResponse.json(
      { data: null, error: "A valid BSC address is required" },
      { status: 400 }
    );
  }

  try {
    const [native, ...balances] = await Promise.all([
      client.getBalance({ address }),
      ...TRACKED.map((token) =>
        client.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        })
      ),
    ]);

    const wallet: WalletInfo = {
      address,
      balance: formatUnits(native, 18),
      tokens: TRACKED.map((token, index) => ({
        symbol: token.symbol,
        address: token.address,
        balance: formatUnits(balances[index] ?? 0n, 18),
      })),
    };

    return NextResponse.json({ data: wallet } satisfies ApiResponse<WalletInfo>);
  } catch (error) {
    console.error("Error reading wallet balances:", error);
    return NextResponse.json(
      { data: null, error: "Could not reach a BSC node. Please try again." },
      { status: 502 }
    );
  }
}
