"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  createAltanaClient,
  recoverPasskeyWallet,
  recoverWalletFromKeychain,
} from "@/lib/altana";
import type { PasskeyCredential } from "@altananetwork/sdk";
import BrandMark from "@/components/BrandMark";
import CopyButton from "@/components/CopyButton";
import type { ConnectedWallet } from "@/lib/wallet-store";
import {
  formatWallet,
  getConnectedWallet,
  listStoredPasskeys,
  saveStoredPasskey,
  setConnectedWallet,
  subscribeConnectedWallet,
} from "@/lib/wallet-store";

type Balances = { native: string; tokens: { symbol: string; balance: string }[] };

/**
 * Deck's wallet is an Altana 7702 smart account with a passkey admin signer.
 *
 * It cannot be MetaMask: per Altana's docs, "extension wallets refuse the
 * signatures a 7702 smart account needs — by design, as anti-drain protection."
 * MetaMask's role is funding, handled in the hire flow.
 *
 * Recovery is two-tier. Saved passkey handles (id + public key, no secrets)
 * rebuild the wallet with zero onchain history — the only path for a wallet
 * that never transacted. Otherwise recovery is a pure onchain read — two
 * eth_calls plus one biometric prompt — which needs one prior transaction.
 */
async function recoverExisting(): Promise<ConnectedWallet> {
  const client = createAltanaClient();
  for (const stored of listStoredPasskeys()) {
    try {
      const rebuilt = await recoverPasskeyWallet(client, stored.credential);
      return { address: rebuilt.address, wallet: rebuilt.wallet, signer: rebuilt.signer };
    } catch {
      // Stale handle (foreign origin, pruned authenticator) — try the next.
    }
  }
  const result = await recoverWalletFromKeychain(client);
  return { address: result.address, wallet: result.wallet, signer: result.signer };
}

async function createFresh(): Promise<ConnectedWallet> {
  const client = createAltanaClient();
  const result = await client.createPasskeyWallet({ name: "Deck Wallet" });
  // Persisted now, not later: this handle is the only way back in before the
  // first transaction writes anything onchain. Public key + id only — the
  // private key stays in the device authenticator.
  const credential = (result.signer as unknown as { credential?: PasskeyCredential })
    .credential;
  if (credential) {
    saveStoredPasskey({ address: result.address as string, credential });
  }
  return {
    address: result.address as `0x${string}`,
    wallet: result,
    signer: result.signer,
  } satisfies ConnectedWallet;
}

/** The picker found a passkey whose wallet never transacted — recovery's dead
 *  end without a saved handle. Worded as what it is, not "not found". */
function isUntransactedWallet(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /no keys registered in KeyStore yet|never executed a transaction/i.test(message);
}

function isCancellation(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? "";
  const message = error instanceof Error ? error.message : "";
  return /NotAllowed|Abort/i.test(name) || /NotAllowed|abort|cancel/i.test(message);
}

/** Does this device hover?
 *
 *  Without the check, a tap on a tablet fires a synthetic mouseenter and THEN the
 *  click: hover opens the wallet panel, the click toggles it straight back shut,
 *  and the button looks broken. On a touch device the hover handlers must do
 *  nothing and the click stays the only way in.
 *
 *  Read through useSyncExternalStore rather than an effect: matchMedia IS an
 *  external store, the server snapshot is a truthful `false`, and plugging in a
 *  mouse mid-session flips it without a reload. */
const HOVER_QUERY = "(hover: hover) and (pointer: fine)";

