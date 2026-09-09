import { DECK_CHAIN } from "./chain";

// Chain — selected by NEXT_PUBLIC_DECK_CHAIN, see lib/chain.ts. Named
// BSC_CHAIN_ID still because every call site reads it as "the chain Deck is on".
export const BSC_CHAIN_ID = DECK_CHAIN.id;

// 8004scan API
export const SCAN8004_BASE_URL = "https://api.8004scan.io/api/v1";
export const SCAN8004_RATE_LIMIT = 30; // requests per minute (anonymous)

// BSC RPC
export const BSC_RPC_URL = DECK_CHAIN.rpcUrl;

// BscScan
export const BSCSCAN_URL = DECK_CHAIN.explorerUrl;

// Tokens for the selected chain (18 decimals on both).
//
// EIP-55 checksummed — viem rejects mixed-case addresses whose capitalisation
// does not match the checksum, so a typo here fails at transaction-build time.
// Note a valid checksum only proves the case pattern is self-consistent, NOT
// that the contract exists: verify with eth_getCode before trusting a new entry.
//
// Every address in lib/chain.ts was confirmed onchain — symbol() and name() read
// back as expected.
//
// U is $U / "United Stables", the token the ERC-8183 escrow settles in. Prefer
// getEscrowPaymentToken() from lib/altana over this constant for escrow work —
// the contract set is the source of truth.
export const TOKENS = {
  USDT: DECK_CHAIN.tokens.USDT,
  USDC: DECK_CHAIN.tokens.USDC,
  U: DECK_CHAIN.tokens.U,
  BNB: "0x0000000000000000000000000000000000000000", // sentinel for native gas
} as const;

// Agent categories for marketplace
export const AGENT_CATEGORIES = [
  {
    id: "rebalancing" as const,
    label: "Rebalancing",
    description: "Manages LP ranges, resets positions automatically",
    keywords: ["rebalance", "liquidity", "LP", "range", "CLMM"],
  },
  {
    id: "grid-trading" as const,
    label: "Grid Trading",
    description: "Places and manages automated grid orders",
    keywords: ["grid", "trading", "automated", "orders"],
  },
  {
    id: "yield-optimisation" as const,
    label: "Yield Optimisation",
    description: "Routes liquidity to the highest available APR",
    keywords: ["yield", "APR", "optimise", "farm", "stake"],
  },
  {
    id: "health-factor" as const,
    label: "Health Factor",
    description: "Protects lending positions from liquidation",
    keywords: ["health", "liquidation", "lending", "borrow", "Venus", "Aave"],
  },
] as const;

// Cache TTLs (seconds)
// AGENTS is deliberately generous: the anonymous tier allows 30 requests/minute
// and every agent page costs two, so repeat views must come from cache.
export const CACHE_TTL = {
  AGENTS: 300,
  AGENT_DETAIL: 300,
  STATS: 300,
  SEARCH: 120,
} as const;
