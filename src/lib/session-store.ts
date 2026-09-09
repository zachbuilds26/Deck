"use client";

import { serializeSession } from "@altananetwork/sdk";
import type { Hex } from "viem";

const STORAGE_KEY = "deck-agent-sessions";

/**
 * A granted session as Deck stores it: the SDK's JSON-safe half plus our own
 * labelling. No key material is ever written here — revocation needs only the
 * session's publicKey, which the Altana account contract uses as its identifier.
 */
export type StoredAgentSession = {
  /** Onchain identifier, and all that revocation requires. */
  publicKey: Hex;
  walletAddress: Hex;
  /** Chain the Keystore lives on — sessions (and revocations) are per-chain. */
  chainId: number;
  agentId: string;
  agentName: string;
  /** Serialized SDK session — permissions, expiry, no secret. */
  stored: ReturnType<typeof serializeSession>;
  expiry: number;
  grantedAt: string;
  grantTxHash?: string;
  revokedAt?: string;
  revokeTxHash?: string;
};

export const NO_SESSIONS: readonly StoredAgentSession[] = Object.freeze([]);

/**
 * Cached because useSyncExternalStore compares snapshots with Object.is on every
 * render. Returning a freshly parsed array each time throws "The result of
 * getSnapshot should be cached to avoid an infinite loop".
 */
let snapshot: StoredAgentSession[] | null = null;

function isStoredSession(entry: unknown): entry is StoredAgentSession {
  if (!entry || typeof entry !== "object") return false;
  const session = entry as Record<string, unknown>;
  return typeof session.publicKey === "string" && typeof session.grantedAt === "string";
}

function read(): StoredAgentSession[] {
  if (snapshot) return snapshot;
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const sessions = Array.isArray(parsed) ? parsed.filter(isStoredSession) : [];
    snapshot = sessions.sort((a, b) =>
      String(b.grantedAt).localeCompare(String(a.grantedAt))
    );
  } catch {
    snapshot = [];
  }
  return snapshot;
}

/** Stable reference for useSyncExternalStore. Filter in the component. */
export function getSessionsSnapshot(): StoredAgentSession[] {
  return read();
}

const listeners = new Set<() => void>();

function write(sessions: StoredAgentSession[]) {
  snapshot = sessions;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      // Quota/private mode: memory still serves this session.
    }
  }
  listeners.forEach((listener) => listener());
}

export function subscribeSessions(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listSessions(walletAddress?: string): StoredAgentSession[] {
  const all = read();
  const scoped = walletAddress
    ? all.filter((s) => s.walletAddress.toLowerCase() === walletAddress.toLowerCase())
    : all;
  return scoped.sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
}

export function saveSession(entry: StoredAgentSession) {
  const all = read().filter((s) => s.publicKey !== entry.publicKey);
  write([entry, ...all]);
}

export function markSessionRevoked(publicKey: string, revokeTxHash?: string) {
  write(
    read().map((s) =>
      s.publicKey === publicKey
        ? { ...s, revokedAt: new Date().toISOString(), revokeTxHash }
        : s
    )
  );
}

export function isSessionActive(entry: StoredAgentSession): boolean {
  if (entry.revokedAt) return false;
  return entry.expiry * 1000 > Date.now();
}

export function sessionState(entry: StoredAgentSession): "active" | "revoked" | "expired" {
  if (entry.revokedAt) return "revoked";
  return entry.expiry * 1000 > Date.now() ? "active" : "expired";
}
