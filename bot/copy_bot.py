import requests
import logging
from datetime import datetime
from database import AgentLog, ActivityLog, Position, Trade

logger = logging.getLogger('copy_bot')

WALLETS = [
    {'address': '0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1', 'name': 'debased',      'win_rate': 0.74, 'signal_weight': 1.0},
    {'address': '0x6bab41a0dc40d6dd4c1a915b8c01969479fd1292', 'name': 'Dropper',      'win_rate': 0.72, 'signal_weight': 1.0},
    {'address': '0x000d257d2dc7616feaef4ae0f14600fdf50a758e', 'name': 'scottilicious', 'win_rate': 0.82, 'signal_weight': 1.0},
    {'address': '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', 'name': 'Big.Chungus',  'win_rate': 0.70, 'signal_weight': 1.0},
    {'address': '0xd5ccdf772f795547e299de57f47966e24de8dea4', 'name': 'tsybka',        'win_rate': 0.86, 'signal_weight': 0.75},
    {'address': '0x751a2b86cab503496efd325c8344e10159349ea1', 'name': 'Sharky6999',   'win_rate': 0.98, 'signal_weight': 0.75},
    {'address': '0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397', 'name': 'aviato',       'win_rate': 0.91, 'signal_weight': 0.75},
    {'address': '0x011f2d377e56119fb09196dffb0948ae55711122', 'name': '11122',         'win_rate': 0.63, 'signal_weight': 0.5},
]

import json, os
_KP_FILE = '/root/polymarket-bot/bot/known_positions.json'

def _load_kp():
    try:
        if os.path.exists(_KP_FILE):
            raw = json.load(open(_KP_FILE))
            return {k: set(v) for k,v in raw.items()}
    except Exception:
        pass
    return {}

def _save_kp(kp):
    try:
        json.dump({k: list(v) for k,v in kp.items()}, open(_KP_FILE,'w'))
    except Exception:
        pass

known_positions = _load_kp()

def log_agent(db, status, message):
    entry = AgentLog(agent='copy_bot', status=status, message=message)
    db.add(entry)
    db.commit()

def log_activity(db, event_type, message, market=None, detail=None):
    entry = ActivityLog(
        agent='copy_bot',
        event_type=event_type,
        market=market[:80] if market else None,
        message=message,
        detail=detail,
    )
    db.add(entry)
    db.commit()

def get_wallet_positions(address):
    try:
        r = requests.get(
            'https://data-api.polymarket.com/positions',
            params={'user': address, 'sizeThreshold': 10, 'limit': 50},
            timeout=10
        )
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        logger.debug('Failed to fetch {}: {}'.format(address, e))
    return []

def get_market_price(condition_id):
    try:
        r = requests.get(
            'https://clob.polymarket.com/markets/{}'.format(condition_id),
            timeout=8
        )
        if r.status_code == 200:
            tokens = r.json().get('tokens', [])
            if tokens:
                return round(float(tokens[0].get('price', 0.5)), 4)
    except Exception:
        pass
    return 0.5

def run_copy_bot(db, portfolio):
    global known_positions
    log_agent(db, 'running', 'Scanning {} wallets for new positions...'.format(len(WALLETS)))
    new_signals = 0

    for wallet in WALLETS:
        address = wallet['address']
        name = wallet['name']
        weight = wallet['signal_weight']

        positions = get_wallet_positions(address)
        if not positions:
            continue

        current_ids = set()
        for p in positions:
            cid = p.get('conditionId')
            if not cid:
                mkt = p.get('market', {})
                cid = mkt.get('conditionId') if mkt else None
            if cid:
                current_ids.add(cid)

        prev_ids = known_positions.get(address, set())
        new_ids = current_ids - prev_ids
        known_positions[address] = current_ids
        _save_kp(known_positions)

        if not prev_ids:
            log_activity(db, 'SCANNING',
                '{} - learned {} existing positions'.format(name, len(current_ids)))
            continue

        if not new_ids:
            continue

        for p in positions:
            cid = p.get('conditionId')
            if not cid:
                mkt = p.get('market', {})
                cid = mkt.get('conditionId') if mkt else None
            if not cid or cid not in new_ids:
                continue

            question = p.get('title') or p.get('question', 'Unknown market')
            size = float(p.get('currentValue') or p.get('size') or 0)
            if size < 50:
                continue  # Only copy trades >$50

            price = get_market_price(cid)
            existing = db.query(Position).filter_by(id='COPY-' + cid, status='OPEN').first()
            if existing:
                continue

            balance = portfolio.get_balance()
            copy_size = round(balance * 0.03 * weight, 2)
            if copy_size < 10:
                continue

            position = Position(
                id='COPY-' + cid,
                question='[COPY:{}] {}'.format(name, question[:60]),
                entry_price=price,
                current_price=price,
                size_usd=copy_size,
                our_probability=wallet['win_rate'],
                expected_gap=0.1,
                kelly_fraction=0.03,
                thesis='Copying {} ({}% win rate, {}x weight)'.format(
                    name, round(wallet['win_rate']*100), weight),
                status='OPEN',
                category='COPY'
            )
            db.merge(position)
            trade = Trade(
                condition_id='COPY-' + cid,
                side='BUY',
                price=price,
                size=copy_size,
                order_id='COPY-{}-{}'.format(name, cid[:8]),
                paper=True
            )
            db.add(trade)
            db.commit()
            new_signals += 1

            log_activity(db, 'TRADE',
                '[COPY] {} entered - paper trading ${:.0f} @ {:.3f}'.format(name, copy_size, price),
                market=question[:80],
                detail='Whale: {} | Win rate: {}% | Weight: {}x | Size: ${:.0f}'.format(
                    name, round(wallet['win_rate']*100), weight, size))

    log_agent(db, 'idle',
        'Copy scan: {} new signals from {} wallets'.format(new_signals, len(WALLETS)))
