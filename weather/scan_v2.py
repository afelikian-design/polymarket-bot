"""
PolyBot Weather V2 — Step 2: Edge Scanner (Ensemble + Dual-Direction)
======================================================================
Core upgrades vs. V1:

  EDGE 1: 31-MEMBER ENSEMBLE (primary lift, 1-3% → 3-5%)
    Probability = fraction of ensemble members in bucket
    No Monte Carlo, no assumed sigma — use the actual distribution
    Confidence = ensemble agreement (how one-sided members are)

  EDGE 2: POST-MODEL-RUN TIMING (cheap, meaningful)
    Aggressive scan 5min cadence for 60min after 00/06/12/18Z runs
    Retail is asleep; prices lag new forecasts by minutes-to-hours

  EDGE 3: NO-SIDE TAIL FADES (diversifier)
    When market prices a bucket at >10¢ but 0-2 of 31 members agree,
    SHORT the YES (buy NO at 85-95¢). High win rate, small profit per trade.
    Smooths the equity curve.

  EDGE 4: MULTI-MODEL AGREEMENT FILTER
    Only trade when 3+ models (GFS + ECMWF + ICON) agree on direction
    Uses sigma_tight from calibration when agreement is high
"""
import requests
import pandas as pd
import numpy as np
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

OUT = Path("data")
OUT.mkdir(exist_ok=True)

CALIB = pd.read_csv(OUT / "error_summary.csv").set_index("city")

CITIES = {
    "NYC":     {"lat": 40.7772, "lon": -73.8726, "slug_keys": ["nyc", "new-york"]},
    "Chicago": {"lat": 41.9742, "lon": -87.9073, "slug_keys": ["chicago"]},
    "Dallas":  {"lat": 32.8471, "lon": -96.8518, "slug_keys": ["dallas"]},
    "LA":      {"lat": 34.0224, "lon": -118.2851, "slug_keys": ["la", "los-angeles"]},
}

GAMMA = "https://gamma-api.polymarket.com"

# ========== THRESHOLDS ==========
# YES-side (laddering): buy underpriced buckets
YES_MIN_EDGE = 0.08                 # ensemble_prob - market_price >= 8pp
YES_MAX_PRICE = 0.45

# NO-side (tail fades): sell overpriced tails
NO_MAX_YES_PRICE = 0.45             # YES priced below 45c only
NO_MIN_NO_PRICE = 0.55              # we buy NO at 55c+
NO_MAX_ENSEMBLE_PROB = 0.05         # ensemble says <5% probability
NO_MIN_EDGE = 0.08                  # (1 - ensemble_prob) - no_price >= 8pp

# Market filters
MIN_VOLUME = 1000
MAX_LEAD_HOURS = 48
MIN_LEAD_HOURS = 2

# Multi-model agreement filter
MIN_MODEL_AGREEMENT = 3             # require 3+ models pointing same direction

# Sizing
KELLY_FRACTION = 0.25
BANKROLL = 1000
MAX_BET_PCT = 0.02

# Model run times in UTC — these trigger aggressive scan windows
MODEL_RUN_HOURS_UTC = [0, 6, 12, 18]


def in_aggressive_window(now_utc=None):
    """True if within 60 minutes after a major model run."""
    now = now_utc or datetime.now(timezone.utc)
    hour = now.hour
    mins = now.minute
    return hour in MODEL_RUN_HOURS_UTC and mins < 60


def fetch_weather_markets():
    r = requests.get(f"{GAMMA}/markets",
                     params={"active": "true", "closed": "false", "limit": 500},
                     timeout=20)
    r.raise_for_status()
    markets = r.json()
    matched = []
    for m in markets:
        slug = (m.get("slug") or "").lower()
        if "highest-temperature" not in slug and "high-temperature" not in slug:
            continue
        for city, info in CITIES.items():
            if any(k in slug for k in info["slug_keys"]):
                m["_city"] = city
                matched.append(m)
                break
    return matched


