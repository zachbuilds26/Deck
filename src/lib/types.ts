// Agent categories matching hackathon requirements
export type AgentCategory =
  | "rebalancing"
  | "grid-trading"
  | "yield-optimisation"
  | "health-factor";

// Agent service types from 8004scan
export type ServiceType = "MCP" | "A2A" | "WEB" | "CUSTOM" | "X402";

// Agent from 8004scan API
export interface Agent {
  agentId: string;
  chainId: number;
  owner: string;
  name: string;
  description: string;
  image?: string;
  services: ServiceType[];
  /** Average feedback rating, 0-5. 0 means nobody has left a star rating yet. */
  score: number;
  /** 8004scan's weighted quality score, 0-100. Not a star rating. */
  qualityScore: number;
  feedbackCount: number;
  stars: number;
  x402Supported: boolean;
  isVerified: boolean;
  endpointVerified: boolean;
  healthScore: number;
  /** 8004scan has actually run an endpoint check — false means "unknown", not "broken". */
  healthChecked: boolean;
  registeredAt: string;
  endpoints?: AgentEndpoint[];
  category?: AgentCategory;
  /** Declared MCP tool / A2A skill names. Verifiable capability, unlike the
   *  description. Only populated by the detail endpoint. */
  tools?: string[];
  /** x402 payments this agent has actually received on BSC, counted from
   *  `q402-weekly` feedback records. The scarcest signal in the registry: a
   *  rating is an opinion, this is someone spending money.
   *
   *  Undefined means "no payment record found in the window we scanned", NOT
   *  "never paid" — the feedback walk is bounded, so absence is not proof. */
  paidPayments?: number;
  /** Distinct weekly windows in which a payment was reported. Two weeks of one
   *  payment is a returning customer; one week of two is a single session. */
  paidWeeks?: number;
}

export interface AgentEndpoint {
  type: "a2a" | "mcp" | "web" | "custom";
  url: string;
  version?: string;
}

// Agent detail with full profile
export interface AgentDetail extends Agent {
  feedback: AgentFeedback[];
  capabilities: string[];
  contracts: string[];
  avgResponseTime?: number;
  successRate?: number;
  totalJobs?: number;
}

export interface AgentFeedback {
  id: string;
  rating: number;
  comment: string;
  reviewer: string;
  createdAt: string;
}

// Job (ERC-8183)
export type JobStatus = "OPEN" | "FUNDED" | "SUBMITTED" | "COMPLETED" | "REJECTED" | "EXPIRED";

export interface Job {
  jobId: string;
  buyer: string;
  provider: string;
  task: string;
  budget: string;
  status: JobStatus;
  deliverableUrl?: string;
  /** Past this time an undelivered job's escrow is reclaimable. ISO string. */
  expiredAt?: string;
  createdAt: string;
  fundedAt?: string;
  submittedAt?: string;
  completedAt?: string;
  txHash: string;
}

// Agent Advantage (TermiX track)
export interface AdvantageReport {
  agentId: string;
  agentName: string;
  /** Chain the proof lives on — mainnet and testnet receipts live on
   *  different explorers, so the report must say which one to check. */
  chainId: number;
  tasks: AdvantageTask[];
  summary: {
    avgTimeSaved: string;
    avgCostSaved: string;
    successRate: string;
  };
}

export interface AdvantageTask {
  description: string;
  category: "trading" | "equities" | "security" | "general";
  manual: { time: string; cost: string; quality: string; output: string };
  agent: { time: string; cost: string; quality: string; output: string; txHash: string };
}

// API response wrappers
export interface ApiResponse<T> {
  data: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  /** Set only when the live registry was unreachable and the payload came from
   *  Deck's committed snapshot. Its absence means the data is live. */
  snapshot?: { capturedAt: string };
}

// Wallet
export interface WalletInfo {
  address: string;
  balance: string;
  tokens: { symbol: string; balance: string; address: string }[];
}
