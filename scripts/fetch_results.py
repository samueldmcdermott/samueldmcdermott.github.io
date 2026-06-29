#!/usr/bin/env python3
"""
Stage 2 (SCAFFOLD): auto-fill official results from an external source.

This is wired into a MANUALLY-triggered workflow (.github/workflows/fetch-results.yml,
workflow_dispatch only — no cron). When run, it asks a results source for the
outcome of every currently-open match and records any finished ones into
wc2026/data/results.json, reusing the exact code->side resolution that the
manual CLI (set_result.py) uses. Committing results.json then chains into the
existing leaderboard workflow, which re-scores.

>>> THE DATA SOURCE IS NOT WIRED YET. <<<
fetch_finished_results() below is a stub that returns []. To finish Stage 2,
implement it against a football results API (e.g. football-data.org) — see the
docstring there for the exact contract. Nothing external is called until you do.

Run locally:
    python scripts/fetch_results.py            # dry run: prints what it WOULD set
    python scripts/fetch_results.py --write     # actually write results.json
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_bracket import parse_bracket, DATA_JS, RESULTS, load_json  # noqa: E402
from set_result import build_open_matches  # noqa: E402


def fetch_finished_results(open_matches):
    """STUB. Return a list of finished outcomes for the given open matches:

        [{"winner": "<CODE>", "loser": "<CODE>"}, ...]

    Each entry names the two teams of a match that has FINISHED (full result,
    including extra time / penalties — knockouts always have a winner). Only
    include matches that are actually decided; skip in-progress or not-yet-played
    ones. `open_matches` is the list this script wants outcomes for, each a dict
    with id/a_code/b_code/a_name/b_name (see set_result.build_open_matches), so an
    implementation can map fixtures by the team codes it already has in hand.

    To implement (example shape, not wired):
        - read an API key from env (e.g. os.environ["FOOTBALL_API_KEY"])
        - GET finished fixtures for the tournament
        - for each, map the two teams to our 3-letter codes and the winner
        - return only those whose teams match an open match here
    """
    # No source configured yet -> nothing to set.
    return []


def resolve_side(open_matches, winner, loser):
    """Find the open match with this winner (and loser, if given) and return
       (match_id, win_side) or (None, None) if not found / ambiguous."""
    cands = []
    for m in open_matches:
        sides = {m["a_code"], m["b_code"]}
        if winner in sides and (loser is None or loser in sides):
            cands.append(m)
    if len(cands) != 1:
        return None, None
    m = cands[0]
    return m["id"], ("a" if m["a_code"] == winner else "b")


def main(argv):
    write = "--write" in argv

    with open(DATA_JS, "r", encoding="utf-8") as f:
        model = parse_bracket(f.read())
    results = load_json(RESULTS, {"winners": {}})
    winners = results.setdefault("winners", {})
    decided = {str(k): v for k, v in winners.items() if v in ("a", "b")}

    open_matches = build_open_matches(model, decided)
    outcomes = fetch_finished_results(open_matches)

    if not outcomes:
        print("No finished results to apply "
              "(source is a stub — implement fetch_finished_results).")
        return 0

    changes = []
    for o in outcomes:
        w = (o.get("winner") or "").strip().upper()
        l = (o.get("loser") or "").strip().upper() or None
        mid, side = resolve_side(open_matches, w, l)
        if mid is None:
            print("  skip: %s vs %s — no unique open match." % (w, l), file=sys.stderr)
            continue
        winners[str(mid)] = side
        decided[str(mid)] = side
        # re-derive open matches so later rounds can resolve within this run
        open_matches = build_open_matches(model, decided)
        changes.append((mid, w, l))

    for mid, w, l in changes:
        print("%s M%s: %s beats %s" % ("set" if write else "would set", mid, w, l or "?"))

    if write and changes:
        with open(RESULTS, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
            f.write("\n")
        print("Wrote %d result(s) to %s" % (len(changes), RESULTS))
    elif changes:
        print("(dry run — pass --write to apply)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as exc:  # noqa: BLE001
        print("fetch_results.py failed: %s" % exc, file=sys.stderr)
        sys.exit(1)
