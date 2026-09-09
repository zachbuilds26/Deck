# Deck — BNB Agent Marketplace

**Hackathon:** Build the Era (BNB Chain)
**Tracks:** Main + TermiX + Altana + PancakeSwap
**Stack:** Next.js 14 (App Router) + Altana SDK + 8004scan API + BNBAgent SDK
**Theme:** Black + BNB Yellow

---

## What Deck Is

A marketplace for AI agents on BNB Smart Chain. Users discover agents, compare their onchain track records, hire them with scoped wallets and spending limits, and watch them deliver results — all from one website.

---

## Architecture

```
deck/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── page.tsx            # Home — agent grid + search
│   │   ├── agent/
│   │   │   └── [chainId]/[tokenId]/
│   │   │       └── page.tsx    # Agent detail profile
│   │   ├── hire/
│   │   │   └── [agentId]/
│   │   │       └── page.tsx    # Hire flow
│   │   ├── dashboard/
│   │   │   └── page.tsx        # User dashboard — sessions, jobs, activity
│   │   ├── sessions/
│   │   │   └── page.tsx        # Active sessions management
│   │   ├── defi/
│   │   │   └── pancakeswap/
│   │   │       └── page.tsx    # PancakeSwap featured agents
│   │   └── agent-advantage/
│   │       └── page.tsx        # TermiX — side-by-side comparisons
│   │
│   ├── api/                    # API routes (backend)
│   │   ├── agents/
│   │   │   ├── route.ts        # GET — list agents (proxy to 8004scan)
│   │   │   └── [chainId]/[tokenId]/
│   │   │       └── route.ts    # GET — single agent detail
│   │   ├── search/
│   │   │   └── route.ts        # GET — semantic search
│   │   ├── stats/
│   │   │   └── route.ts        # GET — global stats
│   │   ├── sessions/
│   │   │   ├── route.ts        # GET — user sessions / POST — create session
│   │   │   └── [sessionId]/
│   │   │       └── route.ts    # DELETE — revoke session
│   │   ├── jobs/
│   │   │   ├── route.ts        # GET — user jobs / POST — create job (hire)
│   │   │   └── [jobId]/
│   │   │       └── route.ts    # GET — job status / POST — settle/dispute
│   │   └── wallet/
│   │       └── route.ts        # POST — create wallet / GET — balances
│   │
│   ├── lib/                    # Core logic
│   │   ├── altana.ts           # Altana SDK client + helpers
│   │   ├── bnbagent.ts         # BNBAgent SDK client + helpers
│   │   ├── scan8004.ts         # 8004scan API client + cache
│   │   ├── contracts.ts        # Contract addresses (BSC mainnet/testnet)
│   │   ├── types.ts            # Shared TypeScript types
│   │   └── constants.ts        # Chain IDs, tokens, config
│   │
│   ├── components/             # Shared components (later)
│   └── styles/
│       └── globals.css         # Tailwind + theme tokens
│
├── prisma/
│   └── schema.prisma           # Optional: cache layer
├── .env.local                  # API keys, RPC URLs
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── next.config.ts
```

---

## Backend Layers (Build Order)

### Layer 1: 8004scan Client (`lib/scan8004.ts`)
Agent discovery — no auth needed for basic reads.

| API Route | 8004scan Endpoint | Purpose |
|---|---|---|
| `GET /api/agents` | `GET /api/v1/agents` | List agents with pagination, chain filter |
| `GET /api/agents/:chainId/:tokenId` | `GET /api/v1/agents/{chainId}/{tokenId}` | Single agent detail |
| `GET /api/search?q=` | `GET /api/v1/agents/search/semantic?q=` | Natural language agent search |
| `GET /api/stats` | `GET /api/v1/stats/global` | Total agents, chains, activity |

**Rate limits:** 30 req/min anonymous. Get free API key for 600 req/min.

**Caching:** In-memory cache with 60s TTL to avoid hammering the API.

---

### Layer 2: Altana Client (`lib/altana.ts`)
Wallet creation, session management, Keystore reads, x402 payments.

**Initialization:**
```typescript
import { AltanaClient } from "@altananetwork/sdk";

const client = new AltanaClient({
  chainId: 56, // BSC Mainnet
});
```

**Key Functions:**

| Function | What it does | Used in |
|---|---|---|
| `createPasskeyWallet()` | Creates Face ID / fingerprint wallet in browser | Hire flow |
| `grantSession()` | Writes scoped permissions to Keystore onchain | Hire flow |
| `revokeSession()` | One-tx revocation, immediate | Sessions page |
| `readContract("isValidKey")` | Free read — verify if key is authorized | Agent detail, dashboard |
| `fetchWithX402()` | Pay for HTTP resources via session key | Agent execution |
| `balances()` | Read wallet + token balances | Dashboard |
| `execute()` | Send calls signed by session key | Agent execution |

**Session Permission Model:**
```typescript
{
  calls: [
    { to: "0xPancakeSwapRouter..." },                    // contract allowlist
    { to: "0xVenusLending...", signature: "0xmethodSig" } // selector-scoped
  ],
  spend: [
    {
      limit: 50n * 10n ** 18n,   // 50 USDT
      period: "day",
      token: "0xUSDT_BSC..."
    }
  ],
  expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60  // 7 days
}
```

