#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# scraper_service.sh — Background manager for unified_scraper.js
# ════════════════════════════════════════════════════════════════════════════

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR" || exit 1

PID_FILE="$PROJECT_DIR/scraper.pid"
LOG_FILE="$PROJECT_DIR/form_results/scraper.log"
mkdir -p "$PROJECT_DIR/form_results"

notify_desktop() {
  [ "${SCRAPER_SILENT:-0}" = "1" ] && return 0
  local title="$1"
  local body="$2"
  local icon="${3:-system-search}"
  if command -v node >/dev/null 2>&1 && [ -f "$PROJECT_DIR/notifier.js" ]; then
    node -e "require('$PROJECT_DIR/notifier.js').notify(process.argv[1], process.argv[2], { appName: 'DigiForge Scraper', desktopEntry: 'digiforge-scraper-start', icon: process.argv[3] });" "$title" "$body" "$icon" 2>/dev/null || true
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send -i "$icon" "$title" "$body" 2>/dev/null || true
  fi
}

get_running_pid() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
  fi
  pgrep -f "node unified_scraper.js" | head -n 1
}

case "${1:-status}" in
  start)
    EXISTING_PID=$(get_running_pid)
    if [ -n "$EXISTING_PID" ]; then
      echo "⚠️  Scraper is already running (PID: $EXISTING_PID)."
      notify_desktop "DigiForge Scraper" "Already running (PID: $EXISTING_PID)"
      exit 0
    fi

    echo "🗺️  Starting DigiForge Google Maps Scraper in background..."
    nohup node "$PROJECT_DIR/unified_scraper.js" >> "$LOG_FILE" 2>&1 < /dev/null &
    NEW_PID=$!
    echo "$NEW_PID" > "$PID_FILE"
    sleep 1

    if kill -0 "$NEW_PID" 2>/dev/null; then
      echo "✅ Scraper started (PID: $NEW_PID)"
      echo "📄 Log: $LOG_FILE"
      notify_desktop "🗺️ DigiForge: Scraper Started" "Google Maps scraper running in background (PID: $NEW_PID)." "system-search"
    else
      echo "❌ Failed to start scraper. Check $LOG_FILE"
      rm -f "$PID_FILE"
      notify_desktop "⚠️ DigiForge: Scraper Failed" "Failed to start scraper. Check form_results/scraper.log." "dialog-warning"
      exit 1
    fi
    ;;

  stop)
    echo "🛑 Stopping DigiForge Google Maps Scraper..."
    PIDS=$(pgrep -f "unified_scraper.js" || true)
    if [ -f "$PID_FILE" ]; then
      FPID=$(cat "$PID_FILE" 2>/dev/null | tr -d '[:space:]')
      [ -n "$FPID" ] && PIDS="$PIDS $FPID"
    fi

    STOPPED=0
    for pid in $(echo "$PIDS" | tr ' ' '\n' | sort -u | grep -E '^[0-9]+$'); do
      if kill -0 "$pid" 2>/dev/null; then
        # Kill child headless chrome processes owned by this scraper first
        pkill -TERM -P "$pid" 2>/dev/null || true
        kill -TERM "$pid" 2>/dev/null || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
          pkill -KILL -P "$pid" 2>/dev/null || true
          kill -KILL "$pid" 2>/dev/null || true
        fi
        STOPPED=1
      fi
    done

    rm -f "$PID_FILE"
    if [ "$STOPPED" -eq 1 ]; then
      echo "✅ Scraper stopped cleanly."
      notify_desktop "🛑 DigiForge: Scraper Stopped" "Google Maps scraper stopped cleanly. Progress saved." "process-stop"
    else
      echo "ℹ️  Scraper was not running."
      notify_desktop "ℹ️ DigiForge: Scraper" "Scraper was not running." "dialog-information"
    fi
    ;;

  status)
    PID=$(get_running_pid)
    if [ -n "$PID" ]; then
      echo "🟢 DIGIFORGE SCRAPER: RUNNING (PID: $PID)"
      echo "📄 Log: $LOG_FILE"
      [ -f "$LOG_FILE" ] && tail -n 10 "$LOG_FILE"
    else
      echo "🔴 DIGIFORGE SCRAPER: STOPPED"
    fi
    ;;

  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac

