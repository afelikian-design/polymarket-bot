from flask import Flask, jsonify
from flask_cors import CORS
from config import Config
from database import (init_db, Position, Trade, AgentLog,
                      WalletSnapshot, WhaleSignal, PrebuiltThesis,
                      ActivityLog)
from datetime import datetime, timedelta
import os
import csv

app = Flask(__name__)
CORS(app)
db = init_db(Config.DB_PATH)

# ─────────────────────────────────────────────────────────────────────────────
# WEATHER BOT — paths & helpers
# ─────────────────────────────────────────────────────────────────────────────
WEATHER_DIR = "/root/polymarket-bot/weather/data"

def _read_csv(path):
    """Read a CSV into list of dicts; return empty list if missing."""
    if not os.path.exists(path):
        return []
    try:
        with open(path, newline="") as f:
            return list(csv.DictReader(f))
    except Exception:
        return []

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

# ─────────────────────────────────────────────────────────────────────────────
# LEGACY (kept for main.py compat, but no longer consumed by dashboard)
# ─────────────────────────────────────────────────────────────────────────────
def _get_daily_pnl():
    from datetime import timezone
    import pytz
    pacific = pytz.timezone("America/Los_Angeles")
    now_pacific = datetime.now(pacific)
    today_midnight_pacific = now_pacific.replace(hour=0, minute=0, second=0, microsecond=0)
    today_midnight_utc = today_midnight_pacific.astimezone(timezone.utc).replace(tzinfo=None)
    trades = db.query(Position).filter(
        Position.status == "CLOSED",
        Position.closed_at >= today_midnight_utc
    ).all()
    return round(sum(p.pnl or 0 for p in trades), 2)

# ─────────────────────────────────────────────────────────────────────────────
# WEATHER ENDPOINTS — new dashboard reads these
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/weather/signals")
def weather_signals():
    """Recent edge candidates from scan_v3.py. Most recent first, limit 100."""
    rows = _read_csv(os.path.join(WEATHER_DIR, "signals.csv"))
    rows.reverse()  # most recent first
    out = []
    for r in rows[:100]:
        out.append({
            "ts":              r.get("ts", ""),
            "city":            r.get("city", ""),
            "event_slug":      r.get("event_slug", ""),
            "target_date":     r.get("target_date", ""),
            "lead_hours":      _fnum(r.get("lead_hours")),
            "direction":       r.get("direction", ""),
            "bucket":          r.get("bucket", ""),
            "ensemble_prob":   _fnum(r.get("ensemble_prob")),
            "market_price":    _fnum(r.get("market_price")),
            "edge":            _fnum(r.get("edge")),
            "ensemble_mean":   _fnum(r.get("ensemble_mean")),
            "n_members":       _fint(r.get("n_members")),
            "n_models_agree":  _fint(r.get("n_models_agree")),
            "size_usd":        _fnum(r.get("kelly_size_$")),
            "aggressive":      (r.get("aggressive_window", "False") == "True"),
        })
    return jsonify(out)


@app.route("/api/weather/results")
def weather_results():
    """Resolved trades with realized P&L. Most recent first, limit 200."""
    rows = _read_csv(os.path.join(WEATHER_DIR, "results.csv"))
    rows.reverse()
    out = []
    for r in rows[:200]:
        out.append({
            "target_date":    r.get("target_date", ""),
            "city":           r.get("city", ""),
            "event_slug":     r.get("market_slug", ""),
            "bucket":         r.get("bucket", ""),
            "direction":      r.get("direction", ""),
            "ensemble_prob":  _fnum(r.get("ensemble_prob")),
            "market_price":   _fnum(r.get("market_price")),
            "edge":           _fnum(r.get("edge")),
            "stake_usd":      _fnum(r.get("stake_$")),
            "actual_high":    _fnum(r.get("actual_high")),
            "bucket_hit":     (r.get("bucket_hit", "False") == "True"),
            "won":            (r.get("won", "False") == "True"),
            "pnl":            _fnum(r.get("pnl_$")),
        })
    return jsonify(out)


