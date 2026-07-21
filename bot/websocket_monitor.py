import asyncio
import json
import logging
import websockets
from datetime import datetime
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine

logger = logging.getLogger("websocket_monitor")

class WebSocketPriceMonitor:
    def __init__(self, db_path, config, log_activity_fn, run_exit_logic_fn):
        self.db_path = db_path
        self.config = config
        self.log_activity = log_activity_fn
        self.run_exit_logic = run_exit_logic_fn
        self.engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
        self.SessionFactory = sessionmaker(bind=self.engine)
        self.ws_url = "wss://ws-subscriptions-clob.polymarket.com/ws/"
        self.running = False
        self.subscribed_tokens = set()

    def get_open_positions(self):
        from database import Position
        session = self.SessionFactory()
        try:
            return session.query(Position).filter_by(status="OPEN").all()
        finally:
            session.close()

    def update_price(self, condition_id, price):
        from database import Position
        session = self.SessionFactory()
        try:
            pos = session.query(Position).filter_by(id=condition_id, status="OPEN").first()
            if pos:
                pos.current_price = round(float(price), 4)
                session.commit()
                logger.debug(f"WS price update: {condition_id[:8]}... = {price}")
                # Run exit logic
                self.run_exit_logic(pos, session)
        except Exception as e:
            logger.error(f"WS price update error: {e}")
            session.rollback()
        finally:
            session.close()

    async def subscribe(self, ws, token_ids):
        msg = {
            "auth": {},
            "markets": [],
            "assets_ids": token_ids,
            "type": "market"
        }
        await ws.send(json.dumps(msg))
        logger.info(f"WS subscribed to {len(token_ids)} tokens")

    async def run(self):
        self.running = True
        logger.info("WebSocket price monitor starting...")
        while self.running:
            try:
                async with websockets.connect(
                    self.ws_url,
                    ping_interval=20,
                    ping_timeout=10
                ) as ws:
                    logger.info("WebSocket connected")
                    # Get open positions and subscribe to their tokens
                    positions = self.get_open_positions()
                    if not positions:
                        await asyncio.sleep(10)
                        continue
                    # Get token IDs from CLOB for each position
                    import requests
                    token_ids = []
                    pos_map = {}
                    for pos in positions:
                        try:
                            r = requests.get(
                                f"https://clob.polymarket.com/markets/{pos.id}",
                                timeout=5
                            )
                            if r.status_code == 200:
                                tokens = r.json().get("tokens", [])
                                if tokens:
                                    # Use token closest to entry price
                                    token = min(tokens, key=lambda t: abs(float(t.get("price", 1)) - pos.entry_price))
                                    tid = token.get("token_id")
                                    if tid:
                                        token_ids.append(tid)
                                        pos_map[tid] = pos.id
                        except Exception as e:
                            logger.error(f"Failed to get token for {pos.id[:8]}: {e}")

                    if not token_ids:
                        await asyncio.sleep(10)
                        continue

                    await self.subscribe(ws, token_ids)

                    async for message in ws:
                        try:
                            data = json.loads(message)
                            if isinstance(data, list):
                                for event in data:
                                    self._handle_event(event, pos_map)
                            elif isinstance(data, dict):
                                self._handle_event(data, pos_map)
                        except Exception as e:
                            logger.error(f"WS message error: {e}")

            except Exception as e:
                logger.error(f"WebSocket error: {e}, reconnecting in 5s...")
                await asyncio.sleep(5)

    def _handle_event(self, event, pos_map):
        event_type = event.get("event_type") or event.get("type", "")
        asset_id = event.get("asset_id") or event.get("token_id", "")
        price = event.get("price") or event.get("mid_price")

        if price and asset_id and asset_id in pos_map:
            condition_id = pos_map[asset_id]
            self.update_price(condition_id, price)

    def start_in_thread(self):
        import threading
        def run_loop():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(self.run())
        t = threading.Thread(target=run_loop, daemon=True)
        t.start()
        logger.info("WebSocket monitor thread started")
        return t
