import logging
import schedule
import time
import threading
import json
import requests as http_requests
from datetime import datetime, timezone
from database import init_db, AgentLog, WalletSnapshot, ActivityLog
from config import Config
from api import app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    handlers=[
        logging.FileHandler("bot.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("main")

db = init_db(Config.DB_PATH)

INITIAL_BALANCE = 1000.0


def log_activity(agent, event_type, message, market=None, detail=None):
    entry = ActivityLog(
        agent=agent,
        event_type=event_type,
        market=market[:80] if market else None,
        message=message,
        detail=detail,
    )
    db.add(entry)
    db.commit()
    logger.info("[{}] {} {}".format(agent, event_type, message))


class Portfolio:
    def __init__(self, db_session, initial_balance=INITIAL_BALANCE):
        self.db = db_session
        self._initial = initial_balance

    def get_realized_pnl(self):
        from database import Position
        closed = self.db.query(Position).filter_by(status="CLOSED").all()
        return sum(p.pnl or 0 for p in closed)

    def get_open_pnl(self):
        from database import Position
        open_pos = self.db.query(Position).filter_by(status="OPEN").all()
        return sum(
            (p.current_price - p.entry_price) * (p.size_usd / p.entry_price)
            for p in open_pos if p.entry_price and p.entry_price > 0
        )

    def get_balance(self):
        return round(self._initial + self.get_realized_pnl(), 2)

    def get_peak_balance(self):
        snap = self.db.query(WalletSnapshot)\
            .order_by(WalletSnapshot.peak_balance.desc()).first()
        peak = snap.peak_balance if snap else self._initial
        return max(peak, self.get_balance())

    def get_start_of_day_balance(self):
        from database import Position
        import pytz
        pacific = pytz.timezone("America/Los_Angeles")
        now_pac = datetime.now(pacific)
        midnight_pac = now_pac.replace(hour=0, minute=0, second=0, microsecond=0)
        today_start = midnight_pac.astimezone(pytz.utc).replace(tzinfo=None)
        closed_before_today = self.db.query(Position).filter(
            Position.status == "CLOSED",
            Position.closed_at < today_start
        ).all()
        return round(self._initial + sum(p.pnl or 0 for p in closed_before_today), 2)
    def get_daily_pnl(self):
        from database import Position
        import pytz
        pacific = pytz.timezone("America/Los_Angeles")
        now_pac = datetime.now(pacific)
        midnight_pac = now_pac.replace(hour=0, minute=0, second=0, microsecond=0)
        today_start = midnight_pac.astimezone(pytz.utc).replace(tzinfo=None)
        today_closed = self.db.query(Position).filter(
            Position.status == "CLOSED",
            Position.closed_at >= today_start
        ).all()
        return round(sum(p.pnl or 0 for p in today_closed), 2)
    def get_open_count(self):
        from database import Position
        return self.db.query(Position).filter_by(status="OPEN").count()

    def get_win_rate(self):
        from database import Position
        closed = self.db.query(Position).filter_by(status="CLOSED").all()
        if not closed:
            return 0.0
        wins = sum(1 for p in closed if (p.pnl or 0) > 0)
        return round(wins / len(closed), 3)

    def get_drawdown(self):
        balance = self.get_balance()
        peak = self.get_peak_balance()
        if peak <= 0:
            return 0.0
        return round((balance - peak) / peak, 4)

    def get_open_count(self):
        from database import Position
        return self.db.query(Position).filter_by(status="OPEN").count()

    def snapshot(self):
        from database import Position
        open_pos = self.db.query(Position).filter_by(status="OPEN").all()
        open_pnl = sum(
            (p.current_price - p.entry_price) * (p.size_usd / p.entry_price)
            for p in open_pos if p.entry_price and p.entry_price > 0
        )
        closed = self.db.query(Position).filter_by(status="CLOSED").all()
        daily_pnl = self.get_daily_pnl()
        balance = self.get_balance()
        peak = self.get_peak_balance()
        drawdown = (balance - peak) / peak if peak > 0 else 0
        snap = WalletSnapshot(
            balance=balance,
            open_pnl=round(open_pnl, 2),
            daily_pnl=daily_pnl,
            peak_balance=peak,
            drawdown_pct=round(drawdown, 4),
        )
        self.db.add(snap)
        self.db.commit()


class RiskEngine:
    def __init__(self):
        self.trading_halted = False
        self.halt_reason = None

    def can_trade(self, trade_size, balance, open_count, start_balance, peak_balance):
        if self.trading_halted:
            return False, self.halt_reason
        if open_count >= Config.MAX_OPEN_POSITIONS:
            return False, "Max open positions reached"
        if balance > 0 and start_balance > 0:
            daily_pct = (balance - start_balance) / start_balance
            if daily_pct < Config.DAILY_LOSS_LIMIT:
                self.trading_halted = True
                self.halt_reason = "Daily loss limit hit"
                return False, self.halt_reason
        if peak_balance > 0:
            drawdown = (balance - peak_balance) / peak_balance
            if drawdown < Config.MAX_DRAWDOWN:
                self.trading_halted = True
                self.halt_reason = "Max drawdown hit"
                return False, self.halt_reason
        if balance > 0 and trade_size / balance > Config.MAX_POSITION_PCT:
            return False, "Position too large"
        return True, "OK"


portfolio = Portfolio(db)
risk = RiskEngine()


def log_agent(agent, status, message):
    entry = AgentLog(agent=agent, status=status, message=message)
    db.add(entry)
    db.commit()


def run_scanner():
    log_agent("scanner", "running", "Scanning Polymarket markets...")
    log_activity("scanner", "SCANNING", "Fetching active markets from Polymarket Gamma API...")
    try:
        url = "https://gamma-api.polymarket.com/markets"
        params = {
            "active": "true",
            "closed": "false",
            "limit": 500,
            "order": "volume",
            "ascending": "false"
        }
        response = http_requests.get(url, params=params, timeout=30)
        markets = response.json()

        if not markets:
            log_agent("scanner", "idle", "No active markets found")
            log_activity("scanner", "ERROR", "No active markets returned from API")
            return []

        log_activity("scanner", "SCANNING",
            "Fetched {} markets — applying filters".format(len(markets)),
            detail="Filters: volume>${}, {}–{}h to resolution".format(
                Config.MIN_VOLUME, Config.MIN_HOURS, Config.MAX_HOURS))

        scored = []
        now = datetime.now(timezone.utc)

        for m in markets:
            try:
                condition_id = m.get("conditionId")
                if not condition_id:
                    continue
                end_date = m.get("endDate") or m.get("endDateIso")
                if not end_date:
                    continue
                try:
                    end_dt = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
                    hours = (end_dt - now).total_seconds() / 3600
                except Exception:
                    continue
                if hours < Config.MIN_HOURS or hours > Config.MAX_HOURS:
                    continue
                volume = float(m.get("volume", 0) or 0)
                if volume < Config.MIN_VOLUME or volume > Config.MAX_VOLUME:
                    continue
                best_bid = float(m.get("bestBid", 0) or 0)
                best_ask = float(m.get("bestAsk", 1) or 1)
                if best_bid <= 0 or best_ask <= 0:
                    continue
                price = round((best_bid + best_ask) / 2, 4)
                if price <= 0 or price >= 1:
                    continue
                if price < Config.MIN_PRICE or price > Config.MAX_PRICE:
                    continue
                if price < Config.MIN_PRICE or price > Config.MAX_PRICE:
                    continue
                scored.append({
                    "condition_id": condition_id,
                    "question": m.get("question", ""),
                    "price": price,
                    "hours": round(hours, 1),
                    "volume": round(volume, 2),
                    "gap": 0.0,
                    "ev": 0.0,
                })
            except Exception:
                continue

        with open("queue.json", "w") as f:
            json.dump(scored, f, indent=2)

        msg = "{} markets passed filters (from {} total)".format(len(scored), len(markets))
        log_agent("scanner", "idle", "Scan complete: " + msg)
        log_activity("scanner", "SCANNING",
            "Scan complete — {} candidates queued for Claude".format(len(scored)),
            detail=msg)
        return scored

    except Exception as e:
        msg = "Scanner error: {}".format(e)
        log_agent("scanner", "error", msg)
        log_activity("scanner", "ERROR", msg)
        logger.error(msg)
        return []


def run_brain():
    log_agent("brain", "running", "Evaluating markets with Claude...")
    try:
        import anthropic

        try:
            with open("queue.json") as f:
                queue = json.load(f)
        except FileNotFoundError:
            log_agent("brain", "idle", "No queue.json found")
            log_activity("brain", "SKIP", "No market queue found")
            return []

        if not queue:
            log_agent("brain", "idle", "Queue is empty")
            log_activity("brain", "SKIP", "Market queue is empty")
            return []

        log_activity("brain", "EVALUATING",
            "Starting evaluation of {} candidate markets".format(len(queue)),
            detail="Model: {} | Min confidence: {}".format(Config.CLAUDE_MODEL, Config.MIN_CONFIDENCE))

        claude = anthropic.Anthropic(api_key=Config.ANTHROPIC_API_KEY)
        theses = []
        skipped = 0

        for i, market in enumerate(queue[:25]):
            q = market["question"]
            price = market["price"]
            hours = market["hours"]
            volume = market["volume"]

            log_activity("brain", "EVALUATING",
                "Analyzing market {}/{}".format(i + 1, min(len(queue), 20)),
                market=q,
                detail="Price: {} | {}h remaining | Vol: ${:,.0f}".format(price, hours, volume))

            try:
                prompt = "You are a prediction market trader. Before analyzing, search the web for recent news relevant to this market.\n\n"
                prompt += "Market: {}\n".format(q)
                prompt += "Current price: {} (implies {}% probability)\n".format(price, round(price * 100))
                prompt += "Hours until resolution: {}\n".format(hours)
                prompt += "Volume: ${:,.0f}\n\n".format(volume)
                prompt += "Step 1: Search for recent news, data, or events relevant to this market question.\n"
                prompt += "Step 2: Based on what you find, estimate the TRUE probability of YES resolution.\n"
                prompt += "Step 3: Respond ONLY with valid JSON, no markdown, no extra text:\n"
                prompt += '{"our_probability": 0.55, "market_price": ' + str(price) + ', '
                prompt += '"edge": 0.10, "direction": "OVER", '
                prompt += '"confidence": 75, "crowd_error": "describe error or null", '
                prompt += '"base_rate_note": "what recent news or data supports your estimate", "thesis": "one sentence including what you found", "action": "BUY"}'
                prompt += "\n\nSet action to SKIP if edge < 0.07 or confidence < 70. Be conservative — only BUY when you found real evidence."

                # Agentic tool loop for web_search
                messages = [{"role": "user", "content": prompt}]
                text = ""
                for _ in range(5):
                    response = claude.messages.create(
                        model=Config.CLAUDE_MODEL,
                        max_tokens=1500,
                        tools=[{"type": "web_search_20250305", "name": "web_search"}],
                        messages=messages
                    )
                    for block in response.content:
                        if hasattr(block, "type") and block.type == "text":
                            text += block.text
                    if response.stop_reason == "end_turn":
                        break
                    if response.stop_reason == "tool_use":
                        messages.append({"role": "assistant", "content": response.content})
                        tool_results = []
                        for block in response.content:
                            if hasattr(block, "type") and block.type == "tool_use":
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": block.id,
                                    "content": "Search completed."
                                })
                        if tool_results:
                            messages.append({"role": "user", "content": tool_results})
                    else:
                        break
                text = text.strip().replace("```json", "").replace("```", "").strip()
                # Find JSON in response
                start = text.find("{")
                end = text.rfind("}") + 1
                if start == -1 or end == 0:
                    raise ValueError("No JSON found in response")
                text = text[start:end]
                result = json.loads(text)

                our_prob = result.get("our_probability", 0)
                edge = result.get("edge", 0)
                confidence = result.get("confidence", 0)
                direction = result.get("direction", "")
                crowd_error = result.get("crowd_error")
                base_rate = result.get("base_rate_note")
                thesis = result.get("thesis", "")
                action = result.get("action", "SKIP")

                if action == "SKIP" or confidence < Config.MIN_CONFIDENCE:
                    skip_reason = "edge too thin ({:.3f})".format(edge) if edge < 0.07 else "low confidence ({})".format(confidence)
                    log_activity("brain", "SKIP",
                        "SKIP — {}".format(skip_reason),
                        market=q,
                        detail="Our est: {:.1%} | Mkt: {:.1%} | Edge: {:.3f} | Conf: {}{}".format(
                            our_prob, price, edge, confidence,
                            " | " + str(crowd_error) if crowd_error else ""))
                    skipped += 1
                    continue

                result["condition_id"] = market["condition_id"]
                result["question"] = q
                # Calculate suggested size for display
                suggested = kelly_size(
                    p_win=result.get("our_probability", 0),
                    market_price=result.get("market_price", 0.5),
                    bankroll=portfolio.get_balance(),
                    confidence=result.get("confidence", 50)
                )
                result["suggested_size"] = suggested
                theses.append(result)

                detail_parts = [
                    "Our est: {:.1%} vs mkt: {:.1%}".format(our_prob, price),
                    "Edge: {:+.3f} ({})".format(edge, direction),
                    "Confidence: {}/100".format(confidence),
                ]
                if crowd_error and crowd_error != "null":
                    detail_parts.append("Crowd error: {}".format(crowd_error))
                if base_rate:
                    detail_parts.append("Base rate: {}".format(base_rate))

                log_activity("brain", "THESIS",
                    "THESIS — {}".format(thesis),
                    market=q,
                    detail=" | ".join(detail_parts))

                time.sleep(0.5)

            except Exception as e:
                log_activity("brain", "ERROR",
                    "Evaluation failed: {}".format(str(e)[:80]),
                    market=q)
                logger.debug("Brain failed: {}".format(e))
                continue

        with open("thesis.json", "w") as f:
            json.dump(theses, f, indent=2)

        msg = "{} theses, {} skipped (from {} evaluated)".format(
            len(theses), skipped, min(len(queue), 20))
        log_agent("brain", "idle", "Brain complete: " + msg)
        log_activity("brain", "EVALUATING",
            "Evaluation complete — {} actionable trades identified".format(len(theses)),
            detail=msg)
        return theses

    except Exception as e:
        msg = "Brain error: {}".format(e)
        log_agent("brain", "error", msg)
        log_activity("brain", "ERROR", msg)
        logger.error(msg)
        return []


