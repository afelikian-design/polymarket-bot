import logging
import schedule
import time
import threading
import json
from database import init_db
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

def load_targets():
    try:
        with open("targets.json") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning("No targets.json — whale tracking disabled")
        return []

def main():
    logger.info("=" * 50)
    logger.info(f"POLYBOT STARTING — {'PAPER' if Config.PAPER_TRADING else 'LIVE'}")
    logger.info("=" * 50)

    db = init_db(Config.DB_PATH)

    api_thread = threading.Thread(
        target=lambda: app.run(
            host=Config.API_HOST,
            port=Config.API_PORT,
            debug=False
        ),
        daemon=True
    )
    api_thread.start()
    logger.info(f"API running on port {Config.API_PORT}")

    logger.info("Bot running. Press Ctrl+C to stop.")
    try:
        while True:
            schedule.run_pending()
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Bot stopped")

if __name__ == "__main__":
    main()
