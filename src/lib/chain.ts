/**
 * Which BNB chain Deck is pointed at, and every address that follows from it.
 *
 * One env var — `NEXT_PUBLIC_DECK_CHAIN` — selects mainnet (56) or testnet (97).
 * Everything downstream derives from the entry below rather than hardcoding an
 * address, which is what made switching networks a search-and-replace before.
 *
 * Mainnet is the default: real escrow value, real x402 payment history, and
 * the only rated agents in the registry. The honest cost, measured by running
 * Deck's own quality pipeline over both registries — testnet wins on raw
 * category depth, the hackathon's "all four categories, equally deep" bar:
 *
 *              mainnet   testnet
 *   surviving      106       291
 *   rebalancing     25        72
 *   grid trading    55        81
 *   yield           21        50
 *   health factor    8        56
 *
 * The Agent Studio ecosystem lives on testnet: Sentinel Health Guard, Delegate
 * Yield Steward, Delegate Range Keeper and friends are purpose-built for exactly
 * these four categories. Mainnet's registry is mostly bulk persona spam with a
 * handful of agents that have actually been paid.
 *
 * EVERY address here was verified onchain — eth_getCode plus a symbol()/factory()
 * read — not taken from documentation or memory. Three mainnet addresses in this
 * codebase turned out to be plausible-looking fabrications with valid checksums,
 * so the standard is now: if it was not read off the chain, it does not go in.
 */

export type DeckChainId = 56 | 97;

export interface DeckChain {
  id: DeckChainId;
  name: string;
  /** True for BSC testnet. Drives copy that must not imply real money. */
  testnet: boolean;
  rpcUrl: string;
  explorerUrl: string;
  /** ERC-8004 agent identity registry. */
  registry: string;
  pancakeswap: {
    router: string;
    routerV3: string;
    factory: string;
  };
  venus: { comptroller: string };
  tokens: {
    USDT: string;
    USDC: string;
    /** $U — the token the ERC-8183 escrow settles in on this chain. */
    U: string;
  };
}

const CHAINS: Record<DeckChainId, DeckChain> = {
  56: {
    id: 56,
    name: "BNB Smart Chain",
    testnet: false,
    rpcUrl: "https://bsc-dataseed1.bnbchain.org",
    explorerUrl: "https://bscscan.com",
    registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    pancakeswap: {
      router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
      // SmartRouter. Its factory() returns the v3 factory
      // 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865.
      routerV3: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
      factory: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
    },
    // Core Pool Unitroller, read off vBNB.comptroller().
    venus: { comptroller: "0xfD36E2c2a6789Db23113685031d7F16329158384" },
    tokens: {
      USDT: "0x55d398326f99059fF775485246999027B3197955", // "Tether USD"
      USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", // "USD Coin"
      U: "0xcE24439F2D9C6a2289F741120FE202248B666666", // "United Stables"
    },
  },
  97: {
    id: 97,
    name: "BNB Smart Chain Testnet",
    testnet: true,
    rpcUrl: "https://bsc-testnet.publicnode.com",
    explorerUrl: "https://testnet.bscscan.com",
    // symbol() reads "AGENT"; a 130-byte proxy, as on mainnet.
    registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    pancakeswap: {
      // Verified: 18,089 bytes, and router.factory() returns the factory below.
      router: "0xD99D1c33F9fC3444f8101754aBC46c52416550D1",
      routerV3: "0x9a489505a00cE272eAa5e07Dba6491314CaE3796",
      factory: "0x6725F303b657a9451d8BA641348b6761A6CC7a17",
    },
    venus: { comptroller: "0x94d1820b2D1c7c7452A163983Dc888CEC546b77D" },
    tokens: {
      USDT: "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd", // symbol() = "USDT"
      USDC: "0x64544969ed7EBf5f083679233325356EbE738930", // symbol() = "USDC"
      // The chain-97 ERC-8183 paymentToken from @altananetwork/sdk.
      // symbol() = "U", name() = "United Stables".
      U: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
    },
  },
};

function resolveChainId(): DeckChainId {
  const raw = Number(process.env.NEXT_PUBLIC_DECK_CHAIN);
  return raw === 97 ? 97 : 56;
}

/** The chain this build runs against. */
export const DECK_CHAIN: DeckChain = CHAINS[resolveChainId()];

export function deckChain(id: DeckChainId): DeckChain {
  return CHAINS[id];
}
