from flask import Flask, jsonify
from flask_cors import CORS
from config import Config
from database import (init_db, Position, Trade, AgentLog,
                      WalletSnapshot, WhaleSignal, PrebuiltThesis,
                      ActivityLog)
from datetime import datetime, timedelta

app = Flask(__name__)
CORS(app)
db = init_db(Config.DB_PATH)

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

@app.route("/api/portfolio")
def get_portfolio():
    snap = db.query(WalletSnapshot)\
        .order_by(WalletSnapshot.snapshotted_at.desc()).first()
    open_pos = db.query(Position).filter_by(status="OPEN").all()
    closed   = db.query(Position).filter_by(status="CLOSED").all()
    wins     = sum(1 for p in closed if (p.pnl or 0) > 0)
    win_rate = round(wins / len(closed), 3) if closed else 0
    open_pnl = sum(
        (p.current_price - p.entry_price) * (p.size_usd / p.entry_price)
        for p in open_pos if p.entry_price > 0
    )
    return jsonify({
        "balance":        snap.balance if snap else 1000.0,
        "daily_pnl":      _get_daily_pnl(),
        "open_pnl":       round(open_pnl, 2),
        "win_rate":       win_rate,
        "open_positions": len(open_pos),
        "drawdown_pct":   snap.drawdown_pct if snap else 0.0,
        "paper_trading":  Config.PAPER_TRADING,
        "total_trades":   len(closed),
    })

@app.route("/api/positions")
def get_positions():
    positions = db.query(Position).filter_by(status="OPEN")\
        .order_by(Position.opened_at.desc()).all()
    return jsonify([{
        "id":             p.id,
        "question":       p.question,
        "entry_price":    p.entry_price,
        "current_price":  p.current_price,
        "size_usd":       p.size_usd,
        "our_probability":p.our_probability,
        "expected_gap":   p.expected_gap,
        "thesis":         p.thesis,
        "opened_at":      p.opened_at.isoformat() if p.opened_at else None,
        "no_price":       p.entry_price,
        "expires_at":     p.expires_at if hasattr(p, "expires_at") else None,
        "yes_price":      round(1 - p.current_price, 4),
        "unrealized_pnl": round(
            (p.current_price - p.entry_price) * (p.size_usd / p.entry_price), 2
        ) if p.entry_price > 0 else 0
    } for p in positions])

@app.route("/api/trades")
def get_trades():
    cutoff = datetime.utcnow() - timedelta(days=30)
    positions = db.query(Position).filter(
        Position.status == "CLOSED",
        Position.closed_at >= cutoff
    ).order_by(Position.closed_at.desc()).limit(50).all()
    return jsonify([{
        "question":    p.question,
        "entry_price": p.entry_price,
        "exit_price":  p.exit_price,
        "size_usd":    p.size_usd,
        "pnl":         p.pnl,
        "exit_reason": p.exit_reason,
        "closed_at":   p.closed_at.isoformat() if p.closed_at else None,
        "opened_at":   p.opened_at.isoformat() if p.opened_at else None,
    } for p in positions])

@app.route("/api/agents")
def get_agents():
    result = {}
    for agent in ["no_bot","binance_bot","exit_monitor","copy_bot"]:
        latest = db.query(AgentLog).filter_by(agent=agent)\
            .order_by(AgentLog.logged_at.desc()).first()
        result[agent] = {
            "status":    latest.status if latest else "unknown",
            "message":   latest.message if latest else "No data",
            "last_seen": latest.logged_at.isoformat() if latest else None
        }
    return jsonify(result)

@app.route("/api/pnl_history")
def get_pnl_history():
    snaps = db.query(WalletSnapshot)\
        .order_by(WalletSnapshot.snapshotted_at.desc()).limit(96).all()
    snaps.reverse()
    return jsonify([{
        "time":      s.snapshotted_at.strftime("%H:%M"),
        "balance":   s.balance,
        "daily_pnl": s.daily_pnl,
    } for s in snaps])

