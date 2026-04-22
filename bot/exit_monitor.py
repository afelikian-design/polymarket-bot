import requests
import logging
from datetime import datetime, timezone
from database import AgentLog, ActivityLog, Position, Trade

logger = logging.getLogger("exit_monitor")

def log_agent(db, status, message):
    entry = AgentLog(agent="exit_monitor", status=status, message=message)
    db.add(entry)
    db.commit()

def log_activity(db, event_type, message, market=None, detail=None):
    entry = ActivityLog(
        agent="exit_monitor",
        event_type=event_type,
        market=market[:80] if market else None,
        message=message,
        detail=detail,
    )
    db.add(entry)
    db.commit()

def get_market_status(condition_id):
    try:
        r = requests.get(
            "https://gamma-api.polymarket.com/markets",
            params={"conditionId": condition_id},
            timeout=10
        )
        data = r.json()
        if isinstance(data, list) and data:
            m = data[0]
            return {
                "closed": m.get("closed", False),
                "resolved": m.get("resolved", False),
                "end_date": m.get("endDate"),
            }
    except Exception as e:
        logger.debug("Gamma check failed: {}".format(e))
    return None

def get_yes_price(condition_id):
    try:
        r = requests.get(
            "https://clob.polymarket.com/markets/{}".format(condition_id),
            timeout=8
        )
        if r.status_code == 200:
            tokens = r.json().get("tokens", [])
            if tokens:
                return round(float(tokens[0].get("price", 0)), 4)
    except Exception as e:
        logger.debug("CLOB check failed for {}: {}".format(condition_id, e))
    return None

def run_exit_monitor(db, portfolio):
    log_agent(db, "running", "Checking positions for exit conditions...")
    try:
        open_positions = db.query(Position).filter_by(status="OPEN").all()
        if not open_positions:
            log_agent(db, "idle", "No open positions to monitor")
            return

        closed = 0
        now = datetime.utcnow()

        for pos in open_positions:
            try:
                pos_id = pos.id
                hours_held = (now - pos.opened_at).total_seconds() / 3600
                is_copy = pos_id.startswith("COPY-")

                real_cid = getattr(pos, "condition_id", None) or ""
                clob_id = real_cid if (real_cid and not real_cid.startswith("COPY-")) else None

                if clob_id:
                    yes_price = get_yes_price(clob_id)
                    if yes_price is not None:
                        pos.current_price = yes_price
                        db.commit()
                    else:
                        yes_price = pos.current_price
                else:
                    yes_price = pos.current_price

                should_close = False
                exit_reason = ""
                exit_price = yes_price

                if clob_id:
                    status = get_market_status(clob_id)
                    if status and (status.get("closed") or status.get("resolved")):
                        should_close = True
                        exit_reason = "RESOLVED"

                if is_copy:
                    if not should_close and clob_id and yes_price >= 0.97 and (yes_price - pos.entry_price) >= 0.03:
                        should_close = True
                        exit_reason = "TAKE_PROFIT"
                    if not should_close and clob_id and yes_price <= 0.10 and hours_held > 1:
                        should_close = True
                        exit_reason = "STOP_LOSS"
                    if not should_close and not clob_id and hours_held > 24:
                        should_close = True
                        exit_reason = "NO_TRACKING_DATA"
                        exit_price = pos.entry_price
                else:
                    if not should_close and clob_id and yes_price <= 0.08:
                        should_close = True
                        exit_reason = "TAKE_PROFIT"
                    if not should_close and clob_id and yes_price >= 0.75 and hours_held > 2:
                        should_close = True
                        exit_reason = "STOP_LOSS"

                if should_close:
                    shares = pos.size_usd / pos.entry_price if pos.entry_price > 0 else 0
                    pnl = round((exit_price - pos.entry_price) * shares, 2)
                    pos.status = "CLOSED"
                    pos.exit_price = exit_price
                    pos.exit_reason = exit_reason
                    pos.closed_at = now
                    pos.pnl = pnl
                    trade = Trade(
                        condition_id=clob_id or pos_id,
                        side="SELL",
                        price=exit_price,
                        size=shares,
                        order_id="EXIT-{}".format(exit_reason),
                        paper=True
                    )
                    db.add(trade)
                    db.commit()
                    closed += 1
                    log_activity(db, "EXIT",
                        "CLOSED [{}] PnL: ${:+.2f}".format(exit_reason, pnl),
                        market=pos.question,
                        detail="Entry: {:.3f} -> Exit: {:.3f} | Held: {:.1f}h | Size: ${:.0f} | CID: {}".format(
                            pos.entry_price, exit_price, hours_held, pos.size_usd,
                            clob_id[:16] if clob_id else "none"))
                else:
                    pnl = (yes_price - pos.entry_price) * (pos.size_usd / pos.entry_price) if pos.entry_price > 0 else 0
                    log_activity(db, "WATCH",
                        "Watching {:.1f}h | YES={:.3f} | PnL: ${:+.2f} | CID: {}".format(
                            hours_held, yes_price, pnl, clob_id[:16] if clob_id else "MISSING"),
                        market=pos.question)

            except Exception as e:
                logger.debug("Exit check failed for {}: {}".format(pos.id, e))
                continue

        log_agent(db, "idle",
            "Exit check: {} closed, {} still open".format(closed, len(open_positions) - closed))

    except Exception as e:
        import traceback
        msg = "Exit monitor error: {}".format(traceback.format_exc())
        log_agent(db, "error", msg[:200])
        logger.error(msg)
