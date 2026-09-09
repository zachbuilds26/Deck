import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createPublicClient, http, type Hex } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { BNB, BNB_TESTNET, getErc8183Job } from "@altananetwork/sdk";
import { BSC_CHAIN_ID, BSC_RPC_URL } from "@/lib/constants";
import type { AdvantageCategory } from "@/lib/job-store";
import type { AdvantageReport, ApiResponse } from "@/lib/types";

// GET /api/advantage — Agent Advantage reports (TermiX track)
// POST /api/advantage — submit a settled job comparison
//
// Reports are built from real ERC-8183 jobs: the manual baseline is captured
// in the hire flow, the agent side is observed on settlement, and each entry
// carries its funding tx so a judge can verify it on BscScan. TermiX needs at
// least 3 real tasks with depth in trading/equities/security.

const CATEGORIES: AdvantageCategory[] = ["trading", "equities", "security", "general"];

type AdvantageEntry = {
  jobId: string;
  /** Chain the escrow settled on — proof links are worthless without it. */
  chainId: number;
  agentId: string;
  agentName: string;
  description: string;
  category: AdvantageCategory;
  manualHours: number;
  manualCostUsd: number;
  /** Hours from hire to observed settlement. */
  agentHours: number;
  /** Escrowed budget, e.g. "1 $U". Display only — never averaged against USD. */
  agentCostDisplay: string;
  /** Funding tx hash — the onchain proof. */
  txHash: string;
  deliverableUrl?: string;
  submittedAt: string;
  status: "COMPLETED" | "SUBMITTED";
};

/**
 * File-backed with an in-memory mirror. The file survives restarts; if the
 * host fs is read-only the mirror still serves until the process recycles —
 * a lost report is annoying, never fatal, and the client resubmits what the
 * file is missing (dedupe is by jobId).
 */
const STORE_FILE = path.join(process.cwd(), "data", "advantage.json");
let memory: AdvantageEntry[] | null = null;

async function readStore(): Promise<AdvantageEntry[]> {
  if (memory) return memory;
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    memory = Array.isArray(parsed) ? (parsed as AdvantageEntry[]) : [];
  } catch {
    memory = [];
  }
  return memory;
}

async function writeStore(entries: AdvantageEntry[]): Promise<void> {
  memory = entries;
  try {
    await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
    await fs.writeFile(STORE_FILE, JSON.stringify(entries, null, 2));
  } catch {
    // Read-only host: the mirror above still serves this process lifetime.
  }
}