@app.route("/api/weather/calibration")
def weather_calibration():
    """Per-city forecast error calibration table."""
    rows = _read_csv(os.path.join(WEATHER_DIR, "error_summary.csv"))
    out = []
    for r in rows:
        out.append({
            "city":          r.get("city", ""),
            "n_days":        _fint(r.get("n_days")),
            "bias_f":        _fnum(r.get("bias_F")),
            "mae_f":         _fnum(r.get("MAE_F")),
            "sigma_f":       _fnum(r.get("sigma_F")),
            "sigma_tight":   _fnum(r.get("sigma_tight_F")),
            "sigma_wide":    _fnum(r.get("sigma_wide_F")),
            "pct_within_2f": _fnum(r.get("pct_within_2F")),
            "pct_within_3f": _fnum(r.get("pct_within_3F")),
        })
    return jsonify(out)


@app.route("/api/weather/portfolio")
def weather_portfolio():
    """
    Portfolio summary computed from results.csv (realized P&L) and
    signals.csv (open positions / unresolved signals).
    """
    starting_balance = 1000.0
    results = _read_csv(os.path.join(WEATHER_DIR, "results.csv"))
    signals = _read_csv(os.path.join(WEATHER_DIR, "signals.csv"))

    total_pnl = sum(_fnum(r.get("pnl_$")) for r in results)
    total_staked = sum(_fnum(r.get("stake_$")) for r in results)
    wins = sum(1 for r in results if (r.get("won", "False") == "True"))
    n_closed = len(results)

    # Daily P&L — Pacific timezone, most recent day's resolutions
    import pytz
    from datetime import timezone
    pacific = pytz.timezone("America/Los_Angeles")
    today = datetime.now(pacific).date().isoformat()
    daily = sum(
        _fnum(r.get("pnl_$")) for r in results
        if r.get("target_date", "") == today
    )

    # Open positions = signals whose target_date hasn't passed yet
    today_utc = datetime.utcnow().date()
    resolved_keys = {
        (r.get("target_date", ""), r.get("market_slug", ""), r.get("bucket", ""), r.get("direction", ""))
        for r in results
    }
    open_positions = 0
    for s in signals:
        try:
            td = datetime.fromisoformat(s.get("target_date", "")).date()
        except Exception:
            continue
        if td < today_utc:
            continue
        key = (s.get("target_date", ""), s.get("market_slug", ""), s.get("bucket", ""), s.get("direction", ""))
        if key in resolved_keys:
            continue
        open_positions += 1

    win_rate = round(wins / n_closed, 3) if n_closed else 0
    roi = round(total_pnl / total_staked * 100, 2) if total_staked else 0
    balance = round(starting_balance + total_pnl, 2)

    return jsonify({
        "balance":        balance,
        "starting":       starting_balance,
        "daily_pnl":      round(daily, 2),
        "total_pnl":      round(total_pnl, 2),
        "total_staked":   round(total_staked, 2),
        "roi_pct":        roi,
        "win_rate":       win_rate,
        "open_positions": open_positions,
        "total_trades":   n_closed,
        "drawdown_pct":   0.0,   # compute later from snapshot series
        "paper_trading":  True,
    })


@app.route("/api/weather/pnl_history")
def weather_pnl_history():
    """
    Reconstruct daily balance curve from results.csv by sorting
    on target_date and doing a cumulative sum of pnl.
    """
    results = _read_csv(os.path.join(WEATHER_DIR, "results.csv"))
    starting_balance = 1000.0

    # Group pnl by target_date
    by_date = {}
    for r in results:
        d = r.get("target_date", "")
        if not d:
            continue
        by_date[d] = by_date.get(d, 0.0) + _fnum(r.get("pnl_$"))

    dates = sorted(by_date.keys())
    balance = starting_balance
    out = []
    for d in dates:
        balance = round(balance + by_date[d], 2)
        out.append({
            "time":     d,
            "balance":  balance,
            "realized": balance,
            "open_pnl": 0.0,
            "daily_pnl": round(by_date[d], 2),
        })
    # Prepend starting point so chart shows a baseline
    if out:
        out = [{"time": "start", "balance": starting_balance, "realized": starting_balance, "open_pnl": 0.0, "daily_pnl": 0.0}] + out
    else:
        # No resolutions yet — return starting point as single datapoint
        out = [{"time": "start", "balance": starting_balance, "realized": starting_balance, "open_pnl": 0.0, "daily_pnl": 0.0}]
    return jsonify(out)


