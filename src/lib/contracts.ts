import { BNB, BNB_TESTNET, erc8183Addresses } from "@altananetwork/sdk";
import { DECK_CHAIN } from "./chain";

/** Contract addresses for the chain this build targets — see lib/chain.ts, which
 *  holds the per-chain table and the note on why every entry was verified onchain
 *  rather than copied from docs.
 *
 *  The ERC-8183 set (commerce, evaluator router, policy, payment token) comes
 *  from @altananetwork/sdk via erc8183Addresses(chainId) — the source of truth
 *  and already chain-aware. Hardcoding the mainnet kernel here is what would
 *  have scoped testnet sessions to a contract that never sees the job. */
const erc8183 = erc8183Addresses(DECK_CHAIN.id);
const altanaNetwork = DECK_CHAIN.id === 56 ? BNB : BNB_TESTNET;

export const CONTRACTS = {
  // ERC-8004 Agent Identity Registry
  ERC8004_REGISTRY: DECK_CHAIN.registry,
  // ERC-8183 Agentic Commerce (job escrow kernel)
  AGENTIC_COMMERCE: erc8183.commerce,
  // Evaluator Router (binds job → policy)
  EVALUATOR_ROUTER: erc8183.router,
  // Optimistic Policy (UMA-style dispute resolution)
  OPTIMISTIC_POLICY: erc8183.policy,
  // Altana Keystore for the active chain
  ALTANA_KEYSTORE: altanaNetwork.keyStore,
  ALTANA_KEYSTORE_CONTROLLER: altanaNetwork.keyStoreController,
  // PancakeSwap. On testnet the router's factory() returns the factory below, the
  // same cross-check applied to the mainnet pair.
  PANCAKESWAP_ROUTER: DECK_CHAIN.pancakeswap.router,
  PANCAKESWAP_ROUTER_V3: DECK_CHAIN.pancakeswap.routerV3,
  PANCAKESWAP_FACTORY: DECK_CHAIN.pancakeswap.factory,
  // Venus Lending — Core Pool Unitroller.
  VENUS_COMPTROLLER: DECK_CHAIN.venus.comptroller,
  // Tokens
  USDT: DECK_CHAIN.tokens.USDT,
  USDC: DECK_CHAIN.tokens.USDC,
  U_TOKEN: DECK_CHAIN.tokens.U,
};
