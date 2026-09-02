"""Prototype: how much latency does the context size cost, and how does it add up?

Per API request the latency is the time from the last user record before it
to the last block of the response. Part one reads the per-request cost off the
data: median latency per context bin for low-output requests, where prompt
processing dominates, plus a least-squares fit. Part two accumulates that cost
per session and per week against total model time, because a small per-request
number only matters together with how often it is paid.

The slopes used for accumulation are constants read off the bin medians, not
the fit: the fit is confounded by output and thinking length (low R^2).
"""
import glob
import json
import os
import statistics as st
import sys
from collections import defaultdict
from datetime import datetime

import numpy as np

# Seconds per 1k context tokens, from the bin medians of the low-output requests.
CACHED_S_PER_K = 0.3 / 100
UNCACHED_S_PER_K = 2.2 / 100
BASELINE_K = 100
MAX_LATENCY_S = 600


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def requests_of(path):
    """Group the assistant records of one session into API requests by requestId."""
    rows = []
    for line in open(path, encoding="utf-8"):
        try:
            o = json.loads(line)
        except json.JSONDecodeError:
            continue
        if o.get("timestamp") and o.get("type") in ("user", "assistant") and not o.get("isSidechain"):
            rows.append(o)
    rows.sort(key=lambda o: o["timestamp"])
    out = []
    prev_user = None
    cur = None
    for o in rows:
        if o["type"] == "user":
            if cur:
                out.append(cur)
                cur = None
            prev_user = ts(o["timestamp"])
            continue
        rid = o.get("requestId")
        u = o["message"].get("usage") or {}
        if not u or prev_user is None:
            continue
        if cur and cur["rid"] == rid:
            cur["end"] = ts(o["timestamp"])
        else:
            if cur:
                out.append(cur)
            cur = dict(rid=rid, start=prev_user, end=ts(o["timestamp"]),
                       cached=u.get("cache_read_input_tokens", 0),
                       uncached=u.get("cache_creation_input_tokens", 0) + u.get("input_tokens", 0),
                       output=u.get("output_tokens", 0))
    if cur:
        out.append(cur)
    return [r for r in out if 0 < (r["end"] - r["start"]).total_seconds() < MAX_LATENCY_S]


def latency(r):
    return (r["end"] - r["start"]).total_seconds()


