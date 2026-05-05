"""
PolyBot Weather V2 — Scheduler
==============================
Runs scan_v2.py with an adaptive cadence:
  - Every 5 min for 60 min after 00Z, 06Z, 12Z, 18Z model runs
  - Every 60 min otherwise

Deploy as a systemd service, OR just use the crontab below.

CRONTAB version (simpler — put this in `crontab -e`):
  # Aggressive window — every 5 min in first hour after model runs
  */5 0 * * *   cd /opt/polybot && /usr/bin/python3 scan_v2.py >> logs/scan.log 2>&1
  */5 6 * * *   cd /opt/polybot && /usr/bin/python3 scan_v2.py >> logs/scan.log 2>&1
  */5 12 * * *  cd /opt/polybot && /usr/bin/python3 scan_v2.py >> logs/scan.log 2>&1
  */5 18 * * *  cd /opt/polybot && /usr/bin/python3 scan_v2.py >> logs/scan.log 2>&1
  # Normal scan — every 60 min at :30 past every other hour
  30 1-5,7-11,13-17,19-23 * * * cd /opt/polybot && /usr/bin/python3 scan_v2.py >> logs/scan.log 2>&1
  # Daily reconcile at 06:30 UTC
  30 6 * * * cd /opt/polybot && /usr/bin/python3 reconcile_v2.py >> logs/reconcile.log 2>&1
  # Weekly calibration on Sunday 08:00 UTC
  0 8 * * 0 cd /opt/polybot && /usr/bin/python3 calibrate_v2.py >> logs/calibrate.log 2>&1

Or run this as a loop (Python-native scheduler):
  python scheduler.py
"""
import subprocess
import time
from datetime import datetime, timezone

MODEL_RUN_HOURS = [0, 6, 12, 18]

def in_aggressive_window(now):
    return now.hour in MODEL_RUN_HOURS and now.minute < 60

def main():
    print("PolyBot V2 scheduler started. Ctrl+C to stop.")
    last_run = None
    while True:
        now = datetime.now(timezone.utc)
        aggressive = in_aggressive_window(now)
        interval = 5 * 60 if aggressive else 60 * 60  # 5 or 60 min

        # Run scan if enough time has elapsed
        if last_run is None or (now - last_run).total_seconds() >= interval - 5:
            label = "AGGRESSIVE" if aggressive else "normal"
            print(f"[{now.isoformat()}Z] Triggering scan ({label})")
            try:
                subprocess.run(["python3", "scan_v2.py"], timeout=300, check=False)
            except Exception as e:
                print(f"  scan failed: {e}")
            last_run = now

        # Daily reconcile at 06:30 UTC
        if now.hour == 6 and now.minute == 30:
            print(f"[{now.isoformat()}Z] Daily reconcile")
            try:
                subprocess.run(["python3", "reconcile_v2.py"], timeout=300, check=False)
            except Exception as e:
                print(f"  reconcile failed: {e}")

        # Weekly calibration Sunday 08:00 UTC
        if now.weekday() == 6 and now.hour == 8 and now.minute < 5:
            print(f"[{now.isoformat()}Z] Weekly calibration")
            try:
                subprocess.run(["python3", "calibrate_v2.py"], timeout=600, check=False)
            except Exception as e:
                print(f"  calibrate failed: {e}")

        time.sleep(60)  # check every minute

if __name__ == "__main__":
    main()