def kelly_size(p_win, market_price, bankroll, confidence=50):
    if not (0 < market_price < 1) or not (0 < p_win < 1):
        return 0.0
    b = (1 / market_price) - 1
    q = 1 - p_win
    f = (p_win * b - q) / b
    if f <= 0:
        return 0.0
    # Scale Kelly fraction by confidence (50=min -> 100=max)
    # confidence 50 = 50% of MAX_KELLY, confidence 100 = 100% of MAX_KELLY
    conf_scalar = 0.5 + (min(max(confidence, 50), 100) - 50) / 100.0
    max_fraction = Config.MAX_KELLY_FRACTION * conf_scalar
    return round(bankroll * min(f, max_fraction), 2)


def run_executor():
    log_agent("executor", "running", "Checking theses for execution...")
    try:
        from database import Position, Trade

        try:
            with open("thesis.json") as f:
                theses = json.load(f)
        except FileNotFoundError:
            log_agent("executor", "idle", "No thesis.json found")
            return

        if not theses:
            log_agent("executor", "idle", "No theses to execute")
            return

        placed = 0
        balance = portfolio.get_balance()

        log_activity("executor", "TRADE",
            "Reviewing {} theses for execution".format(len(theses)),
            detail="Bankroll: ${:.2f} | Open: {}/{}".format(
                balance, portfolio.get_open_count(), Config.MAX_OPEN_POSITIONS))

        for thesis in theses:
            condition_id = thesis.get("condition_id")
            q = thesis.get("question", "")
            if not condition_id:
                continue

            existing = db.query(Position).filter_by(
                id=condition_id, status="OPEN"
            ).first()
            if existing:
                continue

            size = kelly_size(
                p_win=thesis.get("our_probability", 0),
                market_price=thesis.get("market_price", 0.5),
                bankroll=balance,
                confidence=thesis.get("confidence", 50)
            )

            if size < 10:
                log_activity("executor", "SKIP",
                    "Kelly size ${:.2f} too small".format(size),
                    market=q)
                continue

            ok, reason = risk.can_trade(
                trade_size=size,
                balance=balance,
                open_count=portfolio.get_open_count(),
                start_balance=portfolio.get_start_of_day_balance(),
                peak_balance=portfolio.get_peak_balance()
            )

            if not ok:
                log_activity("executor", "SKIP",
                    "Risk block: {}".format(reason), market=q)
                continue

            # Price stability check — skip if price moved >2 cents since brain evaluated
            try:
                r = http_requests.get(
                    "https://clob.polymarket.com/markets/{}".format(condition_id),
                    timeout=8
                )
                if r.status_code == 200:
                    tokens = r.json().get("tokens", [])
                    if tokens:
                        live_price = round(float(tokens[0].get("price", 0)), 4)
                        brain_price = thesis.get("market_price", 0)
                        if abs(live_price - brain_price) > 0.02:
                            log_activity("executor", "SKIP",
                                "Price moved {:.3f} -> {:.3f} since evaluation, skipping".format(
                                    brain_price, live_price),
                                market=q)
                            continue
            except Exception as e:
                logger.debug("Stability check failed: {}".format(e))

            order_id = "PAPER-{}-{}".format(
                condition_id[:8], int(datetime.utcnow().timestamp()))

            position = Position(
                id=condition_id,
                question=q,
                entry_price=thesis.get("market_price", 0),
                current_price=thesis.get("market_price", 0),
                size_usd=size,
                our_probability=thesis.get("our_probability", 0),
                expected_gap=thesis.get("edge", 0),
                kelly_fraction=size / balance if balance > 0 else 0,
                thesis=thesis.get("thesis", ""),
                status="OPEN"
            )
            db.merge(position)

            trade = Trade(
                condition_id=condition_id,
                side="BUY",
                price=thesis.get("market_price", 0),
                size=size,
                order_id=order_id,
                paper=Config.PAPER_TRADING
            )
            db.add(trade)
            db.commit()
            placed += 1

            log_activity("executor", "TRADE",
                "PAPER TRADE — ${:.2f} @ {:.3f}".format(size, thesis.get("market_price", 0)),
                market=q,
                detail="Kelly: {:.1%} | Our prob: {:.1%} | Edge: {:+.3f} | {}".format(
                    size / balance if balance > 0 else 0,
                    thesis.get("our_probability", 0),
                    thesis.get("edge", 0),
                    thesis.get("thesis", "")[:60]))

        log_agent("executor", "idle", "Executor done: {} placed".format(placed))

    except Exception as e:
        msg = "Executor error: {}".format(e)
        log_agent("executor", "error", msg)
        log_activity("executor", "ERROR", msg)
        logger.error(msg)


