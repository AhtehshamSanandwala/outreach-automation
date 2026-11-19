#!/usr/bin/env bash
# ==============================================================================
# autostart_watcher.sh — Mount-Aware KDE Autostart Watcher for DigiForge Outreach
#
# PURPOSE:
#   Runs automatically on KDE desktop login. Since the project lives on a
#   secondary HDD (/dev/sda1) that requires a user password or manual unlock,
#   this script quietly waits until the drive is mounted before starting.
# ==============================================================================

PROJECT_DIR="/run/media/ahtesham/HDD/Project/DigiForgeScripts/outreach-automation"
LOCK_FILE="$PROJECT_DIR/form_results/orchestrator.lock"
LOG_FILE="$PROJECT_DIR/form_results/orchestrator.log"

echo "[$(date)] DigiForge Watcher started. Waiting for HDD mount at $PROJECT_DIR..."

# Wait until the HDD mount directory exists and is accessible
while [ ! -d "$PROJECT_DIR" ] || [ ! -f "$PROJECT_DIR/orchestrator.js" ]; do
  sleep 10
done

echo "[$(date)] HDD is mounted and accessible!"

# Check if orchestrator is already running via PID lock
if [ -f "$LOCK_FILE" ]; then
  PID=$(cat "$LOCK_FILE" 2>/dev/null)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "[$(date)] Orchestrator is already running (PID: $PID). Nothing to do."
    exit 0
  fi
fi

# Notify user on KDE desktop
if command -v kdialog >/dev/null 2>&1; then
  kdialog --passivepopup "HDD Unlocked! Starting DigiForge Outreach Orchestrator in background..." 7 --title "DigiForge Outreach" >/dev/null 2>&1 &
fi

# Launch orchestrator in background
cd "$PROJECT_DIR" || exit 1
mkdir -p "$PROJECT_DIR/form_results"
nohup node orchestrator.js >> "$LOG_FILE" 2>&1 &
ORCH_PID=$!

echo "[$(date)] Launched orchestrator (PID: $ORCH_PID). Logging to $LOG_FILE."
exit 0