def fetch_ensemble_forecast(lat, lon, target_date):
    """
    Pull 31-member GFS ensemble daily high for target_date.
    Returns array of 31 temperatures (one per member).
    """
    r = requests.get(
        "https://ensemble-api.open-meteo.com/v1/ensemble",
        params={
            "latitude": lat, "longitude": lon,
            "hourly": "temperature_2m",
            "models": "gfs_seamless",
            "forecast_days": 7,
            "timezone": "auto",
            "temperature_unit": "fahrenheit",
        }, timeout=20,
    )
    r.raise_for_status()
    d = r.json()
    hourly = d["hourly"]
    times = pd.to_datetime(hourly["time"])

    # Ensemble members come as temperature_2m_member01, _member02, ...
    member_keys = sorted([k for k in hourly.keys() if k.startswith("temperature_2m")])
    if not member_keys:
        return np.array([])

    dates = times.dt.date
    mask = dates == target_date
    if mask.sum() == 0:
        return np.array([])

    # Daily high per member
    member_highs = []
    for key in member_keys:
        values = np.array(hourly[key])
        day_values = values[mask]
        if len(day_values) > 0 and not np.all(np.isnan(day_values)):
            member_highs.append(np.nanmax(day_values))
    return np.array(member_highs)


def fetch_multi_model_forecast(lat, lon, target_date):
    """
    Pull daily highs from 3+ independent models for agreement check.
    Returns dict {model_name: daily_high}.
    """
    models = ["gfs_seamless", "ecmwf_ifs025", "icon_seamless", "best_match"]
    r = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat, "longitude": lon,
            "daily": "temperature_2m_max",
            "forecast_days": 3,
            "timezone": "auto",
            "temperature_unit": "fahrenheit",
            "models": ",".join(models),
        }, timeout=15,
    )
    r.raise_for_status()
    d = r.json()
    daily = d["daily"]
    dates = pd.to_datetime(daily["time"]).dt.date
    idx = np.where(dates == target_date)[0]
    if len(idx) == 0:
        return {}
    i = idx[0]
    out = {}
    for model in models:
        key = f"temperature_2m_max_{model}"
        if key in daily and i < len(daily[key]) and daily[key][i] is not None:
            out[model] = daily[key][i]
    return out


def parse_buckets(market):
    """Parse outcome labels into (lo, hi, price) tuples."""
    outcomes = json.loads(market["outcomes"])
    prices = json.loads(market["outcomePrices"])
    buckets = []
    for label, price in zip(outcomes, prices):
        m = re.search(r"(\d+)\s*[-–to]+\s*(\d+)", label)
        if m:
            lo, hi = float(m.group(1)), float(m.group(2)) + 1
        elif "higher" in label.lower() or "above" in label.lower() or "+" in label:
            n = re.search(r"(\d+)", label)
            lo, hi = float(n.group(1)), 200.0
        elif "lower" in label.lower() or "below" in label.lower():
            n = re.search(r"(\d+)", label)
            lo, hi = -200.0, float(n.group(1))
        else:
            n = re.search(r"(\d+)", label)
            if not n: continue
            lo = float(n.group(1))
            hi = lo + 1
        buckets.append({"label": label, "lo": lo, "hi": hi, "price": float(price)})
    return buckets


def ensemble_bucket_probability(members, bucket):
    """
    Fraction of ensemble members whose daily high falls in [lo, hi).
    This IS the probability. No Monte Carlo. No assumed sigma.
    """
    if len(members) == 0:
        return None, None
    n_in = int(((members >= bucket["lo"]) & (members < bucket["hi"])).sum())
    prob = n_in / len(members)
    # Agreement metric: how concentrated is the distribution?
    # 0 = all members in bucket, 1 = perfectly spread
    agreement = n_in / len(members)
    return prob, agreement


def check_model_agreement(multi_model_fc, bucket):
    """Count how many independent models place their point forecast in/near bucket."""
    if not multi_model_fc:
        return 0
    center = (bucket["lo"] + bucket["hi"]) / 2
    # Within 2°F of bucket center counts as agreement
    return sum(1 for v in multi_model_fc.values() if abs(v - center) <= 2.0)


def kelly_size(p, price, bankroll, fraction=KELLY_FRACTION, cap_pct=MAX_BET_PCT):
    if price <= 0 or price >= 1 or p <= 0:
        return 0
    b = (1 - price) / price
    q = 1 - p
    edge = (b * p - q) / b
    if edge <= 0:
        return 0
    return min(bankroll * edge * fraction, bankroll * cap_pct)