def per_request(reqs):
    lat = np.array([latency(r) for r in reqs])
    cached = np.array([r["cached"] for r in reqs]) / 1000
    uncached = np.array([r["uncached"] for r in reqs]) / 1000
    output = np.array([r["output"] for r in reqs]) / 1000
    print(f"{len(reqs)} requests; latency median {np.median(lat):.1f}s, mean {lat.mean():.1f}s")

    X = np.column_stack([np.ones(len(lat)), cached, uncached, output])
    coef, *_ = np.linalg.lstsq(X, lat, rcond=None)
    r2 = 1 - ((lat - X @ coef) ** 2).sum() / ((lat - lat.mean()) ** 2).sum()
    print("\nleast squares over all requests (confounded by output length, read with care)")
    print(f"  fixed {coef[0]:.2f}s, per 100k cached {coef[1] * 100:.2f}s, per 100k uncached {coef[2] * 100:.2f}s, per 1k output {coef[3]:.2f}s, R^2 {r2:.2f}")

    print("\nlow-output requests (<= 300 output tokens): median latency by total context")
    bins = defaultdict(list)
    for r, l in zip(reqs, lat):
        if r["output"] <= 300:
            bins[(r["cached"] + r["uncached"]) // 50000 * 50].append(l)
    print(f"  {'context':>10s} {'n':>6s} {'median':>7s} {'p75':>7s}")
    for b in sorted(bins):
        v = bins[b]
        if len(v) >= 30:
            print(f"  {b:>5d}-{b + 50:<4d}k {len(v):6d} {st.median(v):6.1f}s {np.percentile(v, 75):6.1f}s")


def accumulate(sessions):
    print(f"\n{len(sessions)} sessions with >= 20 requests")
    n = [s["n"] for s in sessions]
    print(f"requests per session: median {st.median(n):.0f}, p90 {np.percentile(n, 90):.0f}, max {max(n)}")
    print(f"requests per wall-clock minute: median {st.median([s['rate'] for s in sessions]):.1f}; "
          f"median pause between requests {st.median([s['gap'] for s in sessions]):.1f}s")

    weeks = defaultdict(list)
    for s in sessions:
        weeks[s["start"].strftime("%G-W%V")].append(s)
    print(f"\nper week (cached {CACHED_S_PER_K * 100:.1f}s/100k, uncached {UNCACHED_S_PER_K * 100:.1f}s/100k)")
    print(f"{'week':9s} {'sess':>4s} {'req':>6s} {'model h':>7s} {'ctx cost':>8s} {'share':>6s} {'>{}k saves':>11s} {'uncached':>8s} {'avg ctx':>7s}".format(BASELINE_K))
    for w in sorted(weeks):
        ss = weeks[w]
        model = sum(s["model"] for s in ss)
        cost = sum(s["cost"] for s in ss)
        above = sum(s["above"] for s in ss)
        unc = sum(s["unc"] for s in ss)
        print(f"{w:9s} {len(ss):4d} {sum(s['n'] for s in ss):6d} {model / 3600:7.1f} {cost / 60:6.0f}min {cost / model * 100:5.0f}% "
              f"{above / 60:8.0f}min {unc / 60:5.0f}min {np.mean([s['avgctx'] for s in ss]):6.0f}k")

    print("\nsessions where the accumulated context cost was largest")
    for s in sorted(sessions, key=lambda s: -s["cost"])[:6]:
        print(f"  {s['start']:%Y-%m-%d}  req {s['n']:4d}  avg ctx {s['avgctx']:4.0f}k  max {s['maxctx']:4.0f}k  "
              f"model {s['model'] / 60:5.0f} min  ctx cost {s['cost'] / 60:4.1f} min ({s['cost'] / s['model'] * 100:.0f}%)")

    model = sum(s["model"] for s in sessions)
    cost = sum(s["cost"] for s in sessions)
    above = sum(s["above"] for s in sessions)
    unc = sum(s["unc"] for s in sessions)
    print(f"\ntotal: model {model / 3600:.0f} h; context {cost / 3600:.1f} h ({cost / model * 100:.0f}%), "
          f"of which above {BASELINE_K}k {above / 3600:.1f} h; uncached {unc / 3600:.1f} h")


def session_summary(reqs):
    reqs.sort(key=lambda r: r["start"])
    ctx = [(r["cached"] + r["uncached"]) / 1000 for r in reqs]
    span = (reqs[-1]["end"] - reqs[0]["start"]).total_seconds()
    gaps = [(reqs[i + 1]["start"] - reqs[i]["end"]).total_seconds() for i in range(len(reqs) - 1)]
    return dict(start=reqs[0]["start"], n=len(reqs),
                model=sum(latency(r) for r in reqs),
                cost=sum(CACHED_S_PER_K * c for c in ctx),
                above=sum(CACHED_S_PER_K * max(c - BASELINE_K, 0) for c in ctx),
                unc=sum(UNCACHED_S_PER_K * r["uncached"] / 1000 for r in reqs),
                avgctx=np.mean(ctx), maxctx=max(ctx),
                rate=len(reqs) / (span / 60) if span else 0,
                gap=st.median(gaps) if gaps else 0)


def main(dirs):
    all_reqs = []
    sessions = []
    for d in dirs:
        for f in glob.glob(os.path.join(d, "*.jsonl")):
            reqs = requests_of(f)
            all_reqs += reqs
            if len(reqs) >= 20:
                sessions.append(session_summary(reqs))
    per_request(all_reqs)
    accumulate(sessions)


if __name__ == "__main__":
    main(sys.argv[1:])
