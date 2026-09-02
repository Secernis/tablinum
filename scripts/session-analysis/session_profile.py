"""Prototype: where does the wall-clock time of a Claude Code session go?

Reads one session JSONL and attributes every gap between consecutive
timestamped records to a bucket, based on what the gap ends in.
"""
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def load(path):
    rows = []
    for line in open(path, encoding="utf-8"):
        try:
            o = json.loads(line)
        except json.JSONDecodeError:
            continue
        if o.get("timestamp") and o.get("type") in ("user", "assistant", "system"):
            rows.append(o)
    rows.sort(key=lambda o: o["timestamp"])
    return rows


def classify_user(o):
    m = o.get("message", {})
    c = m.get("content")
    if isinstance(c, list) and any(isinstance(x, dict) and x.get("type") == "tool_result" for x in c):
        return "tool_result"
    text = c if isinstance(c, str) else " ".join(
        x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text") if isinstance(c, list) else ""
    if o.get("isMeta") or text.strip().startswith("<"):
        return "meta"
    return "human"


def main(path):
    rows = load(path)
    buckets = Counter()
    tool_time = Counter()
    tool_calls = Counter()
    longest = []
    hook_time = Counter()
    usage = Counter()
    pending_tools = {}  # tool_use_id -> (name, timestamp, input summary)
    last_assistant_had_tool = False
    prev = None
    turns = 0

    for o in rows:
        t = o.get("type")
        now = ts(o["timestamp"])
        if t == "assistant":
            m = o["message"]
            u = m.get("usage") or {}
            usage["output"] += u.get("output_tokens", 0)
            usage["thinking"] += (u.get("output_tokens_details") or {}).get("thinking_tokens", 0)
            usage["cache_read"] += u.get("cache_read_input_tokens", 0)
            usage["cache_create"] += u.get("cache_creation_input_tokens", 0)
            usage["input"] += u.get("input_tokens", 0)
            usage["requests"] += 1
            content = m.get("content") if isinstance(m.get("content"), list) else []
            tus = [x for x in content if x.get("type") == "tool_use"]
            for x in tus:
                inp = x.get("input", {})
                desc = inp.get("description") or inp.get("command") or inp.get("file_path") or inp.get("prompt") or ""
                pending_tools[x["id"]] = (x["name"], now, str(desc)[:90].replace("\n", " "))
            last_assistant_had_tool = bool(tus)
            if prev is not None:
                # gap ends in a model message: model was thinking/writing (plus PostToolUse hooks)
                buckets["model"] += (now - ts(prev["timestamp"])).total_seconds()
        elif t == "user":
            kind = classify_user(o)
            if kind == "tool_result":
                c = o["message"]["content"]
                for x in c:
                    if x.get("type") == "tool_result" and x.get("tool_use_id") in pending_tools:
                        name, started, desc = pending_tools.pop(x["tool_use_id"])
                        d = (now - started).total_seconds()
                        tool_time[name] += d
                        tool_calls[name] += 1
                        longest.append((d, name, desc))
                if prev is not None:
                    buckets["tools"] += (now - ts(prev["timestamp"])).total_seconds()
            elif kind == "human":
                turns += 1
                if prev is not None:
                    buckets["waiting_for_user"] += (now - ts(prev["timestamp"])).total_seconds()
            else:
                if prev is not None:
                    buckets["meta"] += (now - ts(prev["timestamp"])).total_seconds()
        elif t == "system":
            d = o.get("durationMs")
            if d:
                hook_time[o.get("subtype", "?")] += d / 1000
            if prev is not None:
                buckets["system"] += (now - ts(prev["timestamp"])).total_seconds()
        prev = o

    total = (ts(rows[-1]["timestamp"]) - ts(rows[0]["timestamp"])).total_seconds()

    def fmt(s):
        return f"{int(s // 60):3d}m {int(s % 60):02d}s"

    print(f"session span   {fmt(total)}   human turns {turns}   model requests {usage['requests']}")
    print("\n-- buckets (what the gap ends in) --")
    for k, v in buckets.most_common():
        print(f"  {k:18s} {fmt(v)}  {v / total * 100:5.1f}%")
    print("\n-- tool time by tool (assistant tool_use -> tool_result) --")
    for k, v in tool_time.most_common():
        print(f"  {k:16s} {fmt(v)}  calls {tool_calls[k]:3d}  avg {v / tool_calls[k]:6.1f}s")
    print("\n-- longest tool calls --")
    for d, name, desc in sorted(longest, reverse=True)[:8]:
        print(f"  {fmt(d)}  {name:8s} {desc}")
    print("\n-- hook runs recorded as system entries (durationMs) --")
    for k, v in hook_time.most_common():
        print(f"  {k:20s} {fmt(v)}")
    print("\n-- tokens --")
    for k in ("requests", "input", "cache_read", "cache_create", "output", "thinking"):
        print(f"  {k:14s} {usage[k]:>12,}")


if __name__ == "__main__":
    main(sys.argv[1])
