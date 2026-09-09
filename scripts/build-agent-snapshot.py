"""Snapshot the live marketplace so an outage never shows an empty one.

8004scan fails often — during one afternoon it returned DATABASE_ERROR on three
requests in four, and its media endpoint flapped 500/200 for the same URL. Deck's
stale cache covers a process that has already fetched successfully, but a cold
start during an outage has nothing to serve, and a judge landing then sees
"Could not reach the agent registry."

This writes src/lib/agent-snapshot.json — the current curated list, exactly as the
API returns it, so the marketplace can fall back to real agents that were live
when the snapshot was taken. Labelled as cached in the UI, never passed off as
live.

Re-run before submitting, with the dev server running:
    python scripts/build-agent-snapshot.py [--limit 120]
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "agent-snapshot.json")
BASE = os.environ.get("DECK_URL", "http://localhost:3000")


def fetch(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "deck-snapshot"})
    with urllib.request.urlopen(req, timeout=300) as res:
        return json.loads(res.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=120, help="agents to capture")
    args = parser.parse_args()

    print(f"reading {BASE} ...", flush=True)
    agents = []
    seen = set()
    page = 1
    while len(agents) < args.limit and page <= 10:
        try:
            data = fetch(f"/api/agents?limit=100&page={page}&chainId=56&category=all")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as err:
            print(f"  page {page} failed: {err}", file=sys.stderr)
            break
        batch = data.get("data") or []
        if not batch:
            break
        for agent in batch:
            key = agent.get("agentId")
            if key and key not in seen:
                seen.add(key)
                agents.append(agent)
        if not (data.get("pagination") or {}).get("hasMore"):
            break
        page += 1

    if len(agents) < 10:
        print(
            f"only {len(agents)} agents — refusing to overwrite a good snapshot with a bad one",
            file=sys.stderr,
        )
        return 1

    payload = {
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "chainId": 56,
        "agents": agents[: args.limit],
    }
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1)
        handle.write("\n")

    size = os.path.getsize(OUT) / 1024
    print(f"wrote {os.path.relpath(OUT)} — {len(payload['agents'])} agents, {size:.0f}KB")
    for agent in payload["agents"][:5]:
        name = (agent.get("name") or "").encode("ascii", "ignore").decode()
        print(f"  {name[:44]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