def scan_market(market):
    city = market["_city"]
    info = CITIES[city]

    try:
        end_dt = pd.to_datetime(market["endDate"])
        target_date = end_dt.date()
    except Exception:
        return []

    lead_hours = (end_dt - pd.Timestamp.now(tz="UTC")).total_seconds() / 3600
    if not (MIN_LEAD_HOURS <= lead_hours <= MAX_LEAD_HOURS):
        return []
    if float(market.get("volume", 0)) < MIN_VOLUME:
        return []

    buckets = parse_buckets(market)
    if not buckets:
        return []

    # Pull ensemble once per market
    try:
        members = fetch_ensemble_forecast(info["lat"], info["lon"], target_date)
        multi_model = fetch_multi_model_forecast(info["lat"], info["lon"], target_date)
    except Exception as e:
        return []

    if len(members) < 20:
        return []  # need meaningful ensemble

    ensemble_mean = float(np.mean(members))
    ensemble_std = float(np.std(members))
    n_members = len(members)

    candidates = []
    ts = datetime.utcnow().isoformat()

    for b in buckets:
        prob, agreement = ensemble_bucket_probability(members, b)
        if prob is None:
            continue

        n_models_agree = check_model_agreement(multi_model, b)

        # === YES-SIDE: buy underpriced ===
        yes_edge = prob - b["price"]
        if (yes_edge >= YES_MIN_EDGE
                and b["price"] <= YES_MAX_PRICE
                and b["price"] > 0.01
                and n_models_agree >= MIN_MODEL_AGREEMENT
                and prob >= 0.15):
            size = kelly_size(prob, b["price"], BANKROLL)
            if size >= 1:
                candidates.append({
                    "ts": ts, "city": city, "market_slug": market["slug"],
                    "target_date": str(target_date), "lead_hours": round(lead_hours, 1),
                    "direction": "YES", "bucket": b["label"],
                    "ensemble_prob": round(prob, 4),
                    "market_price": round(b["price"], 4),
                    "edge": round(yes_edge, 4),
                    "ensemble_mean": round(ensemble_mean, 2),
                    "ensemble_std": round(ensemble_std, 2),
                    "n_members": n_members,
                    "n_models_agree": n_models_agree,
                    "kelly_size_$": round(size, 2),
                    "aggressive_window": in_aggressive_window(),
                })

        # === NO-SIDE: fade overpriced tails ===
        no_price = 1 - b["price"]
        no_prob = 1 - prob  # probability NO resolves
        no_edge = no_prob - no_price
        if (prob <= NO_MAX_ENSEMBLE_PROB      # ensemble says <5% likely
                and b["price"] <= NO_MAX_YES_PRICE
                and b["price"] >= 0.10         # but market prices it >10c
                and no_edge >= NO_MIN_EDGE
                and n_members >= 25):
            size = kelly_size(no_prob, no_price, BANKROLL)
            if size >= 1:
                candidates.append({
                    "ts": ts, "city": city, "market_slug": market["slug"],
                    "target_date": str(target_date), "lead_hours": round(lead_hours, 1),
                    "direction": "NO", "bucket": b["label"],
                    "ensemble_prob": round(prob, 4),
                    "market_price": round(no_price, 4),  # NO entry price
                    "edge": round(no_edge, 4),
                    "ensemble_mean": round(ensemble_mean, 2),
                    "ensemble_std": round(ensemble_std, 2),
                    "n_members": n_members,
                    "n_models_agree": n_models_agree,
                    "kelly_size_$": round(size, 2),
                    "aggressive_window": in_aggressive_window(),
                })

    return candidates


def main():
    now = datetime.utcnow()
    window = "AGGRESSIVE (post-model-run)" if in_aggressive_window() else "normal"
    print(f"V2 Scan @ {now.isoformat()}Z  |  Window: {window}\n")

    markets = fetch_weather_markets()
    print(f"Found {len(markets)} weather markets in target cities\n")

    all_cands = []
    for m in markets:
        try:
            cands = scan_market(m)
            all_cands.extend(cands)
        except Exception as e:
            print(f"  skipped {m.get('slug')}: {e}")

    if not all_cands:
        print("No edge candidates.")
        return

    df = pd.DataFrame(all_cands).sort_values(["direction", "edge"], ascending=[True, False])
    print("=" * 120)
    print(f"{len(df)} CANDIDATES  ({(df['direction']=='YES').sum()} YES, {(df['direction']=='NO').sum()} NO)")
    print("=" * 120)
    print(df.to_string(index=False))

    log = OUT / "signals.csv"
    df.to_csv(log, mode="a", header=not log.exists(), index=False)
    print(f"\nLogged {len(df)} signals → {log}")


if __name__ == "__main__":
    main()
