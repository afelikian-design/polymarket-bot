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
    MAX_
