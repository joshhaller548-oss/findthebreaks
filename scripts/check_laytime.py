"""Independent check of the laytime data and answer key.

Shares no code with the JavaScript calculator. Where calc.mjs does interval
arithmetic, this walks every minute of every voyage and decides, minute by
minute, whether laytime is running. Money is Decimal, rounded half up.

It checks, in order:
  1. the worked example from the brief, figure by figure
  2. the shape of the data and the rules behind counts_against_laytime
  3. every voyage in the answer key, minute for minute and cent for cent
  4. the groups that share a timeline give different answers
  5. the owner's statement is wrong on exactly three voyages, one of each
     planted kind, and right on the rest

Run: python3 scripts/check_laytime.py    (exits non-zero on any failure)
"""

import json
import re
import sys
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MINUTE = timedelta(minutes=1)
WEEK = 7 * 1440
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]  # Python's weekday() order

passes = 0
failures = 0


def check(label, ok, detail=""):
    global passes, failures
    if ok:
        passes += 1
    else:
        failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f"  ({detail})" if detail else ""))


def section(name):
    print(f"\n{name}")


def load(rel):
    return json.loads((ROOT / rel).read_text())


def at(s):
    return datetime.strptime(s, "%Y-%m-%d %H:%M")


def stamp(dt):
    return dt.strftime("%Y-%m-%d %H:%M")


def minutes(a, b):
    return int((b - a) / MINUTE)


def hm(n):
    sign = "-" if n < 0 else ""
    n = abs(n)
    return f"{sign}{n // 1440}d {(n % 1440) // 60:02d}h" + (f" {n % 60:02d}m" if n % 60 else "")


def money(n_minutes, rate_per_day, divisor):
    value = Decimal(n_minutes) * Decimal(rate_per_day) / Decimal(1440 * divisor)
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ---------- the SHEX window, as a test on one minute ----------

def window_test(text):
    m = re.fullmatch(r"(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d\d):(\d\d) to (?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat) )?(\d\d):(\d\d)", text or "")
    if not m:
        raise ValueError(f"cannot read SHEX window {text!r}")
    start = DAYS.index(m[1]) * 1440 + int(m[2]) * 60 + int(m[3])
    end_day = DAYS.index(m[4]) if m[4] else DAYS.index(m[1])
    end = end_day * 1440 + int(m[5]) * 60 + int(m[6])
    if end <= start:
        end += WEEK

    def inside(dt):
        mow = dt.weekday() * 1440 + dt.hour * 60 + dt.minute
        return start <= mow < end or start <= mow + WEEK < end

    return inside


# ---------- one voyage, minute by minute ----------

def simulate(f, stops):
    nor, load_start, done = at(f["nor_tendered"]), at(f["loading_commenced"]), at(f["loading_completed"])
    allowed = Fraction(f["cargo_mt"] * 1440, f["load_rate_mt_per_day"])
    assert allowed.denominator == 1, "laytime allowed must be whole minutes"
    allowed = int(allowed)
    commenced = min(nor + timedelta(hours=f["turn_time_hrs"]), load_start)
    basis = f["shex_basis"]
    in_window = window_test(f["shex_window"]) if basis != "SHINC" else (lambda dt: False)
    spans = [(at(s["start"]), at(s["end"]), s["counts_against_laytime"]) for s in stops]

    def stopped(dt):
        return any(a <= dt < b for a, b, _ in spans)

    def deductible(dt):
        return any(a <= dt < b and not counts for a, b, counts in spans)

    def counts(dt):
        if dt >= done:
            # Nothing is loaded after completion, so any SHEX window is excepted
            return not in_window(dt)
        if deductible(dt):
            return False
        if in_window(dt):
            if basis == "SHEX EIU":
                return False
            if basis == "SHEX UU":
                return dt >= load_start and not stopped(dt)
        return True

    used = 0
    stop_min = 0
    shex_min = 0
    expiry = None
    dt = commenced
    while dt < done:
        if counts(dt):
            used += 1
            if used == allowed and expiry is None:
                expiry = dt + MINUTE
        elif deductible(dt):
            stop_min += 1
        else:
            shex_min += 1
        dt += MINUTE
    counted = used
    while expiry is None:
        if counts(dt):
            counted += 1
            if counted == allowed:
                expiry = dt + MINUTE
        dt += MINUTE

    balance = used - allowed
    out = {
        "allowed_min": allowed,
        "laytime_commenced": stamp(commenced),
        "elapsed_min": minutes(commenced, done),
        "deductible_stoppage_min": stop_min,
        "shex_excepted_min": shex_min,
        "used_min": used,
        "balance_min": balance,
        "laytime_expiry": stamp(expiry),
        "result": "demurrage" if balance > 0 else "despatch" if balance < 0 else "level",
        "time_on_demurrage_min": 0,
        "time_saved_min": 0,
        "amount_usd": Decimal("0.00"),
        "once_on_demurrage_holds": True,
    }
    if balance > 0:
        on_dem = minutes(expiry, done)
        out["time_on_demurrage_min"] = on_dem
        out["once_on_demurrage_holds"] = on_dem == balance
        out["amount_usd"] = money(on_dem, f["demurrage_rate_usd_per_day"], 1)
    elif balance < 0:
        saved = -balance if f["despatch_basis"] == "working time saved" else minutes(done, expiry)
        out["time_saved_min"] = saved
        out["amount_usd"] = money(saved, f["demurrage_rate_usd_per_day"], 2)
    return out


