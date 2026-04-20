import os
from dotenv import load_dotenv
load_dotenv()

class Config:
    ANTHROPIC_API_KEY   = os.getenv("ANTHROPIC_API_KEY")
    PRIVATE_KEY         = os.getenv("POLYMARKET_PRIVATE_KEY")
    WALLET_ADDRESS      = os.getenv("POLYMARKET_WALLET_ADDRESS")

    CLOB_HOST           = "https://clob.polymarket.com"
    CHAIN_ID            = 137

    PAPER_TRADING       = os.getenv("PAPER_TRADING", "true").lower() == "true"
    SCAN_INTERVAL_SEC   = 300
    BRAIN_INTERVAL_SEC  = 60
    EXIT_CHECK_SEC      = 5
    MAX_MARKETS_SCAN    = 500

    MAX_KELLY_FRACTION  = 0.10
    MIN_KELLY_FRACTION  = 0.01
    MAX_OPEN_POSITIONS  = 10
    MAX_POSITION_PCT    = 0.15
    MIN_LIQUIDITY       = 2000
    MIN_PRICE           = 0.05
    MAX_PRICE           = 0.95
    DAILY_LOSS_LIMIT    = -0.10
    MAX_DRAWDOWN        = -0.50

    MIN_GAP             = 0.07
    MIN_HOURS           = 1
    MAX_HOURS           = 720
    MIN_VOLUME          = 500
    MAX_VOLUME          = 400000

    CLAUDE_MODEL        = "claude-sonnet-4-6"
    MIN_CONFIDENCE      = 70
    CONSENSUS_THRESHOLD = 2

    TARGET_CAPTURE      = 0.60
    VOLUME_SPIKE_MULT   = 3.0
    STALE_HOURS         = 12
    STALE_THRESHOLD     = 0.05

    API_HOST            = "0.0.0.0"
    API_PORT            = 5000
    DB_PATH             = "bot.db"
