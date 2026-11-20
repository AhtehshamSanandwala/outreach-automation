#!/usr/bin/env bash
# ==============================================================================
# service.sh — DigiForge Outreach Service Controller
#
# USAGE:
#   ./service.sh start    -> Starts orchestrator in true background daemon mode
#   ./service.sh stop     -> Gracefully stops background orchestrator & tray icon
#   ./service.sh status   -> Displays live status & recent execution output
#   ./service.sh logs     -> Live-streams log output (Ctrl+C to stop viewing)
#   ./service.sh restart  -> Stops and starts service
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
cd "$PROJECT_DIR" || exit 1

LOCK_FILE="$PROJECT_DIR/form_results/orchestrator.lock"
TRAY_LOCK="$PROJECT_DIR/form_results/tray.lock"
LOG_FILE="$PROJECT_DIR/form_results/orchestrator.log"
STATUS_JSON="$PROJECT_DIR/form_results/status.json"

mkdir -p "$PROJECT_DIR/form_results"

is_orchestrator_running() {
  if [ -f "$LOCK_FILE" ]; then
    local pid
    pid=$(cat "$LOCK_FILE" 2>/dev/null)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
  fi
  return 1
}

start_service() {
  local running_pid
  if running_pid=$(is_orchestrator_running); then
    echo "⚠️ DigiForge Outreach is already running in background (PID: $running_pid)."
    echo "   Check status with: ./service.sh status"
    return 0
  fi

  echo "═══════════════════════════════════════════════════════════════"
  echo "   STARTING DIGIFORGE OUTREACH (TRUE BACKGROUND DAEMON)        "
  echo "═══════════════════════════════════════════════════════════════"

  # Clean stale locks
  rm -f "$LOCK_FILE"

  # 1. Launch orchestrator detached from terminal with systemd inhibitor
  if command -v systemd-inhibit >/dev/null 2>&1; then
    nohup systemd-inhibit \
      --what=shutdown:sleep:idle:handle-lid-switch \
      --who="DigiForge Outreach Automation" \
      --why="Active outreach batch is running in background" \
      --mode=block \
      node orchestrator.js >> "$LOG_FILE" 2>&1 &
    ORCH_PID=$!
  else
    nohup node orchestrator.js >> "$LOG_FILE" 2>&1 &
    ORCH_PID=$!
  fi

  echo "$ORCH_PID" > "$LOCK_FILE"
  echo "✅ Orchestrator launched in background (PID: $ORCH_PID)."
  echo "   Log output: $LOG_FILE"

  # 2. Launch persistent KDE System Tray Indicator if graphical session active
  if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ]; then
    nohup python3 tray_indicator.py >/dev/null 2>&1 &
    TRAY_PID=$!
    echo "$TRAY_PID" > "$TRAY_LOCK"
    echo "✅ KDE System Tray status icon active in panel (PID: $TRAY_PID)."
  fi

  # 3. Corner notification
  if command -v kdialog >/dev/null 2>&1; then
    kdialog --passivepopup "DigiForge Outreach is now running in background.\nTray icon active in panel corner." 7 --title "DigiForge Outreach Started" >/dev/null 2>&1 &
  fi

  echo ""
  echo "💡 You can now SAFELY CLOSE THIS TERMINAL at any time."
  echo "   The script will continue running in the background."
  echo "   Hover over the tray icon in your corner to see live status."
}

stop_service() {
  echo "Stopping DigiForge Outreach Service..."

  # Stop orchestrator via node CLI flag
  node orchestrator.js --stop >/dev/null 2>&1

  local running_pid
  if running_pid=$(is_orchestrator_running); then
    echo "Sending SIGTERM to orchestrator (PID: $running_pid)..."
    kill "$running_pid" 2>/dev/null
    sleep 1
    if kill -0 "$running_pid" 2>/dev/null; then
      kill -9 "$running_pid" 2>/dev/null
    fi
  fi
  rm -f "$LOCK_FILE"

  # Stop tray indicator
  if [ -f "$TRAY_LOCK" ]; then
    local tpid
    tpid=$(cat "$TRAY_LOCK" 2>/dev/null)
    if [ -n "$tpid" ]; then
      kill "$tpid" 2>/dev/null
    fi
    rm -f "$TRAY_LOCK"
  fi
  # Kill any stray tray_indicator.py
  pkill -f "tray_indicator.py" 2>/dev/null

  # Corner notification
  if command -v kdialog >/dev/null 2>&1; then
    kdialog --passivepopup "DigiForge Outreach service stopped cleanly." 5 --title "DigiForge Outreach Stopped" >/dev/null 2>&1 &
  fi

  echo "✅ DigiForge Outreach service and tray icon stopped cleanly."
}

show_status() {
  local running_pid
  if running_pid=$(is_orchestrator_running); then
    echo "🟢 Service Status: RUNNING (PID: $running_pid)"
  else
    echo "🔴 Service Status: STOPPED"
  fi

  node orchestrator.js --status

  echo "──────────────── Recent Log Activity ────────────────"
  if [ -f "$LOG_FILE" ]; then
    tail -n 12 "$LOG_FILE"
  else
    echo "No log file found yet ($LOG_FILE)."
  fi
  echo "──────────────────────────────────────────────────────"
}

show_logs() {
  if [ -f "$LOG_FILE" ]; then
    echo "Streaming live logs (Press Ctrl+C to stop viewing)..."
    tail -f "$LOG_FILE"
  else
    echo "No log file found yet ($LOG_FILE)."
  fi
}

case "$1" in
  start)
    start_service
    ;;
  stop)
    stop_service
    ;;
  restart)
    stop_service
    sleep 2
    start_service
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs
    ;;
  *)
    echo "Usage: ./service.sh {start|stop|restart|status|logs}"
    exit 1
    ;;
esac

