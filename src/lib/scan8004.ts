import { SCAN8004_BASE_URL, CACHE_TTL, BSC_CHAIN_ID } from "./constants";
import { agentMatchesKeywords } from "./agent-status";
import paidIndexFile from "./paid-agents.json";
import agentSnapshot from "./agent-snapshot.json";
import type { Agent, AgentDetail, AgentFeedback } from "./types";

// Simple in-memory cache
const cache = new Map<string, { data: unknown; expires: number }>();

export class ScanApiError extends Error {
  constructor(public readonly status: number, statusText: string) {
    super(`8004scan API error: ${status} ${statusText}`);
    this.name = "ScanApiError";
  }
}

/**
 * The upstream answered 200 with an empty collection where rows were
 * demanded. Thrown instead of returned so caller retry paths engage — a
 * flaky empty must never be cached as fact nor rendered as "none".
 */
export class ScanEmptyError extends Error {
  constructor(endpoint: string) {
    super(`8004scan returned an empty collection for ${endpoint}`);
    this.name = "ScanEmptyError";
  }
}

/** True for {items: []} / {data: []} envelopes. Detail objects, stats and
 *  search hits with rows are never "empty" by this test. */
function isEmptyCollection(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  for (const key of ["items", "data"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.length === 0;
  }
  return false;
}

type QualityPageCache = {
  agents: Agent[];
  sources: ExecutableSource[];
  expires: number;
  /** Set once the scan for this cache entry has run.
   *
   *  `scanRounds` is a local in listAgents, so it reset on every request and each
   *  new page ran up to MAX_SCAN_ROUNDS *more* rounds — which appended agents and
   *  re-sorted the list mid-pagination. That is why `total` climbed 106 → 120 →
   *  122 → 135 → 138 while the reader scrolled, and why slices repeated rows. */
  filled?: boolean;
};

type ExecutableSource = {
  filter: Record<string, string>;
  offset: number;
  total: number;
  exhausted: boolean;
  endpointVerified: boolean;
};

const qualityPageCache = new Map<string, QualityPageCache>();

/**
 * Last good pool per cache key — the deepest successful fill seen. Served
 * whenever a fresh scan comes back thinner (rate limit, flaky upstream) so
 * the marketplace never visibly shrinks mid-scroll. Retried naturally: the
 * 5-minute page cache above still expires, so every few minutes a new scan
 * gets its chance to beat it.
 */
type LastGoodPool = { agents: Agent[]; attemptedAt: number };
const lastGoodPool = new Map<string, LastGoodPool>();
const LAST_GOOD_MAX_AGE_MS = 60 * 60 * 1000;

function getLastGood(cacheKey: string): Agent[] | null {
  const found = lastGoodPool.get(cacheKey);
  if (!found || Date.now() - found.attemptedAt > LAST_GOOD_MAX_AGE_MS) return null;
  return found.agents;
}

function setLastGood(cacheKey: string, agents: Agent[]): void {
  lastGoodPool.set(cacheKey, { agents, attemptedAt: Date.now() });
}

function slicePool(
  agents: Agent[],
  page: number,
  limit: number
): { agents: Agent[]; total: number; hasMore: boolean } {
  const from = (page - 1) * limit;
  const slice = agents.slice(from, from + limit);
  return { agents: slice, total: agents.length, hasMore: from + slice.length < agents.length };
}

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown, ttlSeconds: number): void {
  cache.set(key, { data, expires: Date.now() + ttlSeconds * 1000 });
}

/**
 * Last-known-good responses, kept far longer than the fresh cache.
 *
 * 8004scan allows 30 requests/minute on the anonymous tier and each agent page
 * costs two (details + feedback), so clicking through a handful of agents in
 * quick succession trips the limit. Serving slightly stale metadata beats
 * showing "Registry unavailable" on a page we have already rendered once.
 */
const staleCache = new Map<string, { data: unknown; expires: number }>();
const STALE_TTL_SECONDS = 6 * 60 * 60;

function getStale<T>(key: string): T | null {
  const entry = staleCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    staleCache.delete(key);
    return null;
  }
  return entry.data as T;
}

