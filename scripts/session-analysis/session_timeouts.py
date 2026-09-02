"""Prototype: which Bash calls time out or run long, across a project's sessions?

Pairs every Bash tool_use with its tool_result, detects the harness timeout
message in the result text, and groups calls by a coarse command category.
The categories are substring matches on the command line and deliberately
loose; sharpen them per question rather than trusting them as a taxonomy.
"""
import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime

# Killed: the harness aborted the command. Backgrounded: it hit its timeout and
# kept running detached, so its duration is a wait, not a loss.
KILLED_TEXT = re.compile(r"Command timed out after")
BACKGROUNDED_TEXT = re.compile(r"did not complete within its \d+s timeout")

CATEGORIES = [
    ("preflight", re.compile(r"preflight")),
    ("gradle", re.compile(r"gradlew|gradle ")),
    ("swift-bridge", re.compile(r"swift:remote|test:swift|sx swift")),
    ("push-gate", re.compile(r"pnpm push|pnpm ship|npm run push")),
    ("cargo", re.compile(r"cargo ")),
    ("ts-tests/tsc", re.compile(r"vitest|pnpm test|tsc|typecheck")),
    ("supabase", re.compile(r"supabase|sx db")),
]


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def category(cmd):
    for name, pattern in CATEGORIES:
        if pattern.search(cmd):
            return name
    return "other"


def result_text(block):
    body = block.get("content")
    if isinstance(body, str):
        return body
    if isinstance(body, list):
        return " ".join(y.get("text", "") for y in body if isinstance(y, dict))
    return ""


def scan(files):
    timeouts = []
    errors = Counter()
    calls = Counter()
    seconds = Counter()
    weekly = defaultdict(Counter)
    for path in files:
        pending = {}
        for line in open(path, encoding="utf-8"):
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            if o.get("type") == "assistant":
                for x in o["message"].get("content") or []:
                    if isinstance(x, dict) and x.get("type") == "tool_use" and x["name"] == "Bash":
                        pending[x["id"]] = (ts(o["timestamp"]), x["input"].get("command", ""), x["input"].get("timeout"))
            elif o.get("type") == "user":
                content = o.get("message", {}).get("content")
                if not isinstance(content, list):
                    continue
                for x in content:
                    if not (isinstance(x, dict) and x.get("type") == "tool_result" and x.get("tool_use_id") in pending):
                        continue
                    started, cmd, limit = pending.pop(x["tool_use_id"])
                    duration = (ts(o["timestamp"]) - started).total_seconds()
                    text = result_text(x)
                    cat = category(cmd)
                    calls[cat] += 1
                    seconds[cat] += duration
                    week = started.strftime("%G-W%V")
                    weekly[week]["calls"] += 1
                    if KILLED_TEXT.search(text):
                        timeouts.append((started.strftime("%m-%d %H:%M"), duration, cat, limit, "killed", cmd[:100].replace("\n", " ")))
                        weekly[week]["killed"] += 1
                        weekly[week]["lost_min"] += duration / 60
                    elif BACKGROUNDED_TEXT.search(text):
                        timeouts.append((started.strftime("%m-%d %H:%M"), duration, cat, limit, "backgrounded", cmd[:100].replace("\n", " ")))
                        weekly[week]["backgrounded"] += 1
                    elif x.get("is_error"):
                        errors[cat] += 1
    return timeouts, errors, calls, seconds, weekly


def main(dirs):
    files = []
    for d in dirs:
        files += glob.glob(os.path.join(d, "*.jsonl"))
    timeouts, errors, calls, seconds, weekly = scan(files)
    killed = Counter(t[2] for t in timeouts if t[4] == "killed")
    backgrounded = Counter(t[2] for t in timeouts if t[4] == "backgrounded")
    print(f"{'category':14s} {'calls':>5s} {'killed':>6s} {'bkgnd':>6s} {'errors':>6s} {'avg s':>6s} {'total min':>9s}")
    for cat, n in calls.most_common():
        print(f"{cat:14s} {n:5d} {killed[cat]:6d} {backgrounded[cat]:6d} {errors[cat]:6d} {seconds[cat] / n:6.1f} {seconds[cat] / 60:9.0f}")
    print("\nweek       calls killed  bkgnd  lost-min")
    for week in sorted(weekly):
        w = weekly[week]
        print(f"{week}  {w['calls']:5d} {w['killed']:6d} {w['backgrounded']:6d} {w['lost_min']:9.0f}")
    lost = sum(t[1] for t in timeouts if t[4] == "killed") / 60
    print(f"\n{sum(killed.values())} killed ({lost:.0f} min lost), {sum(backgrounded.values())} backgrounded\n")
    for t in sorted(timeouts):
        print(f"{t[0]}  {t[1] / 60:5.1f}min  {t[4]:12s} limit={str(t[3]):7s} {t[2]:12s} {t[5]}")


if __name__ == "__main__":
    main(sys.argv[1:])
