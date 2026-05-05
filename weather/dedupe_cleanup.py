"""
Dedupe cleanup for paper_positions.csv.

For each unique (city, target_date, bucket, direction), keep only ONE open
position (the one with largest stake — deepest Kelly, opened earliest when
cash was most available). Close the rest at current market price with
exit_reason = DEDUPE_CLEANUP.

Run this ONCE before deploying the new paper_trader.py. After this, cash
frees up, and the next paper_trader run will open positions on buckets that
previously got skipped due to cash exhaustion.
"""
import os
import csv
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict

DATA = Path("/root/polymarket-bot/weather/data")
POSITIONS_CSV = DATA / "paper_positions.csv"
TRADES_CSV    = DATA / "paper_trades.csv"
BANKROLL_CSV  = DATA / "paper_bankroll.csv"

POSITION_COLUMNS = [
    "position_id", "opened_at", "closed_at",
    "city", "event_slug", "market_slug", "condition_id",
    "target_date", "bucket", "direction",
    "ensemble_prob", "entry_price", "fill_price", "current_price",
    "stake_usd", "shares",
    "unrealized_pnl", "realized_pnl",
    "status", "exit_reason",
    "n_models_agree"
]


def _read_csv(path):
    if not os.path.exists(path):
        return []
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def _write_csv(path, rows, columns):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in columns})


def _append_csv(path, row, columns):
    write_header = not os.path.exists(path)
    with open(path, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns)
        if write_header:
            w.writeheader()
        w.writerow({k: row.get(k, "") for k in columns})


def _fnum(v, default=0.0):
    try:
        return float(v) if v not in (None, "", "None") else default
    except (ValueError, TypeError):
        return default


def main():
    positions = _read_csv(POSITIONS_CSV)
    if not positions:
        print("No paper_positions.csv or empty. Nothing to clean.")
        return

    open_positions  = [p for p in positions if p.get("status") == "OPEN"]
    closed_history  = [p for p in positions if p.get("status") == "CLOSED"]

    print(f"Starting state: {len(open_positions)} open, {len(closed_history)} closed")

    # Group OPEN positions by bucket key
    groups = defaultdict(list)
    for p in open_positions:
        key = (p.get("city"), p.get("target_date"),
               p.get("bucket"), p.get("direction"))
        groups[key].append(p)

    now_iso = datetime.now(timezone.utc).isoformat()
    kept = []
    closed_dupes = []

    for key, bucket_positions in groups.items():
        if len(bucket_positions) == 1:
            kept.extend(bucket_positions)
            continue

        # Sort by stake desc; keep largest, close rest
        bucket_positions.sort(key=lambda p: _fnum(p.get("stake_usd")), reverse=True)
        keeper = bucket_positions[0]
        dupes = bucket_positions[1:]

        print(f"  {key[0]:8s} {key[1]} {key[2]:20s} {key[3]:4s}  "
              f"kept 1 (${_fnum(keeper.get('stake_usd')):.2f}), "
              f"closing {len(dupes)} dupes "
              f"(${sum(_fnum(d.get('stake_usd')) for d in dupes):.2f} total)")

        kept.append(keeper)

        # For each duplicate, mark as CLOSED at current market value
        # realized_pnl = shares * current_price - stake
        for d in dupes:
            shares = _fnum(d.get("shares"))
            current = _fnum(d.get("current_price"))
            stake = _fnum(d.get("stake_usd"))
            realized = round(shares * current - stake, 2)

            d["status"] = "CLOSED"
            d["closed_at"] = now_iso
            d["exit_reason"] = "DEDUPE_CLEANUP"
            d["realized_pnl"] = realized
            d["unrealized_pnl"] = 0.0
            closed_dupes.append(d)

    # Final positions list = kept OPEN + all history (pre-existing closed + new dupes)
    all_closed = closed_history + closed_dupes
    final_all = kept + all_closed

    # Write paper_positions.csv with all rows (open + closed), preserves history
    _write_csv(POSITIONS_CSV, final_all, POSITION_COLUMNS)

    # Append new closures to paper_trades.csv
    for d in closed_dupes:
        _append_csv(TRADES_CSV, d, POSITION_COLUMNS)

    # Compute and log new bankroll snapshot
    total_stake_open = sum(_fnum(p.get("stake_usd")) for p in kept)
    total_realized = sum(_fnum(p.get("realized_pnl")) for p in all_closed)
    cash = 1000.0 + total_realized - total_stake_open
    open_equity = sum(
        _fnum(p.get("shares")) * _fnum(p.get("current_price"))
        for p in kept
    )
    equity = cash + open_equity

    _append_csv(BANKROLL_CSV, {
        "ts": now_iso,
        "cash": round(cash, 2),
        "equity": round(equity, 2),
        "realized_pnl": round(total_realized, 2),
        "open_positions": len(kept),
    }, ["ts", "cash", "equity", "realized_pnl", "open_positions"])

    # Summary
    dupe_pnl = sum(_fnum(d.get("realized_pnl")) for d in closed_dupes)
    print()
    print("=" * 60)
    print(f"DONE.")
    print(f"  Kept open:       {len(kept)}")
    print(f"  Closed as dupes: {len(closed_dupes)}")
    print(f"  Dupe P&L:        ${dupe_pnl:+.2f}")
    print(f"  New cash:        ${cash:,.2f}")
    print(f"  New equity:      ${equity:,.2f}")
    print(f"  Realized total:  ${total_realized:+.2f}")
    print()
    print("Cash is now freed. Run paper_trader.py next to fill skipped signals.")


if __name__ == "__main__":
    main()
