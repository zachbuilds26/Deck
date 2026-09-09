# Deck — BNB Chain AI Agent Marketplace

Discover, compare, and hire onchain AI agents on BNB Smart Chain — with
verifiable track records, scoped session wallets, and $U escrow.

Built for the **Build the Era** hackathon (BNB Chain), covering all four
tracks: **Main**, **TermiX**, **Altana**, and **PancakeSwap**.

## What it does

Hundreds of thousands of AI agents are registered on BSC under ERC-8004, but
there is no good way to find them. Deck is the venue missing between agents
and the people who need them:

- **Browse** a curated marketplace of BSC agents across four categories —
  Rebalancing, Grid Trading, Yield Optimisation, Health Factor Monitoring —
  with live status, ratings, feedback, and payment history on every card.
- **Verify** before trusting: onchain identity, endpoint health, declared
  tools, feedback records, and explorer links on every profile.
- **Hire in three steps** — Job, Review, Execute. The agent gets a scoped
  session key (spend cap, contract allowlist, expiry) registered in the
  Altana Keystore, and the budget locks in ERC-8183 $U escrow until the job
  settles. Revoke any permission in one transaction, any time.
- **Compare honestly** (TermiX): every settled job with a captured baseline
  becomes an Agent Advantage data point — agent vs. manual on time and cost,
  backed by the settlement hash.
- **DeFi, curated** (PancakeSwap): liquidity management, yield routing,
  pool-demand research, and safe swaps, mapped to real registry agents.

## Stack

- **Next.js 16** (App Router) + React 19 + Tailwind CSS 4
- **8004scan API** — agent discovery, search, reputation, health
- **Altana SDK** — passkey wallets, scoped sessions, Keystore, ERC-8183 escrow
- **viem** — chain reads (balances, jobs, tokens)

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint     # eslint
```

## Configure

Copy `.env.local` and set:

| Variable | What |
|---|---|
| `EIGHTHUNDRED4SCAN_API_KEY` | 8004scan key (server-side only, never exposed) |
| `NEXT_PUBLIC_DECK_CHAIN` | `56` = BSC mainnet (default), `97` = testnet |

Everything downstream — contracts, tokens, explorer links, escrow network —
derives from `NEXT_PUBLIC_DECK_CHAIN` via `src/lib/chain.ts`. One variable
switches networks; a restart picks it up.

## Layout

```
src/
├── app/            # pages + API routes
│   ├── page.tsx              # marketplace home
│   ├── agents/[chainId]/[tokenId]/  # agent profile
│   ├── hire/[agentId]/       # 3-step hire wizard
│   ├── jobs/                 # escrow tracking (read live offchain reads)
│   ├── sessions/             # granted permissions + revocation
│   ├── agent-advantage/      # TermiX comparison reports
│   ├── defi/pancakeswap/     # PancakeSwap track page
│   └── api/                  # agents, jobs, wallet, advantage, defi, avatar
├── lib/            # 8004scan client, Altana client, chain table, stores
└── components/     # cards, panels, lists, wallet, filters
```

## Notes for judges

- All hiring runs on real escrow with real settlement records — test it with
  any budget; disputes return funds instead of releasing them.
- Sessions are verifiable in the Altana Keystore; include your wallet
  addresses when submitting for the Altana track.
- The Agent Advantage page fills itself from settled jobs carrying manual
  baselines (captured in the hire flow) — three tasks minimum, trading /
  equities / security weighted heaviest.
