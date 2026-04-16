import logging
import schedule
import time
import threading
import json
import requests as http_requests
from datetime import datetime, timezone
from database import init_db, AgentLog, WalletSnapshot
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


class Portfolio:
    def __init__(self, db_session, initial_balance=1000.0):
        self.db = db_session
        self._balance = initial_balance
        self._peak = initial_balance
        self._start_of_day = initial_balance

    def get_balance(self):
        return self._balance

    def get_peak_balance(self):
        return self._peak

    def get_start_of_day_balance(self):
        return self._start_of_day

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
        daily_pnl = sum(p.pnl or 0 for p in closed)
        drawdown = (self._balance - self._peak) / self._peak if self._peak > 0 else 0
        snap = WalletSnapshot(
            balance=self._balance,
            open_pnl=round(open_pnl, 2),
            daily_pnl=round(daily_pnl, 2),
            peak_balance=self._peak,
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
    try:
        url = "https://gamma-api.polymarket.com/markets"
        params = {
            "active": "true",
            "closed": "false",
            "limit": 100,
            "order": "volume",
            "ascending": "false"
        }
        response = http_requests.get(url, params=params, timeout=30)
        markets = response.json()

        if not markets:
            log_agent("scanner", "idle", "No active markets found")
            return []

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
                if volume < Config.MIN_VOLUME:
                    continue

                best_bid = float(m.get("bestBid", 0) or 0)
                best_ask = float(m.get("bestAsk", 1) or 1)
                if best_bid <= 0 or best_ask <= 0:
                    continue

                price = round((best_bid + best_ask) / 2, 4)
                if price <= 0 or price >= 1:
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

        msg = "Scan complete: {} markets passed (from {} total)".format(len(scored), len(markets))
        log_agent("scanner", "idle", msg)
        logger.info(msg)
        return scored

    except Exception as e:
        msg = "Scanner error: {}".format(e)
        log_agent("scanner", "error", msg)
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
            return []

        if not queue:
            log_agent("brain", "idle", "Queue is empty")
            return []

        claude = anthropic.Anthropic(api_key=Config.ANTHROPIC_API_KEY)
        theses = []

        for market in queue[:20]:
            try:
                prompt = (
                    "Evaluate this prediction market for a trading opportunity.\n\n"
                    "Market: {}\n"
                    "Current price: {} (implies {}% probability)\n"
                    "Hours until resolution: {}\n"
                    "Volume: ${:,.0f}\n\n"
                    "Analyze for mispricing. Respond ONLY with valid JSON, no markdown:\n"
                    "{{\n"
                    '  "our_probability": 0.XX,\n'
                    '  "market_price": {},\n'
                    '  "edge": 0.XX,\n'
                    '  "direction": "OVER" or "UNDER",\n'
                    '  "confidence": 0-100,\n'
                    '  "thesis": "one sentence trading thesis",\n'
                    '  "action": "BUY" or "SKIP"\n'
                    "}}\n\n"
                    "Set action=SKIP if edge < 0.07 or confidence < 70."
                ).format(
                    market["question"],
                    market["price"],
                    round(market["price"] * 100),
                    market["hours"],
                    market["volume"],
                    market["price"]
                )

                response = claude.messages.create(
                    model=Config.CLAUDE_MODEL,
                    max_tokens=400,
                    messages=[{"role": "user", "content": prompt}]
                )

                text = response.content[0].text.strip()
                text = text.replace("```json", "").replace("```", "").strip()
                result = json.loads(text)

                if result.get("action") == "SKIP":
                    continue
                if result.get("confidence", 0) < Config.MIN_CONFIDENCE:
                    continue

                result["condition_id"] = market["condition_id"]
                result["question"] = market["question"]
                theses.append(result)
                logger.info("THESIS: {} | Conf: {} | Edge: {:.3f}".format(
                    market["question"][:60],
                    result.get("confidence"),
                    result.get("edge", 0)
                ))
                time.sleep(0.5)

            except Exception as e:
                logger.debug("Brain failed on market: {}".format(e))
                continue

        with open("thesis.json", "w") as f:
            json.dump(theses, f, indent=2)

        msg = "Brain complete: {} theses from {} markets".format(len(theses), len(queue))
        log_agent("brain", "idle", msg)
        logger.info(msg)
        return theses

    except Exception as e:
        msg = "Brain error: {}".format(e)
        log_agent("brain", "error", msg)
        logger.error(msg)
        return []


def kelly_size(p_win, market_price, bankroll):
    if not (0 < market_price < 1) or not (0 < p_win < 1):
        return 0.0
    b = (1 / market_price) - 1
    q = 1 - p_win
    f = (p_win * b - q) / b
    if f <= 0:
        return 0.0
    return round(bankroll * min(f, Config.MAX_KELLY_FRACTION), 2)


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

        placed = 0
        balance = portfolio.get_balance()

        for thesis in theses:
            condition_id = thesis.get("condition_id")
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
                bankroll=balance
            )

            if size < 10:
                continue

            ok, reason = risk.can_trade(
                trade_size=size,
                balance=balance,
                open_count=portfolio.get_open_count(),
                start_balance=portfolio.get_start_of_day_balance(),
                peak_balance=portfolio.get_peak_balance()
            )

            if not ok:
                logger.warning("Risk block: {}".format(reason))
                continue

            order_id = "PAPER-{}-{}".format(
                condition_id[:8],
                int(datetime.utcnow().timestamp())
            )
            logger.info("[PAPER] BUY ${} @ {} | {}".format(
                size, thesis.get("market_price"), thesis.get("question", "")[:50]
            ))

            position = Position(
                id=condition_id,
                question=thesis.get("question", ""),
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

        msg = "Executor done: {} paper trades placed".format(placed)
        log_agent("executor", "idle", msg)
        logger.info(msg)

    except Exception as e:
        msg = "Executor error: {}".format(e)
        log_agent("executor", "error", msg)
        logger.error(msg)


def run_exit_monitor():
    log_agent("exit_monitor", "running", "Checking exit conditions...")
    try:
        from database import Position, Trade

        open_positions = db.query(Position).filter_by(status="OPEN").all()
        exits = 0

        for pos in open_positions:
            try:
                url = "https://gamma-api.polymarket.com/markets"
                params = {"conditionId": pos.id}
                r = http_requests.get(url, params=params, timeout=10)
                data = r.json()
                if data:
                    market = data[0] if isinstance(data, list) else data
                    best_bid = float(market.get("bestBid", 0) or 0)
                    best_ask = float(market.get("bestAsk", 1) or 1)
                    if best_bid > 0 and best_ask > 0:
                        current_price = (best_bid + best_ask) / 2
                        pos.current_price = round(current_price, 4)
                        db.commit()

                hours_held = (datetime.utcnow() - pos.opened_at).total_seconds() / 3600
                current_price = pos.current_price
                should_exit = False
                exit_reason = ""

                target = pos.entry_price + (pos.expected_gap * Config.TARGET_CAPTURE)
                if current_price >= target:
                    should_exit = True
                    exit_reason = "TARGET_HIT"
                elif current_price <= pos.entry_price * 0.75:
                    should_exit = True
                    exit_reason = "STOP_LOSS"
                elif hours_held > Config.STALE_HOURS:
                    if abs(current_price - pos.entry_price) < Config.STALE_THRESHOLD:
                        should_exit = True
                        exit_reason = "STALE_THESIS"

                if should_exit:
                    pnl = (current_price - pos.entry_price) * (pos.size_usd / pos.entry_price)
                    pos.status = "CLOSED"
                    pos.exit_price = current_price
                    pos.exit_reason = exit_reason
                    pos.closed_at = datetime.utcnow()
                    pos.pnl = round(pnl, 2)
                    trade = Trade(
                        condition_id=pos.id,
                        side="SELL",
                        price=current_price,
                        size=pos.size_usd / pos.entry_price,
                        order_id="EXIT-{}".format(exit_reason),
                        paper=Config.PAPER_TRADING
                    )
                    db.add(trade)
                    db.commit()
                    exits += 1
                    logger.info("EXIT [{}] {} | PnL: ${:.2f}".format(
                        exit_reason, pos.question[:50], pnl
                    ))

            except Exception as e:
                logger.debug("Exit check failed: {}".format(e))
                continue

        msg = "Exit check: {} closed, {} open".format(exits, len(open_positions) - exits)
        log_agent("exit_monitor", "idle", msg)

    except Exception as e:
        msg = "Exit monitor error: {}".format(e)
        log_agent("exit_monitor", "error", msg)
        logger.error(msg)


def run_whale_monitor():
    log_agent("whale_monitor", "idle", "Monitoring markets for whale activity")


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

    logger.info("All agents scheduled. Bot running 24/7.")

    try:
        while True:
            schedule.run_pending()
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Bot stopped")


if __name__ == "__main__":
    main()