@app.route("/api/weather/city_stats")
def weather_city_stats():
    """Per-city win rate + P&L, replaces old category_stats."""
    results = _read_csv(os.path.join(WEATHER_DIR, "results.csv"))
    signals = _read_csv(os.path.join(WEATHER_DIR, "signals.csv"))

    CITIES = ["NYC", "Chicago", "Dallas", "LA"]
    out = []
    for city in CITIES:
        city_results = [r for r in results if r.get("city") == city]
        wins = sum(1 for r in city_results if r.get("won") == "True")
        total = len(city_results)
        pnl = sum(_fnum(r.get("pnl_$")) for r in city_results)
        staked = sum(_fnum(r.get("stake_$")) for r in city_results)

        # Open signals per city (unresolved)
        today_utc = datetime.utcnow().date()
        resolved_keys = {
            (r.get("target_date", ""), r.get("market_slug", ""), r.get("bucket", ""), r.get("direction", ""))
            for r in results
        }
        open_count = 0
        open_stake = 0.0
        for s in signals:
            if s.get("city") != city:
                continue
            try:
                td = datetime.fromisoformat(s.get("target_date", "")).date()
            except Exception:
                continue
            if td < today_utc:
                continue
            key = (s.get("target_date", ""), s.get("market_slug", ""), s.get("bucket", ""), s.get("direction", ""))
            if key in resolved_keys:
                continue
            open_count += 1
            open_stake += _fnum(s.get("kelly_size_$"))

        out.append({
            "city":           city,
            "open_count":     open_count,
            "open_stake":     round(open_stake, 2),
            "win_rate":       round(wins / total, 3) if total else 0,
            "total":          total,
            "wins":           wins,
            "pnl":            round(pnl, 2),
            "roi":            round(pnl / staked * 100, 2) if staked else 0,
        })
    return jsonify(out)


@app.route("/api/weather/scanner_status")
def weather_scanner_status():
    """Scanner process health: last scan time + signal counts last 24h."""
    signals = _read_csv(os.path.join(WEATHER_DIR, "signals.csv"))
    last_ts = None
    last_24h = 0
    now = datetime.utcnow()
    cutoff = now - timedelta(hours=24)
    for s in signals:
        ts = s.get("ts", "")
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "").split("+")[0])
            if dt > cutoff:
                last_24h += 1
            if last_ts is None or dt > last_ts:
                last_ts = dt
        except Exception:
            continue
    status = "running"
    message = "Awaiting next scan"
    if last_ts is None:
        status = "idle"
        message = "No scans yet"
    else:
        mins_since = int((now - last_ts).total_seconds() / 60)
        if mins_since > 90:
            status = "stale"
            message = f"Last scan {mins_since}m ago"
        else:
            message = f"Last scan {mins_since}m ago · {last_24h} signals in 24h"

    return jsonify({
        "status":  status,
        "message": message,
        "last_scan_utc": last_ts.isoformat() if last_ts else None,
        "signals_24h":   last_24h,
    })


# ─────────────────────────────────────────────────────────────────────────────
# PRESERVED ENDPOINTS — still used by existing bot infrastructure
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/activity")
def get_activity():
    logs = db.query(ActivityLog)\
        .order_by(ActivityLog.logged_at.desc()).limit(60).all()
    return jsonify([{
        "id":         l.id,
        "agent":      l.agent,
        "event_type": l.event_type,
        "market":     l.market,
        "message":    l.message,
        "detail":     l.detail,
        "logged_at":  l.logged_at.isoformat() if l.logged_at else None,
        "time_ago":   _time_ago(l.logged_at),
    } for l in logs])


