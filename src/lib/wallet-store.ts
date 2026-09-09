"use client";

import type { PasskeyCredential, Signer, Wallet } from "@altananetwork/sdk";

export type ConnectedWallet = {
  address: `0x${string}`;
  wallet: Wallet;
  signer: Signer;
};

/**
 * Saved passkey handles — the ONLY way back into a wallet that has never
 * transacted. KeyStore recovery needs one onchain registration, so a fresh
 * wallet refreshed before its first transaction is otherwise a deadlock:
 * no local key, nothing onchain, refresh wiped memory. The stored credential
 * is an id + public key (persistable by SDK design); the private key never
 * leaves the device authenticator.
 */
export type StoredPasskey = {
  address: string;
  credential: PasskeyCredential;
};

const PASSKEYS_KEY = "deck-passkeys";

export function listStoredPasskeys(): StoredPasskey[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PASSKEYS_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredPasskey[]) : [];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.credential) : [];
  } catch {
    return [];
  }
}

export function saveStoredPasskey(entry: StoredPasskey): void {
  if (typeof window === "undefined") return;
  // Only webauthn handles are persistable (id + public key). A headless
  // credential carries a raw private key and must never touch storage.
  const credential = entry.credential;
  if (credential.kind !== "webauthn") return;
  try {
    const known = listStoredPasskeys().filter(
      (existing) =>
        existing.credential.kind !== "webauthn" ||
        (existing.credential.kind === "webauthn" && existing.credential.id !== credential.id)
    );
    window.localStorage.setItem(PASSKEYS_KEY, JSON.stringify([...known, entry]));
  } catch {
    // Private mode etc. — recovery just falls back to the Keystore path.
  }
}

let activeWallet: ConnectedWallet | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function getConnectedWallet(): ConnectedWallet | null {
  return activeWallet;
}

export function setConnectedWallet(wallet: ConnectedWallet | null) {
  activeWallet = wallet;
  notify();
}

export function subscribeConnectedWallet(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function formatWallet(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
