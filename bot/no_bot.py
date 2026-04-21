import requests
import logging
from datetime import datetime, timezone
from database import AgentLog, ActivityLog, Position, Trade

logger = logging.getLogger("no_bot")

def log_agent(db, status, message):
    entry = AgentLog(agent="no_bot", status=status, message=message)
    db.add(entry)
    db.commit()

def log_activity(db, event_type, message, market=None, detail=None):
    entry = ActivityLog(
        agent="no_bot",
        event_type=event_type,
        market=market[:80] if market else None,
        message=message,
        detail=detail,
    )
    db.add(entry)
    db.commit()

def run_no_bot(db, portfolio):
    log_agent(db, "running", "Scanning for NO opportunities...")
    try:
        url = "https://gamma-api.polymarket.com/markets"
        params = {"active": "true", "closed": "false", "limit": 500, "order": "volume", "ascending": "false"}
        resp = requests.get(url, params=params, timeout=30)
        markets = resp.json()
        if not markets:
            log_agent(db, "idle", "No markets returned")
            return
        candidates = []
        for m in markets:
            try:
                condition_id = m.get("conditionId")
                if not condition_id:
                    continue
                volume = float(m.get("volume", 0) or 0)
                if volume < 1000:
                    continue
                best_bid = float(m.get("bestBid", 0) or 0)
                best_ask = float(m.get("bestAsk", 1) or 1)
                if best_bid <= 0 or best_ask <= 0:
                    continue
                yes_price = round((best_bid + best_ask) / 2, 4)
                no_price = round(1 - yes_price, 4)
                if not (0.40 <= no_price <= 0.92):
                    continue
                end_date = m.get("endDate") or m.get("endDateIso")
                candidates.append({
                    "condition_id": condition_id,
                    "question": m.get("question", ""),
                    "yes_price": yes_price,
                    "no_price": no_price,
                    "volume": volume,
                    "end_date": end_date,
                })
            except Exception:
                continue
        log_activity(db, "SCANNING",
            "NO Bot scan: {} candidates from {} markets".format(len(candidates), len(markets)),
            detail="Criteria: NO price 0.40-0.92, volume >$1,000")
        placed = 0
        for c in sorted(candidates, key=lambda x: x["volume"], reverse=True)[:3]:
            condition_id = c["condition_id"]
            existing = db.query(Position).filter_by(id=condition_id, status="OPEN").first()
            if existing:
                continue
            balance = portfolio.get_balance()
            size = round(balance * 0.05, 2)
            if size < 10:
                continue
            no_price = c["no_price"]
            q = c["question"].lower()
            if any(k in q for k in ["trump","biden","election","president","senate","congress","vote","iran","tariff","minister","musk","democrat","republican","greenland","cuba","venezuela","ukraine","russia","china","israel","war","military","sanctions"]):
                cat = "POLITICS"
            elif any(k in q for k in ["btc","eth","sol","bitcoin","ethereum","solana","crypto","xrp","token","binance","hyperliquid"]):
                cat = "CRYPTO"
            elif any(k in q for k in ["fed","rate","cpi","gdp","inflation","recession","treasury","oil","gold","dollar","opec"]):
                cat = "MACRO"
            elif any(k in q for k in ["lol:","valorant","csgo","dota","esport","lck","lcs","lec","bo3","bo5","t1","fnatic","c9"]):
                cat = "ESPORTS"
            elif any(k in q for k in ["ufc","nfl","nba","nhl","mlb","soccer","football","basketball","vs.","match","goals","innings","tennis","open","championship"]):
                cat = "SPORTS"
            else:
                cat = "OTHER"
            position = Position(
                id=condition_id,
                question=c["question"],
                entry_price=no_price,
                current_price=no_price,
                size_usd=size,
                our_probability=0.73,
                expected_gap=round(0.73 - no_price, 4),
                kelly_fraction=0.05,
                thesis="NO Bot: 73% base rate. YES={:.3f} NO={:.3f} Vol=${:,.0f}".format(
                    c["yes_price"], no_price, c["volume"]),
                status="OPEN",
                category=cat,
                expires_at=c.get("end_date")
            )
            db.merge(position)
            trade = Trade(
                condition_id=condition_id,
                side="BUY",
                price=no_price,
                size=size,
                order_id="NOBOT-{}".format(condition_id[:8]),
                paper=True
            )
            db.add(trade)
            db.commit()
            placed += 1
            log_activity(db, "TRADE",
                "[PAPER] BUY NO ${:.2f} @ {:.3f}".format(size, no_price),
                market=c["question"],
                detail="YES: {:.3f} | NO: {:.3f} | Vol: ${:,.0f} | 73% base rate edge".format(
                    c["yes_price"], no_price, c["volume"]))
        log_agent(db, "idle", "NO Bot: {} candidates, {} new positions opened".format(len(candidates), placed))
    except Exception as e:
        import traceback
        msg = "NO Bot error: {}".format(traceback.format_exc())
        log_agent(db, "error", msg[:200])
        logger.error(msg)
