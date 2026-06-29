#!/usr/bin/env python3
"""
Record an official Round-of-32-and-beyond result by COUNTRY CODE, without having
to know the match number.

Usage:
    python scripts/set_result.py WINNER [LOSER]

    WINNER, LOSER are 3-letter codes from data.js CODES (e.g. BRA, JPN).
    The WINNER is listed first:  "BRA JPN"  =  Brazil beats Japan.

How it works:
    An "open" match is one that is not yet decided but whose BOTH teams are
    already known (either a fixed Round-of-32 pairing, or a later-round match
    whose two feeders have official winners). We resolve every open match to its
    (a-code, b-code), find the unique open match containing WINNER (optionally
    pinned by LOSER), and set winners[matchId] to the side WINNER sits on.

    Later rounds propagate automatically: the scorer and the live page resolve a
    match's teams from `winners`, so once you set match 73, match 89's feeder is
    known on the next score/render. You never set a later match's teams by hand.

    Match 103 (third place) is handled too — its feeders are the semifinal losers.

On ambiguity or an unknown code, the script writes nothing and prints the open
matches so you can re-run with both codes.

Exit codes: 0 on a successful write (or an idempotent no-op), 1 on any error.
"""

import json
import os
import sys

# Reuse the single source of truth: data.js parser + team resolution from the
# scorer. No duplicated bracket model.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_bracket import (  # noqa: E402
    parse_bracket, side_team, DATA_JS, RESULTS, load_json,
)


def loser_of(model, winners, feeder):
    """Team that LOST `feeder` per official results, or None if undecided.
       (side_team resolves winners; the third-place game needs the losers.)"""
    side = winners.get(str(feeder))
    if side not in ("a", "b"):
        return None
    lose = "b" if side == "a" else "a"
    return side_team(model, winners, str(feeder), lose)


def match_teams(model, winners, mid):
    """(a_name, b_name) for `mid`, or (None, None) if not yet playable.
       Match 103 (third place) is the two SEMIFINAL LOSERS, not winners."""
    if str(mid) == "103":
        fa, fb = model["feeders"]["103"]
        return loser_of(model, winners, fa), loser_of(model, winners, fb)
    return (side_team(model, winners, mid, "a"),
            side_team(model, winners, mid, "b"))


def build_open_matches(model, winners):
    """List of open matches as dicts:
         {id, round, a_name, b_name, a_code, b_code}
       'open' = not yet in `winners`, but both teams resolvable from `winners`.
       Covers R32 (fixed teams) + later rounds + 103 (third place)."""
    codes = model["codes"]
    def code(name):
        return codes.get(name) or name

    # Every match id we know about: scored rounds + the third-place game (103),
    # whose feeders are recorded in model["feeders"].
    all_ids = set(model["round_of"]) | set(model["feeders"]) | set(model["r32team"])

    open_matches = []
    for mid in all_ids:
        if mid in winners:
            continue  # already decided
        a, b = match_teams(model, winners, mid)
        if not a or not b:
            continue  # one or both teams not yet known -> not playable yet
        open_matches.append({
            "id": mid,
            "round": model["round_of"].get(mid, "third"),
            "a_name": a, "b_name": b,
            "a_code": code(a), "b_code": code(b),
        })
    # stable, readable order
    open_matches.sort(key=lambda m: int(m["id"]))
    return open_matches


def fmt_match(m):
    return "  M%s  %s (%s) vs %s (%s)" % (
        m["id"], m["a_name"], m["a_code"], m["b_name"], m["b_code"])


def die(msg, open_matches=None):
    print("ERROR: " + msg, file=sys.stderr)
    if open_matches is not None:
        if open_matches:
            print("\nOpen matches right now:", file=sys.stderr)
            for m in open_matches:
                print(fmt_match(m), file=sys.stderr)
        else:
            print("\n(No open matches — every playable match is decided.)",
                  file=sys.stderr)
    sys.exit(1)


def main(argv):
    if not (1 <= len(argv) <= 2):
        die("usage: set_result.py WINNER [LOSER]   (codes, winner first; e.g. BRA JPN)")
    winner = argv[0].strip().upper()
    loser = argv[1].strip().upper() if len(argv) == 2 else None

    with open(DATA_JS, "r", encoding="utf-8") as f:
        model = parse_bracket(f.read())

    results = load_json(RESULTS, {"winners": {}})
    winners = results.setdefault("winners", {})
    # normalize: only "a"/"b" count as decided
    decided = {str(k): v for k, v in winners.items() if v in ("a", "b")}

    known_codes = set(model["codes"].values())
    if winner not in known_codes:
        die("'%s' is not a known team code." % winner)
    if loser is not None and loser not in known_codes:
        die("'%s' is not a known team code." % loser)

    open_matches = build_open_matches(model, decided)

    # candidate open matches containing WINNER (and LOSER if given)
    cands = []
    for m in open_matches:
        sides = {m["a_code"], m["b_code"]}
        if winner not in sides:
            continue
        if loser is not None and loser not in sides:
            continue
        cands.append(m)

    if not cands:
        # Maybe it's already decided exactly this way — report an idempotent no-op
        # rather than a confusing "no open match" error.
        for mid in decided:
            a, b = match_teams(model, decided, mid)
            if not a or not b:
                continue
            ac, bc = (model["codes"].get(a) or a), (model["codes"].get(b) or b)
            win_code = ac if decided[mid] == "a" else bc
            lose_code = bc if decided[mid] == "a" else ac
            if win_code == winner and (loser is None or loser == lose_code):
                print("Already set: M%s %s beats %s. No change." % (mid, winner, lose_code))
                return 0
        if loser is not None:
            die("no open match has %s vs %s." % (winner, loser), open_matches)
        die("'%s' is in no open match." % winner, open_matches)
    if len(cands) > 1:
        die("'%s' is ambiguous (in %d open matches) — re-run with the loser too, "
            "e.g. set_result.py %s <LOSER>." % (winner, len(cands), winner), cands)

    m = cands[0]
    win_side = "a" if m["a_code"] == winner else "b"

    if winners.get(str(m["id"])) == win_side:
        print("Already set: M%s winner is %s. No change." % (m["id"], winner))
        return 0

    winners[str(m["id"])] = win_side
    with open(RESULTS, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
        f.write("\n")

    loser_code = m["b_code"] if win_side == "a" else m["a_code"]
    print("Set M%s: %s beats %s  (side %s)." % (m["id"], winner, loser_code, win_side))
    print("Re-run scoring with: python scripts/score_bracket.py")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print("set_result.py failed: %s" % exc, file=sys.stderr)
        sys.exit(1)