@app.route("/api/whale_signals")
def get_whale_signals():
    signals = db.query(WhaleSignal)\
        .order_by(WhaleSignal.detected_at.desc()).limit(20).all()
    return jsonify([{
        "wallet":        s.wallet_address[:6] + "..." + s.wallet_address[-4:],
        "tier":          s.wallet_tier,
        "question":      s.question,
        "entry_price":   s.entry_price,
        "size_usd":      s.size_usd,
        "has_thesis":    s.has_thesis,
        "action":        s.action_taken,
        "detected_at":   s.detected_at.isoformat(),
        "signal_weight": s.signal_weight,
    } for s in signals])

@app.route("/api/queue")
def get_queue():
    import json as _json
    try:
        with open("thesis.json") as f:
            theses = _json.load(f)
        def _kelly(p_win, mkt_price, bankroll, confidence):
            if not (0 < mkt_price < 1) or not (0 < p_win < 1):
                return 0.0
            b = (1 / mkt_price) - 1
            q = 1 - p_win
            f = (p_win * b - q) / b
            if f <= 0:
                return 0.0
            conf_scalar = 0.5 + (min(max(confidence, 50), 100) - 50) / 100.0
            max_fraction = Config.MAX_KELLY_FRACTION * conf_scalar
            return round(bankroll * min(f, max_fraction), 2)

        # Get current balance from snapshots
        snap = db.query(WalletSnapshot).order_by(WalletSnapshot.snapshotted_at.desc()).first()
        bal = snap.balance if snap else 1000.0

        result = []
        for t in theses:
            p_win = t.get("our_probability", 0)
            mkt = t.get("market_price", 0.5)
            conf = t.get("confidence", 50)
            size = _kelly(p_win, mkt, bal, conf)
            result.append({
                "condition_id":    t.get("condition_id"),
                "question":        t.get("question"),
                "price":           mkt,
                "our_probability": p_win,
                "edge":            t.get("edge"),
                "confidence":      conf,
                "thesis":          t.get("thesis"),
                "suggested_size":  size,
            })
        return jsonify(result)
    except:
        return jsonify([])

