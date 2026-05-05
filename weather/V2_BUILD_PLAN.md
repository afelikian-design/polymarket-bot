# PolyBot Weather V2 — Upgrade Build Plan

**Upgrade from V1 (1-3% monthly) → V2 (3-6% monthly) by stacking four edges**

---

## What's new

| # | Edge | Source | Implementation |
|---|---|---|---|
| 1 | 31-member GFS ensemble | Open-Meteo ensemble API (free) | scan_v2.py uses member-count probability, not Monte Carlo |
| 2 | Post-model-run timing | 00Z / 06Z / 12Z / 18Z runs | scheduler.py or crontab, 5-min cadence in model-run hour |
| 3 | NO-side tail fades | PolyWeatherBot strategy | scan_v2.py dual-direction scan |
| 4 | Multi-model agreement filter | Hagedorn 2008 (academic) | scan_v2.py requires 3+ models agree before trading |

## Why these specifically

**Edge 1 — ensemble probability:** V1 ran a Monte Carlo with an assumed sigma on a single point forecast. V2 pulls 31 independent model integrations with perturbed initial conditions. The probability is literally "how many of the 31 members landed in this bucket." No distributional assumption. The suislanchez GitHub bot uses exactly this approach and it's the core of the live bots on the leaderboard.

**Edge 2 — timing:** GFS runs at 00/06/12/18Z. ECMWF at 00/12Z. When a new run shifts temp forecasts by 2°F+, retail hasn't seen it yet. The window where mispricings are freshest is the first 30-60 min after a model run. Latency isn't milliseconds here — it's minutes. A 5-min scan cadence during these windows captures the dislocation. Rest of the day, 60-min scan is fine.

**Edge 3 — NO-side fades:** When market prices a bucket at 10¢ but 0 of 31 members agree, NO at 90¢ is high-probability profit. Small win per trade but ~95% win rate. Balances the YES laddering (low win rate, big payoff) for a smoother equity curve and lower drawdown.

**Edge 4 — agreement filter:** Hagedorn 2008 showed calibrated multi-model forecasts beat any single model. We require 3+ of {GFS, ECMWF, ICON, best_match} to point within 2°F of a bucket's center before trading it. Cuts trade count ~30% but lifts win rate meaningfully.

## New files

```
polybot_v2/
  calibrate_v2.py   # Multi-model ensemble calibration, per-city tight/wide sigma
  scan_v2.py        # 31-member ensemble + dual-direction + agreement filter
  reconcile_v2.py   # Handles YES and NO, calibration table by direction
  scheduler.py      # Adaptive cadence (5-min in model-run windows, 60-min otherwise)
```

## Deploy sequence

### Step 1: Drop files into repo
```bash
cd ~/polybot  # your existing Hetzner dir
git checkout -b v2-ensemble
cp /path/to/downloads/*.py .
mkdir -p data logs
```

### Step 2: Install (nothing new needed)
Same dependencies as V1: `requests`, `pandas`, `numpy`. Already installed.

### Step 3: Recalibrate with ensemble data
```bash
python3 calibrate_v2.py
```
This takes 2-3 minutes. Output will show you:
- **`sigma_tight`**: error std on days when models agreed (narrow spread)
- **`sigma_wide`**: error std on days when models disagreed
- The ratio tells you how much the agreement filter buys you

Expect `sigma_tight` ~20-40% lower than `sigma_wide`. That delta is your edge.

### Step 4: Test scan end-to-end
```bash
python3 scan_v2.py
```
First run will be slower (pulls ensemble for each market). Expect 1-3 minutes. Output shows YES and NO candidates separately, ranked by edge.

Verify:
- Ensemble probabilities look sane (not all 0 or 1)
- `n_members` column shows 25-31 for most markets
- `n_models_agree` column shows 3-4 for most markets you'd trade
- YES and NO candidates are in separate groups

### Step 5: Set up scheduling

**Option A — crontab (simpler):**
```bash
crontab -e
```
Paste the schedule from the comment block at the top of scheduler.py.

**Option B — Python scheduler (if you prefer):**
```bash
python3 scheduler.py  # or wrap with systemd
```

### Step 6: Wire into existing PolyBot paper-execution
Each row in `data/signals.csv` becomes a paper buy. Use the `direction` column to know YES vs. NO. Position amount is the `kelly_size_$` column. Exit logic remains "close at resolution" — same as V1.

### Step 7: Dashboard additions
Add three charts to feliksbot.netlify.app weather tab:
1. **Calibration curve**: x = ensemble_prob bin, y = observed bucket_hit rate (should be diagonal if calibrated)
2. **YES vs. NO equity curves**: two lines, should both trend up
3. **Aggressive window lift**: bar chart of ROI during model-run windows vs. normal hours

---

## Expected performance lift

| Metric | V1 | V2 (paper target) |
|---|---|---|
| Trades/day | 8-15 | 12-20 (NO trades add volume) |
| YES win rate | ~50% | ~55% (agreement filter + ensemble) |
| NO win rate | n/a | ~90% (fading <5% ensemble probs) |
| Avg edge per trade | 5-7pp | 8-12pp |
| Monthly ROI | 1-3% | **3-6%** |
| Max drawdown | 15-20% | 10-15% (NO-side smoothing) |

## Deployment gates (unchanged, still the gate for real capital)

Do not deploy real capital until ALL of these pass on V2 paper data:

1. 50+ resolved trades (YES and NO combined)
2. YES calibration table within ±5pp at every probability bin
3. NO win rate ≥ 80% (if below, the fade strategy isn't actually high-conviction)
4. Positive ROI after a 2% slippage haircut
5. 4+ weeks of elapsed data
6. Positive ROI in 3 of 4 cities

## Risk notes specific to V2

**Ensemble API rate limits.** Open-Meteo is free but has soft rate limits. One call per market per scan = ~20 calls/scan. In aggressive windows (5-min cadence × 4 hours × 20 calls) you'll make ~240 calls/hour. Well within Open-Meteo's 10K/day limit, but monitor.

**NO-side variance.** A 90% win rate sounds safe but the losses are 9x the wins. One bad day can erase a week of small wins. Position sizing is already set at quarter-Kelly which accounts for this, but don't be surprised by -5% days even on a winning strategy.

**Model run timing risk.** Most of your scans now cluster around four hours of the day. If Open-Meteo has an outage during a 12Z window, you miss the freshest mispricings. Consider running a backup forecast source (NOAA NWS API) as failover for critical windows.

---

## Rollback plan

If V2 underperforms V1 in first 2 weeks of paper:
1. Compare calibration tables — is ensemble_prob actually better than Monte Carlo prob?
2. Check NO-side win rate specifically — if below 80%, disable NO direction
3. Check aggressive_window lift — if negative, revert to simple 60-min cadence

V1 scripts remain in place as `calibrate.py`, `scan.py`, `reconcile.py`. V2 files are suffixed `_v2.py` so both can coexist during comparison testing.
