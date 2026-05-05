"""
Strategy Analyzer for PolyBot Weather V3.

Runs twice daily (13:45 UTC post-reconcile and 01:00 UTC end-of-day Pacific).
Computes rule-based performance metrics, then asks Claude for narrative
analysis + recommendations. Writes everything to analyzer_reports.csv for
history and dashboard display.

Usage:
    python strategy_analyzer.py

Env required:
    ANTHROPIC_API_KEY — reused from existing .env
"""
import os
import csv
import json
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from collections import defaultdict, Counter

# Load .env if present (reuses main bot's Anthropic key)
ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / "bot" / ".env"
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

DATA = Path("/root/polymarket-bot/weather/data")
POSITIONS_CSV = DATA / "paper_positions.csv"
TRADES_CSV    = DATA / "paper_trades.csv"
SIGNALS_CSV   = DATA / "signals.csv"
HISTORY_CSV   = DATA / "forecast_history.csv"
RESULTS_CSV   = DATA / "results.csv"
ERRORS_CSV    = DATA / "error_summary.csv"
REPORTS_CSV   = DATA / "analyzer_reports.csv"

STRATEGY_REASONS = {"TAKE_PROFIT", "STOP_LOSS", "RESOLVED"}

# ── Helpers ─────────────────────────────────────────────────────────────

