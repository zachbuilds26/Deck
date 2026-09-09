"use client";

import { createWalletClient, custom, type Address, type WalletClient } from "viem";
import { bsc, bscTestnet } from "viem/chains";

/** Minimal EIP-1193 shape — enough for connect, chain switch and events. */
export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

/** A wallet announced via EIP-6963 — the standard way to list every injected
 *  wallet instead of gambling on which one won the window.ethereum race. */
export type DiscoveredWallet = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
  provider: Eip1193Provider;
};

type Eip6963Announce = CustomEvent<{
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}>;

/**
 * Ask every injected wallet to announce itself (EIP-6963) and collect the
 * answers. Resolves with an empty list when nothing is installed — never hangs.
 */
export function discoverInjectedWallets(timeoutMs = 500): Promise<DiscoveredWallet[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve([]);
      return;
    }
    const found = new Map<string, DiscoveredWallet>();
    const onAnnounce = (event: Event) => {
      const detail = (event as Eip6963Announce).detail;
      if (!detail?.info || !detail?.provider) return;
      const { uuid, name, icon, rdns } = detail.info;
      if (!uuid || found.has(uuid)) return;
      found.set(uuid, { uuid, name, icon, rdns, provider: detail.provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

export class WalletTimeoutError extends Error {
  constructor(action: string, seconds: number) {
    super(
      `Your wallet did not answer the ${action} request within ${seconds} seconds. ` +
        `Open the wallet extension and try again.`
    );
    this.name = "WalletTimeoutError";
  }
}

/**
 * Race a provider request against a timeout. Without this a dead or
 * non-responding provider leaves the UI stuck on "Confirm in your wallet…"
 * forever — the exact hang this was added for.
 */
async function requestWithTimeout<T>(
  provider: Eip1193Provider,
  args: { method: string; params?: unknown[] | object },
  action: string,
  timeoutMs = 60_000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new WalletTimeoutError(action, Math.round(timeoutMs / 1000))), timeoutMs);
    });
    return await Promise.race([provider.request(args) as Promise<T>, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type BrowserWallet = {
  address: Address;
  chainId: number;
  client: WalletClient;
};

export const SUPPORTED_CHAINS = { [bsc.id]: bsc, [bscTestnet.id]: bscTestnet } as const;

let active: BrowserWallet | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function getBrowserWallet(): BrowserWallet | null {
  return active;
}

export function setBrowserWallet(wallet: BrowserWallet | null) {
  active = wallet;
  notify();
}

export function subscribeBrowserWallet(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const injected = (window as { ethereum?: Eip1193Provider }).ethereum;
  return injected ?? null;
}

export class NoWalletError extends Error {
  constructor() {
    super("No browser wallet found. Install MetaMask, Trust Wallet or Binance Wallet.");
    this.name = "NoWalletError";
  }
}

function toChainId(raw: unknown): number {
  return typeof raw === "string" ? Number.parseInt(raw, 16) : Number(raw);
}

function buildWallet(provider: Eip1193Provider, address: Address, chainId: number): BrowserWallet {
  const chain = SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS];
  if (!chain) {
    throw new Error(`Deck does not support chain ${chainId}. Switch to BNB Smart Chain first.`);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error("The wallet shared an invalid account address.");
  }
  return {
    address,
    chainId,
    client: createWalletClient({ account: address, chain, transport: custom(provider) }),
  };
}

/**
 * Prompts the extension. Pass the provider from discoverInjectedWallets when
 * the user picked one; otherwise falls back to window.ethereum.
 * Throws NoWalletError when nothing is injected.
 */
export async function connectBrowserWallet(preferred?: Eip1193Provider): Promise<BrowserWallet> {
  const provider = preferred ?? getInjectedProvider();
  if (!provider) throw new NoWalletError();

  const accounts = (await requestWithTimeout<Address[]>(
    provider,
    { method: "eth_requestAccounts" },
    "connect"
  )) as Address[];
  if (!accounts?.length) throw new Error("No account was shared by the wallet.");

  const chainId = toChainId(await provider.request({ method: "eth_chainId" }));
  const wallet = buildWallet(provider, accounts[0], chainId);
  setBrowserWallet(wallet);
  return wallet;
}

/** Reconnects silently if the wallet is already authorised for this origin. */
export async function restoreBrowserWallet(preferred?: Eip1193Provider): Promise<BrowserWallet | null> {
  const provider = preferred ?? getInjectedProvider();
  if (!provider) return null;

  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as Address[];
    if (!accounts?.length) return null;
    const chainId = toChainId(await provider.request({ method: "eth_chainId" }));
    const wallet = buildWallet(provider, accounts[0], chainId);
    setBrowserWallet(wallet);
    return wallet;
  } catch {
    return null;
  }
}

/** Asks the wallet to switch chains, adding the network if it is unknown. */
export async function switchChain(chainId: number, preferred?: Eip1193Provider): Promise<void> {
  const provider = preferred ?? getInjectedProvider();
  if (!provider) throw new NoWalletError();

  const chain = SUPPORTED_CHAINS[chainId as keyof typeof SUPPORTED_CHAINS];
  if (!chain) throw new Error(`Deck does not support chain ${chainId}.`);
  const hexId = `0x${chainId.toString(16)}`;

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (error) {
    // 4902 = chain unknown to the wallet, so offer to add it.
    const code = (error as { code?: number })?.code;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [chain.rpcUrls.default.http[0]],
          blockExplorerUrls: [chain.blockExplorers?.default.url].filter(Boolean),
        },
      ],
    });
  }

  await restoreBrowserWallet(preferred);
}

export function disconnectBrowserWallet() {
  setBrowserWallet(null);
}

/** Keeps the store in step with the extension's own account/chain switches. */
export function watchBrowserWallet(): () => void {
  const provider = getInjectedProvider();
  if (!provider?.on) return () => {};

  const onAccounts = (...args: unknown[]) => {
    const accounts = args[0] as Address[] | undefined;
    if (!accounts?.length) setBrowserWallet(null);
    else void restoreBrowserWallet();
  };
  const onChain = () => void restoreBrowserWallet();

  provider.on("accountsChanged", onAccounts);
  provider.on("chainChanged", onChain);
  return () => {
    provider.removeListener?.("accountsChanged", onAccounts);
    provider.removeListener?.("chainChanged", onChain);
  };
}
