"""
PolyBot Weather V2 — Step 3: Reconciliation (Dual-Direction)
=============================================================
Handles YES and NO positions. Builds calibration table by direction
so you can see whether ensemble prob is accurate AND whether NO fades
are winning at the expected rate.
"""
import requests
import pandas as pd
import numpy as np
import re
from datetime import date, timedelta
from pathlib import Path

OUT = Path("data")
SIGNALS = OUT / "signals.csv"
RESULTS = OUT / "results.csv"

CITIES = {
    "NYC":     {"lat": 40.7772, "lon": -73.8726},
    "Chicago": {"lat": 41.9742, "lon": -87.9073},
    "Dallas":  {"lat": 32.8471, "lon": -96.8518},
    "LA":      {"lat": 34.0224, "lon": -118.2851},
}


def fetch_actual_high(city, target_date):
    info = CITIES[city]
    r = requests.get(
        "https://archive-api.open-meteo.com/v1/archive",
        params={
            "latitude": info["lat"], "longitude": info["lon"],
            "start_date": target_date, "end_date": target_date,
            "daily": "temperature_2m_max",
            "timezone": "auto",
            "temperature_unit": "fahrenheit",
        }, timeout=20,
    )
    r.raise_for_status()
    return r.json()["daily"]["temperature_2m_max"][0]


def parse_bucket_range(label):
    m = re.search(r"(\d+)\s*[-–to]+\s*(\d+)", label)
    if m:
        return float(m.group(1)), float(m.group(2)) + 1
    if "higher" in label.lower() or "above" in label.lower():
        n = re.search(r"(\d+)", label)
        return float(n.group(1)), 200.0
    if "lower" in label.lower():
        n = re.search(r"(\d+)", label)
        return -200.0, float(n.group(1))
    n = re.search(r"(\d+)", label)
    if n:
        return float(n.group(1)), float(n.group(1)) + 1
    return None, None


def main():
    if not SIGNALS.exists():
        print("No signals.csv yet. Run scan_v2.py first.")
        return

    sigs = pd.read_csv(SIGNALS)
    sigs["target_date"] = pd.to_datetime(sigs["target_date"]).dt.date
    cutoff = date.today() - timedelta(days=1)
    pending = sigs[sigs["target_date"] <= cutoff].copy()

    if pending.empty:
        print("No matured signals to resolve.")
        return

    # Dedupe against prior resolutions
    if RESULTS.exists():
        done = pd.read_csv(RESULTS)
        done_keys = set(zip(
            done["target_date"].astype(str),
            done["market_slug"],
            done["bucket"],
            done["direction"],
        ))
        pending = pending[~pending.apply(
            lambda r: (str(r["target_date"]), r["market_slug"], r["bucket"], r["direction"]) in done_keys,
            axis=1)]
    if pending.empty:
        print("All matured signals already resolved.")
        return

    # Cache actuals
    cache = {}
    for _, row in pending.iterrows():
        key = (row["city"], str(row["target_date"]))
        if key not in cache:
            try:
                cache[key] = fetch_actual_high(row["city"], str(row["target_date"]))
            except Exception as e:
                print(f"  failed {key}: {e}")
                cache[key] = None

    out = []
    for _, row in pending.iterrows():
        actual = cache.get((row["city"], str(row["target_date"])))
        if actual is None:
            continue
        lo, hi = parse_bucket_range(row["bucket"])
        if lo is None:
            continue

        bucket_hit = (actual >= lo) and (actual < hi)
        # YES wins if bucket hits; NO wins if bucket misses
        won = bucket_hit if row["direction"] == "YES" else not bucket_hit

        shares = row["kelly_size_$"] / row["market_price"] if row["market_price"] > 0 else 0
        payout = shares * (1 if won else 0)
        pnl = payout - row["kelly_size_$"]

        out.append({
            "target_date": str(row["target_date"]),
            "city": row["city"],
            "market_slug": row["market_slug"],
            "bucket": row["bucket"],
            "direction": row["direction"],
            "ensemble_prob": row["ensemble_prob"],
            "market_price": row["market_price"],
            "edge": row["edge"],
            "stake_$": row["kelly_size_$"],
            "actual_high": actual,
            "bucket_hit": bucket_hit,
            "won": won,
            "pnl_$": round(pnl, 2),
            "aggressive_window": row.get("aggressive_window", False),
        })

    if not out:
        print("No new resolutions.")
        return

    new_r = pd.DataFrame(out)
    if RESULTS.exists():
        all_r = pd.concat([pd.read_csv(RESULTS), new_r], ignore_index=True)
    else:
        all_r = new_r
    all_r.to_csv(RESULTS, index=False)

    print(f"Resolved {len(new_r)} new positions\n")
    print("=" * 80)
    print("CUMULATIVE PERFORMANCE")
    print("=" * 80)
    total_staked = all_r["stake_$"].sum()
    total_pnl = all_r["pnl_$"].sum()
    win_rate = all_r["won"].mean() * 100
    roi = total_pnl / total_staked * 100 if total_staked > 0 else 0
    print(f"Trades: {len(all_r)}  |  Win rate: {win_rate:.1f}%")
    print(f"Staked: ${total_staked:.2f}  |  P&L: ${total_pnl:+.2f}  |  ROI: {roi:+.2f}%")

    # By direction
    print("\nBY DIRECTION")
    dir_stats = all_r.groupby("direction").agg(
        n=("won", "size"),
        win_rate=("won", lambda x: round(x.mean() * 100, 1)),
        pnl=("pnl_$", lambda x: round(x.sum(), 2)),
        roi=("pnl_$", lambda x: round(x.sum() / all_r.loc[x.index, "stake_$"].sum() * 100, 2)),
    )
    print(dir_stats.to_string())

    # Calibration: does ensemble_prob match observed bucket-hit rate?
    print("\nCALIBRATION (YES trades only — does ensemble_prob predict bucket hits?)")
    yes_only = all_r[all_r["direction"] == "YES"].copy()
    if len(yes_only) >= 5:
        bins = [0, 0.15, 0.25, 0.35, 0.5, 0.7, 1.0]
        yes_only["prob_bin"] = pd.cut(yes_only["ensemble_prob"], bins)
        cal = yes_only.groupby("prob_bin", observed=True).agg(
            n=("bucket_hit", "size"),
            observed_hit_rate=("bucket_hit", lambda x: round(x.mean(), 3)),
            avg_ensemble_prob=("ensemble_prob", lambda x: round(x.mean(), 3)),
            pnl=("pnl_$", lambda x: round(x.sum(), 2)),
        )
        print(cal.to_string())

    # Per city
    print("\nPER CITY")
    city_stats = all_r.groupby("city").agg(
        n=("won", "size"),
        win_rate=("won", lambda x: round(x.mean() * 100, 1)),
        pnl=("pnl_$", lambda x: round(x.sum(), 2)),
        roi=("pnl_$", lambda x: round(x.sum() / all_r.loc[x.index, "stake_$"].sum() * 100, 2)),
    )
    print(city_stats.to_string())

    # Aggressive window lift
    if "aggressive_window" in all_r.columns:
        print("\nAGGRESSIVE WINDOW LIFT (post-model-run vs. normal)")
        agg_stats = all_r.groupby("aggressive_window").agg(
            n=("won", "size"),
            win_rate=("won", lambda x: round(x.mean() * 100, 1)),
            avg_edge=("edge", lambda x: round(x.mean(), 3)),
            roi=("pnl_$", lambda x: round(x.sum() / all_r.loc[x.index, "stake_$"].sum() * 100, 2)),
        )
        print(agg_stats.to_string())


if __name__ == "__main__":
    main()