def _read_csv(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def _fnum(v, default=0.0):
    try:
        return float(v) if v not in (None, "", "None") else default
    except (ValueError, TypeError):
        return default


def _fint(v, default=0):
    try:
        return int(float(v)) if v not in (None, "", "None") else default
    except (ValueError, TypeError):
        return default


# ── Metric Computation ──────────────────────────────────────────────────

def compute_metrics():
    """Read all data files and compute a structured metrics dict."""
    positions = _read_csv(POSITIONS_CSV)
    trades    = _read_csv(TRADES_CSV)
    signals   = _read_csv(SIGNALS_CSV)
    history   = _read_csv(HISTORY_CSV)
    results   = _read_csv(RESULTS_CSV)
    errors    = _read_csv(ERRORS_CSV)

    open_pos   = [p for p in positions if p.get("status") == "OPEN"]
    closed_pos = [p for p in positions if p.get("status") == "CLOSED"]

    # Filter to strategy trades only (exclude DEDUPE_CLEANUP)
    strat_trades = [t for t in trades if t.get("exit_reason") in STRATEGY_REASONS]
    dedupe_trades = [t for t in trades if t.get("exit_reason") == "DEDUPE_CLEANUP"]

    m = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "counts": {
            "open_positions":    len(open_pos),
            "strategy_trades":   len(strat_trades),
            "dedupe_trades":     len(dedupe_trades),
            "signals_all_time":  len(signals),
            "forecast_snapshots": len(history),
            "resolved_markets":  len(results),
        },
    }

    # ── Overall performance (strategy only) ───────────────────────────
    realized = sum(_fnum(t.get("realized_pnl")) for t in strat_trades)
    stakes   = sum(_fnum(t.get("stake_usd")) for t in strat_trades)
    wins     = [t for t in strat_trades if _fnum(t.get("realized_pnl")) > 0]
    losses   = [t for t in strat_trades if _fnum(t.get("realized_pnl")) < 0]

    m["overall"] = {
        "realized_pnl":   round(realized, 2),
        "total_staked":   round(stakes, 2),
        "roi_pct":        round(realized / stakes * 100, 2) if stakes > 0 else 0,
        "win_rate":       round(len(wins) / len(strat_trades) * 100, 1) if strat_trades else 0,
        "avg_win":        round(sum(_fnum(t.get("realized_pnl")) for t in wins) / len(wins), 2) if wins else 0,
        "avg_loss":       round(sum(_fnum(t.get("realized_pnl")) for t in losses) / len(losses), 2) if losses else 0,
        "n_trades":       len(strat_trades),
        "n_wins":         len(wins),
        "n_losses":       len(losses),
    }

    # ── Per-city breakdown ────────────────────────────────────────────
    city_stats = {}
    for city in ["NYC", "Chicago", "Dallas", "LA"]:
        city_trades = [t for t in strat_trades if t.get("city") == city]
        if not city_trades:
            city_stats[city] = {"n": 0, "roi_pct": 0, "win_rate": 0, "realized_pnl": 0}
            continue
        c_realized = sum(_fnum(t.get("realized_pnl")) for t in city_trades)
        c_stakes   = sum(_fnum(t.get("stake_usd")) for t in city_trades)
        c_wins     = sum(1 for t in city_trades if _fnum(t.get("realized_pnl")) > 0)
        city_stats[city] = {
            "n":            len(city_trades),
            "roi_pct":      round(c_realized / c_stakes * 100, 2) if c_stakes > 0 else 0,
            "win_rate":     round(c_wins / len(city_trades) * 100, 1),
            "realized_pnl": round(c_realized, 2),
        }
    m["by_city"] = city_stats

    # ── YES vs NO ─────────────────────────────────────────────────────
    for direction in ["YES", "NO"]:
        d_trades = [t for t in strat_trades if t.get("direction") == direction]
        if not d_trades:
            m[f"direction_{direction}"] = {"n": 0, "roi_pct": 0, "win_rate": 0}
            continue
        d_realized = sum(_fnum(t.get("realized_pnl")) for t in d_trades)
        d_stakes   = sum(_fnum(t.get("stake_usd")) for t in d_trades)
        d_wins     = sum(1 for t in d_trades if _fnum(t.get("realized_pnl")) > 0)
        m[f"direction_{direction}"] = {
            "n":            len(d_trades),
            "roi_pct":      round(d_realized / d_stakes * 100, 2) if d_stakes > 0 else 0,
            "win_rate":     round(d_wins / len(d_trades) * 100, 1),
            "realized_pnl": round(d_realized, 2),
        }

    # ── Exit-reason breakdown ─────────────────────────────────────────
    reason_stats = {}
    for reason in STRATEGY_REASONS:
        r_trades = [t for t in strat_trades if t.get("exit_reason") == reason]
        if not r_trades:
            reason_stats[reason] = {"n": 0, "realized_pnl": 0}
            continue
        reason_stats[reason] = {
            "n":            len(r_trades),
            "realized_pnl": round(sum(_fnum(t.get("realized_pnl")) for t in r_trades), 2),
            "win_rate":     round(sum(1 for t in r_trades if _fnum(t.get("realized_pnl")) > 0) / len(r_trades) * 100, 1),
        }
    m["by_exit_reason"] = reason_stats

    # ── Edge-tier performance ─────────────────────────────────────────
    # Only use signals that became trades — match by (ts, market_slug, bucket, direction)
    # Simpler: bucket by sort-by entry_price delta-to-probability. But we have
    # ensemble_prob and entry_price on each trade row, so compute signed edge.
    tier_stats = {"8-12pp": [], "12-20pp": [], "20pp+": []}
    for t in strat_trades:
        ep = _fnum(t.get("ensemble_prob"))
        entry = _fnum(t.get("entry_price"))
        direction = t.get("direction", "")
        # For NO trades, real edge = (1-ep) - (1-entry) = entry - ep — inverted
        if direction == "NO":
            edge_pp = (entry - ep) * 100
        else:
            edge_pp = (ep - entry) * 100
        pnl = _fnum(t.get("realized_pnl"))
        if edge_pp >= 20:
            tier_stats["20pp+"].append(pnl)
        elif edge_pp >= 12:
            tier_stats["12-20pp"].append(pnl)
        elif edge_pp >= 8:
            tier_stats["8-12pp"].append(pnl)
    m["by_edge_tier"] = {
        k: {
            "n": len(v),
            "realized_pnl": round(sum(v), 2),
            "win_rate": round(sum(1 for x in v if x > 0) / len(v) * 100, 1) if v else 0,
        }
        for k, v in tier_stats.items()
    }

    # ── Calibration drift ─────────────────────────────────────────────
    # Compare calibrated MAE (from error_summary) to recent realized (from results)
    baseline_mae = {}
    for row in errors:
        city = row.get("city", "")
        if city:
            baseline_mae[city] = _fnum(row.get("mae_f"))

    recent_mae = {}
    recent_results = results[-20:] if len(results) >= 20 else results
    per_city_errors = defaultdict(list)
    for r in recent_results:
        city = r.get("city", "")
        err = abs(_fnum(r.get("forecast_error_f")))
        if city and err > 0:
            per_city_errors[city].append(err)
    for city, errs in per_city_errors.items():
        if errs:
            recent_mae[city] = round(sum(errs) / len(errs), 2)

    drift = {}
    for city in ["NYC", "Chicago", "Dallas", "LA"]:
        base = baseline_mae.get(city, 0)
        recent = recent_mae.get(city, 0)
        if base > 0 and recent > 0:
            drift[city] = {
                "baseline_mae": base,
                "recent_mae":   recent,
                "drift_pct":    round((recent - base) / base * 100, 1),
                "n_recent":     len(per_city_errors[city]),
            }
        else:
            drift[city] = {"baseline_mae": base, "recent_mae": 0, "drift_pct": 0, "n_recent": 0}
    m["calibration_drift"] = drift

    # ── Signal flow ───────────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    signals_24h = 0
    for s in signals:
        try:
            ts = datetime.fromisoformat(s.get("ts", "").replace("Z", "+00:00"))
            if (now - ts).total_seconds() < 86400:
                signals_24h += 1
        except Exception:
            pass
    m["signal_flow"] = {
        "signals_24h": signals_24h,
        "signals_all_time": len(signals),
    }

    return m