# ---------- 1. the worked example ----------

section("1. Worked example from the brief")
defaults = load("public/config/laytime-defaults.json")
example = load("public/data/laytime-worked-example.json")
print(f"  defaults ({defaults['status']}): {defaults['shex_basis']}, {defaults['despatch_basis']}, {defaults['shex_window']}")


def example_with(**over):
    f = dict(example["fixture"], shex_basis=defaults["shex_basis"], despatch_basis=defaults["despatch_basis"], shex_window=defaults["shex_window"])
    f.update(over)
    return simulate(f, example["stoppages"])


base = example_with()
check("laytime allowed 5d 00h", base["allowed_min"] == 5 * 1440, hm(base["allowed_min"]))
check("laytime commenced Mon 1 Jun 20:00, after 12 hours turn time", base["laytime_commenced"] == "2026-06-01 20:00")
check("elapsed 5d 18h", base["elapsed_min"] == 5 * 1440 + 18 * 60, hm(base["elapsed_min"]))
check("deductions: rain 6h, Sunday under SHEX 14h", base["deductible_stoppage_min"] == 360 and base["shex_excepted_min"] == 840)
check("laytime used 4d 22h", base["used_min"] == 4 * 1440 + 22 * 60, hm(base["used_min"]))
check("2 hours saved, despatch due", base["result"] == "despatch" and base["time_saved_min"] == 120)
check("SHEX EIU, working time saved: despatch USD 1,041.67", base["amount_usd"] == Decimal("1041.67"), str(base["amount_usd"]))

uu = example_with(**example["contrast"])
check("SHEX UU: the Sunday is used, so it counts: used 5d 12h", uu["used_min"] == 5 * 1440 + 12 * 60, hm(uu["used_min"]))
check("SHEX UU: 12 hours on demurrage", uu["result"] == "demurrage" and uu["time_on_demurrage_min"] == 720)
check("SHEX UU: demurrage USD 12,500.00", uu["amount_usd"] == Decimal("12500.00"), str(uu["amount_usd"]))

# Worked out by hand as well; they show what the other two conventions do
check("all time saved instead: 12 hours saved, USD 6,250.00", example_with(despatch_basis="all time saved")["amount_usd"] == Decimal("6250.00"))
check("Sat 17:00 to Mon 08:00 window: 9 hours saved, USD 4,687.50", example_with(shex_window="Sat 17:00 to Mon 08:00")["amount_usd"] == Decimal("4687.50"))
check("that window on all time saved: 27 hours, USD 14,062.50", example_with(shex_window="Sat 17:00 to Mon 08:00", despatch_basis="all time saved")["amount_usd"] == Decimal("14062.50"))

# ---------- 2. data shape and stoppage rules ----------

section("2. Data shape and the rules behind counts_against_laytime")
data = load("public/data/laytime.json")["tables"]
key = load("public/data/laytime.key.json")
fixtures, stoppages, owner = data["fixtures"], data["stoppages"], data["owner_statement"]
FIELDS = ["voyage_id", "vessel", "cargo_mt", "load_rate_mt_per_day", "shex_basis", "shex_window", "despatch_basis",
          "waiting_for_berth", "demurrage_rate_usd_per_day", "turn_time_hrs", "nor_tendered", "loading_commenced", "loading_completed"]
