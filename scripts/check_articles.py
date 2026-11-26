"""Recomputes every figure quoted in scripts/articles.py. Run: python scripts/check_articles.py"""
import sys
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "demos" / "fcn-monitor"))
from fcn.engine import Termsheet, evaluate  # noqa: E402

def eq(a, b, msg):
    assert abs(a - b) < 0.01, f"{msg}: {a} != {b}"

# fcn-ki
eq(200 * .8, 160, "NVDA strike"); eq(200 * .6, 120, "NVDA KI"); eq(150 * .8, 120, "AMD strike"); eq(150 * .6, 90, "AMD KI")
sh = 100_000 / 160; eq(sh, 625, "shares"); eq(sh * 140, 87_500, "value"); eq(100_000 * .12, 12_000, "coupons")
eq(sh * 140 - 100_000 + 12_000, -500, "net")
# fcn-jie-gu
sh = 50_000 / (375 * .8); eq(sh, 166.6667, "tsla shares"); eq(sh * 250, 41_666.67, "tsla value")
eq(50_000 - sh * 250, 8_333.33, "loss"); eq(50_000 * .15 * 6 / 12, 3_750, "coupon")
eq(3_750 - (50_000 - sh * 250), -4_583.33, "net"); eq((50_000 - 3_750) / sh, 277.5, "breakeven")
# fcn-coupon
eq(100_000 * .15 / 12, 1_250, "monthly"); eq(100_000 * .15 * 3 / 12, 3_750, "quarterly"); eq(4 * 1_250, 5_000, "4 periods")

# fcn-american-european-ki, run through the real engine: dip to 58%, end at 75%
days = pd.bdate_range("2026-01-02", "2026-07-31")
px = pd.DataFrame({"A": 95.0}, index=days)  # below KO so it never knocks out
px.loc["2026-03-10":, "A"] = 58.0
px.loc["2026-03-11":, "A"] = 75.0
base = dict(name="x", isin="x", issuer="x", underlyings=["A"], currency="USD", notional=100_000,
            coupon_pa=.12, tenor_months=6, obs_period_months=1, strike_pct=.8, ko_pct=1.0,
            ko_type="period_end", ki_pct=.6, trade_date=date(2026, 1, 2),
            initial_settlement_date=date(2026, 1, 9), maturity_date=date(2026, 7, 9),
            initial_spots={"A": 100.0})
am = evaluate(Termsheet(**base, ki_type="american"), px, date(2026, 7, 31))
eu = evaluate(Termsheet(**base, ki_type="european"), px, date(2026, 7, 31))
assert am.delivered is not None and am.ki_hit, "american should deliver shares"
assert eu.delivered is None and eu.redemption == 100_000, "european should return principal"

# fcn-memory-ko timeline, through the engine (3 monthly observations)
obs = ["2026-02-02", "2026-03-02", "2026-04-02"]
perf = {"A": [103, 95, 90], "B": [97, 101, 94], "C": [92, 96, 100.5]}
px = pd.DataFrame({u: 80.0 for u in perf}, index=days)
for u, vals in perf.items():
    for d, v in zip(obs, vals):
        px.loc[d, u] = v
mb = {**base, "underlyings": ["A", "B", "C"], "initial_spots": {u: 100.0 for u in perf}, "ki_type": "american"}
mb["ki_pct"] = .5
plain = evaluate(Termsheet(**mb), px, date(2026, 7, 31))
mb["ko_type"] = "period_end_memory"
mem = evaluate(Termsheet(**mb), px, date(2026, 7, 31))
assert plain.ko_day is None, "plain KO should not trigger"
assert mem.ko_day == date(2026, 4, 2), f"memory KO should trigger on 3rd obs, got {mem.ko_day}"
print("all article figures check out")