# ── Claude narrative ─────────────────────────────────────────────────────

def get_claude_narrative(metrics, sample_trades):
    """Call Anthropic API to produce summary + recommendations."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {
            "summary": "No ANTHROPIC_API_KEY in environment. Narrative disabled.",
            "observations": [],
            "warnings": [],
            "recommendations": [],
        }

    try:
        import anthropic
    except ImportError:
        return {
            "summary": "anthropic Python package not installed. Run: pip install anthropic",
            "observations": [],
            "warnings": [],
            "recommendations": [],
        }

    # Build a condensed prompt
    prompt = f"""You are a quantitative analyst reviewing a Polymarket weather trading bot's performance.

METRICS (computed from actual trade data):
{json.dumps(metrics, indent=2)}

RECENT CLOSED STRATEGY TRADES (excluding operational dedupe):
{json.dumps(sample_trades, indent=2)}

Context on the strategy:
- Trades temperature-bucket Polymarket events for NYC, Chicago, Dallas, LA
- Uses 31-member GFS ensemble + ECMWF + ICON multi-model forecast
- Enters YES when ensemble_prob > market_yes_price by 8+ percentage points with 3+ models agreeing
- Enters NO when ensemble_prob is very low but market prices the bucket high (tail-fade)
- Full Kelly sizing capped at 10% of bankroll per trade
- Scans every 5min during aggressive windows (00/06/12/18 UTC after GFS model runs), hourly otherwise
- Stop-loss -50%, take-profit 2x entry, else hold to resolution

Produce a JSON response with exactly this shape:
{{
  "summary": "2-3 sentence executive summary of how the strategy is performing",
  "observations": ["specific observations about the data, 2-5 bullets"],
  "warnings": ["concerning patterns that need attention, 0-3 bullets"],
  "recommendations": ["specific tactical changes to try, 2-4 bullets"]
}}

Be direct and specific. Cite actual numbers from the metrics. If there are not enough trades yet to be meaningful (under 20 strategy trades), say so in the summary and keep recommendations focused on what we'll know after more data.

Respond with ONLY the JSON, no preamble.
"""

    try:
        client = anthropic.Anthropic(api_key=api_key)
        resp = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        # Strip possible code fences
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            if text.startswith("json"):
                text = text[4:].strip()
        return json.loads(text)
    except Exception as e:
        return {
            "summary": f"LLM call failed: {e}",
            "observations": [],
            "warnings": [],
            "recommendations": [],
        }


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    print(f"Strategy Analyzer @ {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    metrics = compute_metrics()

    # Sample most recent 10 strategy trades for LLM context
    trades = _read_csv(TRADES_CSV)
    strat_trades = [t for t in trades if t.get("exit_reason") in STRATEGY_REASONS]
    sample = strat_trades[-10:] if strat_trades else []
    sample_trimmed = [
        {k: t.get(k) for k in [
            "city", "target_date", "bucket", "direction",
            "ensemble_prob", "entry_price", "fill_price", "current_price",
            "stake_usd", "realized_pnl", "exit_reason", "n_models_agree"
        ]}
        for t in sample
    ]

    print(f"Rule-based metrics computed.")
    print(f"  Strategy trades: {metrics['counts']['strategy_trades']}")
    print(f"  Overall ROI: {metrics['overall']['roi_pct']}%")
    print(f"  Open positions: {metrics['counts']['open_positions']}")
    print()
    print("Calling Claude for narrative...")

    narrative = get_claude_narrative(metrics, sample_trimmed)

    print()
    print(f"Summary: {narrative.get('summary', 'N/A')[:200]}")
    print(f"Observations: {len(narrative.get('observations', []))}")
    print(f"Warnings: {len(narrative.get('warnings', []))}")
    print(f"Recommendations: {len(narrative.get('recommendations', []))}")

    # Persist report
    report_row = {
        "ts":              metrics["ts"],
        "metrics_json":    json.dumps(metrics),
        "summary":         narrative.get("summary", ""),
        "observations":    json.dumps(narrative.get("observations", [])),
        "warnings":        json.dumps(narrative.get("warnings", [])),
        "recommendations": json.dumps(narrative.get("recommendations", [])),
    }

    columns = ["ts", "metrics_json", "summary", "observations", "warnings", "recommendations"]
    write_header = not REPORTS_CSV.exists()
    with open(REPORTS_CSV, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns)
        if write_header:
            w.writeheader()
        w.writerow(report_row)

    print()
    print(f"Saved report → {REPORTS_CSV}")


if __name__ == "__main__":
    main()
