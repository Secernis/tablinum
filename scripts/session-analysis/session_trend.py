"""Prototype: one line per session across a project directory, to see trends.

Columns: date, span, human turns, model requests, model/tool/wait minutes,
average cached context per request, output tokens, edits (Edit+Write).
"""
import glob
import json
import os
import sys
from collections import Counter
from datetime import datetime


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def is_tool_result(o):
    c = o.get("message", {}).get("content")
    return isinstance(c, list) and any(isinstance(x, dict) and x.get("type") == "tool_result" for x in c)


def is_human(o):
    c = o.get("message", {}).get("content")
    text = c if isinstance(c, str) else (" ".join(
        x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text") if isinstance(c, list) else "")
    return not o.get("isMeta") and bool(text.strip()) and not text.strip().startswith("<")


def profile(path):
    rows = []
    for line in open(path, encoding="utf-8"):
        try:
            o = json.loads(line)
        except json.JSONDecodeError:
            continue
        if o.get("timestamp") and o.get("type") in ("user", "assistant") and not o.get("isSidechain"):
            rows.append(o)
    if len(rows) < 4:
        return None
    rows.sort(key=lambda o: o["timestamp"])
    b = Counter()
    prev = None
    turns = 0
    requests = 0
    cache = 0
    out = 0
    edits = 0
    bash = 0
    for o in rows:
        now = ts(o["timestamp"])
        gap = (now - ts(prev["timestamp"])).total_seconds() if prev else 0
        if o["type"] == "assistant":
            u = o["message"].get("usage") or {}
            if u:
                requests += 1
                cache += u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0) + u.get("input_tokens", 0)
                out += u.get("output_tokens", 0)
            for x in o["message"].get("content") or []:
                if isinstance(x, dict) and x.get("type") == "tool_use":
                    edits += x["name"] in ("Edit", "Write", "MultiEdit")
                    bash += x["name"] == "Bash"
            b["model"] += gap
        elif is_tool_result(o):
            b["tool"] += gap
        elif is_human(o):
            turns += 1
            b["wait"] += gap
        prev = o
    span = (ts(rows[-1]["timestamp"]) - ts(rows[0]["timestamp"])).total_seconds()
    if span < 300 or requests == 0:
        return None
    return dict(date=rows[0]["timestamp"][:16].replace("T", " "), span=span / 60, turns=turns, req=requests,
                model=b["model"] / 60, tool=b["tool"] / 60, wait=b["wait"] / 60,
                ctx=cache / requests / 1000, out=out / 1000, edits=edits, bash=bash,
                per_req=(b["model"] / requests) if requests else 0)


def main(dirs):
    files = []
    for d in dirs:
        files += glob.glob(os.path.join(d, "*.jsonl"))
    res = [r for r in (profile(f) for f in files) if r]
    res.sort(key=lambda r: r["date"])
    print(f"{'start (UTC)':16s} {'span':>6s} {'turns':>5s} {'req':>5s} {'model':>6s} {'tool':>6s} {'wait':>6s} {'s/req':>5s} {'ctx k':>6s} {'out k':>6s} {'edits':>5s} {'bash':>4s}")
    for r in res:
        print(f"{r['date']:16s} {r['span']:6.0f} {r['turns']:5d} {r['req']:5d} {r['model']:6.0f} {r['tool']:6.0f} {r['wait']:6.0f} {r['per_req']:5.1f} {r['ctx']:6.0f} {r['out']:6.0f} {r['edits']:5d} {r['bash']:4d}")
    print(f"\n{len(res)} sessions >= 5 min")


if __name__ == "__main__":
    main(sys.argv[1:])
