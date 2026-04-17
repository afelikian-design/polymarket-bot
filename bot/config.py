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
    EXIT_CHECK_SEC      = 30
    MAX_MARKETS_SCAN    = 500

    MAX_KELLY_FRACTION  = 0.10
    MIN_KELLY_FRACTION  = 0.01
    MAX_OPEN_POSITIONS  = 10
    MAX_POSITION_PCT    = 0.15
    MIN_LIQUIDITY       = 500
    DAILY_LOSS_LIMIT    = -0.10
    MAX_DRAWDOWN        = -0.20

    MIN_GAP             = 0.07
    MIN_HOURS           = 1
    MAX_HOURS           = 168
    MIN_VOLUME          = 1_000

    CLAUDE_MODEL        = "claude-opus-4-5"
    MIN_CONFIDENCE      = 63
    CONSENSUS_THRESHOLD = 2

    TARGET_CAPTURE      = 0.85
    VOLUME_SPIKE_MULT   = 3.0
    STALE_HOURS         = 24
    STALE_THRESHOLD     = 0.02

    API_HOST            = "0.0.0.0"
    API_PORT            = 5000
    DB_PATH             = "bot.db"
