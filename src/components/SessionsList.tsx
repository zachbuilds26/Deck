"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type { Hex } from "viem";
import ExternalArrow from "@/components/ExternalArrow";
import { BSCSCAN_URL } from "@/lib/constants";
import { createAltanaClient, revokeAgentSession } from "@/lib/altana";
import {
  getSessionsSnapshot,
  markSessionRevoked,
  sessionState,
  subscribeSessions,
  NO_SESSIONS,
  type StoredAgentSession,
} from "@/lib/session-store";
import {
  getConnectedWallet,
  subscribeConnectedWallet,
  type ConnectedWallet,
} from "@/lib/wallet-store";

const STATE_STYLES = {
  active: { label: "Active", dot: "bg-[#33fba1]", text: "text-[#8fdcb8]" },
  revoked: { label: "Revoked", dot: "bg-[#e5484d]", text: "text-[#c98b8d]" },
  expired: { label: "Expired", dot: "bg-[#4a4a4a]", text: "text-[#7c7c7c]" },
} as const;

function formatCap(entry: StoredAgentSession): string {
  const spend = entry.stored.permissions.spend?.[0];
  if (!spend) return "No cap set";
  const whole = Number(BigInt(spend.limit) / 10n ** 18n);
  const fraction = Number(BigInt(spend.limit) % 10n ** 18n) / 1e18;
  return `${(whole + fraction).toLocaleString(undefined, { maximumFractionDigits: 4 })} $U / ${spend.period}`;
}

function formatExpiry(expiry: number): string {
  const ms = expiry * 1000 - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `in ${hours} hour${hours === 1 ? "" : "s"}`;
}

export default function SessionsList() {
  const wallet = useSyncExternalStore(
    subscribeConnectedWallet,
    getConnectedWallet,
    () => null as ConnectedWallet | null
  );
  const sessions = useSyncExternalStore(
    subscribeSessions,
    getSessionsSnapshot,
    () => NO_SESSIONS as StoredAgentSession[]
  );

  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const mine = wallet
    ? sessions.filter((s) => s.walletAddress.toLowerCase() === wallet.address.toLowerCase())
    : [];

  async function revoke(entry: StoredAgentSession) {
    if (!wallet) return;
    // Destructive and onchain: first tap arms, second tap fires.
    if (confirmKey !== entry.publicKey) {
      setConfirmKey(entry.publicKey);
      return;
    }
    setConfirmKey(null);
    setRevoking(entry.publicKey);
    setError("");
    try {
      // One transaction, immediate effect. Only the publicKey is needed.
      const result = await revokeAgentSession(
        createAltanaClient(),
        wallet.wallet,
        wallet.signer,
        entry.publicKey as Hex
      );
      markSessionRevoked(entry.publicKey, result.transactionHash);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke this session.");
    } finally {
      setRevoking(null);
    }
  }

  if (!wallet) {
    return (
      <div className="deck-frame mt-4 border border-[#2f2f2f] bg-[#141414] px-6 py-14 text-center">
        <p className="text-[10px] font-bold uppercase text-[#F0B90B]">Wallet not connected</p>
        <h3 className="mt-3 text-xl font-bold text-[#f5f5f5]">
          Connect to see your sessions.
        </h3>
        <p className="mx-auto mt-3 max-w-md text-[13px] leading-6 text-[#999]">
          Session keys belong to a wallet. Connect the one you hire with and every permission you
          have granted appears here.
        </p>
      </div>
    );
  }

  if (mine.length === 0) {
    return (
      <div className="deck-frame mt-4 border border-[#2f2f2f] bg-[#141414] px-6 py-14 text-center">
        <p className="text-[10px] font-bold uppercase text-[#F0B90B]">No active sessions</p>
        <h3 className="mt-3 text-xl font-bold text-[#f5f5f5]">
          No agent holds a session on this wallet.
        </h3>
        <p className="mx-auto mt-3 max-w-md text-[13px] leading-6 text-[#999]">
          Hire an agent and its session appears here, revocable at any time.
        </p>
        <Link
          href="/"
          className="chamfer mt-7 inline-flex h-11 items-center bg-[#F0B90B] px-6 text-[12px] font-bold text-black transition-[transform,opacity] hover:opacity-90 active:scale-[0.98]"
        >
          Hire an agent
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {error && (
        <p
          role="alert"
          className="border border-[#4a1e20] bg-[#1a0d0e] p-3 text-[11px] leading-5 text-[#ff8d8d]"
        >
          {error}
        </p>
      )}

      {mine.map((entry) => {
        const state = sessionState(entry);
        const style = STATE_STYLES[state];
        const calls = entry.stored.permissions.calls ?? [];

        return (
          <article
            key={entry.publicKey}
            className="deck-frame border border-[#2f2f2f] bg-[#141414] p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-[15px] font-semibold text-[#f5f5f5]">
                    {entry.agentName}
                  </h2>
                  <span
                    className={`flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase ${style.text}`}
                  >
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                    {style.label}
                  </span>
                </div>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-[#666]">
                  Session key {entry.publicKey.slice(0, 10)}…{entry.publicKey.slice(-6)}
                </p>
              </div>

              {state === "active" && (
                <button
                  type="button"
                  onClick={() => revoke(entry)}
                  disabled={revoking !== null}
                  aria-label={
                    confirmKey === entry.publicKey
                      ? `Confirm revoking ${entry.agentName}`
                      : `Revoke ${entry.agentName}`
                  }
                  className="h-9 shrink-0 px-1 text-[11px] font-bold text-[#ff8d8d] underline-offset-4 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
                >
                  {revoking === entry.publicKey
                    ? "Revoking…"
                    : confirmKey === entry.publicKey
                      ? "Confirm revoke"
                      : "Revoke"}
                </button>
              )}
            </div>

            <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-[#242424] pt-4 sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-[11px] text-[#7c7c7c]">Spend cap</dt>
                <dd className="text-[11px] font-semibold text-[#e4e4e4]">{formatCap(entry)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[11px] text-[#7c7c7c]">Expires</dt>
                <dd className="text-[11px] font-semibold text-[#e4e4e4]">
                  {formatExpiry(entry.expiry)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[11px] text-[#7c7c7c]">May call</dt>
                <dd className="text-right text-[11px] font-semibold text-[#e4e4e4]">
                  {calls.length === 0
                    ? "Any contract"
                    : calls
                        .map((call) => ("to" in call && call.to ? `${call.to.slice(0, 6)}…${call.to.slice(-4)}` : "any"))
                        .join(", ")}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[11px] text-[#7c7c7c]">Proof</dt>
                <dd className="text-[11px] font-semibold">
                  {entry.revokeTxHash || entry.grantTxHash ? (
                    <a
                      href={`${BSCSCAN_URL}/tx/${entry.revokeTxHash || entry.grantTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[#F0B90B] underline underline-offset-4"
                    >
                      {entry.revokeTxHash ? "Revoke tx" : "Grant tx"}
                      <ExternalArrow />
                    </a>
                  ) : (
                    <span className="text-[#666]">Not recorded</span>
                  )}
                </dd>
              </div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}