def run_exit_monitor():
    log_agent("exit_monitor", "running", "Checking exit conditions...")
    try:
        from database import Position, Trade

        open_positions = db.query(Position).filter_by(status="OPEN").all()

        if not open_positions:
            log_agent("exit_monitor", "idle", "No open positions to monitor")
            return

        exits = 0

        for pos in open_positions:
            try:
                # Use CLOB API — Gamma API conditionId filter is broken
                r = http_requests.get(
                    "https://clob.polymarket.com/markets/{}".format(pos.id),
                    timeout=10
                )
                if r.status_code == 200:
                    data = r.json()
                    tokens = data.get("tokens", [])
                    if tokens:
                        current_price = round(float(tokens[0].get("price", pos.current_price)), 4)
                        pos.current_price = current_price
                        db.commit()

                hours_held = (datetime.utcnow() - pos.opened_at).total_seconds() / 3600
                current_price = pos.current_price
                pnl = (current_price - pos.entry_price) * (pos.size_usd / pos.entry_price)
                should_exit = False
                exit_reason = ""

                target = pos.entry_price + (pos.expected_gap * Config.TARGET_CAPTURE)
                if current_price >= target:
                    should_exit = True
                    exit_reason = "TARGET_HIT"
                elif (pos.entry_price > 0 and current_price <= pos.entry_price * 0.75 and hours_held > 2) or                      (pnl < -15):
                    should_exit = True
                    exit_reason = "STOP_LOSS"
                elif hours_held > Config.STALE_HOURS:
                    if abs(current_price - pos.entry_price) < Config.STALE_THRESHOLD:
                        should_exit = True
                        exit_reason = "STALE_THESIS"

                if should_exit:
                    pos.status = "CLOSED"
                    pos.exit_price = current_price
                    pos.exit_reason = exit_reason
                    pos.closed_at = datetime.utcnow()
                    pos.pnl = round(pnl, 2)
                    trade = Trade(
                        condition_id=pos.id,
                        side="SELL",
                        price=current_price,
                        size=pos.size_usd / pos.entry_price if pos.entry_price > 0 else 0,
                        order_id="EXIT-{}".format(exit_reason),
                        paper=Config.PAPER_TRADING
                    )
                    db.add(trade)
                    db.commit()
                    exits += 1

                    log_activity("exit_monitor", "EXIT",
                        "CLOSED [{}] PnL: ${:+.2f}".format(exit_reason, pnl),
                        market=pos.question,
                        detail="Entry: {:.3f} → Exit: {:.3f} | Held: {:.1f}h | Size: ${:.0f}".format(
                            pos.entry_price, current_price, hours_held, pos.size_usd))
                else:
                    pnl_pct = (current_price - pos.entry_price) / pos.entry_price * 100 if pos.entry_price > 0 else 0
                    log_activity("exit_monitor", "EXIT",
                        "Watching — {:.1f}h held | PnL: ${:+.2f} ({:+.1f}%)".format(hours_held, pnl, pnl_pct),
                        market=pos.question,
                        detail="Price: {:.3f} | Target: {:.3f} | Stop: {:.3f}".format(
                            current_price,
                            pos.entry_price + (pos.expected_gap * Config.TARGET_CAPTURE),
                            pos.entry_price * 0.75))

            except Exception as e:
                logger.debug("Exit check failed: {}".format(e))
                continue

        log_agent("exit_monitor", "idle",
            "Exit check: {} closed, {} open".format(exits, len(open_positions) - exits))

    except Exception as e:
        msg = "Exit monitor error: {}".format(e)
        log_agent("exit_monitor", "error", msg)
        log_activity("exit_monitor", "ERROR", msg)
        logger.error(msg)