function trimNum(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${trimNum(hours)}h`;
  return `${trimNum(hours / 24)}d`;
}

function buildReports(entries: AdvantageEntry[]): AdvantageReport[] {
  // Grouped by agent AND chain: the same agent hired on both networks earns
  // two reports, each pointing at its own explorer.
  const byAgent = new Map<string, AdvantageEntry[]>();
  for (const entry of entries) {
    const key = `${entry.agentId}:${entry.chainId}`;
    const group = byAgent.get(key) ?? [];
    group.push(entry);
    byAgent.set(key, group);
  }

  const reports: AdvantageReport[] = [];
  // agentId/chainId are read off the group, never parsed back out of the key:
  // agent ids themselves contain colons ("56:0xregistry:123").
  for (const group of byAgent.values()) {
    const agentId = group[0].agentId;
    const chainId = group[0].chainId;
    const ordered = [...group].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    const timeSaved = ordered
      .filter((e) => e.manualHours > 0)
      .map((e) => ((e.manualHours - e.agentHours) / e.manualHours) * 100);
    const avgTime =
      timeSaved.length > 0 ? timeSaved.reduce((a, b) => a + b, 0) / timeSaved.length : null;
    const manualTotal = ordered.reduce((sum, e) => sum + e.manualCostUsd, 0);
    const settled = ordered.filter((e) => e.status === "COMPLETED").length;

    reports.push({
      agentId,
      agentName: ordered[0].agentName,
      chainId,
      tasks: ordered.map((e) => ({
        description: e.description,
        category: e.category,
        manual: {
          time: formatHours(e.manualHours),
          cost: `$${trimNum(e.manualCostUsd)}`,
          quality: "Manual baseline",
          output: "Hand-executed",
        },
        agent: {
          time: formatHours(e.agentHours),
          cost: e.agentCostDisplay,
          quality: e.status === "COMPLETED" ? "Delivered & settled" : "Submitted",
          output: e.deliverableUrl ?? "Submitted onchain",
          txHash: e.txHash,
        },
      })),
      summary: {
        // Time is the only like-for-like average. Money crosses currencies
        // ($U escrow vs USD baseline), so costs are stated side by side —
        // averaging them into one percentage would be arithmetic fiction.
        avgTimeSaved:
          avgTime === null
            ? "—"
            : avgTime >= 0
              ? `${Math.round(avgTime)}% faster`
              : `${Math.round(-avgTime)}% slower`,
        avgCostSaved: `$${trimNum(manualTotal)} by hand vs ${ordered.length} escrowed job${ordered.length === 1 ? "" : "s"}`,
        successRate: `${settled}/${ordered.length} settled`,
      },
    });
  }

  return reports.sort((a, b) => b.tasks.length - a.tasks.length);
}

export async function GET() {
  try {
    const reports = buildReports(await readStore());
    if (reports.length === 0) {
      return NextResponse.json({
        data: [],
        message: "Agent Advantage reports are generated from ERC-8183 job history",
        instructions: {
          howToPopulate:
            "Describe the manual baseline in the hire flow, complete the job, settlement submits the comparison",
          requiredForTermiX: "At least 3 real tasks, at least one from trading/equities/security",
        },
      });
    }
    return NextResponse.json({ data: reports } satisfies ApiResponse<AdvantageReport[]>);
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { data: [], error: "Failed to fetch reports" },
      { status: 500 }
    );
  }
}

function isCategory(value: unknown): value is AdvantageCategory {
  return typeof value === "string" && (CATEGORIES as string[]).includes(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const {
      jobId,
      chainId,
      agentId,
      agentName,
      description,
      category,
      manualHours,
      manualCostUsd,
      agentHours,
      agentCostDisplay,
      txHash,
      deliverableUrl,
      status,
    } = body;

    if (
      typeof jobId !== "string" ||
      !jobId ||
      (chainId !== 56 && chainId !== 97) ||
      typeof agentId !== "string" ||
      !agentId ||
      typeof agentName !== "string" ||
      !agentName ||
      typeof description !== "string" ||
      !description ||
      !isCategory(category) ||
      !isPositiveNumber(manualHours) ||
      !isPositiveNumber(manualCostUsd) ||
      typeof agentHours !== "number" ||
      !Number.isFinite(agentHours) ||
      agentHours < 0 ||
      typeof agentCostDisplay !== "string" ||
      !agentCostDisplay ||
      typeof txHash !== "string" ||
      !txHash
    ) {
      return NextResponse.json(
        { data: null, error: "Invalid comparison: check job, baseline, agent time and txHash" },
        { status: 400 }
      );
    }

    // Onchain verification, fail-closed: the funding tx must exist and have
    // succeeded, and the job must exist past OPEN with matching task text.
    // This endpoint feeds a judged surface — an invented txHash must never
    // become "verified proof".
    const deckChain = BSC_CHAIN_ID === 56 ? bsc : bscTestnet;
    const publicClient = createPublicClient({
      chain: deckChain,
      transport: http(BSC_RPC_URL),
    });
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hex });
      if (receipt.status !== "success") {
        return NextResponse.json(
          { data: null, error: "Funding transaction did not succeed onchain" },
          { status: 422 }
        );
      }
    } catch {
      return NextResponse.json(
        { data: null, error: "Funding transaction not found onchain" },
        { status: 422 }
      );
    }
    try {
      const network = BSC_CHAIN_ID === 56 ? BNB : BNB_TESTNET;
      const onchain = await getErc8183Job(network, BigInt(jobId));
      if (onchain.status === 0 || onchain.description.trim() !== description.trim()) {
        return NextResponse.json(
          { data: null, error: "Job not found onchain or task does not match" },
          { status: 422 }
        );
      }
    } catch {
      return NextResponse.json(
        { data: null, error: "Job not found onchain or task does not match" },
        { status: 422 }
      );
    }

    const entry: AdvantageEntry = {
      jobId,
      chainId,
      agentId,
      agentName,
      description,
      category,
      manualHours,
      manualCostUsd,
      agentHours,
      agentCostDisplay,
      txHash,
      submittedAt: new Date().toISOString(),
      status: status === "COMPLETED" ? "COMPLETED" : "SUBMITTED",
      ...(typeof deliverableUrl === "string" && deliverableUrl
        ? { deliverableUrl }
        : {}),
    };

    // One entry per job — resubmission (retry after a restart) replaces.
    const entries = (await readStore()).filter((e) => e.jobId !== jobId);
    entries.push(entry);
    await writeStore(entries);

    return NextResponse.json({ data: buildReports(entries) } satisfies ApiResponse<
      AdvantageReport[]
    >);
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { data: null, error: "Failed to submit comparison" },
      { status: 500 }
    );
  }
}
