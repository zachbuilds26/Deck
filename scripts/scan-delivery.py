"""Which BSC agents have people actually paid, and did the work land?

`total_feedbacks` on /agents is not the answer. The top of that list is bulk
Ensoul X-persona agents with 100+ feedbacks and an average_score of 0 — volume
with no rating behind it. This walks /feedbacks instead, which carries the
fields that matter: `score` (a real rating), `value` (what was paid), and
`is_revoked` (whether the client took it back).

Usage:  python scripts/scan-delivery.py [--pages N]
Needs EIGHTHUNDRED4SCAN_API_KEY in .env.local. ~120 requests for a full walk,
against a 1000/day cap, so don't loop it.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict

BASE = "https://api.8004scan.io/api/v1"
CHAIN = 56
PAGE = 100


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
    # A default Python-urllib User-Agent gets a blanket 403 from this API, so
    # send a browser-ish one like scripts/check-agent-health.py does.
    headers = {"User-Agent": "Mozilla/5.0 (deck-delivery-scan)"}
    if key:
        headers["X-API-Key"] = key
    req = urllib.request.Request(BASE + path, headers=headers)
    # Returns None on failure, distinct from a valid empty page: transient DNS
    # and 5xx blips are common over a 120-page walk and must not be read as
    # "no more data", or the scan silently reports a fraction of the registry.
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.loads(res.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as err:
            if attempt == 4:
                print(f"\n  ! {path} gave up: {err}", file=sys.stderr)
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def ascii_only(text):
    return (text or "").encode("ascii", "ignore").decode().strip()


# Bulk-minted persona and filler agents. These carry feedback volume but no
# rating, and they are what makes total_feedbacks useless as a quality signal.
SPAM = re.compile(r"(ensoul|^@|\bbort\b|test|asdf|demo agent)", re.I)


def to_amount(value, decimals):
    """Feedback `value` is an integer string in token base units."""
    try:
        raw = int(value)
    except (TypeError, ValueError):
        return 0.0
    return raw / (10 ** int(decimals or 18))


def walk_feedbacks(key, max_pages):
    """Page through every BSC feedback record, newest API order."""
    agents = defaultdict(
        lambda: {
            "name": "",
            "token_id": "",
            "total": 0,
            "live": 0,
            "revoked": 0,
            "scores": [],
            "paid": 0,
            "value": 0.0,
            "users": set(),
            "comments": [],
            "tags": set(),
            "txs": set(),
        }
    )
    seen = 0
    total = None
    missed = 0

    for page in range(max_pages):
        data = get(f"/feedbacks?chain_id={CHAIN}&limit={PAGE}&offset={page * PAGE}", key)
        if data is None:
            missed += 1
            continue
        items = data.get("items") or []
        if total is None:
            total = data.get("total")
            print(f"BSC feedback records: {total}")
        if not items:
            break
        for row in items:
            seen += 1
            agent = row.get("agent") or {}
            token = str(agent.get("token_id") or row.get("agent_id") or "?")
            entry = agents[token]
            entry["token_id"] = token
            entry["name"] = ascii_only(agent.get("name")) or entry["name"]
            entry["total"] += 1
            if row.get("is_revoked"):
                entry["revoked"] += 1
                continue
            entry["live"] += 1
            if row.get("score") is not None:
                entry["scores"].append(float(row["score"]))
            amount = to_amount(row.get("value"), row.get("value_decimals"))
            if amount > 0:
                entry["paid"] += 1
                entry["value"] += amount
            if row.get("user_address"):
                entry["users"].add(str(row["user_address"]).lower())
            comment = ascii_only(row.get("comment"))
            if comment:
                entry["comments"].append(comment[:160])
            if row.get("tag1"):
                entry["tags"].add(f"{ascii_only(row.get('tag1'))}:{ascii_only(row.get('tag2'))}")
            if row.get("transaction_hash"):
                entry["txs"].add(row["transaction_hash"])
        print(f"  page {page + 1}: {seen} records, {len(agents)} agents", end="\r", flush=True)
        if total and seen >= total:
            break
        time.sleep(0.25)

    print()
    if missed:
        print(f"  ({missed} page(s) unreadable after retries — counts are a floor)")
    return agents, seen, total


def classify(entry):
    """Delivery evidence, strongest first.

    A rating is the only signal a human deliberately left. Payment proves money
    moved but not that the client was happy. More than one distinct payer is
    what separates a real customer base from one wallet talking to itself.
    """
    scores = entry["scores"]
    avg = sum(scores) / len(scores) if scores else None
    spam = bool(SPAM.search(entry["name"] or ""))
    return {
        "rated": len(scores) > 0,
        "avg": avg,
        "good": avg is not None and avg >= 60,
        "paid": entry["paid"] > 0,
        "multi_payer": len(entry["users"]) > 1,
        "spam": spam,
    }


def report(agents, seen, total):
    rows = []
    for entry in agents.values():
        if entry["live"] == 0:
            continue
        rows.append((entry, classify(entry)))

    rated = [r for r in rows if r[1]["rated"]]
    good = [r for r in rows if r[1]["good"]]
    paid = [r for r in rows if r[1]["paid"]]
    multi = [r for r in rows if r[1]["multi_payer"]]
    clean_good = [r for r in good if not r[1]["spam"]]

    print("\n" + "=" * 74)
    print(f"{seen} feedback records read (of {total}) across {len(rows)} agents with live feedback")
    print("=" * 74)
    print(f"  agents someone paid at all        {len(paid)}")
    print(f"  agents with >1 distinct payer      {len(multi)}")
    print(f"  agents with ANY real rating        {len(rated)}")
    print(f"  agents rated 60/100 or better      {len(good)}")
    print(f"  ...excluding bulk/persona agents   {len(clean_good)}")

    print("\n--- RATED AGENTS (a human scored the work) " + "-" * 30)
    if not rated:
        print("  none")
    for entry, flags in sorted(rated, key=lambda r: (-(r[1]["avg"] or 0), -r[0]["live"])):
        mark = "spam?" if flags["spam"] else "     "
        print(
            f"  {mark} {flags['avg']:5.1f}/100  fb={entry['live']:<4} payers={len(entry['users']):<3}"
            f" paid={entry['paid']:<4} value={entry['value']:.4f}  {entry['name'][:42]}"
            f"  tok={entry['token_id']}"
        )
        for comment in entry["comments"][:2]:
            print(f"           “{comment}”")

    print("\n--- HIGHEST PAID VOLUME (no rating needed) " + "-" * 30)
    for entry, flags in sorted(rows, key=lambda r: -r[0]["value"])[:12]:
        if entry["value"] <= 0:
            break
        mark = "spam?" if flags["spam"] else "     "
        tags = ",".join(sorted(entry["tags"]))[:34]
        print(
            f"  {mark} value={entry['value']:.4f}  fb={entry['live']:<4}"
            f" payers={len(entry['users']):<3} rated={'Y' if flags['rated'] else 'n'}"
            f"  {entry['name'][:34]}  {tags}"
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=130, help="max pages of 100 to read")
    args = parser.parse_args()

    key = load_key()
    print(f"API key: {'present' if key else 'MISSING (anonymous tier)'}")
    agents, seen, total = walk_feedbacks(key, args.pages)
    report(agents, seen, total)


if __name__ == "__main__":
    main()