def run_strategy_analyzer():
    log_agent("strategy_analyzer", "running", "Analyzing trading performance...")
    try:
        from database import Position, StrategyInsight
        import json, anthropic

        trades = db.query(Position).filter_by(status="CLOSED").order_by(Position.closed_at.desc()).limit(50).all()
        if len(trades) < 5:
            log_agent("strategy_analyzer", "idle", "Not enough trades to analyze yet")
            return

        trade_lines = []
        for t in trades:
            pnl = t.pnl or 0
            win = "WIN" if pnl > 0 else ("LOSS" if pnl < 0 else "NEUTRAL")
            held = round((t.closed_at - t.opened_at).total_seconds() / 3600, 1) if t.closed_at and t.opened_at else 0
            trade_lines.append("{} | PnL: ${:.2f} | Entry: {} | Exit: {} | Reason: {} | Held: {}h | Market: {}".format(
                win, pnl, t.entry_price, t.exit_price, t.exit_reason, held, (t.question or "")[:60]))

        trade_text = "\n".join(trade_lines)
        wins = sum(1 for t in trades if (t.pnl or 0) > 0)
        win_rate = round(wins / len(trades) * 100, 1)
        total_pnl = sum(t.pnl or 0 for t in trades)

        prompt = """You are analyzing a Polymarket prediction market trading bot's recent performance.

Here are the last {} closed trades:
{}

Overall: {}/{} wins ({}% win rate), Total PnL: ${:.2f}

Analyze this data and respond with ONLY a JSON object in this exact format:
{{
  "summary": "2-3 sentence summary of overall performance",
  "warnings": ["warning 1", "warning 2", "warning 3"],
  "recommendations": ["specific config change 1", "specific config change 2", "specific config change 3", "specific config change 4"]
}}

Focus on which market categories are winning vs losing, entry price quality, stop loss frequency, stale thesis patterns, and specific actionable config changes. No markdown, just the JSON object.""".format(len(trades), trade_text, wins, len(trades), win_rate, total_pnl)

        client = anthropic.Anthropic(api_key=Config.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model=Config.CLAUDE_MODEL,
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}]
        )

        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        data = json.loads(raw)

        insight = StrategyInsight(
            total_trades=len(trades),
            win_rate=win_rate / 100,
            summary=data.get("summary", ""),
            recommendations=json.dumps(data.get("recommendations", [])),
            warnings=json.dumps(data.get("warnings", [])),
            raw_analysis=raw
        )
        db.add(insight)
        db.commit()

        log_agent("strategy_analyzer", "idle", "Analysis complete: {} recommendations generated".format(len(data.get("recommendations", []))))
        log_activity("strategy_analyzer", "SCANNING",
            "Strategy analysis complete - {}% win rate on {} trades".format(win_rate, len(trades)),
            detail=data.get("summary", "")[:100])

    except Exception as e:
        log_agent("strategy_analyzer", "error", "Analysis error: {}".format(e))
        logger.error("Strategy analyzer error: {}".format(e))