function subscribeHover(onChange: () => void) {
  const query = window.matchMedia(HOVER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function hoverSnapshot() {
  return window.matchMedia(HOVER_QUERY).matches;
}

export default function WalletButton({ mobile = false }: { mobile?: boolean }) {
  const wallet = useSyncExternalStore(
    subscribeConnectedWallet,
    getConnectedWallet,
    () => null as ConnectedWallet | null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offerCreate, setOfferCreate] = useState(false);
  const [open, setOpen] = useState(false);
  const [balances, setBalances] = useState<Balances | null>(null);
  /** Pending hover-out close, so a trip across the gap to the panel cannot
   *  cancel itself. Cleared on unmount — a timer that fires after the component
   *  is gone calls setState on nothing. */
  const closeTimer = useRef<number | null>(null);
  const canHover = useSyncExternalStore(subscribeHover, hoverSnapshot, () => false);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    []
  );

  // Balances are read only while the panel is open, so a connected wallet costs
  // nothing until the user actually asks.
  useEffect(() => {
    if (!open || !wallet) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/wallet?address=${encodeURIComponent(wallet.address)}`);
        const payload = await res.json();
        if (!cancelled && res.ok) setBalances(payload.data ?? null);
      } catch {
        // Leave balances unknown rather than showing a wrong zero.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, wallet]);

  const baseClasses = mobile
    ? "mt-2 h-11 w-full text-[13px] font-bold"
    : "hidden h-10 px-4 text-[13px] font-bold md:block";
  const accentClasses = `chamfer ${baseClasses} bg-[#F0B90B] text-black transition-[transform,opacity] enabled:hover:opacity-90 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60`;
  const quietClasses = `${baseClasses} border border-[#2f2f2f] text-[#f5f5f5] transition-colors hover:border-[#666]`;

  const label = useMemo(() => {
    if (busy) return offerCreate ? "Creating…" : "Unlocking…";
    if (wallet) return formatWallet(wallet.address);
    return offerCreate ? "Create wallet" : "Connect Wallet";
  }, [busy, offerCreate, wallet]);

  async function handleClick() {
    if (busy) return;
    if (wallet) {
      setOpen((value) => !value);
      return;
    }

    setBusy(true);
    setError("");
    try {
      // A new wallet is only minted when the user asks, so a cancelled unlock can
      // never silently create a second one.
      setConnectedWallet(offerCreate ? await createFresh() : await recoverExisting());
      setOfferCreate(false);
    } catch (caught) {
      if (isCancellation(caught)) {
        setError("Passkey prompt was dismissed.");
      } else if (offerCreate) {
        setError("Could not create a wallet. Your browser must support passkeys.");
      } else if (isUntransactedWallet(caught)) {
        setOfferCreate(true);
        setError(
          "Found your passkey, but its wallet never completed a transaction — and this device has no saved handle for it, so there is nothing to rebuild from. Create a fresh wallet (this device will remember it)."
        );
      } else {
        setOfferCreate(true);
        setError(
          "No wallet found on this device yet. Create one — this device remembers it, so reconnecting always works."
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    setConnectedWallet(null);
    setOpen(false);
    setBalances(null);
    setOfferCreate(false);
  }

  const u = balances?.tokens.find((token) => token.symbol === "U");

  // Hover opens the panel on pointer devices; click still works and is the only
  // way in on touch, where there is no hover at all.
  //
  // The listeners sit on the WRAPPER, not the button, so moving the cursor down
  // into the panel keeps it open — on the button alone, leaving the button to
  // reach the balances closes the thing you were reaching for. The close is
  // delayed ~140ms because `mt-2` puts a real gap between button and panel, and
  // crossing it fires mouseleave before the panel's mouseenter lands.
  //
  // Focus is wired the same way for keyboard users, via focusin/focusout on the
  // wrapper rather than the button, so tabbing into Disconnect does not dismiss
  // the panel holding it.
  function openOnHover() {
    if (!wallet || mobile || !canHover) return;
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }

  function closeOnLeave() {
    if (!wallet || mobile || !canHover) return;
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, 140);
  }

  const panel = (
    <div
      className={
        mobile
          ? "mt-2 border border-[#2f2f2f] bg-[#0d0d0d] p-3"
          : "absolute right-0 z-50 mt-2 w-[252px] border border-[#2f2f2f] bg-[#0d0d0d] p-4"
      }
    >
      <p className="flex items-center gap-2 text-[10px] font-bold uppercase leading-none text-[#666]">
        {/* The wallet IS an Altana 7702 smart account (see the note at the top of
            this file). It was labelled "Deck wallet" with nothing crediting the
            infrastructure it runs on. label={false} — "Altana" is in the text. */}
        <BrandMark id="altana" size={14} label={false} />
        Altana wallet
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-[#d3d3d3]">
        <span className="truncate">{wallet ? formatWallet(wallet.address) : ""}</span>
        {wallet && <CopyButton value={wallet.address} label="Copy wallet address" />}
      </p>

      <dl className="mt-3 space-y-1.5 border-t border-[#242424] pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[11px] text-[#7c7c7c]">$U</dt>
          <dd className="text-[11px] font-semibold text-[#e4e4e4]">
            {u ? u.balance : balances ? "0" : "…"}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[11px] text-[#7c7c7c]">BNB</dt>
          <dd className="text-[11px] font-semibold text-[#e4e4e4]">
            {balances ? Number(balances.native).toFixed(4) : "…"}
          </dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={disconnect}
        className="mt-4 h-9 w-full border border-[#5c2427] text-[11px] font-bold text-[#ff8d8d] transition-colors hover:border-[#8a3439] hover:bg-[#1a0d0e]"
      >
        Disconnect
      </button>
    </div>
  );

  return (
    <div
      className={mobile ? "relative mt-2" : "relative"}
      onMouseEnter={openOnHover}
      onMouseLeave={closeOnLeave}
      onFocus={openOnHover}
      onBlur={closeOnLeave}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-expanded={wallet ? open : undefined}
        title={wallet ? wallet.address : undefined}
        className={wallet ? quietClasses : accentClasses}
      >
        {label}
      </button>

      {wallet && open && panel}
      {/* Touch devices get no hover, so the click-toggle needs a way out that is
          not "tap the button again": a backdrop that dismisses. Fine-pointer
          devices close on mouseleave and never see this. */}
      {wallet && open && !mobile && !canHover && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
      )}

      {error && (
        <p
          role="alert"
          className={
            mobile
              ? "mt-2 text-[10px] leading-4 text-[#ff8d8d]"
              : "absolute right-0 z-50 mt-2 w-[268px] border border-[#3a2f08] bg-[#0d0d0d] p-3 text-[10px] leading-4 text-[#e8b339]"
          }
        >
          {error}
        </p>
      )}
    </div>
  );
}
