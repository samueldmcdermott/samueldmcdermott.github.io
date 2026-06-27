#!/usr/bin/env python3
"""
Score World Cup 2026 bracket submissions against the official results and
write wc2026/leaderboard.json.

Single source of truth for the bracket structure is wc2026/src/data.js — this
script parses the TREE (round -> match ids) and POINTS constants straight out of
it, so there is no duplicated tree definition to drift.

Inputs (paths relative to repo root):
  wc2026/src/data.js            - bracket tree + point weights (parsed)
  wc2026/data/results.json      - official outcomes, hand-edited:
                                    { "winners": { "<matchId>": "a"|"b"|null } }
  wc2026/data/submissions.json  - list of { user, picks, issue?, submittedAt? }
                                    picks = "74a,77b,90a,..." (matchId + side)

Output:
  wc2026/leaderboard.json       - { updatedAt, resultsCount, maxPossible, entries:[...] }

Scoring: for every match that has an official winner, each submission earns
POINTS[round] if its pick for that match matches. The third-place match (id 103)
is intentionally excluded — it carries no round in POINTS, mirroring the page.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(REPO_ROOT, "wc2026", "src", "data.js")
RESULTS = os.path.join(REPO_ROOT, "wc2026", "data", "results.json")
SUBMISSIONS = os.path.join(REPO_ROOT, "wc2026", "data", "submissions.json")
OUT = os.path.join(REPO_ROOT, "wc2026", "leaderboard.json")


def parse_bracket(js_text):
    """Return (round_of, points): match id -> round name, and round -> weight."""
    # POINTS = {r32:1, r16:2, qf:4, sf:8, final:16};
    m = re.search(r"const\s+POINTS\s*=\s*\{([^}]*)\}", js_text)
    if not m:
        raise ValueError("Could not find POINTS in data.js")
    points = {k: int(v) for k, v in re.findall(r"(\w+)\s*:\s*(\d+)", m.group(1))}

    round_of = {}

    # R32 match ids live in the const R32 = [ ... ] array.
    r32_block = re.search(r"const\s+R32\s*=\s*\[(.*?)\];", js_text, re.S)
    if not r32_block:
        raise ValueError("Could not find R32 array in data.js")
    for mid in re.findall(r"id:\s*(\d+)", r32_block.group(1)):
        round_of[mid] = "r32"

    # Each later round is a named array inside TREE: r16:[...], qf:[...], sf:[...]
    for rnd in ("r16", "qf", "sf"):
        blk = re.search(rnd + r"\s*:\s*\[(.*?)\]\s*,", js_text, re.S)
        if not blk:
            raise ValueError("Could not find %s array in data.js" % rnd)
        for mid in re.findall(r"id:\s*(\d+)", blk.group(1)):
            round_of[mid] = rnd

    # final:{id:104, ...}
    fin = re.search(r"final\s*:\s*\{\s*id:\s*(\d+)", js_text)
    if not fin:
        raise ValueError("Could not find final in data.js")
    round_of[fin.group(1)] = "final"

    # Note: the third-place match (id 103) is deliberately NOT mapped to a round,
    # so it is never scored.
    return round_of, points


def decode_picks(s):
    """'74a,77b' -> {'74':'a','77':'b'} (ignores malformed tokens)."""
    out = {}
    for tok in (s or "").split(","):
        tok = tok.strip()
        if len(tok) < 2:
            continue
        side = tok[-1]
        mid = tok[:-1]
        if side in ("a", "b") and mid.isdigit():
            out[mid] = side
    return out


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        txt = f.read().strip()
    if not txt:
        return default
    return json.loads(txt)


def main():
    with open(DATA_JS, "r", encoding="utf-8") as f:
        round_of, points = parse_bracket(f.read())

    results = load_json(RESULTS, {"winners": {}})
    winners = {
        str(k): v
        for k, v in (results.get("winners") or {}).items()
        if v in ("a", "b") and str(k) in round_of  # only scored matches with a result
    }

    # Points available so far = sum of weights over decided, scored matches.
    max_possible = sum(points[round_of[mid]] for mid in winners)

    submissions = load_json(SUBMISSIONS, [])

    # One scored bracket per user: the one explicitly marked official. If a user
    # has no official bracket (e.g. legacy data), fall back to their latest submit.
    chosen = {}
    for sub in submissions:
        user = (sub.get("user") or "").strip()
        if not user:
            continue
        key = user.lower()
        ts = sub.get("submittedAt") or ""
        prev = chosen.get(key)
        if prev is None:
            chosen[key] = sub
            continue
        prev_official = bool(prev.get("official"))
        this_official = bool(sub.get("official"))
        # Prefer an official bracket; among same official-ness, prefer the latest.
        if this_official and not prev_official:
            chosen[key] = sub
        elif this_official == prev_official and ts >= (prev.get("submittedAt") or ""):
            chosen[key] = sub

    entries = []
    for sub in chosen.values():
        picks = decode_picks(sub.get("picks", ""))
        score = 0
        correct = 0
        for mid, actual in winners.items():
            if picks.get(mid) == actual:
                score += points[round_of[mid]]
                correct += 1
        entries.append({
            "user": (sub.get("user") or "").strip(),
            "label": sub.get("label") or "",
            "bid": sub.get("bid"),
            "score": score,
            "correct": correct,
            "maxPossible": max_possible,
            "submittedAt": sub.get("submittedAt"),
            "issue": sub.get("issue"),
        })

    # Rank by score desc, then earlier submission first, then name.
    entries.sort(key=lambda e: (-e["score"], e.get("submittedAt") or "", e["user"].lower()))

    out = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "resultsCount": len(winners),
        "maxPossible": max_possible,
        "entries": entries,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")

    print("Scored %d submission(s) against %d result(s); max possible so far = %d"
          % (len(entries), len(winners), max_possible))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - surface a clean error in CI logs
        print("score_bracket.py failed: %s" % exc, file=sys.stderr)
        sys.exit(1)