@app.route("/api/risk")
def get_risk():
    return jsonify({
        "paper_trading":      Config.PAPER_TRADING,
        "daily_loss_limit":   Config.DAILY_LOSS_LIMIT,
        "max_drawdown":       Config.MAX_DRAWDOWN,
        "max_kelly":          Config.MAX_KELLY_FRACTION,
        "max_open_positions": Config.MAX_OPEN_POSITIONS,
        "min_confidence":      Config.MIN_CONFIDENCE,
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

@app.route("/api/control/halt", methods=["POST"])
def control_halt():
    log = AgentLog(agent="system", status="halted",
                   message="Manual halt via dashboard")
    db.add(log)
    db.commit()
    return jsonify({"status": "halted"})


@app.route("/api/close_position/<condition_id>", methods=["POST"])
def close_position(condition_id):
    from datetime import datetime
    pos = db.query(Position).filter_by(id=condition_id, status="OPEN").first()
    if not pos:
        return jsonify({"error": "Position not found"}), 404
    try:
        r = __import__("requests").get(
            "https://clob.polymarket.com/markets/{}".format(condition_id),
            timeout=8
        )
        current_price = pos.current_price
        if r.status_code == 200:
            tokens = r.json().get("tokens", [])
            if tokens:
                current_price = round(float(tokens[0].get("price", pos.current_price)), 4)
    except:
        current_price = pos.current_price

    pnl = round((current_price - pos.entry_price) * (pos.size_usd / pos.entry_price), 2) if pos.entry_price > 0 else 0
    pos.status = "CLOSED"
    pos.exit_price = current_price
    pos.exit_reason = "MANUAL_SELL"
    pos.closed_at = datetime.utcnow()
    pos.pnl = pnl
    db.commit()
    return jsonify({"status": "closed", "pnl": pnl, "exit_price": current_price})


@app.route("/api/category_stats")
def get_category_stats():
    open_pos = db.query(Position).filter_by(status='OPEN').all()
    exposure = {}
    for p in open_pos:
        cat = (p.category or 'OTHER') if hasattr(p, 'category') else 'OTHER'
        if cat not in exposure:
            exposure[cat] = {"count": 0, "size_usd": 0}
        exposure[cat]["count"] += 1
        exposure[cat]["size_usd"] += (p.size_usd or 0)
    closed = db.query(Position).filter_by(status='CLOSED').all()
    history = {}
    for p in closed:
        cat = (p.category or 'OTHER') if hasattr(p, 'category') else 'OTHER'
        if cat not in history:
            history[cat] = {"wins": 0, "losses": 0, "pnl": 0}
        if (p.pnl or 0) > 0:
            history[cat]["wins"] += 1
        else:
            history[cat]["losses"] += 1
        history[cat]["pnl"] += (p.pnl or 0)
    result = []
    all_cats = set(list(exposure.keys()) + list(history.keys()))
    for cat in all_cats:
        exp = exposure.get(cat, {"count": 0, "size_usd": 0})
        hist = history.get(cat, {"wins": 0, "losses": 0, "pnl": 0})
        total = hist['wins'] + hist['losses']
        result.append({
            "category": cat,
            "open_count": exp["count"],
            "open_size_usd": round(exp["size_usd"], 2),
            "win_rate": round(hist["wins"] / total, 3) if total > 0 else 0,
            "total": total,
            "wins": hist["wins"],
            "pnl": round(hist["pnl"], 2),
        })
    return jsonify(result)

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

@app.route("/api/snapshots")
def get_snapshots():
    from database import WalletSnapshot
    snaps = db.query(WalletSnapshot).order_by(WalletSnapshot.snapshotted_at.asc()).all()
    return jsonify([{
        "balance": s.balance,
        "open_pnl": s.open_pnl or 0,
        "daily_pnl": s.daily_pnl or 0,
        "time": s.snapshotted_at.isoformat() if s.snapshotted_at else None
    } for s in snaps])

@app.route("/api/insights")
def get_insights():
    from database import StrategyInsight
    import json
    insight = db.query(StrategyInsight).order_by(StrategyInsight.analyzed_at.desc()).first()
    if not insight:
        return jsonify({"summary":"No analysis yet","recommendations":[],"warnings":[],"win_rate":0,"total_trades":0,"analyzed_at":None})
    return jsonify({
        "summary": insight.summary,
        "recommendations": json.loads(insight.recommendations or "[]"),
        "warnings": json.loads(insight.warnings or "[]"),
        "win_rate": insight.win_rate,
        "total_trades": insight.total_trades,
        "analyzed_at": insight.analyzed_at.isoformat() if insight.analyzed_at else None
    })



@app.route("/api/whale_trades")
def get_whale_trades():
    import requests as req
    wallets = [
        {"address": "0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1", "name": "debased"},
        {"address": "0x6bab41a0dc40d6dd4c1a915b8c01969479fd1292", "name": "Dropper"},
        {"address": "0x000d257d2dc7616feaef4ae0f14600fdf50a758e", "name": "scottilicious"},
        {"address": "0x06dcaa14f57d8a0573f5dc5940565e6de667af59", "name": "Big.Chungus"},
        {"address": "0xd5ccdf772f795547e299de57f47966e24de8dea4", "name": "tsybka"},
        {"address": "0x751a2b86cab503496efd325c8344e10159349ea1", "name": "Sharky6999"},
        {"address": "0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397", "name": "aviato"},
        {"address": "0x011f2d377e56119fb09196dffb0948ae55711122", "name": "11122"},
    ]
    all_trades = []
    for w in wallets:
        try:
            r = req.get(
                "https://data-api.polymarket.com/activity",
                params={"user": w["address"], "limit": 5, "type": "TRADE"},
                timeout=8
            )
            if r.status_code == 200:
                trades = r.json()
                for t in trades:
                    all_trades.append({
                        "name": w["name"],
                        "address": w["address"],
                        "market": t.get("title") or t.get("market", ""),
                        "side": t.get("side", "BUY"),
                        "price": t.get("price", 0),
                        "size": t.get("cash", t.get("size", 0)),
                        "outcome": t.get("outcome", "YES"),
                        "timestamp": t.get("timestamp", ""),
                    })
        except Exception:
            continue
    all_trades.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return jsonify(all_trades[:30])
