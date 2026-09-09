import {
  createClient,
  BNB,
  BNB_TESTNET,
  getErc8183Job,
  getErc8183DeliverableUrl,
  hireErc8183Agent,
  settleErc8183Job,
  buildClaimRefundCall,
  erc8183Addresses,
  signerFromPasskey,
  type Client,
  type Wallet,
  type Session,
  type Signer,
  type Erc8183Job,
  type SessionPermissions,
  type CallPermission,
  type SpendPermission,
  type TokenBalance,
  type PasskeyCredential,
} from "@altananetwork/sdk";
import { formatEther, type Address, type Hex } from "viem";
import { TOKENS, BSC_CHAIN_ID } from "./constants";

// Re-export SDK types
export type {
  Client,
  Wallet,
  Session,
  Signer,
  Erc8183Job,
  SessionPermissions,
  CallPermission,
  SpendPermission,
};

// ============================================
// CLIENT CREATION (browser-only)
// ============================================

/**
 * The SDK network object for the chain this build targets. Every ERC-8183
 * call takes a `network`, and hardcoding BNB here is what kept hires,
 * settles and job reads on mainnet after the rest of the app moved to
 * testnet.
 */
export function deckNetwork() {
  return BSC_CHAIN_ID === 56 ? BNB : BNB_TESTNET;
}

/**
 * Create an Altana client. Must be called in browser context.
 */
export function createAltanaClient(): Client {
  // Both chains registered, the configured one made default. Registering only the
  // active chain would break any call that passes an explicit chainId, and the
  // escrow, the session grant and the balance read all do.
  return createClient({
    chains: [BNB, BNB_TESTNET],
    defaultChainId: BSC_CHAIN_ID,
  });
}

// ============================================
// WALLET OPERATIONS
// ============================================

/**
 * Create a passkey wallet (Face ID / fingerprint).
 */
export async function createPasskeyWallet(
  client: Client,
  name: string = "Deck Wallet"
): Promise<{ wallet: Wallet; signer: Signer; address: `0x${string}`; credential?: PasskeyCredential }> {
  const result = await client.createPasskeyWallet({ name });
  return {
    wallet: result as unknown as Wallet,
    signer: result.signer as unknown as Signer,
    address: (result as unknown as Wallet).address as `0x${string}`,
    credential: result.signer.credential,
  };
}

/**
 * Rebuild the wallet from a passkey credential we stored ourselves. Works even
 * before the wallet has touched the chain, because the address is derived from
 * the signer rather than read from KeyStore.
 */
export async function recoverPasskeyWallet(
  client: Client,
  credential: PasskeyCredential
): Promise<{ wallet: Wallet; signer: Signer; address: `0x${string}` }> {
  const signer = signerFromPasskey(credential);
  const recovered = await client.createWallet({ signer });
  return {
    wallet: recovered as unknown as Wallet,
    signer: recovered.signer as unknown as Signer,
    address: (recovered as unknown as Wallet).address as `0x${string}`,
  };
}

/**
 * Recover via the OS keychain and onchain KeyStore — no local storage needed,
 * and works on a device that has never seen this browser profile.
 *
 * Only succeeds once the wallet has executed at least one transaction: a fresh
 * wallet is counterfactual and has no KeyStore entry to read yet.
 */
export async function recoverWalletFromKeychain(
  client: Client
): Promise<{ wallet: Wallet; signer: Signer; address: `0x${string}`; credential: PasskeyCredential }> {
  const recovered = await client.recoverFromPasskey();
  return {
    wallet: recovered as unknown as Wallet,
    signer: recovered.signer as unknown as Signer,
    address: (recovered as unknown as Wallet).address as `0x${string}`,
    credential: recovered.signer.credential,
  };
}

/**
 * Get native + token balances for a wallet.
 */
export async function getBalances(
  client: Client,
  wallet: Wallet | Address,
  tokens?: Address[]
): Promise<{ native: string; tokens: { address: string; symbol: string; balance: string }[] }> {
  const result = await client.balances({
    wallet,
    tokens: tokens || [TOKENS.USDT as Address, TOKENS.USDC as Address, TOKENS.U as Address],
    chainId: BSC_CHAIN_ID,
  });

  const native = formatEther(result.native);

  for (const failed of result.tokens || []) {
    if (!(failed as { ok: boolean }).ok) {
      console.warn("Balance read failed:", (failed as { address?: string }).address);
    }
  }

  const tokenBalances = (result.tokens || [])
    .filter((t): t is TokenBalance & { ok: true } => t.ok)
    .map((t) => ({
      address: t.address,
      symbol: t.symbol || "???",
      balance: t.display,
    }));

  return { native, tokens: tokenBalances };
}

