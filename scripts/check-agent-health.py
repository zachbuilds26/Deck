import json, io, time, urllib.request as u

BASE = "https://api.8004scan.io/api/v1"
UA = {"User-Agent": "Mozilla/5.0 (deck-marketplace-health-check)"}


def get(path):
    req = u.Request(BASE + path, headers=UA)
    with u.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def ascii_(s):
    return (s or "").encode("ascii", "ignore").decode()


listing = get(
    "/agents?chain_id=56&is_registered=true&is_active=true"
    "&x402_supported=true&has_mcp=true&limit=40"
    "&sort_by=total_feedbacks&sort_order=desc"
)
items = listing.get("items", [])
print(f"pool: {listing.get('total')} agents with x402 + a real MCP endpoint")
print(f"checking the top {min(14, len(items))} by feedback\n")

rows = []
for x in items[:14]:
    tok = x.get("token_id")
    try:
        d = get(f"/agents/56/{tok}")
    except Exception as exc:
        print(f"  ! {tok}: {exc}")
        continue
    o = d.get("data", d)
    hs = o.get("health_status") or {}
    svcs = (hs.get("services") or {}) if isinstance(hs, dict) else {}
    states = {k: (v or {}).get("status") for k, v in svcs.items()}
    healthy = [k for k, v in states.items() if v == "healthy"]
    rows.append(
        {
            "tok": tok,
            "name": ascii_(o.get("name"))[:34],
            "fb": o.get("total_feedbacks"),
            "health": o.get("health_score"),
            "states": states,
            "healthy": healthy,
            "err": ascii_(str(o.get("endpoint_verification_error")))[:52],
            "mcp": ((o.get("services") or {}).get("mcp") or {}).get("endpoint"),
        }
    )
    time.sleep(2.2)

rows.sort(key=lambda r: (-len(r["healthy"]), -(r["health"] or 0)))

print(f"{'agent':<34} {'fb':>3} {'score':>5}  endpoint status")
print("-" * 96)
for r in rows:
    st = ", ".join(f"{k}={v}" for k, v in r["states"].items()) or "no health data"
    print(f"{r['name']:<34} {r['fb']:>3} {r['health'] or 0:>5.0f}  {st}")

working = [r for r in rows if r["healthy"]]
print(f"\nresponding right now: {len(working)} of {len(rows)} checked")
for r in working:
    print(f"  OK  {r['name']}  (token {r['tok']})  services={r['healthy']}")
    if r["mcp"]:
        print(f"      mcp: {r['mcp']}")
