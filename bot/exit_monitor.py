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

def get_no_price(condition_id):
    try:
        r = requests.get(
            "https://clob.polymarket.com/markets/{}".format(condition_id),
            timeout=8
        )
        if r.status_code == 200:
            tokens = r.json().get("tokens", [])
            if len(tokens) >= 2:
                return round(float(tokens[1].get("price", 0)), 4)
            elif tokens:
                yes_price = round(float(tokens[0].get("price", 0)), 4)
                return round(1 - yes_price, 4)
    except Exception as e:
        logger.debug("CLOB check failed: {}".format(e))
    return None

def run_exit_monitor(db, portfolio):
    log_agent(db, "running", "Checking NO positions for resolution...")
    try:
        open_positions = db.query(Position).filter_by(status="OPEN").all()
        if not open_positions:
            log_agent(db, "idle", "No open positions to monitor")
            return

        closed = 0
        now = datetime.utcnow()

        for pos in open_positions:
            try:
                condition_id = pos.id
                hours_held = (now - pos.opened_at).total_seconds() / 3600

                # Get current NO price from CLOB
                no_price = get_no_price(condition_id)
                if no_price is not None:
                    pos.current_price = no_price
                    db.commit()

                # Check resolution via Gamma
                status = get_market_status(condition_id)
                should_close = False
                exit_reason = ""
                exit_price = pos.current_price

                if status:
                    if status.get("closed") or status.get("resolved"):
                        should_close = True
                        exit_reason = "RESOLVED"
                        # If NO won, price goes to 1.0. If YES won, price goes to 0.0
                        exit_price = no_price if no_price is not None else pos.current_price

                is_copy = condition_id.startswith("COPY-")

                if is_copy:
                    # Copy trades follow YES — take profit when YES hits 0.85+
                    if not should_close and pos.current_price >= 0.85:
                        should_close = True
                        exit_reason = "TAKE_PROFIT"
                        exit_price = pos.current_price
                    # Stop loss when YES drops below 0.15
                    if not should_close and pos.current_price <= 0.15 and hours_held > 2:
                        should_close = True
                        exit_reason = "STOP_LOSS"
                        exit_price = pos.current_price
                else:
                    # NO bot trades — take profit when NO price > 0.92
                    if not should_close and pos.current_price >= 0.92:
                        should_close = True
                        exit_reason = "TAKE_PROFIT"
                        exit_price = pos.current_price
                    # Stop loss if NO price drops below 0.25 (YES winning)
                    if not should_close and pos.current_price <= 0.25 and hours_held > 2:
                        should_close = True
                        exit_reason = "STOP_LOSS"
                        exit_price = pos.current_price

                if should_close:
                    shares = pos.size_usd / pos.entry_price if pos.entry_price > 0 else 0
                    pnl = round((exit_price - pos.entry_price) * shares, 2)
                    pos.status = "CLOSED"
                    pos.exit_price = exit_price
                    pos.exit_reason = exit_reason
                    pos.closed_at = now
                    pos.pnl = pnl
                    trade = Trade(
                        condition_id=condition_id,
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
                        detail="Entry: {:.3f} → Exit: {:.3f} | Held: {:.1f}h | Size: ${:.0f}".format(
                            pos.entry_price, exit_price, hours_held, pos.size_usd))
                else:
                    pnl = (pos.current_price - pos.entry_price) * (pos.size_usd / pos.entry_price) if pos.entry_price > 0 else 0
                    log_activity(db, "EXIT",
                        "Watching — {:.1f}h held | NO={:.3f} | PnL: ${:+.2f}".format(
                            hours_held, pos.current_price, pnl),
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
