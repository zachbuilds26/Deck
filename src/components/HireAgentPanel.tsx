"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { encodeFunctionData, erc20Abi, isAddress, parseEther, type Address } from "viem";
import BrandMark, { type BrandId } from "@/components/BrandMark";
import ExternalArrow from "@/components/ExternalArrow";
import {
  createAltanaClient,
  getBalances,
  getEscrowPaymentToken,
  grantAgentSession,
  hireAgent,
} from "@/lib/altana";
import {
  connectBrowserWallet,
  discoverInjectedWallets,
  getBrowserWallet,
  getInjectedProvider,
  switchChain,
  watchBrowserWallet,
  NoWalletError,
  type DiscoveredWallet,
  type Eip1193Provider,
} from "@/lib/browser-wallet";
import { CONTRACTS } from "@/lib/contracts";
import { BSC_CHAIN_ID, BSCSCAN_URL } from "@/lib/constants";
import {
  formatWallet,
  getConnectedWallet,
  subscribeConnectedWallet,
  type ConnectedWallet,
} from "@/lib/wallet-store";
import { endpointStatus } from "@/lib/agent-status";
import { saveSession } from "@/lib/session-store";
import { saveJob, type AdvantageCategory } from "@/lib/job-store";
import { serializeSession } from "@altananetwork/sdk";
import type { Agent } from "@/lib/types";

type Step = "idle" | "granting-session" | "funding-job" | "complete" | "error";

/** Wizard position: 1 = describe the job, 2 = review budget and permissions,
 *  3 = sign and fund. Separate from Step, which tracks the onchain run. */
type Phase = 1 | 2 | 3;

const EXPIRY_DAYS = 7;

/**
 * Native buffer the passkey wallet must hold before Execute. Granting a
 * session performs two payable Keystore registrations (~0.000664 BNB each,
 * read live off the controller) — a wallet with $U but 0 BNB reverts with an
 * empty reason, which is the opaque "Reason: 0x" failure. 0.003 covers both
 * with margin; the relay handles execution gas separately.
 */
const KEYSTORE_FEE_BUFFER_WEI = parseEther("0.003");

/** Offered budgets, in $U. A bare text box gave no sense of what a job costs —
 *  the one decision that actually matters here was the least designed control on
 *  the page. Custom entry is still there for anything off-ladder. */
const BUDGET_PRESETS = ["1", "5", "10", "25"];

function SectionHead({ index, title, hint }: { index: string; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <span className="text-[11px] font-bold text-[#F0B90B]">{index}</span>
      <div>
        <h2 className="text-[15px] font-bold leading-none text-[#f5f5f5]">{title}</h2>
        {hint && <p className="mt-2 text-[11px] leading-5 text-[#7c7c7c]">{hint}</p>}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="text-[11px] text-[#7c7c7c]">{label}</span>
      <span className="text-right text-[11px] font-semibold text-[#e4e4e4]">{value}</span>
    </div>
  );
}

const PHASES = [
  { n: 1 as Phase, label: "Job", hint: "Describe the work" },
  { n: 2 as Phase, label: "Review", hint: "Budget & permissions" },
  { n: 3 as Phase, label: "Execute", hint: "Sign & fund" },
];

/** The three stages of every hire, always visible so the user knows where
 *  they are and what is left. Earlier stages are clickable to go back —
 *  forward motion only happens through each stage's own button, which is
 *  what enforces the validation order. */
