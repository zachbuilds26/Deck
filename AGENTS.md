# Deck — Build Context

## Project
- **Name:** Deck
- **Type:** BNB Chain AI Agent Marketplace
- **Hackathon:** Build the Era (Aug 5 – Sep 9, 2026)
- **Tracks:** Main + TermiX + Altana + PancakeSwap
- **Theme:** Black + BNB Yellow (#F0B90B)
- **Repo:** C:\Users\Emmanuel\deck

## What It Does
Marketplace for AI agents on BSC. Users discover agents (from 463K+ registered), compare onchain track records, hire them with scoped wallets + spending limits, and watch them deliver results — all from one website.

## Tech Stack
- **Frontend:** Next.js 14 (App Router), Tailwind CSS (black/yellow theme)
- **Wallet/Sessions:** Altana SDK (@altananetwork/sdk) — passkey wallets, session keys, Keystore
- **Discovery:** 8004scan API — agent listing, search, reputation
- **Commerce:** BNBAgent SDK (bnbagent) — ERC-8183 job escrow, agent registration
- **Payments:** x402 — HTTP-native micropayments
- **Blockchain:** BNB Smart Chain (chain ID 56)

## Build Strategy
- Backend first (API routes + lib layer)
- Frontend together later, small pieces
- The user is advanced, solo builder

## Agent Categories (Main Track)
1. Rebalancing — LP range management
2. Grid Trading — automated grid orders
3. Yield Optimisation — route to highest APR
4. Health Factor Monitoring — prevent liquidation

## Key APIs
- 8004scan: GET /api/v1/agents, /api/v1/agents/search/semantic, /api/v1/stats/global
- Altana: createPasskeyWallet, grantSession, revokeSession, fetchWithX402, execute
- BNBAgent: ERC8183Client (create_job, fund, settle, get_job_status)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
