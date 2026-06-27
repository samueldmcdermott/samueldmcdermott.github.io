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
    """Parse data.js into a bracket model. Returns a dict with:
         round_of : matchId -> round name ("r32".."final"); 103 omitted (unscored)
         points   : round -> weight
         feeders  : matchId -> (feederIdA, feederIdB) for non-R32 matches
         r32team  : matchId -> (teamNameA, teamNameB) for R32 matches
         codes    : team name -> 3-letter code
       This mirrors data.js so there is no duplicated tournament definition.
    """
    # POINTS = {r32:1, r16:2, qf:4, sf:8, final:16};
    m = re.search(r"const\s+POINTS\s*=\s*\{([^}]*)\}", js_text)
    if not m:
        raise ValueError("Could not find POINTS in data.js")
    points = {k: int(v) for k, v in re.findall(r"(\w+)\s*:\s*(\d+)", m.group(1))}

    round_of, feeders, r32team = {}, {}, {}

    # R32: const R32 = [ {id:74, a:T("Germany",..), b:T("Paraguay",..)}, ... ]
    r32_block = re.search(r"const\s+R32\s*=\s*\[(.*?)\];", js_text, re.S)
    if not r32_block:
        raise ValueError("Could not find R32 array in data.js")
    for entry in re.findall(r"\{id:\s*(\d+),\s*a:\s*[TP]\(\s*\"([^\"]+)\".*?,\s*b:\s*[TP]\(\s*\"([^\"]+)\"",
                            r32_block.group(1), re.S):
        mid, a, b = entry
        round_of[mid] = "r32"
        r32team[mid] = (a, b)

    # Later rounds: r16/qf/sf arrays of {id:NN, from:[A,B]}
    for rnd in ("r16", "qf", "sf"):
        blk = re.search(rnd + r"\s*:\s*\[(.*?)\]\s*,", js_text, re.S)
        if not blk:
            raise ValueError("Could not find %s array in data.js" % rnd)
        for mid, fa, fb in re.findall(r"\{id:\s*(\d+),\s*from:\[(\d+),\s*(\d+)\]\}", blk.group(1)):
            round_of[mid] = rnd
            feeders[mid] = (fa, fb)

    # final:{id:104, from:[101,102]}
    fin = re.search(r"final\s*:\s*\{\s*id:\s*(\d+),\s*from:\[(\d+),\s*(\d+)\]\}", js_text)
    if not fin:
        raise ValueError("Could not find final in data.js")
    round_of[fin.group(1)] = "final"
    feeders[fin.group(1)] = (fin.group(2), fin.group(3))

    # third:{id:103, from:[101,102]} — not scored, but its feeders let us resolve
    # the 3rd-place game for the tiebreak.
    third = re.search(r"third\s*:\s*\{\s*id:\s*(\d+),\s*from:\[(\d+),\s*(\d+)\]\}", js_text)
    if third:
        feeders[third.group(1)] = (third.group(2), third.group(3))

    # CODES = { "Germany":"GER", ... }
    codes = {}
    cb = re.search(r"const\s+CODES\s*=\s*\{(.*?)\};", js_text, re.S)
    if cb:
        codes = dict(re.findall(r'"([^"]+)"\s*:\s*"([^"]+)"', cb.group(1)))

    return {"round_of": round_of, "points": points,
            "feeders": feeders, "r32team": r32team, "codes": codes}


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


def side_team(model, picks, mid, side):
    """Team on (mid, side) given a picks dict (winner-of feeders recursively)."""
    if mid in model["r32team"]:
        a, b = model["r32team"][mid]
        return a if side == "a" else b
    fa, fb = model["feeders"][mid]
    feeder = fa if side == "a" else fb
    return winner_team(model, picks, feeder)


def winner_team(model, picks, mid):
    """Team the given picks advance out of `mid`, or None if unresolved."""
    side = picks.get(str(mid))
    if side not in ("a", "b"):
        return None
    return side_team(model, picks, str(mid), side)


def eliminated_teams(model, winners):
    """Names of teams eliminated by an official result (lost a decided match)."""
    dead = set()
    for mid, side in winners.items():
        lose = "b" if side == "a" else "a"
        t = side_team(model, winners, mid, lose)
        if t:
            dead.add(t)
    return dead


def code(model, name):
    return model["codes"].get(name) or (name or "")


def main():
    with open(DATA_JS, "r", encoding="utf-8") as f:
        model = parse_bracket(f.read())
    round_of, points = model["round_of"], model["points"]
    SCORED = set(round_of)              # scored match ids (103 excluded)

    results = load_json(RESULTS, {"winners": {}})
    raw_winners = results.get("winners") or {}
    # scored matches with an official result
    winners = {str(k): v for k, v in raw_winners.items()
               if v in ("a", "b") and str(k) in SCORED}
    third_result = raw_winners.get("103")        # tiebreak only; may be None
    if third_result not in ("a", "b"):
        third_result = None

    dead = eliminated_teams(model, winners)
    decided = set(winners)
    # perfect bracket total (every round worth the same); used to cap maxPossible
    perfect_total = 16 + 16 + 16 + 16 + 16  # = 80 by the doubling scheme

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
        score = correct = 0
        # points already earned
        for mid, actual in winners.items():
            if picks.get(mid) == actual:
                score += points[round_of[mid]]
                correct += 1
        # max the player can STILL reach: earned points + every undecided scored
        # match whose pick is a team not yet eliminated.
        still = score
        for mid in SCORED:
            if mid in decided:
                continue
            t = side_team(model, picks, mid, picks.get(mid)) if picks.get(mid) in ("a", "b") else None
            if t and t not in dead:
                still += points[round_of[mid]]
        still = min(still, perfect_total)

        # final prediction: this bracket's two finalists ("ARG beats FRA")
        fa = winner_team(model, picks, "101")
        fb = winner_team(model, picks, "102")
        champ = winner_team(model, picks, "104")
        if champ and fa and fb:
            runner = fb if champ == fa else fa
            final_pick = "%s beats %s" % (code(model, champ), code(model, runner))
        else:
            final_pick = ""

        # third-place pick correctness (tiebreak only)
        third_correct = 1 if (third_result and picks.get("103") == third_result) else 0

        entries.append({
            "user": (sub.get("user") or "").strip(),
            "bid": sub.get("bid"),
            "score": score,
            "correct": correct,
            "maxPossible": still,
            "finalPick": final_pick,
            "thirdCorrect": third_correct,
            "submittedAt": sub.get("submittedAt"),
        })

    # Rank: points desc, then 3rd-place tiebreak, then earliest submit, then name.
    entries.sort(key=lambda e: (-e["score"], -e["thirdCorrect"],
                                e.get("submittedAt") or "", e["user"].lower()))

    out = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "resultsCount": len(winners),
        "thirdDecided": bool(third_result),
        "entries": entries,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")

    print("Scored %d submission(s) against %d result(s)%s"
          % (len(entries), len(winners),
             "; 3rd-place tiebreak active" if third_result else ""))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - surface a clean error in CI logs
        print("score_bracket.py failed: %s" % exc, file=sys.stderr)
        sys.exit(1)