function Stepper({
  phase,
  complete,
  locked,
  onBack,
}: {
  phase: Phase;
  complete: boolean;
  locked: boolean;
  onBack: (target: Phase) => void;
}) {
  return (
    <ol className="grid grid-cols-3 border border-[#2f2f2f] bg-[#141414]">
      {PHASES.map(({ n, label, hint }, index) => {
        const done = complete || n < phase;
        const current = !complete && n === phase;
        const clickable = !locked && !complete && n < phase;
        return (
          <li
            key={n}
            className={`relative p-4 sm:p-5 ${index > 0 ? "border-l border-[#2f2f2f]" : ""}`}
          >
            <button
              type="button"
              onClick={() => {
                if (clickable) onBack(n as Phase);
              }}
              disabled={!clickable}
              aria-current={current ? "step" : undefined}
              className={`flex w-full items-start gap-3 text-left ${clickable ? "cursor-pointer" : "cursor-default"}`}
            >
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center text-[11px] font-bold ${
                  done
                    ? "bg-[#10291f] text-[#33fba1]"
                    : current
                      ? "bg-[#F0B90B] text-black"
                      : "border border-[#3c3c3c] text-[#666]"
                }`}
              >
                {done ? "✓" : `0${n}`}
              </span>
              <span>
                <span
                  className={`block text-[12px] font-bold leading-none ${
                    done || current ? "text-[#f5f5f5]" : "text-[#666]"
                  }`}
                >
                  {label}
                </span>
                <span className="mt-1.5 block text-[10px] leading-4 text-[#666]">{hint}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** The wallet Deck last successfully used, so repeat top-ups are one click
 *  and the installed-wallet list never has to be shown. */
const STORED_WALLET_KEY = "deck.browser-wallet-rdns";

function storedWalletRdns(): string | null {
  try {
    return window.localStorage.getItem(STORED_WALLET_KEY);
  } catch {
    return null;
  }
}

function rememberWalletRdns(rdns: string): void {
  try {
    window.localStorage.setItem(STORED_WALLET_KEY, rdns);
  } catch {
    // Private mode etc. — remembering is a convenience, not a requirement.
  }
}

/** Native balance for display: 4 decimals, no trailing noise. */
function trimBnb(value: string): string {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(4) : value;
}

/** A positive finite number, or undefined for blank/invalid. Baselines are
 *  optional, so there is no error state — unparseable just means excluded. */
function parsePositiveNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * True when the user said no in their wallet. Matched on wording, not just
 * error code, because wallets report it differently — code 4001 on some, a
 * "denied request signature" sentence on others — and an unrecognized
 * rejection used to print viem's full calldata dump on screen.
 */
function isWalletRejection(error: unknown): boolean {
  if ((error as { code?: number })?.code === 4001) return true;
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (current instanceof Error) parts.push(current.message);
    else if (typeof current === "string") parts.push(current);
    current = (current as { cause?: unknown })?.cause;
  }
  return /user (rejected|denied)|denied request|rejected the request|action rejected|transaction rejected/i.test(
    parts.join(" ")
  );
}

function Progress({ step }: { step: Step }) {
  // Each stage runs on a different piece of infrastructure — the session is
  // Altana's keystore, the escrow is an ERC-8183 contract on BSC — so the marks
  // say which one you are waiting on rather than decorating the list.
  //
  // Rendered BEFORE the run as well as during it. A checkout should say what is
  // about to happen; narrating it only once the button is pressed is too late to
  // be reassuring.
  const stages: [Step, string, BrandId][] = [
    ["granting-session", "Grant scoped session", "altana"],
    ["funding-job", "Fund job escrow", "bnb"],
  ];
  return (
    <div className="mt-4 space-y-2 border-t border-[#242424] pt-4">
      {stages.map(([id, label, brand]) => {
        const done = step === "complete" || (id === "granting-session" && step === "funding-job");
        const active = step === id;
        return (
          <p
            key={id}
            className={`flex items-center gap-2 text-[10px] font-bold uppercase leading-none ${done ? "text-[#33fba1]" : active ? "text-[#F0B90B]" : "text-[#555]"}`}
          >
            <span aria-hidden="true" className="w-2">
              {done ? "✓" : active ? "•" : ""}
            </span>
            <BrandMark id={brand} size={14} label={false} className={done || active ? "" : "opacity-40"} />
            {label}
          </p>
        );
      })}
    </div>
  );
}

export default function HireAgentPanel({ agent }: { agent: Agent }) {
  const wallet = useSyncExternalStore(
    subscribeConnectedWallet,
    getConnectedWallet,
    () => null as ConnectedWallet | null
  );

  const [task, setTask] = useState("");
  const [budget, setBudget] = useState("1");
  /** TermiX baseline, captured where the work is described. Optional — a job
   *  without it simply never enters an Agent Advantage report. */
  const [category, setCategory] = useState<AdvantageCategory>("general");
  const [manualHours, setManualHours] = useState("");
  const [manualCost, setManualCost] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [phase, setPhase] = useState<Phase>(1);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ jobId: string; txHash?: string }>();
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [nativeBalances, setNativeBalances] = useState<Record<string, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [funding, setFunding] = useState(false);
  const [fundError, setFundError] = useState("");
  /** Wallets found via EIP-6963 when the user has more than one — null means
   *  the chooser is closed. */
  const [browserOptions, setBrowserOptions] = useState<DiscoveredWallet[] | null>(null);
  const [discovering, setDiscovering] = useState(false);

  const provider = agent.owner;
  const validProvider = isAddress(provider);
  const busy = step === "granting-session" || step === "funding-job";
  const status = endpointStatus(agent);
  // Read from the escrow contract set, never hardcoded — see getEscrowPaymentToken.
  const escrowToken = getEscrowPaymentToken(BSC_CHAIN_ID);

  // Derived rather than stored, so no branch has to setState synchronously in an
  // effect, and switching wallets can never show the previous wallet's balance.
  const balance = wallet ? (balances[wallet.address.toLowerCase()] ?? null) : null;
  const native = wallet ? (nativeBalances[wallet.address.toLowerCase()] ?? null) : null;

  let budgetWei: bigint | null = null;
  try {
    budgetWei = budget.trim() ? parseEther(budget.trim()) : null;
  } catch {
    budgetWei = null;
  }
  const budgetValid = budgetWei !== null && budgetWei > 0n;
  const funded = balance !== null && budgetWei !== null && parseEther(balance) >= budgetWei;
  // `native` is only ever null or a formatEther string, so this parse cannot throw.
  const bnbReady = native !== null && parseEther(native) >= KEYSTORE_FEE_BUFFER_WEI;
  const needsU = budgetValid && !funded;
  const needsBnb = !bnbReady;
  const manualHoursValue = parsePositiveNumber(manualHours);
  const manualCostValue = parsePositiveNumber(manualCost);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;

    (async () => {
      try {
        const client = createAltanaClient();
        const result = await getBalances(client, wallet.wallet, [escrowToken]);
        const u = result.tokens.find(
          (token) => token.address.toLowerCase() === escrowToken.toLowerCase()
        );
        if (!cancelled) {
          setBalances((prev) => ({ ...prev, [wallet.address.toLowerCase()]: u?.balance ?? "0" }));
          setNativeBalances((prev) => ({ ...prev, [wallet.address.toLowerCase()]: result.native }));
        }
      } catch {
        // Leave the balance unknown rather than claiming zero.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wallet, refreshKey, escrowToken]);

  // Without this, switching account or network in MetaMask mid-flow goes unnoticed
  // and the funding transfer is built against a stale address.
  useEffect(() => watchBrowserWallet(), []);

  /**
   * Tops the passkey wallet up from the user's own extension wallet — Altana's
   * documented pattern, where the extension is the funding source and the
   * passkey account is the signing authority. One confirm popup, no copy-paste.
   */
  async function fundFromBrowserWallet(preferred?: Eip1193Provider) {
    if (!wallet || budgetWei === null) return;
    if (!needsU && !needsBnb) return;
    setFunding(true);
    setFundError("");
    setBrowserOptions(null);
    try {
      const browser = getBrowserWallet() ?? (await connectBrowserWallet(preferred));
      if (browser.chainId !== BSC_CHAIN_ID) await switchChain(BSC_CHAIN_ID, preferred);

      const active = getBrowserWallet();
      if (!active) throw new Error("Browser wallet disconnected.");

      // BNB first: without the buffer the grant's payable Keystore calls revert
      // and Execute dies with an empty reason. Then the $U budget, if short.
      // Sequential confirms — a rejection stops the second transfer.
      if (needsBnb) {
        await active.client.sendTransaction({
          account: active.address,
          chain: active.client.chain,
          to: wallet.address,
          value: KEYSTORE_FEE_BUFFER_WEI,
        });
      }
      if (needsU) {
        await active.client.sendTransaction({
          account: active.address,
          chain: active.client.chain,
          to: escrowToken,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [wallet.address, budgetWei],
          }),
        });
      }

      setRefreshKey((key) => key + 1);
    } catch (caught) {
      if (caught instanceof NoWalletError) {
        setFundError("No browser wallet found. Install MetaMask, Trust Wallet or Binance Wallet.");
      } else if (isWalletRejection(caught)) {
        setFundError("Transfer rejected in your wallet. Nothing was sent — click again when ready.");
      } else {
        setFundError(caught instanceof Error ? caught.message : "The transfer failed.");
      }
    } finally {
      setFunding(false);
    }
  }

  /**
   * One click, no wallet list. Deck silently reuses the wallet it used last
   * time, else the only wallet installed, else the legacy default provider.
   * With several new wallets it starts with the first — connecting is
   * harmless and the confirm popup names the sending account, so a wrong
   * guess costs a rejection, not funds. "Use a different wallet" below is the
   * only place the list ever appears, and only when asked for.
   */
  async function chooseBrowserWallet() {
    if (!wallet || budgetWei === null || funding || discovering) return;
    if (getBrowserWallet()) {
      void fundFromBrowserWallet();
      return;
    }
    setDiscovering(true);
    setFundError("");
    try {
      const found = await discoverInjectedWallets();
      const stored = storedWalletRdns();
      const pick =
        found.find((entry) => entry.rdns === stored) ??
        (found.length === 1 ? found[0] : undefined) ??
        found.find((entry) => entry.provider === getInjectedProvider()) ??
        found[0];
      if (pick) {
        rememberWalletRdns(pick.rdns);
        await fundFromBrowserWallet(pick.provider);
      } else {
        // No 6963 announcements — fall back to the legacy provider, which
        // throws NoWalletError itself when nothing is there.
        await fundFromBrowserWallet();
      }
    } catch (caught) {
      setFundError(caught instanceof Error ? caught.message : "Could not reach a browser wallet.");
    } finally {
      setDiscovering(false);
    }
  }

  /** Opens the installed-wallet list on demand — the only place it appears. */
  async function openWalletOptions() {
    if (!wallet || budgetWei === null || funding || discovering) return;
    setDiscovering(true);
    setFundError("");
    try {
      const found = await discoverInjectedWallets();
      if (found.length === 0) {
        await fundFromBrowserWallet();
      } else {
        setBrowserOptions(found);
      }
    } catch (caught) {
      setFundError(caught instanceof Error ? caught.message : "Could not list browser wallets.");
    } finally {
      setDiscovering(false);
    }
  }

  /** Wizard navigation. Clears a stale execution error so going back to fix
   *  things never shows yesterday's failure next to today's form. */
  function goPhase(target: Phase) {
    if (busy || (step === "complete" && target !== phase)) return;
    if (step === "error") {
      setStep("idle");
      setError("");
    }
    setPhase(target);
  }

  async function beginHire() {
    if (!wallet) {
      setError("Connect your wallet first — the header button opens it.");
      setStep("error");
      return;
    }
    if (!validProvider) {
      setError("This agent has no valid owner address to pay.");
      setStep("error");
      return;
    }
    if (!task.trim()) {
      setError("Describe the task before creating the job.");
      setStep("error");
      return;
    }
    if (!budgetValid || budgetWei === null) {
      setError("Enter a budget greater than zero.");
      setStep("error");
      return;
    }
    if (!funded) {
      setError("Your passkey balance is short of the budget — top it up on the Review step first.");
      setStep("error");
      return;
    }
    if (!bnbReady) {
      setError(
        "Your passkey wallet needs ~0.003 BNB for the Keystore registration fee — top it up on the Review step first."
      );
      setStep("error");
      return;
    }

    setError("");
    try {
      const client = createAltanaClient();

      setStep("granting-session");
      const session = await grantAgentSession(client, wallet.wallet, wallet.signer, {
        allowedContracts: [CONTRACTS.AGENTIC_COMMERCE as Address],
        spendLimit: budgetWei,
        spendPeriod: "day",
        spendToken: escrowToken,
        expiryDays: EXPIRY_DAYS,
      });

      // Persisted so /sessions can list and revoke it. No key material is stored —
      // revocation needs only the publicKey.
      saveSession({
        publicKey: session.publicKey,
        walletAddress: wallet.address,
        chainId: BSC_CHAIN_ID,
        agentId: agent.agentId,
        agentName: agent.name,
        stored: serializeSession(session),
        expiry: session.expiry,
        grantedAt: new Date().toISOString(),
        grantTxHash: session.transactionHash,
      });

      setStep("funding-job");
      const hired = await hireAgent(client, wallet.wallet, wallet.signer, {
        provider: provider as Address,
        task: task.trim(),
        budget: budgetWei,
        deadlineSeconds: 1800,
      });

      saveJob({
        jobId: hired.jobId.toString(),
        chainId: BSC_CHAIN_ID,
        buyerAddress: wallet.address,
        agentId: agent.agentId,
        agentName: agent.name,
        task: task.trim(),
        budgetWei: budgetWei.toString(),
        createdAt: new Date().toISOString(),
        txHash: hired.txHash,
        category,
        ...(manualHoursValue !== undefined ? { manualHours: manualHoursValue } : {}),
        ...(manualCostValue !== undefined ? { manualCostUsd: manualCostValue } : {}),
      });

      setResult({ jobId: hired.jobId.toString(), txHash: hired.txHash });
      setStep("complete");
      setRefreshKey((key) => key + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The hire flow could not be completed.");
      setStep("error");
    }
  }

  if (step === "complete" && result) {
    return (
      <div className="space-y-4">
      <Stepper phase={3} complete locked onBack={() => {}} />
      <div className="deck-frame border border-[#225d44] bg-[#10291f] p-6 sm:p-8">
        <p className="text-[10px] font-bold uppercase leading-none text-[#33fba1]">
          Escrow funded
        </p>
        <h2 className="mt-3 text-[24px] font-bold text-[#f5f5f5]">Job {result.jobId} is live.</h2>
        <p className="mt-3 max-w-xl text-[13px] leading-6 text-[#b0d8c2]">
          {agent.name} can act only within the {budget} $U cap you approved, on the escrow
          contract, for {EXPIRY_DAYS} days. You can revoke it at any time.
        </p>

        {/* Both destinations exist to manage exactly what was just created. The old
            success box was a dead end with a BscScan link and nowhere to go. */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/jobs"
            className="chamfer inline-flex h-11 items-center bg-[#F0B90B] px-5 text-[12px] font-bold text-black transition-[transform,opacity] hover:opacity-90 active:scale-[0.98]"
          >
            Track this job
          </Link>
          <Link
            href="/sessions"
            className="inline-flex h-11 items-center border border-[#225d44] px-5 text-[12px] font-bold text-[#33fba1] transition-colors hover:bg-[#154032]"
          >
            Manage permissions
          </Link>
          {result.txHash && (
            <a
              href={`${BSCSCAN_URL}/tx/${result.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#33fba1] underline underline-offset-4"
            >
              View transaction
              <ExternalArrow />
            </a>
          )}
        </div>
      </div>
    </div>
    );
  }

  // Gating, derived so the buttons never disagree with the numbers: Review
  // unlocks once the job is described; Execute unlocks once the passkey
  // wallet actually covers the budget.
  const reviewBlocker = !wallet
    ? "Connect your wallet to continue — the header button opens it."
    : !budgetValid
      ? "Enter a budget greater than zero."
      : !funded
        ? "Top up to the budget to continue."
        : !bnbReady
          ? "Top up ~0.003 BNB for keystore fees to continue."
          : null;

  return (
    <div className="space-y-4">
      <Stepper phase={phase} complete={false} locked={busy} onBack={goPhase} />

      {phase === 1 && (
        <section className="deck-frame border border-[#2f2f2f] bg-[#141414] p-5 sm:p-6">
          <SectionHead
            index="01"
            title="Job"
            hint={`What ${agent.name} should do, the constraints, and what success looks like. This is what the job is settled against.`}
          />
          <textarea
            value={task}
            onChange={(event) => setTask(event.target.value)}
            aria-label="Scope of work"
            placeholder="e.g. Rebalance my PancakeSwap V3 position into the 580–640 BNB band and keep it in range for a week. Report gas spent."
            className="min-h-[184px] w-full resize-y border border-[#2f2f2f] bg-black p-3.5 text-[12px] leading-6 text-[#f5f5f5] placeholder:text-[#555] focus:border-[#F0B90B] focus:outline-none"
          />
          <div className="mt-5 border-t border-[#242424] pt-5">
            <p className="text-[10px] font-bold uppercase text-[#999]">Task kind</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Task kind">
              {(["trading", "equities", "security", "general"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setCategory(kind)}
                  aria-pressed={category === kind}
                  className={`chamfer-sm h-9 px-3 text-[11px] font-bold capitalize transition-colors ${
                    category === kind
                      ? "bg-[#F0B90B] text-black"
                      : "border border-[#2f2f2f] bg-[#101010] text-[#a7a7a7] hover:border-[#666] hover:text-[#f5f5f5]"
                  }`}
                >
                  {kind}
                </button>
              ))}
            </div>
            <p className="mt-5 text-[10px] font-bold uppercase text-[#999]">
              By hand, this would take{" "}
              <span className="font-semibold normal-case text-[#666]">
                — optional, feeds the Agent Advantage comparison
              </span>
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <span className="sr-only">Hours by hand</span>
                <input
                  value={manualHours}
                  onChange={(event) => setManualHours(event.target.value)}
                  inputMode="decimal"
                  placeholder="Hours"
                  className="h-10 w-24 border border-[#2f2f2f] bg-black px-3 text-[12px] text-[#f5f5f5] placeholder:text-[#555] focus:border-[#F0B90B] focus:outline-none"
                />
                <span className="text-[11px] font-semibold text-[#7c7c7c]">hours</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="sr-only">Cost by hand in dollars</span>
                <input
                  value={manualCost}
                  onChange={(event) => setManualCost(event.target.value)}
                  inputMode="decimal"
                  placeholder="Cost"
                  className="h-10 w-24 border border-[#2f2f2f] bg-black px-3 text-[12px] text-[#f5f5f5] placeholder:text-[#555] focus:border-[#F0B90B] focus:outline-none"
                />
                <span className="text-[11px] font-semibold text-[#7c7c7c]">$</span>
              </label>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#242424] pt-5">
            <p className="text-[11px] text-[#7c7c7c]">
              {task.trim()
                ? "Locked in on the next step — you can come back and edit."
                : "Describe the outcome first — review unlocks next."}
            </p>
            <button
              type="button"
              onClick={() => goPhase(2)}
              disabled={!task.trim()}
              className="chamfer h-11 bg-[#F0B90B] px-6 text-[12px] font-bold text-black transition-[transform,opacity] enabled:hover:opacity-90 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#3a2f08] disabled:text-[#6d6d6d]"
            >
              Continue to review
            </button>
          </div>
        </section>
      )}

      {phase === 2 && (
      <>
      {/* Stretch (the default): both cards always end on the same line. Safe
          now that every message lives in a reserved slot — nothing
          content-driven can inflate either column anymore. */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {/* h-full: the grid stretches the column wrapper, but the card inside
            keeps content height unless told otherwise — that gap below it is
            what read as "shorter". */}
        <section className="deck-frame h-full border border-[#2f2f2f] bg-[#141414] p-5 sm:p-6">
          <SectionHead
            index="02"
            title="Review"
            hint="Held in escrow on BNB Smart Chain until the job settles. It is also the agent's hard spend cap."
          />

          <div className="flex flex-wrap items-center gap-1.5">
            {BUDGET_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={busy}
                onClick={() => setBudget(preset)}
                className={`chamfer-sm h-10 min-w-[68px] px-3 text-[12px] font-bold transition-colors disabled:opacity-50 ${
                  budget.trim() === preset
                    ? "bg-[#F0B90B] text-black"
                    : "border border-[#2f2f2f] bg-[#101010] text-[#a7a7a7] hover:border-[#666] hover:text-[#f5f5f5]"
                }`}
              >
                {preset} $U
              </button>
            ))}
            <span className="mx-1 hidden h-6 w-px bg-[#2f2f2f] sm:block" />
            <label className="flex items-center gap-2">
              <span className="sr-only">Custom budget in $U</span>
              <input
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                disabled={busy}
                inputMode="decimal"
                placeholder="Custom"
                className="h-10 w-24 border border-[#2f2f2f] bg-black px-3 text-[12px] text-[#f5f5f5] placeholder:text-[#555] focus:border-[#F0B90B] focus:outline-none disabled:opacity-60"
              />
              <span className="text-[11px] font-semibold text-[#7c7c7c]">$U</span>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#242424] pt-4">
            <p className="text-[11px] text-[#7c7c7c]">
              {!wallet
                ? "Connect your wallet to see your balance."
                : balance === null
                  ? "Checking your balance…"
                  : `Balance ${balance} $U${native !== null ? ` + ${trimBnb(native)} BNB` : ""} · ${formatWallet(wallet.address)}`}
            </p>
            {/* Always rendered once the balance is known: clearing the amount
                swaps the words ("Enter a budget") instead of deleting the row,
                which is what shrank this card. */}
            {wallet && balance !== null && (
              <p
                className={`text-[10px] font-bold uppercase leading-none ${budgetValid && funded && bnbReady ? "text-[#33fba1]" : "text-[#e8b339]"}`}
              >
                {!budgetValid
                  ? "Enter a budget"
                  : !funded
                    ? "Short of budget"
                    : !bnbReady
                      ? "Short on BNB"
                      : "Funded"}
              </p>
            )}
          </div>

          {wallet && balance !== null && (!funded || !bnbReady || !budgetValid) && (
            <div className="mt-3 border border-[#3a2f08] bg-[#100d04] p-3">
              <p className="text-[11px] leading-5 text-[#e8b339]">
                Top up the passkey wallet from your extension wallet — the $U budget
                plus ~0.003 BNB for the Keystore registration fee. One confirm per
                transfer, no copy-paste.
              </p>
              {!budgetValid ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button
                    type="button"
                    disabled
                    className="chamfer-sm h-9 border border-[#5c4a10] px-3 text-[11px] font-bold text-[#F0B90B] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Enter a budget first
                  </button>
                </div>
              ) : (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  onClick={chooseBrowserWallet}
                  disabled={funding || discovering}
                  className="chamfer-sm h-9 border border-[#5c4a10] px-3 text-[11px] font-bold text-[#F0B90B] transition-colors hover:border-[#8a6f18] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {funding
                    ? "Confirm in your wallet…"
                    : discovering
                      ? "Reaching your wallet…"
                      : needsU && needsBnb
                        ? `Send ${budget} $U + BNB for fees`
                        : needsU
                          ? `Send ${budget} $U from browser wallet`
                          : "Send BNB for keystore fees"}
                </button>
                {browserOptions === null && (
                  <button
                    type="button"
                    onClick={openWalletOptions}
                    disabled={funding || discovering}
                    className="text-[10px] font-semibold text-[#666] underline underline-offset-4 hover:text-[#999] disabled:opacity-50"
                  >
                    Use a different wallet
                  </button>
                )}
              </div>
              )}
              {browserOptions !== null && (
                <div className="mt-2.5 space-y-1.5">
                  {browserOptions.map((option) => (
                    <button
                      key={option.uuid}
                      type="button"
                      onClick={() => {
                        rememberWalletRdns(option.rdns);
                        void fundFromBrowserWallet(option.provider);
                      }}
                      disabled={funding}
                      className="flex h-10 w-full items-center gap-2.5 border border-[#5c4a10] bg-black px-3 text-left text-[11px] font-bold text-[#f5f5f5] transition-colors hover:border-[#8a6f18] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {option.icon && (
                        // Brand icon supplied by the wallet itself via EIP-6963.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={option.icon} alt="" width={18} height={18} className="shrink-0" />
                      )}
                      {option.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setBrowserOptions(null)}
                    disabled={funding}
                    className="text-[10px] font-semibold text-[#666] underline underline-offset-4 hover:text-[#999]"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {/* Always rendered with room for two lines: appearing/disappearing
                  text used to grow this column and leave the authorising card
                  beside it looking shorter. */}
              <p role="alert" className="mt-2 min-h-8 text-[10px] leading-4 text-[#ff8d8d]">
                {fundError || " "}
              </p>
            </div>
          )}
        </section>
      </div>

      <aside className="deck-frame flex flex-col border border-[#2f2f2f] bg-[#141414] p-5">
        <p className="text-[10px] font-bold uppercase text-[#999]">You are authorising</p>

        <div className="mt-4 flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-[#f5f5f5]">{agent.name}</span>
          <span
            title={status.title}
            className={`flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase ${status.text}`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        </div>
        <p className="mt-1 text-[10px] uppercase tracking-wide text-[#666]">
          {agent.services.join(" · ") || "No protocol declared"}
        </p>

        <div className="mt-4 divide-y divide-[#242424] border-y border-[#242424]">
          <SummaryRow label="Spend cap" value={budgetValid ? `${budget} $U` : "—"} />
          <SummaryRow label="Can call" value="Escrow contract only" />
          <SummaryRow label="Expires" value={`in ${EXPIRY_DAYS} days`} />
          <SummaryRow label="Revoke" value="Any time, one tx" />
        </div>

        <p className="mt-auto pt-4 text-[11px] leading-5 text-[#7c7c7c]">
          Signing happens once, on the next step — nothing here moves funds.
        </p>
      </aside>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => goPhase(1)}
          className="h-11 border border-[#3c3c3c] px-6 text-[12px] font-semibold text-[#f5f5f5] transition-colors hover:border-[#666] hover:bg-[#1b1b1b]"
        >
          Back
        </button>
        <div className="flex flex-wrap items-center gap-4">
          {/* Reserved single line for the same reason as the fund error slot. */}
          <p className="text-[11px] text-[#8f8f8f]">{reviewBlocker || " "}</p>
          <button
            type="button"
            onClick={() => goPhase(3)}
            disabled={reviewBlocker !== null}
            className="chamfer h-11 bg-[#F0B90B] px-6 text-[12px] font-bold text-black transition-[transform,opacity] enabled:hover:opacity-90 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#3a2f08] disabled:text-[#6d6d6d]"
          >
            Continue to execute
          </button>
        </div>
      </div>
      </>
      )}

      {phase === 3 && (
        <section className="deck-frame border border-[#2f2f2f] bg-[#141414] p-5 sm:p-6">
          <SectionHead
            index="03"
            title="Execute"
            hint="Your wallet signs a scoped session, then funds an ERC-8183 escrow. The agent never holds your keys."
          />
          <div className="divide-y divide-[#242424] border-y border-[#242424]">
            <SummaryRow label="Agent" value={agent.name} />
            <SummaryRow label="Spend cap" value={budgetValid ? `${budget} $U` : "—"} />
            <SummaryRow label="Keystore fee" value="~0.0013 BNB" />
            <SummaryRow label="Expires" value={`in ${EXPIRY_DAYS} days`} />
          </div>
          <div className="mt-4 border border-[#2f2f2f] bg-black p-3.5">
            <p className="text-[10px] font-bold uppercase text-[#666]">The job</p>
            <p className="mt-2 text-[12px] leading-6 text-[#d3d3d3]">{task}</p>
          </div>

          <Progress step={step} />

          {/* Reserved slot — an Execute failure must not shove the buttons down. */}
          <p role="alert" className="mt-4 min-h-8 text-[11px] leading-5 text-[#ff8d8d]">
            {error || " "}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => goPhase(2)}
              disabled={busy}
              className="h-11 border border-[#3c3c3c] px-6 text-[12px] font-semibold text-[#f5f5f5] transition-colors hover:border-[#666] hover:bg-[#1b1b1b] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Back
            </button>
            <button
              onClick={beginHire}
              disabled={busy || !task.trim() || !budgetValid}
              className="chamfer h-11 bg-[#F0B90B] px-6 text-[12px] font-bold text-black transition-[transform,opacity] enabled:hover:opacity-90 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#3a2f08] disabled:text-[#6d6d6d]"
            >
              {step === "granting-session"
                ? "Granting session…"
                : step === "funding-job"
                  ? "Funding escrow…"
                  : step === "error"
                    ? "Try again"
                    : wallet
                      ? "Fund and hire"
                      : "Connect wallet to hire"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