// ============================================
// SESSION OPERATIONS
// ============================================

/**
 * Grant a scoped session to an agent.
 *
 * `register: true` is what makes the key readable in the onchain KeyStore, so
 * anyone (including a judge running verify_authorization) can see the session's
 * authority, expiry and revocation state without taking our word for it.
 *
 * The SDK generates and holds the session key. Deck never persists a secret —
 * revocation only needs the session's publicKey.
 */
export async function grantAgentSession(
  client: Client,
  wallet: Wallet,
  signer: Signer,
  params: {
    allowedContracts: Address[];
    spendLimit: bigint;
    spendPeriod: "minute" | "hour" | "day" | "week" | "month" | "year";
    spendToken?: Address;
    expiryDays: number;
  }
): Promise<Session & { transactionHash?: Hex }> {
  const permissions: SessionPermissions = {
    calls: params.allowedContracts.map((to) => ({ to } as CallPermission)),
    spend: [
      {
        limit: params.spendLimit,
        period: params.spendPeriod,
        // Default is the escrow token, never USDT: capping the wrong asset
        // fails only at transaction time, which is the worst moment to learn.
        token: params.spendToken || (TOKENS.U as Address),
      },
    ],
  };

  const expiry = Math.floor(Date.now() / 1000) + params.expiryDays * 24 * 60 * 60;

  return client.grantSession({
    wallet,
    signer,
    permissions,
    expiry,
    register: true,
  });
}

/**
 * Revoke a session. One tx, immediate effect.
 * Accepts the live Session or just its publicKey.
 */
export async function revokeAgentSession(
  client: Client,
  wallet: Wallet,
  signer: Signer,
  session: Session | Hex
): Promise<{ transactionHash?: Hex }> {
  const result = await client.revokeSession({ wallet, signer, session });
  return result as { transactionHash?: Hex };
}

// ============================================
// ERC-8183 COMMERCE (HIRE / SETTLE)
// ============================================

/**
 * Hire an ERC-8183 agent. Creates + funds a job escrow in one atomic tx.
 */
export async function hireAgent(
  client: Client,
  wallet: Wallet,
  signer: Signer,
  params: {
    provider: Address;
    task: string;
    budget: bigint;
    deadlineSeconds?: number;
  }
): Promise<{ jobId: bigint; txHash?: string }> {
  const result = await hireErc8183Agent(
    wallet,
    signer,
    {
      provider: params.provider,
      task: params.task,
      budget: params.budget,
      deadlineSeconds: params.deadlineSeconds || 1800,
    },
    { network: deckNetwork() }
  );

  return {
    jobId: result.jobId,
    txHash: result.transactionHash,
  };
}

/**
 * Settle (approve) or dispute a job's escrow.
 */
export async function settleJob(
  client: Client,
  wallet: Wallet,
  signer: Signer,
  jobId: bigint,
  action: "approve" | "dispute" = "approve"
): Promise<void> {
  await settleErc8183Job(
    wallet,
    signer,
    { jobId, action },
    { network: deckNetwork() }
  );
}

/**
 * Read a job from the kernel.
 */
export async function getJob(jobId: bigint): Promise<Erc8183Job> {
  return getErc8183Job(deckNetwork(), jobId);
}

/**
 * Get the deliverable URL for a submitted job.
 */
export async function getDeliverableUrl(jobId: bigint): Promise<string | undefined> {
  return getErc8183DeliverableUrl(deckNetwork(), jobId);
}

/**
 * Build claimRefund calldata (for expired jobs).
 */
export function getClaimRefundCall(jobId: bigint) {
  return buildClaimRefundCall(BSC_CHAIN_ID, jobId);
}

/**
 * Get ERC-8183 contract addresses for a chain.
 */
export function getErc8183ContractAddresses(chainId: number = BSC_CHAIN_ID) {
  return erc8183Addresses(chainId);
}

/**
 * The token the ERC-8183 escrow actually settles in, read from the contract set
 * rather than hardcoded. On BSC this is $U ("United Stables").
 *
 * Do not substitute a constant here: the escrow accepts exactly one token, so a
 * stale address means funding the wrong contract and a spend cap on the wrong
 * asset — both of which fail only at transaction time.
 */
export function getEscrowPaymentToken(chainId: number = BSC_CHAIN_ID): Address {
  return erc8183Addresses(chainId).paymentToken as Address;
}
