import requests
import logging
import time as _time
from datetime import datetime
from database import AgentLog, ActivityLog, Position, Trade
import json, os

logger = logging.getLogger("copy_bot")

WALLETS = [
    {"address": "0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1", "name": "debased",      "win_rate": 0.74, "signal_weight": 1.0},
    {"address": "0x6bab41a0dc40d6dd4c1a915b8c01969479fd1292", "name": "Dropper",      "win_rate": 0.72, "signal_weight": 1.0},
    {"address": "0x000d257d2dc7616feaef4ae0f14600fdf50a758e", "name": "scottilicious", "win_rate": 0.82, "signal_weight": 1.0},
    {"address": "0x06dcaa14f57d8a0573f5dc5940565e6de667af59", "name": "Big.Chungus",  "win_rate": 0.70, "signal_weight": 1.0},
    {"address": "0xd5ccdf772f795547e299de57f47966e24de8dea4", "name": "tsybka",        "win_rate": 0.86, "signal_weight": 0.75},
    {"address": "0x751a2b86cab503496efd325c8344e10159349ea1", "name": "Sharky6999",   "win_rate": 0.98, "signal_weight": 0.75},
    {"address": "0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397", "name": "aviato",       "win_rate": 0.91, "signal_weight": 0.75},
    {"address": "0x011f2d377e56119fb09196dffb0948ae55711122", "name": "11122",         "win_rate": 0.63, "signal_weight": 0.5},
]

# Track seen activity timestamps to avoid duplicates
_SEEN_FILE = "/root/polymarket-bot/bot/seen_activity.json"

def _load_seen():
    try:
        if os.path.exists(_SEEN_FILE):
            return set(json.load(open(_SEEN_FILE)))
    except Exception:
        pass
    return set()

def _save_seen(seen):
    try:
        # Keep only last 1000 entries
        items = list(seen)[-1000:]
        json.dump(items, open(_SEEN_FILE, "w"))
    except Exception:
        pass

seen_activity = _load_seen()

def log_agent(db, status, message):
    entry = AgentLog(agent="copy_bot", status=status, message=message)
    db.add(entry)
    db.commit()

def log_activity(db, event_type, message, market=None, detail=None):
    entry = ActivityLog(
        agent="copy_bot",
        event_type=event_type,
        market=market[:80] if market else None,
        message=message,
        detail=detail,
    )
    db.add(entry)
    db.commit()

def get_recent_activity(address):
    try:
        r = requests.get(
            "https://data-api.polymarket.com/activity",
            params={"user": address, "limit": 10, "type": "TRADE"},
            timeout=10
        )
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        logger.debug("Failed to fetch activity {}: {}".format(address, e))
    return []

def get_market_price(condition_id):
    try:
        r = requests.get(
            "https://clob.polymarket.com/markets/{}".format(condition_id),
            timeout=8
        )
        if r.status_code == 200:
            tokens = r.json().get("tokens", [])
            if tokens:
                return round(float(tokens[0].get("price", 0.5)), 4)
    except Exception:
        pass
    return 0.5

def run_copy_bot(db, portfolio):
    global seen_activity
    log_agent(db, "running", "Scanning {} wallets for new trades...".format(len(WALLETS)))
    new_signals = 0
    now_ts = _time.time()

    for wallet in WALLETS:
        address = wallet["address"]
        name = wallet["name"]
        weight = wallet["signal_weight"]

        activities = get_recent_activity(address)
        if not activities:
            continue

        for t in activities:
            ts = float(t.get("timestamp", 0))

            # Only process trades from last 10 minutes
            if now_ts - ts > 600:
                continue

            # Unique key for this activity
            act_key = "{}-{}".format(address[:10], ts)
            if act_key in seen_activity:
                continue

            size = float(t.get("cash") or t.get("size") or 0)
            if size < 50:
                seen_activity.add(act_key)
                continue

            question = t.get("title") or t.get("market") or "Unknown market"
            price = float(t.get("price") or 0.5)
            side = t.get("side", "BUY")
            cid = t.get("conditionId") or "ACT-{}-{}".format(address[:8], str(int(ts)))

            pos_id = "COPY-{}-{}".format(address[:8], str(int(ts)))
            existing = db.query(Position).filter_by(id=pos_id).first()
            if existing:
                seen_activity.add(act_key)
                continue

            balance = portfolio.get_balance()
            copy_size = round(balance * 0.03 * weight, 2)
            if copy_size < 10:
                continue

            # Try to get expiry from Gamma API
            end_date = None
            try:
                gr = requests.get("https://gamma-api.polymarket.com/markets", params={"conditionId": cid}, timeout=8)
                if gr.status_code == 200:
                    gd = gr.json()
                    if isinstance(gd, list) and gd:
                        end_date = gd[0].get("endDate") or gd[0].get("endDateIso")
            except Exception:
                pass
            position = Position(
                id=pos_id,
                question="[COPY:{}] {}".format(name, question[:60]),
                entry_price=price,
                current_price=price,
                size_usd=copy_size,
                our_probability=wallet["win_rate"],
                expected_gap=0.1,
                kelly_fraction=0.03,
                thesis="Copying {} | {} ${:.0f} @ {:.3f}".format(name, side, size, price),
                status="OPEN",
                category="COPY",
                expires_at=end_date
            )
            db.merge(position)
            trade = Trade(
                condition_id=pos_id,
                side=side,
                price=price,
                size=copy_size,
                order_id="COPY-{}-{}".format(name[:6], str(int(ts))),
                paper=True
            )
            db.add(trade)
            db.commit()
            seen_activity.add(act_key)
            new_signals += 1

            log_activity(db, "TRADE",
                "[COPY] {} {} - paper ${:.0f} @ {:.3f}".format(name, side, copy_size, price),
                market=question[:80],
                detail="Whale: {} | Original: ${:.0f} | Weight: {}x | WR: {}%".format(
                    name, size, weight, round(wallet["win_rate"]*100)))

    _save_seen(seen_activity)
    log_agent(db, "idle",
        "Copy scan: {} new signals from {} wallets".format(new_signals, len(WALLETS)))