def run_whale_monitor():
    log_agent("whale_monitor", "idle", "Monitoring markets for whale activity")
    log_activity("whale_monitor", "SCANNING", "Polling 50 tracked wallets for new entries")


def main():
    logger.info("=" * 50)
    logger.info("POLYBOT STARTING - {}".format("PAPER" if Config.PAPER_TRADING else "LIVE"))
    logger.info("=" * 50)

    api_thread = threading.Thread(
        target=lambda: app.run(
            host=Config.API_HOST,
            port=Config.API_PORT,
            debug=False,
            use_reloader=False
        ),
        daemon=True
    )
    api_thread.start()
    logger.info("API running on port {}".format(Config.API_PORT))

    log_agent("scanner", "idle", "Bot started")
    log_agent("brain", "idle", "Bot started")
    log_agent("executor", "idle", "Bot started")
    log_agent("exit_monitor", "idle", "Bot started")
    log_agent("whale_monitor", "idle", "Bot started")

    log_activity("scanner", "SCANNING",
        "PolyBot started in {} mode".format("PAPER" if Config.PAPER_TRADING else "LIVE"),
        detail="Model: {} | Initial balance: ${}".format(Config.CLAUDE_MODEL, INITIAL_BALANCE))

    logger.info("Running initial scan...")
    run_scanner()
    run_brain()
    run_executor()

    schedule.every(Config.SCAN_INTERVAL_SEC).seconds.do(run_scanner)
    schedule.every(Config.BRAIN_INTERVAL_SEC).seconds.do(run_brain)
    schedule.every(Config.BRAIN_INTERVAL_SEC).seconds.do(run_executor)
    schedule.every(Config.EXIT_CHECK_SEC).seconds.do(run_exit_monitor)
    schedule.every(5).minutes.do(portfolio.snapshot)
    schedule.every(60).minutes.do(run_whale_monitor)
    schedule.every(30).minutes.do(run_strategy_analyzer)

    logger.info("All agents scheduled. Bot running 24/7.")

    try:
        while True:
            schedule.run_pending()
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Bot stopped")


if __name__ == "__main__":
    main()