check("12 fixtures", len(fixtures) == 12, str(len(fixtures)))
check("fixture columns as specified", all(list(f) == FIELDS for f in fixtures))
check("stoppage columns as specified", all(list(s) == ["voyage_id", "start", "end", "reason", "counts_against_laytime"] for s in stoppages))
check("every SHEX fixture has a readable window; SHINC has none", all((f["shex_basis"] == "SHINC") == (f["shex_window"] is None) for f in fixtures) and all(window_test(f["shex_window"]) for f in fixtures if f["shex_window"]))
bases = {b: sum(f["shex_basis"] == b for f in fixtures) for b in ("SHEX EIU", "SHEX UU", "SHINC")}
check("all three SHEX bases are used", all(bases.values()), str(bases))
check("both despatch bases are used", {f["despatch_basis"] for f in fixtures} == {"working time saved", "all time saved"})
check("both SHEX windows are used", {f["shex_window"] for f in fixtures if f["shex_window"]} == {"Sun 00:00 to 24:00", "Sat 17:00 to Mon 08:00"})
check("turn time 6 or 12 hours", all(f["turn_time_hrs"] in (6, 12) for f in fixtures))
check("loading starts after NOR and ends after it starts", all(at(f["nor_tendered"]) < at(f["loading_commenced"]) < at(f["loading_completed"]) for f in fixtures))

RULE = {"rain": False, "swell": False, "shifting": False, "breakdown": False}
CLAUSES = {"WIBON", "time lost waiting for berth to count"}
by_voyage = {f["voyage_id"]: f for f in fixtures}


def rule(s):
    f = by_voyage[s["voyage_id"]]
    if s["reason"] == "public holiday":
        return f["shex_basis"] == "SHINC"
    if s["reason"] == "berth congestion":
        return f["waiting_for_berth"] in CLAUSES
    return RULE[s["reason"]]


check("waiting_for_berth is a known clause or empty", all(f["waiting_for_berth"] in CLAUSES | {None} for f in fixtures))
congestion_no_clause = sorted({s["voyage_id"] for s in stoppages if s["reason"] == "berth congestion" and s["counts_against_laytime"] and by_voyage[s["voyage_id"]]["waiting_for_berth"] not in CLAUSES})
check("berth congestion counts only on fixtures with a waiting for berth clause", not congestion_no_clause, ", ".join(congestion_no_clause))
check("counts_against_laytime follows the rules (weather, shifting and ship's breakdown excepted; congestion counts under a WIBON or waiting clause; holidays excepted unless SHINC)", all(s["counts_against_laytime"] == rule(s) for s in stoppages))
reasons = {s["reason"] for s in stoppages}
check("every stoppage reason from the brief's list appears, and nothing else", reasons == {"rain", "swell", "berth congestion", "shifting", "breakdown", "public holiday"}, ", ".join(sorted(reasons)))
check("berth congestion only ever sits in waiting time before loading, where it counts", all(at(s["end"]) <= at(by_voyage[s["voyage_id"]]["loading_commenced"]) and s["counts_against_laytime"] for s in stoppages if s["reason"] == "berth congestion"))

clean = True
for f in fixtures:
    own = sorted([s for s in stoppages if s["voyage_id"] == f["voyage_id"]], key=lambda s: s["start"])
    commenced = min(at(f["nor_tendered"]) + timedelta(hours=f["turn_time_hrs"]), at(f["loading_commenced"]))
    for s in own:
        if not (commenced <= at(s["start"]) < at(s["end"]) <= at(f["loading_completed"])):
            clean = False
    for a, b in zip(own, own[1:]):
        if at(a["end"]) > at(b["start"]):
            clean = False
    if f["shex_window"]:
        inside = window_test(f["shex_window"])
        for s in own:
            dt = at(s["start"])
            while dt < at(s["end"]):
                if inside(dt):
                    clean = False
                dt += MINUTE
check("stoppages sit inside laytime, never overlap each other, and never overlap a SHEX window", clean)

# ---------- 3. every voyage against the key ----------

section("3. Every voyage, minute by minute, against the answer key")
mine = {}
for f in fixtures:
    r = simulate(f, [s for s in stoppages if s["voyage_id"] == f["voyage_id"]])
    mine[f["voyage_id"]] = r
    k = key["voyages"][f["voyage_id"]]
    fields = ["allowed_min", "laytime_commenced", "elapsed_min", "deductible_stoppage_min", "shex_excepted_min", "used_min",
              "balance_min", "laytime_expiry", "result", "time_on_demurrage_min", "time_saved_min"]
    diffs = [x for x in fields if r[x] != k[x]]
    amount_ok = r["amount_usd"] == Decimal(str(k["amount_usd"])).quantize(Decimal("0.01"))
    label = f"{f['voyage_id']} {f['shex_basis']:8} {f['despatch_basis'][:3].upper()} {(f['shex_window'] or '-'):22} used {hm(r['used_min']):>12} of {hm(r['allowed_min']):>8}  {r['result']:9} USD {r['amount_usd']:>12,}"
    check(label, not diffs and amount_ok, ("differs on " + ", ".join(diffs)) if diffs else ("" if amount_ok else f"amount {k['amount_usd']}"))