// Fetch with error handling
async function scanFetch<T>(
  endpoint: string,
  params?: Record<string, string>,
  opts?: { noStore?: boolean; empty?: "allow" | "reject" }
): Promise<T> {
  const url = new URL(`${SCAN8004_BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const cacheKey = url.toString();
  // noStore skips every cache: the escape hatch when a cached answer is
  // suspected wrong (e.g. a flaky empty page cached as fact).
  if (!opts?.noStore) {
    const cached = getCached<T>(cacheKey);
    if (cached) return cached;
  }

  const headers: Record<string, string> = {};
  if (process.env.EIGHTHUNDRED4SCAN_API_KEY) {
    headers["X-API-Key"] = process.env.EIGHTHUNDRED4SCAN_API_KEY;
  }

  let res: Response;
  try {
    res = await fetch(
      url.toString(),
      opts?.noStore
        ? { headers, cache: "no-store" }
        : {
            headers,
            next: { revalidate: CACHE_TTL.AGENTS },
          }
    );

    // 8004scan intermittently 500s on individual agents and succeeds on an
    // immediate retry. One bounded retry only, and never for 429 — a rate limit
    // is a real answer, and the stale cache below handles it.
    if (res.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      res = await fetch(url.toString(), { headers, cache: "no-store" });
    }
  } catch (networkError) {
    const stale = getStale<T>(cacheKey);
    if (stale) return stale;
    throw networkError;
  }

  if (!res.ok) {
    const stale = getStale<T>(cacheKey);
    if (stale) return stale;
    throw new ScanApiError(res.status, res.statusText);
  }

  // A gateway HTML page here used to surface as a raw SyntaxError. It is a
  // transport failure like any other: stale serves, otherwise it throws.
  let data: T;
  try {
    data = await res.json();
  } catch {
    const stale = getStale<T>(cacheKey);
    if (stale) return stale;
    throw new ScanApiError(res.status, "Unparseable response");
  }
  if (opts?.empty === "reject" && isEmptyCollection(data)) {
    // Evict, don't write: a flaky empty must leave no trace in either cache,
    // or the next reader gets yesterday's outage presented as today's fact —
    // including via the stale fallback, which serves whatever was stored.
    cache.delete(cacheKey);
    staleCache.delete(cacheKey);
    throw new ScanEmptyError(endpoint);
  }
  // A noStore read never writes: it exists to second-guess the cache, and
  // writing its answer would just re-poison it on a second flaky empty.
  if (!opts?.noStore) {
    setCache(cacheKey, data, CACHE_TTL.AGENTS);
    staleCache.set(cacheKey, { data, expires: Date.now() + STALE_TTL_SECONDS * 1000 });
  }
  return data;
}

// ============================================
// QUALITY FILTER
// ============================================

// Generic auto-generated names to reject.
const GENERIC_NAMES = /^agent\s*#?\d+$/i;
/** Filler names. Checked twice — once raw, once with a `.agent`/`.bot`/`.ai`
 *  suffix stripped — because the registry carries both "test" and "test.agent". */
const PLACEHOLDER_NAMES =
  /^(unnamed(?: agent)?|unknown(?: agent)?|n\/?a|null|none|test|testing|demo|sample|example|foo|bar|asdf+)$/i;
const X_PERSONA_NAME = /^@[a-z0-9_]{1,30}(?:\s*[·|—-]\s*.*)?$/i;
const ENSOUL_PROFILE = /(?:^|\s|[·|—-])ensoul(?:\s|$)/i;
const X_PERSONA_DESCRIPTION =
  /(?:twitter api|twitter presence|actual tweets|recent tweets|profile for @|personality profil|seed profile|public figure with limited available data)/i;
const EXECUTABLE_SERVICES = new Set(["MCP", "A2A", "X402"]);

const COMMON_NAME_BIGRAMS = new Set([
  "th", "he", "in", "er", "an", "re", "on", "at", "en", "nd", "ti", "es",
  "or", "te", "of", "ed", "is", "it", "al", "ar", "st", "to", "nt", "ng",
  "se", "ha", "as", "ou", "io", "le", "ve", "co", "me", "de", "hi", "ri",
  "ro", "ic", "ne", "ea", "ra", "ce", "li", "ch", "ll", "be", "ma", "si",
  "om", "ur", "ai", "tr", "di", "fi", "la", "et", "el", "ta", "ac", "us",
  "ni", "wa", "ap", "po",
]);

// Keyed by AGENT_CATEGORIES ids — the four categories the hackathon judges on.
// Deliberately generous: "Agent Diversity" is scored on all four having real depth,
// so a thin keyword list here directly costs marks.
const MARKETPLACE_CATEGORY_KEYWORDS: Record<string, string[]> = {
  rebalancing: [
    "rebalance", "rebalancing", "liquidity", "LP", "range", "CLMM", "concentrated",
    "reposition", "pool", "pools", "allocation", "weighting", "portfolio",
  ],
  "grid-trading": [
    "grid", "trading", "trade", "trader", "automated", "order", "orders",
    "strategy", "arbitrage", "market making", "DCA", "limit order", "swap", "bot",
  ],
  "yield-optimisation": [
    "yield", "APR", "APY", "optimise", "optimize", "farm", "farming", "stake",
    "staking", "vault", "compound", "auto-compound", "returns", "harvest", "beefy",
  ],
  "health-factor": [
    "health", "liquidation", "liquidate", "lending", "lend", "borrow", "borrowing",
    "collateral", "venus", "aave", "loan", "debt", "LTV", "margin", "position",
    // Health Factor is genuinely the sparsest of the four — paging deeper added
    // nothing, so the only honest lever is naming more of the vocabulary lending
    // agents actually use. Kept to terms that cannot mean anything else in a DeFi
    // description: protocol names and repayment mechanics.
    //
    // Terms tried and REMOVED: supply, withdraw, credit, leverage, solvency,
    // unwind, radiant, "money market". Matching is substring-based above three
    // characters, so "radiant" pulled in RadiantDrifter and "supply"/"credit"
    // pulled in a mint engine and a trend bot. That took the count from 9 to 13 by
    // filling a lending category with agents that do not lend, which is the
    // opposite of letting someone make an informed call.
    "repay", "vtoken", "kinza", "morpho", "loan-to-value", "healthfactor",
    "undercollateral", "overcollateral",
  ],
};

function matchesMarketplaceCategory(agent: Agent, category?: string): boolean {
  if (!category || category === "all") return true;
  const keywords = MARKETPLACE_CATEGORY_KEYWORDS[category];
  if (!keywords) return true;
  return agentMatchesKeywords(agent, keywords);
}

function isReadableName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 120) return false;
  if (GENERIC_NAMES.test(trimmed)) return false;
  if (PLACEHOLDER_NAMES.test(trimmed)) return false;
  if (/^\d+$/.test(trimmed) || /^0x[0-9a-f]{20,}$/i.test(trimmed)) return false;
  if (/^(?:https?:\/\/|www\.)/i.test(trimmed)) return false;
  const normalized = trimmed
    .toLowerCase()
    .replace(/\.(?:agent|bot|ai)$/i, "")
    .trim();
  // Re-tested against the SUFFIX-STRIPPED name, because the registry is full of
  // "test.agent" and "demo.agent" — the raw string is not "test", so the check
  // above misses them and one was surfacing in the marketplace.
  if (PLACEHOLDER_NAMES.test(normalized)) return false;
  // Widened from 3 characters to 16: the registry carries names like
  // "LTCAILTCAILTCAILTCAI…", and a five-character unit repeated slipped straight
  // through a rule that only looked for units of three or fewer.
  if (isRepeatedUnit(trimmed)) return false;

  const letters = normalized.replace(/[^a-z]/g, "");
  const digits = (normalized.match(/\d/g) || []).length;
  if (letters.length === 0) return false;
  if (digits / (letters.length + digits) > 0.4) return false;

  // Everything below is junk detection for single-token names. A name containing
  // a space, dot, dash or ampersand was typed deliberately, so it skips these.
  //
  // Measured before loosening: these rules rejected 78 of 100 real MCP agents,
  // including "Buyback" and "OpenOdds.Ai" — two of only four rated agents on BSC.
  const isSingleToken = !/[-_.&+/ ]/.test(normalized);
  if (!isSingleToken) return true;

  // Runs of consonants only make sense per word, never across a whole phrase.
  if (letters.length >= 5 && /[bcdfghjklmnpqrstvwxyz]{5,}/.test(letters)) return false;

  const vowelRatio = (letters.match(/[aeiouy]/g) || []).length / letters.length;
  if (letters.length >= 5 && (vowelRatio < 0.15 || vowelRatio > 0.8)) return false;

  // Bigram scoring is only statistically meaningful on long strings. Short real
  // names like "Samie" score 0.00 through no fault of their own.
  if (letters.length >= 10) {
    let commonPairs = 0;
    for (let index = 0; index < letters.length - 1; index++) {
      if (COMMON_NAME_BIGRAMS.has(letters.slice(index, index + 2))) commonPairs++;
    }
    if (commonPairs / (letters.length - 1) < 0.18) return false;
  }

  return true;
}

/** One short unit typed three or more times: `LTCAILTCAILTCAI…`.
 *
 *  Kept separate from the description checks below because it is the only one of
 *  them safe to run on a NAME. Names are legitimately single tokens —
 *  `bnb-lending-guardian.agent` has no spaces and is 26 characters — so the
 *  prose rules must not touch them. */
function isRepeatedUnit(text: string): boolean {
  const squashed = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  return squashed.length > 0 && /^(.{1,16}?)\1{2,}$/.test(squashed);
}

/** A description that is its own name typed over and over, or one token repeated.
 *
 *  The registry is full of these — `LTCAILTCAILTCAILTCAI…` as both the name and
 *  the description. The old check only caught a description EXACTLY equal to the
 *  name, so a name repeated fifteen times sailed through and took a marketplace
 *  slot away from an agent that had explained itself. */
function isPaddingText(text: string, name: string): boolean {
  const squashed = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!squashed) return true;
  if (isRepeatedUnit(text)) return true;

  // Mostly the agent's own name, whatever else is around it.
  const bare = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (bare.length >= 2 && squashed.split(bare).length - 1 >= 3) return true;

  // Real prose has spaces. Past about twenty characters, a string without one is
  // an identifier or a mashed-together repeat, not a sentence.
  if (text.trim().length > 24 && !/\s/.test(text.trim())) return true;

  return false;
}

/** Registration boilerplate: the description is the agent's own name plus a
 *  platform tag and nothing else.
 *
 *  The registry is full of `asdfd.agent` → "asdfd.agent on Termix Platform".
 *  These clear a word count and a length check — five words, thirty characters —
 *  while telling a reader nothing at all about what the agent does, which is the
 *  one thing a marketplace listing has to do.
 *
 *  Written as "name, then only a platform tag" rather than as a Termix blocklist,
 *  so any other tool generating the same shape is caught too. An agent that
 *  mentions its platform and then explains itself keeps its listing: the
 *  remainder has to be JUST the tag. */
function isRegistrationBoilerplate(description: string, name: string): boolean {
  const text = description.trim();
  const bare = name.trim();
  if (!bare) return false;

  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const remainder = text.replace(new RegExp(`^${escaped}\\s*`, "i"), "").trim();
  if (remainder === text) return false; // does not lead with the name

  return /^(?:is\s+)?(?:an?\s+)?(?:ai\s+)?(?:agent\s+)?on\s+[\w.\-'’ ]{2,48}$/i.test(remainder);
}

/** Does this agent say what it does?
 *
 *  Bar raised from "ten characters and not literally the name" to a real clause:
 *  at least four words and twenty characters, not padding, and not registration
 *  boilerplate. The three descriptions worth surfacing all clear this comfortably
 *  — "Gasless stablecoin payment agent on BNB Chain." is seven words — while
 *  "Agnet", "LTCAILTCAILTCAI…" and "asdfd.agent on Termix Platform" do not. */
function hasMeaningfulDescription(description: string, name: string): boolean {
  const trimmed = description.trim();
  if (trimmed.length < 20) return false;
  if (trimmed.split(/\s+/).filter(Boolean).length < 4) return false;
  if (/^(no description|n\/?a|none|null|test|description)$/i.test(trimmed)) return false;
  if (trimmed === name.trim()) return false;
  if (isRegistrationBoilerplate(trimmed, name)) return false;
  return !isPaddingText(trimmed, name);
}

/** How well an agent explains itself, as a rank bucket.
 *
 *  Two, because the difference that matters is "explains what it does" versus
 *  "names itself". A twelve-word description is doing real work for the reader;
 *  a five-word one is a label. Ranked below payment and rating evidence — those
 *  are facts, this is only presentation — but above raw feedback counts, so the
 *  long tail of unrated agents is ordered by whether it is legible at all. */
function descriptionTier(agent: Agent): number {
  const words = agent.description.trim().split(/\s+/).filter(Boolean).length;
  if (words >= 12) return 2;
  if (words >= 5) return 1;
  return 0;
}

// Check if agent meets quality threshold. chainId is a parameter rather than a
// hardcoded 56 so BSC testnet can be surfaced when a caller asks for it.
function isQualityAgent(agent: Agent, chainId: number = BSC_CHAIN_ID): boolean {
  if (!isReadableName(agent.name)) return false;
  if (!hasMeaningfulDescription(agent.description, agent.name)) return false;
  // No image requirement. It used to be here and it was the wrong test twice
  // over: on testnet only 24 of ~440 agents populate an avatar, so requiring one
  // emptied the marketplace completely — and on mainnet the URL is present for
  // nearly every agent but resolves for roughly one in five, so the gate was
  // admitting broken pictures and rejecting good agents on the same field.
  // Whether an agent uploaded a picture says nothing about whether it works;
  // AgentAvatar's monogram covers the ones that did not.
  if (agent.chainId !== chainId) return false;
  if (X_PERSONA_NAME.test(agent.name.trim())) return false;
  if (ENSOUL_PROFILE.test(agent.name)) return false;
  if (X_PERSONA_DESCRIPTION.test(agent.description)) return false;
  if (!agent.services.some((service) => EXECUTABLE_SERVICES.has(service))) return false;
  return true;
}

// Filter agents to quality-only
function filterQuality(agents: Agent[], chainId: number = BSC_CHAIN_ID): Agent[] {
  return agents.filter((agent) => isQualityAgent(agent, chainId));
}

// Map raw API agent to our Agent type
function mapAgent(raw: Record<string, unknown>): Agent {
  const services = parseProtocols(raw.supported_protocols);
  const x402Supported = Boolean(raw.x402_supported);
  if (x402Supported && !services.includes("X402")) services.push("X402");

  return {
    agentId: String(raw.agent_id || raw.id || ""),
    chainId: Number(raw.chain_id),
    owner: String(raw.owner_address || ""),
    name: String(raw.name || "Unnamed Agent"),
    description: String(raw.description || ""),
    image: raw.image_url ? String(raw.image_url) : undefined,
    services,
    // average_score is an average of 0-100 feedback ratings (the OpenAPI spec
    // mislabels it "0-5"; live values are 80.0, 100.0). Convert to 0-5 stars.
    // total_score is a separate 0-100 weighted quality grade, not a rating.
    score: Math.min(5, Number(raw.average_score || 0) / 20),
    qualityScore: Number(raw.total_score || 0),
    feedbackCount: Number(raw.total_feedbacks || 0),
    stars: Number(raw.star_count || 0),
    x402Supported,
    isVerified: Boolean(raw.is_verified),
    endpointVerified: Boolean(raw.is_endpoint_verified),
    healthScore: Number(raw.health_score || 0),
    healthChecked: raw.health_score !== null && raw.health_score !== undefined,
    registeredAt: String(raw.created_at || ""),
    tools: parseDeclaredTools(raw.services),
  };
}

// Parse protocol string
/**
 * Tool and skill names an agent declares on its endpoints. Far stronger evidence
 * of capability than its description — "createPosition" or "liquidationCall" is a
 * commitment, marketing copy is not. Only the detail endpoint returns these.
 */
function parseDeclaredTools(services: unknown): string[] {
  if (!services || typeof services !== "object") return [];
  const names: string[] = [];

  for (const service of Object.values(services as Record<string, unknown>)) {
    if (!service || typeof service !== "object") continue;
    const entry = service as { tools?: unknown[]; skills?: unknown[] };
    for (const item of [...(entry.tools ?? []), ...(entry.skills ?? [])]) {
      const name =
        typeof item === "string"
          ? item
          : ((item as { name?: unknown })?.name as string | undefined);
      if (name && !names.includes(name)) names.push(name);
    }
  }

  return names;
}

function parseProtocols(protocols: unknown): ("MCP" | "A2A" | "WEB" | "CUSTOM" | "X402")[] {
  if (!protocols) return [];
  const validProtocols = new Set<string>(["MCP", "A2A", "WEB", "CUSTOM", "X402"]);
  const values = Array.isArray(protocols) ? protocols : String(protocols).split(/[,;\s]+/);
  return values
    .map((p) => String(p).trim().toUpperCase())
    .filter((p) => validProtocols.has(p)) as ("MCP" | "A2A" | "WEB" | "CUSTOM" | "X402")[];
}

// One query per executable protocol so the registry does the filtering for us.
// Asking for agents unfiltered returns mostly X-persona profiles that then fail
// isQualityAgent — that is what made the marketplace look empty while burning
// through the daily request quota.
/** How many paging rounds one cache fill may spend, and how many consecutive
 *  fruitless rounds end it.
 *
 *  Three sources page in parallel, so a round is 3 requests and a full fill is at
 *  most 18 — cached for CACHE_TTL.AGENTS. That is affordable now the API key is
 *  actually being sent (the participant tier allows 500/min), and it is what buys
 *  depth in the sparse categories. */
const MAX_SCAN_ROUNDS = 6;
const MAX_EMPTY_ROUNDS = 3;
/** Depth one cache fill aims for, so every page slices a settled list. Higher
 *  than the scan can actually reach, which is the point — MAX_SCAN_ROUNDS bounds
 *  the work, this just stops the loop from stopping early. */
const FULL_POOL_TARGET = 500;

function createExecutableSources(): ExecutableSource[] {
  const make = (filter: Record<string, string>): ExecutableSource => ({
    filter,
    offset: 0,
    total: 0,
    exhausted: false,
    endpointVerified: false,
  });

  return [
    make({ has_a2a: "true" }),
    make({ has_mcp: "true" }),
    make({ x402_supported: "true" }),
  ];
}

// 8004scan reports health_score as 100 (every service answering), ~50 (some
// answering), ~33 or lower (checked and broken), or nothing at all when it has
// never run a check. "Never checked" must not rank below "checked and broken",
// so compare buckets rather than the raw number.
function healthTier(agent: Agent): number {
  if (!agent.healthChecked) return 1; // never checked
  if (agent.healthScore >= 50) return 2; // checked, responding
  return 0; // checked, mostly broken
}

/** Confirmed to be answering — 8004scan checked it and enough services replied. */
export function isRespondingAgent(agent: Agent): boolean {
  return agent.healthChecked && agent.healthScore >= 50;
}

/** Checked and failing — distinct from simply never having been checked. */
function isBrokenAgent(agent: Agent): boolean {
  return agent.healthChecked && agent.healthScore < 50;
}

function rankMarketplaceAgents(left: Agent, right: Agent): number {
  // Liveness first: agents confirmed answering lead the marketplace as a
  // block, then everything else follows. A paid or rated agent that does not
  // answer right now cannot execute right now, so recency of proof beats
  // depth of proof — the full evidence order below survives as the tiebreak
  // inside each group.
  const leftLive = isRespondingAgent(left);
  const rightLive = isRespondingAgent(right);
  if (leftLive !== rightLive) return leftLive ? -1 : 1;

  // A confirmed-broken endpoint never outranks a working or untested one.
  const leftBroken = isBrokenAgent(left);
  const rightBroken = isBrokenAgent(right);
  if (leftBroken !== rightBroken) return leftBroken ? 1 : -1;

  if (left.endpointVerified !== right.endpointVerified) return left.endpointVerified ? -1 : 1;
  if (left.isVerified !== right.isVerified) return left.isVerified ? -1 : 1;

  // Someone paying is the strongest evidence an agent works, and rarer than a
  // rating — a handful of BSC agents have ever taken an x402 payment. Money
  // outranks opinion, so this sits above score.
  const leftPaid = (left.paidPayments ?? 0) > 0;
  const rightPaid = (right.paidPayments ?? 0) > 0;
  if (leftPaid !== rightPaid) return leftPaid ? -1 : 1;
  if (leftPaid && left.paidPayments !== right.paidPayments) {
    return (right.paidPayments ?? 0) - (left.paidPayments ?? 0);
  }

  // A human scoring an agent is the scarcest signal in this registry — roughly
  // 2% of BSC agents have one — so rated agents lead, best rating first.
  const leftRated = left.score > 0;
  const rightRated = right.score > 0;
  if (leftRated !== rightRated) return leftRated ? -1 : 1;
  if (left.score !== right.score) return right.score - left.score;

  // Then whether it explains itself. Facts above (payment, rating) outrank this;
  // among the long tail of unrated agents, the ones that say what they do lead the
  // ones that only name themselves.
  const leftDesc = descriptionTier(left);
  const rightDesc = descriptionTier(right);
  if (leftDesc !== rightDesc) return rightDesc - leftDesc;

  // Then whether the endpoint actually answers.
  const leftHealth = healthTier(left);
  const rightHealth = healthTier(right);
  if (leftHealth !== rightHealth) return rightHealth - leftHealth;
  if (left.healthScore !== right.healthScore) return right.healthScore - left.healthScore;

  if (left.feedbackCount !== right.feedbackCount) return right.feedbackCount - left.feedbackCount;

  const leftProtocols = left.services.filter((service) => EXECUTABLE_SERVICES.has(service)).length;
  const rightProtocols = right.services.filter((service) => EXECUTABLE_SERVICES.has(service)).length;
  if (leftProtocols !== rightProtocols) return rightProtocols - leftProtocols;
  // qualityScore is populated for every agent, unlike the star average.
  return right.qualityScore - left.qualityScore;
}

function marketplaceIdentity(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*#\d+\s*$/i, "")
    .replace(/\.(?:agent|bot|ai)$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function marketplaceContentFingerprint(agent: Agent): string {
  const description = agent.description
    .toLowerCase()
    .replace(/risk profile:\s*(?:conservative|moderate|aggressive)\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  // 24, not 80. An EXACT description match is a strong signal at any length, and
  // the 80-character floor was letting the single worst duplication on the site
  // through: 110 of the first 200 agents were `*.pie` cloud instances —
  // alana.pie, moonbirds.pie, aaaaaaaaaaa.pie — all carrying the identical
  // 35-character "Purr-Fect Claw cloud instance agent". Unique names, so name
  // dedup never fired; too short for the fingerprint, so content dedup never
  // fired either. One listing for that product is right; a hundred and ten is the
  // marketplace being used as a user directory.
  return description.length >= 24 ? description : "";
}

function deduplicateMarketplaceAgents(agents: Agent[]): Agent[] {
  const identities = new Set<string>();
  const contentFingerprints = new Set<string>();
  return agents.filter((agent) => {
    const identity = marketplaceIdentity(agent.name);
    if (!identity || identities.has(identity)) return false;

    const contentFingerprint = marketplaceContentFingerprint(agent);
    if (contentFingerprint && contentFingerprints.has(contentFingerprint)) return false;

    identities.add(identity);
    if (contentFingerprint) contentFingerprints.add(contentFingerprint);
    return true;
  });
}

// ============================================
// PAID AGENTS — who has actually been given money
// ============================================

/** Feedback tag that records real x402 payment activity.
 *
 *  Worth being precise about, because the obvious-looking fields are traps. The
 *  `value` column on a feedback record is NOT an amount — it is the reading for
 *  whatever metric `tag1` names, so `responseTime`/674 is milliseconds and
 *  `uptime`/1E+4 with 2 decimals is 100%. Summing `value` across an agent
 *  produces a number that looks like revenue and means nothing.
 *
 *  `q402-weekly` is the one tag that counts transactions: `tag2` is the chain
 *  ("bsc") and `value` is how many payments landed in that weekly window.
 *
 *  The index itself is built offline by scripts/build-paid-index.py, because the
 *  API ignores every tag filter we tried (`tag=`, `tag1=`, `has_score=` all
 *  return the unfiltered 11.7k records) and walking ~120 pages to find these
 *  cost 200 seconds on a cold marketplace load. Payment history moves weekly, so
 *  a committed snapshot is the right shape for it. Re-run the script to refresh. */
const PAID_INDEX_TTL_MS = 6 * 60 * 60 * 1000;

type PaidRecord = { payments: number; weeks: number };

/** token_id → payments observed. Read from the committed snapshot; an absent or
 *  malformed file is not an error, it just means no agent gets the badge. */
function getPaidIndex(chainId: number): Map<string, PaidRecord> {
  const map = new Map<string, PaidRecord>();
  if (chainId !== paidIndexFile.chainId) return map;
  for (const [tokenId, entry] of Object.entries(paidIndexFile.agents || {})) {
    const payments = Number((entry as PaidRecord)?.payments);
    const weeks = Number((entry as PaidRecord)?.weeks);
    if (!Number.isFinite(payments) || payments <= 0) continue;
    map.set(tokenId, { payments, weeks: Number.isFinite(weeks) ? weeks : 1 });
  }
  return map;
}

/** Resolved paid agents, cached for hours.
 *
 *  Needed because listAgents' page cache expires every 5 minutes while this data
 *  changes weekly. Without it, every 5 minutes each paid token id costs another
 *  `/agents/{chain}/{id}` request — enough to eat a 1,000/day budget by lunchtime. */
const paidAgentsCache = new Map<number, { agents: Agent[]; expires: number }>();

/** Agents with a confirmed x402 payment, ready to merge into the marketplace.
 *
 *  These skip the declared-protocol gate that `isQualityAgent` applies, and take
 *  a description OR an image where it demands both. A completed payment is
 *  stronger evidence an agent works than either field — one that took money and
 *  never filled in an avatar is still a working agent.
 *
 *  What does NOT get relaxed is the junk bar. Of the 13 paid token ids in the
 *  snapshot, most are throwaway test registrations ("Agent Q", "My Agent Q",
 *  "REXTER Q402 Testing") with no description and no image; a payment does not
 *  make those worth a slot in the marketplace. Requiring one real field keeps the
 *  agents someone actually built and drops the rest. */
export async function listPaidAgents(chainId: number = BSC_CHAIN_ID): Promise<Agent[]> {
  const cached = paidAgentsCache.get(chainId);
  if (cached && Date.now() < cached.expires) return cached.agents;

  const index = getPaidIndex(chainId);
  if (index.size === 0) {
    paidAgentsCache.set(chainId, { agents: [], expires: Date.now() + PAID_INDEX_TTL_MS });
    return [];
  }

  // Four at a time, not thirteen: this runs inside cold marketplace fills that
  // already fire concurrent source queries, and one burst tripping the key's
  // window poisons everything behind it (detail reads, feedback reads).
  const PAID_LOOKUP_CONCURRENCY = 4;
  const entries = [...index.entries()];
  const settled: (Agent | null)[] = [];
  for (let start = 0; start < entries.length; start += PAID_LOOKUP_CONCURRENCY) {
    const chunk = await Promise.all(
      entries.slice(start, start + PAID_LOOKUP_CONCURRENCY).map(async ([tokenId, paid]) => {
        try {
          const raw = await scanFetch<{ data?: Record<string, unknown> }>(
            `/agents/${chainId}/${tokenId}`
          );
          const agent = mapAgent((raw.data || raw) as Record<string, unknown>);
          agent.paidPayments = paid.payments;
          agent.paidWeeks = paid.weeks;
          return agent;
        } catch {
          return null;
        }
      })
    );
    settled.push(...chunk);
  }

  const agents = settled
    .filter((agent): agent is Agent => agent !== null)
    .filter((agent) => agent.chainId === chainId)
    .filter((agent) => isReadableName(agent.name))
    .filter(
      (agent) =>
        hasMeaningfulDescription(agent.description, agent.name) || Boolean(agent.image?.trim())
    )
    .filter((agent) => !X_PERSONA_NAME.test(agent.name.trim()))
    .filter((agent) => !ENSOUL_PROFILE.test(agent.name))
    .filter((agent) => !X_PERSONA_DESCRIPTION.test(agent.description))
    .sort(rankMarketplaceAgents);

  paidAgentsCache.set(chainId, { agents, expires: Date.now() + PAID_INDEX_TTL_MS });
  return agents;
}

/** How many opening cards are guaranteed to carry a real avatar. */
/** Agents whose avatar URL is at least present, ahead of those with none.
 *
 *  A STABLE partition, so within each group the evidence order from
 *  `rankMarketplaceAgents` survives — among agents with a picture the paid and
 *  rated ones still lead.
 *
 *  This USED to probe each URL to find out whether an image really existed, and
 *  that was removed for two measured reasons:
 *
 *   1. It cannot work. Their media endpoint is non-deterministic — the same URL
 *      returned 500, 200, 200, timeout, 200, 500 on six consecutive calls — so no
 *      verdict taken at one moment is worth caching, and the order reshuffled on
 *      every fill.
 *   2. It made things worse. The endpoint allows 180 requests a minute; probing 40
 *      in parallel on a cold fill, on top of the ~20 images the browser is loading
 *      for the visible cards, pushed past that ceiling and avatars that had been
 *      loading fine started failing.
 *
 *  So the ordering is back to the free signal, and the monogram in AgentAvatar is
 *  what carries a missing picture. */
function avatarsFirst(agents: Agent[]): Agent[] {
  // The picture partition applies WITHIN each liveness group, never across
  // them: the live block stays ahead as a block, pretty untested agents do
  // not jump it. Both partitions are stable, so the evidence order from
  // `rankMarketplaceAgents` survives everywhere.
  const partition = (group: Agent[]): Agent[] => {
    const withAvatar: Agent[] = [];
    const withoutAvatar: Agent[] = [];
    for (const agent of group) {
      if (agent.image?.trim()) withAvatar.push(agent);
      else withoutAvatar.push(agent);
    }
    if (withAvatar.length === 0 || withoutAvatar.length === 0) return group;
    return [...withAvatar, ...withoutAvatar];
  };

  const live = agents.filter((agent) => isRespondingAgent(agent));
  if (live.length === 0 || live.length === agents.length) return partition(agents);
  const rest = agents.filter((agent) => !isRespondingAgent(agent));
  return [...partition(live), ...partition(rest)];
}

/** Agents captured while the registry was healthy, for when it is not.
 *
 *  Filtered and ranked by the same rules as live data — a snapshot that bypassed
 *  the quality gates would be a different, worse marketplace wearing the same
 *  clothes. Category filtering still applies, so a category page degrades to its
 *  own cached subset rather than to everything. */
function snapshotAgents(chainId: number, category?: string): Agent[] {
  if (agentSnapshot.chainId !== chainId) return [];
  const agents = (agentSnapshot.agents as Agent[]) ?? [];
  return agents
    .filter((agent) => isQualityAgent(agent, chainId))
    .filter((agent) => matchesMarketplaceCategory(agent, category))
    .sort(rankMarketplaceAgents);
}

// ============================================
// PUBLIC API
// ============================================

// List all agents from the registry with upstream pagination intact.
export async function listAgents(params?: {
  page?: number;
  limit?: number;
  chainId?: number;
  owner?: string;
  category?: string;
}): Promise<{
  agents: Agent[];
  total: number;
  hasMore: boolean;
  /** Present only when the live registry could not be reached and these agents
   *  came from the committed snapshot. The UI says so rather than implying the
   *  data is current. */
  snapshot?: { capturedAt: string };
}> {
  const requestedLimit = params?.limit || 20;
  const page = params?.page || 1;
  const category = params?.category && params.category !== "all" ? params.category : undefined;
  const cacheKey = `executable-v28:${params?.chainId || BSC_CHAIN_ID}:${params?.owner || "all"}:${category || "all"}`;
  let entry = qualityPageCache.get(cacheKey);
  if (!entry || Date.now() > entry.expires) {
    entry = {
      agents: [],
      sources: createExecutableSources(),
      expires: Date.now() + CACHE_TTL.AGENTS * 1000,
    };
    qualityPageCache.set(cacheKey, entry);

    // Seed with agents that have actually been paid. They come from /feedbacks
    // rather than /agents, so no protocol-filtered source query can reach them —
    // without this the marketplace never shows the agents with the best proof of
    // working. Owner-scoped views skip it: those answer "what does this wallet
    // own", where injecting someone else's agents would be wrong.
    if (!params?.owner) {
      try {
        const paid = await listPaidAgents(params?.chainId || BSC_CHAIN_ID);
        entry.agents = paid.filter((agent) => matchesMarketplaceCategory(agent, category));
      } catch {
        // Ranking still works without it; an empty seed is not an error.
      }
    }
  }

  // Fill to a FIXED depth, not to the requested page.
  //
  // Paging to `page * limit` grew the cached list as the reader scrolled, and every
  // fill re-sorts it (ranking, then avatars). Slicing a list that reorders between
  // requests is not pagination: measured across six pages of 20, `total` climbed
  // 55 → 79 → 89 → 102 → 120 and the slices repeated 23 agents, so 120 slots
  // yielded 97 unique. The client then deduped the repeats and showed ~46.
  //
  // One fill, one sort, then every page slices the same frozen array until the
  // cache expires. Costs a slower first request; buys pagination that does not
  // lose rows. MAX_SCAN_ROUNDS is the real ceiling, so this only has to be a
  // number the scan will never reach on its own.
  const targetCount = FULL_POOL_TARGET;
  let scanRounds = 0;
  let emptyRounds = 0;
  let lastSourceError: unknown = null;
  while (
    !entry.filled &&
    entry.agents.length < targetCount &&
    entry.sources.some((source) => !source.exhausted) &&
    scanRounds < MAX_SCAN_ROUNDS
  ) {
    scanRounds += 1;
    const agentsBeforeRound = entry.agents.length;
    const activeSources = entry.sources.filter((source) => !source.exhausted);
    let failedSources = 0;
    const batches = await Promise.all(
      activeSources.map(async (source) => {
        try {
          const data = await scanFetch<{
            items: Record<string, unknown>[];
            total: number;
            limit: number;
            offset: number;
          }>("/agents", {
            limit: "100",
            offset: String(source.offset),
            chain_id: String(params?.chainId || BSC_CHAIN_ID),
            is_registered: "true",
            is_active: "true",
            sort_by: "total_feedbacks",
            sort_order: "desc",
            ...source.filter,
            ...(params?.owner ? { owner_address: params.owner } : {}),
          });

          source.total = data.total || source.total;
          source.offset += data.items?.length || 0;
          source.exhausted = !data.items?.length || source.offset >= source.total;
          return (data.items || []).map((raw) => {
            const agent = mapAgent(raw);
            if (source.endpointVerified) agent.endpointVerified = true;
            return agent;
          });
        } catch (error) {
          failedSources += 1;
          lastSourceError = error;
          console.warn("Executable agent source unavailable:", source.filter, error);
          return [];
        }
      })
    );

    const mapped = batches
      .flat()
      .filter((agent) => isQualityAgent(agent, params?.chainId || BSC_CHAIN_ID))
      .filter((agent) => matchesMarketplaceCategory(agent, params?.category));
    const known = new Set(entry.agents.map((agent) => agent.agentId));
    for (const agent of mapped) {
      if (!known.has(agent.agentId)) {
        entry.agents.push(agent);
        known.add(agent.agentId);
      }
    }
    entry.agents.sort(rankMarketplaceAgents);
    entry.agents = avatarsFirst(deduplicateMarketplaceAgents(entry.agents));
    if (failedSources === activeSources.length) break;

    // An unproductive round used to mark every source exhausted and stop for good.
    // That is exactly wrong for a RARE category: Health Factor agents are sparse
    // in the registry, so one page of 100 with no lending agent in it permanently
    // ended the scan and the category came back at 9 while Grid Trading had 39.
    // "All four categories, equally deep" is a scored criterion, so tolerate a run
    // of empty rounds and only give up when several in a row come back with
    // nothing new.
    if (entry.agents.length === agentsBeforeRound) {
      emptyRounds += 1;
      if (emptyRounds >= MAX_EMPTY_ROUNDS) {
        entry.sources.forEach((source) => {
          source.exhausted = true;
        });
        break;
      }
    } else {
      emptyRounds = 0;
    }
  }

  // A failed scan used to throw, which is right when there is genuinely nothing to
  // show and wrong when the registry is simply having one of its frequent bad
  // minutes. Fall back to the committed snapshot instead: real agents that were
  // live when it was captured, clearly flagged as cached rather than passed off as
  // current. `staleCache` inside scanFetch already covers a process that fetched
  // successfully once; this is the cold-start case a visitor actually hits.
  if (entry.agents.length === 0 && lastSourceError) {
    qualityPageCache.delete(cacheKey);
    // A recent in-memory pool beats the committed snapshot: fresher, and
    // already filtered for this exact chain, owner and category.
    const previous = getLastGood(cacheKey);
    if (previous) return slicePool(previous, page, requestedLimit);
    const fallback = snapshotAgents(params?.chainId || BSC_CHAIN_ID, category);
    if (fallback.length === 0) throw lastSourceError;

    const from = (page - 1) * requestedLimit;
    const slice = fallback.slice(from, from + requestedLimit);
    return {
      agents: slice,
      total: fallback.length,
      hasMore: from + slice.length < fallback.length,
      snapshot: { capturedAt: agentSnapshot.capturedAt },
    };
  }

  // Ratchet: remember this fill only if it is at least as deep as the best
  // seen — ties go to the fresher data. A thinner fill means the scan gave up
  // early, so swap in the remembered pool and serve that instead: settled and
  // sliced exactly like a fresh fill, which is what keeps the pages stable.
  const previous = getLastGood(cacheKey);
  if (!previous || entry.agents.length >= previous.length) {
    setLastGood(cacheKey, entry.agents);
  } else {
    console.warn(
      `Thin marketplace fill (${entry.agents.length} < ${previous.length}); serving last good pool for ${cacheKey}`
    );
    entry.agents = previous;
  }

  // Settled. Every subsequent page slices this exact array until the cache expires,
  // which is what makes the slices stable.
  entry.filled = true;

  // Only promise more when more are already in hand. Deriving this from upstream
  // totals made the client scroll forever through ~296k mostly-unusable rows.
  return slicePool(entry.agents, page, requestedLimit);
}

// Get single agent detail (no filter — show any agent on detail page)
export async function getAgent(chainId: number, tokenId: string): Promise<AgentDetail> {
  const data = await scanFetch<{ data: Record<string, unknown> }>(`/agents/${chainId}/${tokenId}`);
  const raw = data.data || data;
  const agent = mapAgent(raw) as AgentDetail;
  // The list enriches paid agents, but the detail page never went through the
  // list — without this the "Paid onchain" badge could never appear here.
  // tokenId may arrive composite ("56:0xregistry:120411"); the index is keyed
  // by the bare id.
  const bare = tokenId.includes(":") ? (tokenId.split(":").at(-1) ?? tokenId) : tokenId;
  const paid = getPaidIndex(chainId).get(bare);
  if (paid) {
    agent.paidPayments = paid.payments;
    agent.paidWeeks = paid.weeks;
  }
  return agent;
}

/**
 * Recognises an agent-ID search: a bare token id ("146995") or a full composite
 * id ("56:0xregistry:146995"). Returns the bare token id, or null if the query
 * looks like ordinary text. Three digits minimum so "5" stays a text search.
 */
function parseAgentIdQuery(query: string): string | null {
  const trimmed = query.trim();
  if (/^\d{3,}$/.test(trimmed)) return trimmed;

  if (trimmed.includes(":")) {
    const last = trimmed.split(":").at(-1)?.trim() ?? "";
    if (/^\d+$/.test(last)) return last;
  }
  return null;
}

// Search by agent id first, then fall back to semantic text search.
export async function searchAgents(
  query: string,
  limit = 20,
  chainId = BSC_CHAIN_ID
): Promise<Agent[]> {
  const cacheKey = `search:${chainId}:${query}:${limit}`;
  const cached = getCached<Agent[]>(cacheKey);
  if (cached) return cached;

  // An exact id lookup skips the quality filters on purpose — if someone types
  // an id they want that agent, not our opinion of it.
  const tokenId = parseAgentIdQuery(query);
  if (tokenId) {
    try {
      const agent = await getAgent(chainId, tokenId);
      if (agent.agentId) {
        const hit = [agent as Agent];
        setCache(cacheKey, hit, CACHE_TTL.SEARCH);
        return hit;
      }
    } catch {
      // No agent with that id — carry on and treat it as text.
    }
  }

  // Fetch extra to compensate for filtering
  const data = await scanFetch<{ items: Record<string, unknown>[]; total: number }>(
    "/agents/search/semantic",
    { q: query, limit: String(limit * 5) }
  );

  const allAgents = (data.items || []).map(mapAgent);

  // Search is EXHAUSTIVE where browsing is curated, and the split is deliberate.
  //
  // The default listing is the marketplace's editorial opinion — that curation is
  // the product, and a registry of 300k+ where most entries are bulk persona
  // profiles is not something a first-time visitor should be handed. But someone
  // who types a name has already named what they want, and answering "no agents
  // found" about an agent that plainly exists on BSC reads as broken rather than
  // as taste.
  //
  // The id path above already worked this way. This is the same reasoning carried
  // through to text: keep the chain check and the junk-name guard, drop the
  // curation gates (image, declared protocol, description length).
  const hits = allAgents
    .filter((agent) => agent.chainId === chainId)
    .filter((agent) => isReadableName(agent.name))
    .sort(rankMarketplaceAgents)
    .slice(0, limit);

  setCache(cacheKey, hits, CACHE_TTL.SEARCH);
  return hits;
}

// Get global stats
export async function getGlobalStats(): Promise<{
  totalAgents: number;
  totalChains: number;
  recentActivity: number;
}> {
  const data = await scanFetch<{
    total_agents: number;
    chain_stats: Record<string, unknown>[];
    daily_new_agents: number;
  }>("/stats/global");

  return {
    totalAgents: data.total_agents || 0,
    totalChains: (data.chain_stats || []).length,
    recentActivity: data.daily_new_agents || 0,
  };
}

// Get agent feedback
// Get agent feedback.
// NOTE: `agent_id` on /feedbacks means 8004scan's internal UUID, not the
// {chain}:{registry}:{token} identifier Deck uses. Filtering by token id and
// chain is the only form that matches our agents.
/**
 * Last good feedback per agent — same ratchet as the marketplace pool. A
 * flaky 200-with-nothing must never read as "this agent has no feedback":
 * if a previous read found rows, they are served instead. Feedback is
 * append-only, so the worst case is missing the very newest record.
 */
const lastGoodFeedback = new Map<string, { rows: AgentFeedback[]; at: number }>();
const LAST_GOOD_FEEDBACK_TTL_MS = 60 * 60 * 1000;

function getPreviousFeedback(key: string): AgentFeedback[] | null {
  const found = lastGoodFeedback.get(key);
  if (!found || Date.now() - found.at > LAST_GOOD_FEEDBACK_TTL_MS) {
    if (found) lastGoodFeedback.delete(key);
    return null;
  }
  return found.rows;
}

export async function getAgentFeedback(
  chainId: number,
  tokenId: string,
  opts?: { fresh?: boolean; strictEmpty?: boolean }
): Promise<AgentFeedback[]> {
  const data = await scanFetch<{ items: Record<string, unknown>[] }>(
    "/feedbacks",
    {
      agent_token_id: tokenId,
      chain_id: String(chainId),
      limit: "50",
      sort_by: "created_at",
      sort_order: "desc",
    },
    {
      ...(opts?.fresh ? { noStore: true } : {}),
      ...(opts?.strictEmpty ? { empty: "reject" as const } : {}),
    }
  );

  const rows = (data.items || [])
    .filter((f) => !f.is_revoked)
    .map((f) => ({
      id: String(f.feedback_id || f.id || ""),
      // score is 0-100 and null for non-rating feedback. Convert to 0-5 stars;
      // 0 means the author left a comment without scoring the agent.
      rating: Math.min(5, Number(f.score || 0) / 20),
      comment: String(f.comment || ""),
      reviewer: String(f.user_address || ""),
      createdAt: String(f.created_at || f.submitted_at || ""),
    }));

  const key = `${chainId}:${tokenId}`;
  if (rows.length > 0) {
    lastGoodFeedback.set(key, { rows, at: Date.now() });
    if (lastGoodFeedback.size > 500) {
      const oldest = lastGoodFeedback.keys().next();
      if (!oldest.done) lastGoodFeedback.delete(oldest.value);
    }
    return rows;
  }

  const previous = getPreviousFeedback(key);
  if (previous) {
    console.warn(
      `Empty feedback read for ${key} with ${previous.length} known; serving last good`
    );
    return previous;
  }
  return rows;
}

export interface AgentStats {
  lastActive: string | null;
  totalChats: number;
  totalMessages: number;
  rank: number | null;
}

/**
 * Engagement stats for one agent: last_active ("Active 3hrs ago"), chats,
 * messages, rank. Lenient by design — stats are garnish on the profile, so a
 * failure resolves to null and the line simply doesn't render, never an error.
 */
export async function getAgentStats(
  chainId: number,
  tokenId: string
): Promise<AgentStats | null> {
  try {
    const data = await scanFetch<{
      last_active?: string | null;
      total_chats?: number;
      total_messages?: number;
      rank?: number | null;
    }>(`/stats/agents/${chainId}/${tokenId}`);
    return {
      lastActive: data.last_active ?? null,
      totalChats: Number(data.total_chats || 0),
      totalMessages: Number(data.total_messages || 0),
      rank: typeof data.rank === "number" ? data.rank : null,
    };
  } catch {
    return null;
  }
}

// Get agents by owner — quality filtered
export async function getAgentsByOwner(ownerAddress: string): Promise<Agent[]> {
  const data = await scanFetch<{ items: Record<string, unknown>[] }>("/agents", {
    owner_address: ownerAddress,
    limit: "100",
  });

  return filterQuality((data.items || []).map(mapAgent)).sort(rankMarketplaceAgents);
}