def _time_ago(dt):
    if not dt:
        return ""
    secs = int((datetime.utcnow() - dt).total_seconds())
    if secs < 60:
        return "{}s ago".format(secs)
    if secs < 3600:
        return "{}m ago".format(secs // 60)
    return "{}h ago".format(secs // 3600)


@app.route("/api/risk")
def get_risk():
    return jsonify({
        "paper_trading":      Config.PAPER_TRADING,
        "daily_loss_limit":   Config.DAILY_LOSS_LIMIT,
        "max_drawdown":       Config.MAX_DRAWDOWN,
        "max_kelly":          Config.MAX_KELLY_FRACTION,
        "max_open_positions": Config.MAX_OPEN_POSITIONS,
        "min_confidence":     Config.MIN_CONFIDENCE,
    })


@app.route("/api/control/start", methods=["POST"])
def control_start():
    import subprocess
    subprocess.Popen(["systemctl", "start", "polybot"])
    return jsonify({"status": "started"})

@app.route("/api/control/stop", methods=["POST"])
def control_stop():
    import subprocess
    subprocess.run(["systemctl", "stop", "polybot"])
    return jsonify({"status": "stopped"})


# ─────────────────────────────────────────────────────────────────────────────
# STUBS — old dashboard still calls these; return empty arrays to avoid errors
# from any stale frontends until the Netlify deploy propagates.
# ─────────────────────────────────────────────────────────────────────────────
@app.route("/api/portfolio")
def get_portfolio():
    # Redirect old clients to weather portfolio
    return weather_portfolio()

@app.route("/api/positions")
def get_positions():
    return jsonify([])

@app.route("/api/trades")
def get_trades():
    return jsonify([])

@app.route("/api/agents")
def get_agents():
    return jsonify({})

@app.route("/api/pnl_history")
def get_pnl_history():
    return weather_pnl_history()

@app.route("/api/whale_signals")
def get_whale_signals():
    return jsonify([])

@app.route("/api/queue")
def get_queue():
    return jsonify([])

@app.route("/api/category_stats")
def get_category_stats():
    return weather_city_stats()

@app.route("/api/whale_trades")
def get_whale_trades():
    return jsonify([])

@app.route("/api/snapshots")
def get_snapshots():
    return weather_pnl_history()

@app.route("/api/insights")
def get_insights():
    return jsonify({
        "summary": "Weather strategy paper trading. Awaiting first resolutions.",
        "recommendations": [],
        "warnings": [],
        "win_rate": 0,
        "total_trades": 0,
        "analyzed_at": None,
    })
# PAPER TRADER ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/paper/positions")
def paper_positions():
    """Open paper positions with live unrealized P&L."""
    rows = _read_csv(os.path.join(WEATHER_DIR, "paper_positions.csv"))
    open_ = [r for r in rows if r.get("status") == "OPEN"]
    # Most recent first
    open_.sort(key=lambda r: r.get("opened_at", ""), reverse=True)
    out = []
    for r in open_:
        out.append({
            "position_id":     r.get("position_id", ""),
            "opened_at":       r.get("opened_at", ""),
            "city":            r.get("city", ""),
            "target_date":     r.get("target_date", ""),
            "bucket":          r.get("bucket", ""),
            "direction":       r.get("direction", ""),
            "ensemble_prob":   _fnum(r.get("ensemble_prob")),
            "entry_price":     _fnum(r.get("entry_price")),
            "fill_price":      _fnum(r.get("fill_price")),
            "current_price":   _fnum(r.get("current_price")),
            "stake_usd":       _fnum(r.get("stake_usd")),
            "shares":          _fnum(r.get("shares")),
            "unrealized_pnl":  _fnum(r.get("unrealized_pnl")),
            "n_models_agree":  _fint(r.get("n_models_agree")),
        })
    return jsonify(out)


@app.route("/api/paper/trades")
def paper_trades():
    """Closed paper trades with realized P&L."""
    rows = _read_csv(os.path.join(WEATHER_DIR, "paper_trades.csv"))
    rows.sort(key=lambda r: r.get("closed_at", ""), reverse=True)
    out = []
    for r in rows[:200]:
        out.append({
            "position_id":     r.get("position_id", ""),
            "opened_at":       r.get("opened_at", ""),
            "closed_at":       r.get("closed_at", ""),
            "city":            r.get("city", ""),
            "target_date":     r.get("target_date", ""),
            "bucket":          r.get("bucket", ""),
            "direction":       r.get("direction", ""),
            "ensemble_prob":   _fnum(r.get("ensemble_prob")),
            "fill_price":      _fnum(r.get("fill_price")),
            "exit_price":      _fnum(r.get("current_price")),
            "stake_usd":       _fnum(r.get("stake_usd")),
            "realized_pnl":    _fnum(r.get("realized_pnl")),
            "exit_reason":     r.get("exit_reason", ""),
        })
    return jsonify(out)


@app.route("/api/paper/bankroll")
def paper_bankroll():
    """Latest bankroll snapshot + historical series for the chart."""
    rows = _read_csv(os.path.join(WEATHER_DIR, "paper_bankroll.csv"))
    if not rows:
        return jsonify({
            "cash":           1000.0,
            "equity":         1000.0,
            "realized_pnl":   0.0,
            "open_positions": 0,
            "history":        [],
        })

    latest = rows[-1]
    history = [{
        "ts":           r.get("ts", ""),
        "cash":         _fnum(r.get("cash")),
        "equity":       _fnum(r.get("equity")),
        "realized_pnl": _fnum(r.get("realized_pnl")),
        "open_count":   _fint(r.get("open_positions")),
    } for r in rows[-500:]]  # last 500 snapshots

    return jsonify({
        "cash":           _fnum(latest.get("cash")),
        "equity":         _fnum(latest.get("equity")),
        "realized_pnl":   _fnum(latest.get("realized_pnl")),
        "open_positions": _fint(latest.get("open_positions")),
        "history":        history,
    })


@app.route("/api/paper/portfolio")
def paper_portfolio():
    """Top-line summary for dashboard header bar."""
    pos_rows = _read_csv(os.path.join(WEATHER_DIR, "paper_positions.csv"))
    trade_rows = _read_csv(os.path.join(WEATHER_DIR, "paper_trades.csv"))
    bank_rows = _read_csv(os.path.join(WEATHER_DIR, "paper_bankroll.csv"))

    latest_bank = bank_rows[-1] if bank_rows else {}
    cash = _fnum(latest_bank.get("cash"), 1000.0)
    equity = _fnum(latest_bank.get("equity"), 1000.0)
    realized = _fnum(latest_bank.get("realized_pnl"), 0.0)

    open_positions = [p for p in pos_rows if p.get("status") == "OPEN"]
    open_unrealized = sum(_fnum(p.get("unrealized_pnl")) for p in open_positions)

    # Daily P&L = realized today + change in unrealized today
    import pytz
    from datetime import timezone
    pacific = pytz.timezone("America/Los_Angeles")
    today = datetime.now(pacific).date().isoformat()
    daily_realized = sum(
        _fnum(t.get("realized_pnl")) for t in trade_rows
        if t.get("closed_at", "").startswith(today)
    )

    # Win rate
    wins = sum(1 for t in trade_rows if _fnum(t.get("realized_pnl")) > 0)
    total = len(trade_rows)
    win_rate = round(wins / total, 3) if total else 0.0

    return jsonify({
        "balance":          equity,
        "cash":             cash,
        "starting":         1000.0,
        "total_pnl":        round(realized + open_unrealized, 2),
        "realized_pnl":     round(realized, 2),
        "unrealized_pnl":   round(open_unrealized, 2),
        "daily_pnl":        round(daily_realized + open_unrealized, 2),
        "win_rate":         win_rate,
        "total_trades":     total,
        "open_positions":   len(open_positions),
        "roi_pct":          round((equity - 1000.0) / 1000.0 * 100, 2),
        "drawdown_pct":     0.0,
        "paper_trading":    True,
    })


# ─────────────────────────────────────────────────────────────────────────────
# FORECAST VISUALIZATION ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/weather/forecast_markets")
def forecast_markets():
    """List available (city, target_date) pairs from forecast history.
       Powers the dropdown selector in the distribution chart."""
    rows = _read_csv(os.path.join(WEATHER_DIR, "forecast_history.csv"))
    if not rows:
        return jsonify([])

    # Get latest ts per (city, target_date), sorted by date
    today = datetime.utcnow().date().isoformat()
    seen = {}
    for r in rows:
        key = (r.get("city"), r.get("target_date"))
        ts = r.get("ts", "")
        if key not in seen or ts > seen[key]["latest_ts"]:
            seen[key] = {
                "city":        r.get("city"),
                "target_date": r.get("target_date"),
                "latest_ts":   ts,
                "ensemble_mean": _fnum(r.get("ensemble_mean")),
                "n_members":   _fint(r.get("n_members")),
            }

    # Filter to future + today, sort by date asc
    out = sorted(
        [v for v in seen.values() if v["target_date"] >= today],
        key=lambda x: (x["target_date"], x["city"])
    )
    return jsonify(out)


@app.route("/api/weather/forecast_distribution")
def forecast_distribution():
    """Latest ensemble probability + market price for each bucket of one city+date.
       Query params: ?city=NYC&date=2026-04-23"""
    from flask import request
    city = request.args.get("city", "")
    target_date = request.args.get("date", "")

    rows = _read_csv(os.path.join(WEATHER_DIR, "forecast_history.csv"))
    if not rows:
        return jsonify({"city": city, "target_date": target_date, "buckets": []})

    # Filter to this city+date, keep latest per bucket
    latest_per_bucket = {}
    for r in rows:
        if r.get("city") != city or r.get("target_date") != target_date:
            continue
        bucket = r.get("bucket", "")
        ts = r.get("ts", "")
        if bucket not in latest_per_bucket or ts > latest_per_bucket[bucket].get("ts", ""):
            latest_per_bucket[bucket] = r

    # Sort buckets by bucket_lo
    buckets = sorted(
        latest_per_bucket.values(),
        key=lambda r: _fnum(r.get("bucket_lo"))
    )

    out = []
    for r in buckets:
        out.append({
            "bucket":         r.get("bucket"),
            "bucket_lo":      _fnum(r.get("bucket_lo")),
            "bucket_hi":      _fnum(r.get("bucket_hi")),
            "ensemble_prob":  _fnum(r.get("ensemble_prob")),
            "yes_price":      _fnum(r.get("yes_price")),
            "no_price":       _fnum(r.get("no_price")),
            "edge_yes":       round(_fnum(r.get("ensemble_prob")) - _fnum(r.get("yes_price")), 4),
            "n_models_agree": _fint(r.get("n_models_agree")),
        })

    latest_ts = max((r.get("ts", "") for r in latest_per_bucket.values()), default="")
    latest_row = latest_per_bucket.get(list(latest_per_bucket.keys())[0]) if latest_per_bucket else {}

    return jsonify({
        "city":          city,
        "target_date":   target_date,
        "latest_ts":     latest_ts,
        "ensemble_mean": _fnum(latest_row.get("ensemble_mean")),
        "ensemble_std":  _fnum(latest_row.get("ensemble_std")),
        "n_members":     _fint(latest_row.get("n_members")),
        "lead_hours":    _fnum(latest_row.get("lead_hours")),
        "buckets":       out,
    })


@app.route("/api/weather/forecast_evolution")
def forecast_evolution():
    """Time series of ensemble prob + market price for one bucket.
       Query params: ?city=Chicago&date=2026-04-24&bucket=68-69°F"""
    from flask import request
    city = request.args.get("city", "")
    target_date = request.args.get("date", "")
    bucket = request.args.get("bucket", "")

    rows = _read_csv(os.path.join(WEATHER_DIR, "forecast_history.csv"))
    if not rows:
        return jsonify({"city": city, "target_date": target_date, "bucket": bucket, "series": []})

    # Filter + sort by ts
    filt = [
        r for r in rows
        if r.get("city") == city
        and r.get("target_date") == target_date
        and r.get("bucket") == bucket
    ]
    filt.sort(key=lambda r: r.get("ts", ""))

    series = [{
        "ts":              r.get("ts"),
        "ensemble_prob":   _fnum(r.get("ensemble_prob")),
        "yes_price":       _fnum(r.get("yes_price")),
        "no_price":        _fnum(r.get("no_price")),
        "n_models_agree":  _fint(r.get("n_models_agree")),
        "lead_hours":      _fnum(r.get("lead_hours")),
    } for r in filt]

    return jsonify({
        "city":        city,
        "target_date": target_date,
        "bucket":      bucket,
        "n_snapshots": len(series),
        "series":      series,
    })
