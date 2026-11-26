"""Download daily closes for the FCN underlying universe into data/px/<ticker>.json.

    python scripts/fetch_prices.py          # all tickers in data/universe.json

Each file: {"t": "NVDA", "dates": ["2025-01-02", ...], "closes": [..]}  (raw closes, not adjusted,
because termsheet levels are fixed on raw prices; splits are flagged in data/meta.json for review).
"""
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
START = "2025-01-01"


def safe(t: str) -> str:
    return t.replace("^", "_").replace(".", "_")


def main() -> int:
    universe = json.loads((ROOT / "data" / "universe.json").read_text(encoding="utf-8"))
    tickers = [u["t"] for u in universe]
    raw = yf.download(tickers, start=START, auto_adjust=False, actions=True, progress=False,
                      group_by="ticker", threads=True)
    out = ROOT / "data" / "px"
    out.mkdir(parents=True, exist_ok=True)
    ok, failed, splits = [], [], {}
    for t in tickers:
        try:
            s = raw[t]["Close"].dropna()
        except KeyError:
            s = pd.Series(dtype=float)
        if len(s) < 20:
            failed.append(t)
            continue
        sp = raw[t].get("Stock Splits")
        if sp is not None:
            hits = sp[sp.fillna(0) > 0]
            if len(hits):
                splits[t] = {d.strftime("%Y-%m-%d"): float(v) for d, v in hits.items()}
        data = {"t": t, "dates": [d.strftime("%Y-%m-%d") for d in s.index],
                "closes": [round(float(v), 4) for v in s.values]}
        (out / f"{safe(t)}.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        ok.append(t)
    meta = {"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "ok": len(ok),
            "failed": failed, "splits": splits}
    (ROOT / "data" / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"ok={len(ok)} failed={failed}")
    return 0 if len(ok) > len(tickers) * 0.9 else 1


if __name__ == "__main__":
    sys.exit(main())
