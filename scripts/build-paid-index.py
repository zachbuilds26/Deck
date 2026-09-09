"""Build the paid-agent index the marketplace reads at runtime.

Deck ranks agents that have actually been paid above everything else, but that
fact only exists on /feedbacks records tagged `q402-weekly` — /agents cannot
express it, and the API ignores every tag filter we tried, so finding them means
reading pages and filtering client-side.

Doing that walk at request time cost 200s on a cold marketplace load. So it runs
here instead, and the result is committed as src/lib/paid-agents.json.

Re-run weekly (the tag is a weekly counter):
    python scripts/build-paid-index.py [--pages 130]
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://api.8004scan.io/api/v1"
CHAIN = 56
TAG = "q402-weekly"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "paid-agents.json")


def load_key():
    env = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    try:
        with open(env, encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("EIGHTHUNDRED4SCAN_API_KEY="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return os.environ.get("EIGHTHUNDRED4SCAN_API_KEY", "")


def get(path, key):
    headers = {"User-Agent": "Mozilla/5.0 (deck-paid-index)"}
    if key:
        headers["X-API-Key"] = key
    req = urllib.request.Request(BASE + path, headers=headers)
    # Fail fast. This API's latency swings from 2s to well past a minute, and a
    # patient retry loop over 100+ pages turns a 5-minute job into an hours-long
    # one. Skipping a slow page costs a few records; blocking on it costs the run.
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=12) as res:
                return json.loads(res.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
            if attempt == 1:
                return None
            time.sleep(1)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=130)
    args = parser.parse_args()

    key = load_key()
    print(f"API key: {'present' if key else 'MISSING'}", flush=True)

    agents = {}
    read = 0
    missed = 0
    for page in range(args.pages):
        data = get(f"/feedbacks?chain_id={CHAIN}&limit=100&offset={page * 100}", key)
        if data is None:
            missed += 1
            continue
        items = data.get("items") or []
        if not items:
            break
        read += len(items)
        for row in items:
            if row.get("is_revoked") or row.get("tag1") != TAG:
                continue
            agent = row.get("agent") or {}
            token = str(agent.get("token_id") or "")
            if not token:
                continue
            entry = agents.setdefault(token, {"payments": 0, "weeks": 0, "name": ""})
            try:
                count = int(float(row.get("value") or 1))
            except (TypeError, ValueError):
                count = 1
            entry["payments"] += max(count, 1)
            entry["weeks"] += 1
            entry["name"] = (agent.get("name") or entry["name"] or "").encode(
                "ascii", "ignore"
            ).decode()
        print(f"  page {page + 1}: {read} records, {len(agents)} paid agents", end="\r", flush=True)
        time.sleep(0.1)

    print()
    if missed:
        print(f"  ({missed} page(s) unreadable — index is a floor)")
    if not agents:
        print("No paid agents found; leaving the existing index alone.", file=sys.stderr)
        return 1

    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "chainId": CHAIN,
        "tag": TAG,
        "recordsScanned": read,
        "agents": dict(sorted(agents.items(), key=lambda kv: -kv[1]["payments"])),
    }
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")

    print(f"\nwrote {os.path.relpath(OUT)} — {len(agents)} agents")
    for token, entry in list(payload["agents"].items())[:20]:
        print(f"  tok={token:<8} payments={entry['payments']:<4} weeks={entry['weeks']:<3} {entry['name'][:40]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