**API Routes:**

| Route | Method | Altana Call | Purpose |
|---|---|---|---|
| `POST /api/wallet` | POST | `createPasskeyWallet()` | New user wallet |
| `GET /api/wallet` | GET | `balances()` | Wallet balances |
| `POST /api/sessions` | POST | `grantSession()` | Grant agent permission |
| `DELETE /api/sessions/:id` | DELETE | `revokeSession()` | Revoke agent permission |
| `GET /api/sessions` | GET | `getKeys(user)` | List active sessions |

---

### Layer 3: BNBAgent / ERC-8183 Client (`lib/bnbagent.ts`)
Agent registration, job creation, escrow, settlement.

**Contract Addresses (BSC Mainnet):**

| Contract | Address |
|---|---|
| ERC-8004 Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| AgenticCommerce | `0xea4daa3100a767e86fded867729ae7446476eba6` |
| EvaluatorRouter | `0x51895229e12f9876011789b04f8698af06ccd6da` |
| OptimisticPolicy | `0x9c01845705b3078aa2e8cff7520a6376fd766de5` |

**Job Lifecycle:**
```
OPEN → FUNDED → SUBMITTED → COMPLETED
                    ↓
              dispute → REJECTED
              expired → claimRefund
```

**API Routes:**

| Route | Method | BNBAgent Call | Purpose |
|---|---|---|---|
| `POST /api/jobs` | POST | `ERC8183Client.create_job()` + `fund()` | Hire agent |
| `GET /api/jobs` | GET | Read job records | List user's jobs |
| `GET /api/jobs/:id` | GET | `get_job_status()` | Job status + deliverable |
| `POST /api/jobs/:id/settle` | POST | `settleErc8183Job()` | Release escrow |
| `POST /api/jobs/:id/dispute` | POST | `settleErc8183Job(dispute)` | Contest result |

---

### Layer 4: Agent Advantage (`lib/advantage.ts`)
TermiX track — side-by-side comparison data.

**Data Source:** ERC-8183 job settlement records.

**API Route:**

| Route | Method | Purpose |
|---|---|---|
| `GET /api/advantage` | GET | Aggregated comparison data |
| `GET /api/advantage/:agentId` | GET | Per-agent task history |

**Report Structure:**
```typescript
interface AdvantageReport {
  tasks: {
    description: string;
    manual: { time: number; cost: number; quality: string; output: string };
    agent: { time: number; cost: number; quality: string; output: string; txHash: string };
    category: "trading" | "equities" | "security" | "general";
  }[];
  summary: {
    avgTimeSaved: string;
    avgCostSaved: string;
    successRate: string;
  };
}
```

---

### Layer 5: PancakeSwap Integration (`lib/pancakeswap.ts`)
Featured DeFi agents section.

**API Route:**

| Route | Method | Purpose |
|---|---|---|
| `GET /api/defi/pancakeswap` | GET | Curated PancakeSwap agents |

**Agent Categories to Surface:**
- Liquidity range rebalancers (interact with PancakeSwap CLMM)
- Yield optimizers (find best APR pools)
- Pool researchers (identify demand for new pools)
- Safe swap executors (automated swaps, no fund withdrawal)

---

## Environment Variables (`.env.local`)

```env
# 8004scan
NEXT_PUBLIC_8004SCAN_API_URL=https://api.8004scan.io/api/v1
EIGHTHUNDRED4SCAN_API_KEY=           # optional, free tier

# Altana
NEXT_PUBLIC_ALTANA_CHAIN_ID=56
ALTANA_RPC_URL=https://bsc-dataseed.binance.org

# BNBAgent
BNBAGENT_NETWORK=bsc-mainnet

# BSC
NEXT_PUBLIC_BSC_CHAIN_ID=56
NEXT_PUBLIC_BSC_RPC_URL=https://bsc-dataseed.binance.org
NEXT_PUBLIC_BSCSCAN_URL=https://bscscan.com
```

---

## Package Dependencies

```json
{
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@altananetwork/sdk": "latest",
    "bnbagent": "latest",
    "viem": "^2.0.0",
    "wagmi": "^2.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0"
  }
}
```

---

## Build Order

| Phase | What | Status |
|---|---|---|
| **1** | Project scaffold (Next.js + Tailwind + TypeScript) | TODO |
| **2** | 8004scan client + agent listing/search API routes | TODO |
| **3** | Altana client + wallet + session management API routes | TODO |
| **4** | BNBAgent client + ERC-8183 job/hire API routes | TODO |
| **5** | Agent Advantage report endpoint | TODO |
| **6** | PancakeSwap curated agents endpoint | TODO |
| **7** | Frontend (together, small pieces) | TODO |

---

## Track Coverage Checklist

- [ ] Main Track: Agent grid, 4 categories, search, hire flow, end-to-end
- [ ] TermiX: Agent Advantage Report with 3+ real task comparisons
- [ ] Altana: Passkey wallets, session keys, Keystore writes, revocation, onchain txs
- [ ] PancakeSwap: Featured DeFi section, real benefit to traders/LPs