check("no voyage has an exception after laytime ran out (once on demurrage, always on demurrage)", all(r["once_on_demurrage_holds"] for r in mine.values()))
dem = sum(r["result"] == "demurrage" for r in mine.values())
check("a mix of demurrage and despatch", 3 <= dem <= 9, f"{dem} demurrage, {12 - dem} despatch")

# ---------- 4. same timeline, different terms ----------

section("4. Groups sharing one timeline give different answers")
TIMELINE = ["cargo_mt", "load_rate_mt_per_day", "demurrage_rate_usd_per_day", "turn_time_hrs", "nor_tendered", "loading_commenced", "loading_completed"]
for g, ids in key["groups"].items():
    fs = [by_voyage[i] for i in ids]
    same = all([f[x] for x in TIMELINE] == [fs[0][x] for x in TIMELINE] for f in fs)
    stops = [[(s["start"], s["end"], s["reason"]) for s in stoppages if s["voyage_id"] == i] for i in ids]
    same = same and all(x == stops[0] for x in stops)
    answers = [(mine[i]["result"], mine[i]["amount_usd"]) for i in ids]
    terms = " / ".join(f"{by_voyage[i]['shex_basis']}, {by_voyage[i]['despatch_basis']}, {by_voyage[i]['shex_window'] or 'no window'}" for i in ids)
    check(f"group {g} {', '.join(ids)}: same times and stoppages", same)
    check(f"group {g}: every member's answer differs: " + "; ".join(f"{r} USD {a:,}" for r, a in answers), len(set(answers)) == len(answers), terms)

# ---------- 5. owner's statement ----------

section("5. Owner's laytime statement")
wrong = []
for o in owner:
    r = mine[o["voyage_id"]]
    right = (o["laytime_commenced"] == r["laytime_commenced"] and Fraction(str(o["laytime_allowed_hrs"])) * 60 == r["allowed_min"]
             and Fraction(str(o["laytime_used_hrs"])) * 60 == r["used_min"] and o["result"] == r["result"]
             and Decimal(str(o["amount_usd"])).quantize(Decimal("0.01")) == r["amount_usd"])
    if not right:
        wrong.append(o)
check("the owner is wrong on exactly three voyages", len(wrong) == 3, ", ".join(o["voyage_id"] for o in wrong))


def classify(o):
    f, r = by_voyage[o["voyage_id"]], mine[o["voyage_id"]]
    extra = int(Fraction(str(o["laytime_used_hrs"])) * 60) - r["used_min"]
    stops = [s for s in stoppages if s["voyage_id"] == f["voyage_id"]]
    if o["laytime_commenced"] == f["nor_tendered"] and extra == f["turn_time_hrs"] * 60:
        return "clock_from_nor"
    if f["shex_basis"] == "SHEX EIU" and extra == r["shex_excepted_min"] and extra > 0:
        return "counted_shex_window"
    if any(s["reason"] in ("rain", "swell") and extra == minutes(at(s["start"]), at(s["end"])) for s in stops):
        return "omitted_weather"
    return "unexplained"


kinds = {o["voyage_id"]: classify(o) for o in wrong}
check("one of each planted kind: SHEX window counted, clock from NOR, weather left out", sorted(kinds.values()) == ["clock_from_nor", "counted_shex_window", "omitted_weather"], str(kinds))
check("the key names the same voyages and kinds", {e["voyage_id"]: e["type"] for e in key["owner_errors"]} == kinds)
owner_sums = all(
    Decimal(str(o["amount_usd"])).quantize(Decimal("0.01")) == money(int(Fraction(str(o["laytime_used_hrs"])) * 60) - mine[o["voyage_id"]]["allowed_min"], by_voyage[o["voyage_id"]]["demurrage_rate_usd_per_day"], 1)
    for o in wrong)
check("on those three the owner's arithmetic is right; the error is in the time, as in real disputes", owner_sums)
check("all three overstate time used, so the owner claims too much demurrage", all(o["result"] == "demurrage" and int(Fraction(str(o["laytime_used_hrs"])) * 60) > mine[o["voyage_id"]]["used_min"] for o in wrong))

print(f"\n{passes} passed, {failures} failed.")
sys.exit(1 if failures else 0)
