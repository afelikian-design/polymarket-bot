import requests
import logging
import time
from database import AgentLog, ActivityLog

logger = logging.getLogger("binance_bot")

price_history = {"BTCUSDT": [], "ETHUSDT": [], "SOLUSDT": []}

def log_agent(db, status, message):
    entry = AgentLog(agent="binance_bot", status=status, message=message)
    db.add(entry)
    db.commit()

def log_activity(db, event_type, message, market=None, detail=None):
    entry = ActivityLog(
        agent="binance_bot",
        event_type=event_type,
        market=market[:80] if market else None,
        message=message,
        detail=detail,
    )
    db.add(entry)
    db.commit()

def fetch_binance_prices():
    symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    prices = {}
    for sym in symbols:
        try:
            r = requests.get("https://api.binance.com/api/v3/ticker/price",
                params={"symbol": sym}, timeout=5)
            if r.status_code == 200:
                prices[sym] = float(r.json()["price"])
        except Exception:
            pass
    return prices

def check_price_move(history, current_price, window_seconds=60, threshold=0.003):
    now = time.time()
    cutoff = now - window_seconds
    old_prices = [p for ts, p in history if ts >= cutoff]
    if not old_prices:
        return False, 0.0
    oldest = old_prices[0]
    if oldest == 0:
        return False, 0.0
    pct = (current_price - oldest) / oldest
    return abs(pct) >= threshold, pct

KEYWORDS = {
    "BTCUSDT": ["bitcoin", "btc"],
    "ETHUSDT": ["ethereum", "eth"],
    "SOLUSDT": ["solana", "sol"],
}

def find_poly_market(sym, direction):
    keywords = KEYWORDS.get(sym, [])
    try:
        r = requests.get("https://gamma-api.polymarket.com/markets",
            params={"active": "true", "closed": "false", "limit": 200}, timeout=15)
        for m in r.json():
            q = (m.get("question") or "").lower()
            if any(kw in q for kw in keywords):
                if direction == "UP" and any(w in q for w in ["above", "higher", "over", "up"]):
                    return m
                if direction == "DOWN" and any(w in q for w in ["below", "lower", "under", "down"]):
                    return m
    except Exception as e:
        logger.debug("Polymarket search failed: {}".format(e))
    return None

def run_binance_bot(db, portfolio):
    global price_history
    log_agent(db, "running", "Checking Binance price feeds...")
    prices = fetch_binance_prices()
    if not prices:
        log_agent(db, "idle", "Binance API unreachable")
        return
    now = time.time()
    signals = []
    for sym, price in prices.items():
        price_history[sym].append((now, price))
        price_history[sym] = [(ts, p) for ts, p in price_history[sym] if ts >= now - 300]
        moved, pct = check_price_move(price_history[sym], price)
        if moved:
            direction = "UP" if pct > 0 else "DOWN"
            signals.append((sym, price, pct, direction))
    if not signals:
        prices_str = " | ".join("{}=${:,.0f}".format(s, p) for s, p in prices.items())
        log_agent(db, "idle", "Watching: {}".format(prices_str))
        log_activity(db, "SCANNING", "No moves >0.3% in 60s", detail=prices_str)
        return
    for sym, price, pct, direction in signals:
        log_activity(db, "SCANNING",
            "SIGNAL: {} moved {:+.2f}% → hunting {} market".format(sym, pct*100, direction),
            detail="Price: ${:,.2f}".format(price))
        poly = find_poly_market(sym, direction)
        if not poly:
            log_activity(db, "SKIP", "No matching Polymarket market found for {} {}".format(sym, direction))
            continue
        question = poly.get("question", "")
        best_bid = float(poly.get("bestBid", 0) or 0)
        best_ask = float(poly.get("bestAsk", 1) or 1)
        yes_price = round((best_bid + best_ask) / 2, 4)
        if direction == "UP" and yes_price > 0.70:
            log_activity(db, "SKIP", "Already repriced to {:.3f}".format(yes_price), market=question)
            continue
        if direction == "DOWN" and yes_price < 0.30:
            log_activity(db, "SKIP", "Already repriced to {:.3f}".format(yes_price), market=question)
            continue
        balance = portfolio.get_balance()
        size = round(balance * 0.05, 2)
        if size < 10:
            continue
        log_activity(db, "TRADE",
            "[PAPER] BUY {} ${:.2f} @ {:.3f} — {} moved {:+.2f}%".format(
                direction, size, yes_price, sym, pct*100),
            market=question,
            detail="Binance signal: {} @ ${:,.2f} | Poly YES: {:.3f} | Edge window open".format(
                sym, price, yes_price))
    log_agent(db, "idle", "Binance check done: {} signal(s)".format(len(signals)))
