from sqlalchemy import create_engine, Column, String, Float, Integer, Boolean, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

Base = declarative_base()

class Position(Base):
    __tablename__ = "positions"
    id              = Column(String, primary_key=True)
    question        = Column(Text)
    entry_price     = Column(Float)
    current_price   = Column(Float)
    size_usd        = Column(Float)
    our_probability = Column(Float)
    expected_gap    = Column(Float)
    kelly_fraction  = Column(Float)
    thesis          = Column(Text)
    status          = Column(String, default="OPEN")
    exit_price      = Column(Float)
    exit_reason     = Column(String)
    pnl             = Column(Float, default=0.0)
    opened_at       = Column(DateTime, default=datetime.utcnow)
    closed_at       = Column(DateTime)

class Trade(Base):
    __tablename__ = "trades"
    id              = Column(Integer, primary_key=True, autoincrement=True)
    condition_id    = Column(String)
    side            = Column(String)
    price           = Column(Float)
    size            = Column(Float)
    order_id        = Column(String)
    paper           = Column(Boolean, default=True)
    executed_at     = Column(DateTime, default=datetime.utcnow)

class PrebuiltThesis(Base):
    __tablename__ = "prebuilt_theses"
    id                    = Column(Integer, primary_key=True, autoincrement=True)
    condition_id          = Column(String, index=True)
    question              = Column(Text)
    our_probability       = Column(Float)
    market_price_at_build = Column(Float)
    edge                  = Column(Float)
    direction             = Column(String)
    confidence            = Column(Integer)
    category              = Column(String)
    crowd_error           = Column(Text)
    thesis                = Column(Text)
    resolution_risk       = Column(String)
    whale_active          = Column(Boolean, default=False)
    valid_until           = Column(DateTime)
    active                = Column(Boolean, default=True)
    created_at            = Column(DateTime, default=datetime.utcnow)
    triggered             = Column(Boolean, default=False)

class TrackedWallet(Base):
    __tablename__ = "tracked_wallets"
    address          = Column(String, primary_key=True)
    tier             = Column(Integer)
    signal_weight    = Column(Float)
    win_rate         = Column(Float)
    total_pnl        = Column(Float)
    total_trades     = Column(Integer)
    best_category    = Column(String)
    sharpe_score     = Column(Float)
    active           = Column(Boolean, default=True)
    last_updated     = Column(DateTime, default=datetime.utcnow)

class WhaleSignal(Base):
    __tablename__ = "whale_signals"
    id               = Column(Integer, primary_key=True, autoincrement=True)
    wallet_address   = Column(String)
    wallet_tier      = Column(Integer)
    condition_id     = Column(String)
    question         = Column(Text)
    entry_price      = Column(Float)
    size_usd         = Column(Float)
    side             = Column(String)
    signal_weight    = Column(Float)
    has_thesis       = Column(Boolean)
    action_taken     = Column(String)
    detected_at      = Column(DateTime, default=datetime.utcnow)

class AgentLog(Base):
    __tablename__ = "agent_logs"
    id              = Column(Integer, primary_key=True, autoincrement=True)
    agent           = Column(String)
    status          = Column(String)
    message         = Column(Text)
    logged_at       = Column(DateTime, default=datetime.utcnow)

class WalletSnapshot(Base):
    __tablename__ = "wallet_snapshots"
    id              = Column(Integer, primary_key=True, autoincrement=True)
    balance         = Column(Float)
    open_pnl        = Column(Float, default=0.0)
    daily_pnl       = Column(Float, default=0.0)
    peak_balance    = Column(Float)
    drawdown_pct    = Column(Float, default=0.0)
    snapshotted_at  = Column(DateTime, default=datetime.utcnow)
class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    agent       = Column(String)
    event_type  = Column(String)
    market      = Column(Text)
    message     = Column(Text)
    detail      = Column(Text)
    logged_at   = Column(DateTime, default=datetime.utcnow)
def init_db(db_path: str):
    engine = create_engine(f"sqlite:///{db_path}", echo=False)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    return Session()

class StrategyInsight(Base):
    __tablename__ = "strategy_insights"
    id            = Column(Integer, primary_key=True)
    analyzed_at   = Column(DateTime, default=datetime.utcnow)
    total_trades  = Column(Integer, default=0)
    win_rate      = Column(Float, default=0)
    summary       = Column(Text)
    recommendations = Column(Text)  # JSON list of recommendation strings
    warnings      = Column(Text)    # JSON list of warning strings
    raw_analysis  = Column(Text)

