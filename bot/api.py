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
        "daily_pnl":      snap.daily_pnl if snap else 0.0,
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
    } for p in positions])

@app.route("/api/agents")
def get_agents():
    result = {}
    for agent in ["scanner","brain","executor","exit_monitor","whale_monitor"]:
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
    theses = db.query(PrebuiltThesis)\
        .filter_by(active=True, triggered=False)\
        .order_by(PrebuiltThesis.confidence.desc()).limit(20).all()
    return jsonify([{
        "condition_id":   t.condition_id,
        "question":       t.question,
        "price":          t.market_price_at_build,
        "our_probability":t.our_probability,
        "edge":           t.edge,
        "confidence":     t.confidence,
        "thesis":         t.thesis,
    } for t in theses])

@app.route("/api/risk")
def get_risk():
    return jsonify({
        "paper_trading":      Config.PAPER_TRADING,
        "daily_loss_limit":   Config.DAILY_LOSS_LIMIT,
        "max_drawdown":       Config.MAX_DRAWDOWN,
        "max_kelly":          Config.MAX_KELLY_FRACTION,
        "max_open_positions": Config.MAX_OPEN_POSITIONS,
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

if __name__ == "__main__":
    app.run(host=Config.API_HOST, port=Config.API_PORT, debug=False)
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
