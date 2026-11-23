#!/usr/bin/env bash
# ==============================================================================
# service.sh — DigiForge Outreach Service Controller
#
# USAGE:
#   ./service.sh start    -> Starts orchestrator in true background daemon mode
#   ./service.sh stop     -> Stops ALL background processes cleanly (no ghost PIDs)
#   ./service.sh status   -> Displays live status, PIDs, and milestone activity
#   ./service.sh logs     -> Live-streams log output (Ctrl+C to exit viewing)
#   ./service.sh restart  -> Full clean stop + start
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
cd "$PROJECT_DIR" || exit 1

LOCK_FILE="$PROJECT_DIR/form_results/orchestrator.lock"
LOG_FILE="$PROJECT_DIR/form_results/orchestrator.log"
STATUS_JSON="$PROJECT_DIR/form_results/status.json"

mkdir -p "$PROJECT_DIR/form_results"

# Returns list of running orchestrator PIDs (excluding self)
get_orchestrator_pids() {
  local pids=""
  # 1. Check lockfile first
  if [ -f "$LOCK_FILE" ]; then
    local lpid
    lpid=$(cat "$LOCK_FILE" 2>/dev/null | tr -d '[:space:]')
    if [ -n "$lpid" ] && kill -0 "$lpid" 2>/dev/null; then
      pids="$lpid"
    fi
  fi
  # 2. Also check pgrep
  local pgrep_pids
  pgrep_pids=$(pgrep -f "node.*orchestrator\.js" 2>/dev/null | grep -v "$$" || true)
  if [ -n "$pgrep_pids" ]; then
    pids=$(echo -e "${pids}\n${pgrep_pids}" | grep -v "^$" | sort -u | tr '\n' ' ' | xargs)
  fi
  echo "$pids"
}

# Returns list of all outreach worker PIDs (orchestrator, main.js, inhibitors)
get_all_outreach_pids() {
  {
    pgrep -f "node.*orchestrator\.js" || true
    pgrep -f "node.*main\.js" || true
    pgrep -f "systemd-inhibit.*DigiForge" || true
    pgrep -f "tray_indicator\.py" || true
  } | grep -v "$$" | sort -u
}

start_service() {
  local running_pids
  running_pids=$(get_orchestrator_pids)

  if [ -n "$running_pids" ]; then
    echo "⚠️ DigiForge Outreach is ALREADY RUNNING in background (PID: $running_pids)."
    echo "   • Check live status:  npm run status   (or ./status.sh)"
    echo "   • Stop all processes: npm stop         (or ./stop.sh)"
    return 0
  fi

  echo "═══════════════════════════════════════════════════════════════"
  echo "   STARTING DIGIFORGE OUTREACH (AUTONOMOUS BACKGROUND DAEMON)  "
  echo "═══════════════════════════════════════════════════════════════"

  # Clean stale lock files
  rm -f "$LOCK_FILE" "$PROJECT_DIR/form_results/tray.lock"

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🚀 Launching background orchestrator daemon..." >> "$LOG_FILE"

  # Launch orchestrator directly detached from terminal with nohup
  nohup node orchestrator.js >> "$LOG_FILE" 2>&1 &
  ORCH_PID=$!

  echo "$ORCH_PID" > "$LOCK_FILE"

  # Give it a second to initialize
  sleep 1

  if kill -0 "$ORCH_PID" 2>/dev/null; then
    echo "✅ Orchestrator started in background (PID: $ORCH_PID)."
    echo "   • Operating Hours: 08:00 – 20:00 SGT (Mon–Fri)"
    echo "   • Notifications:   Logged to KDE Notification History (Bell Icon)"
    echo "   • Log Output:      form_results/orchestrator.log"
    echo ""
    echo "💡 You can now SAFELY CLOSE THIS TERMINAL at any time."
    echo "   The script will continue running autonomously until PC shutdown."
  else
    echo "❌ Failed to start orchestrator. Check log:"
    tail -n 15 "$LOG_FILE"
    exit 1
  fi
}

stop_service() {
  echo "═══════════════════════════════════════════════════════════════"
  echo "   STOPPING ALL DIGIFORGE OUTREACH PROCESSES                  "
  echo "═══════════════════════════════════════════════════════════════"

  # 1. Ask orchestrator to stop gracefully first if lock exists
  if [ -f "$LOCK_FILE" ]; then
    node orchestrator.js --stop >/dev/null 2>&1 || true
  fi

  local pids
  pids=$(get_all_outreach_pids)

  if [ -z "$pids" ]; then
    echo "ℹ️ No running DigiForge outreach processes found."
    rm -f "$LOCK_FILE" "$PROJECT_DIR/form_results/tray.lock"
    return 0
  fi

  echo "Found running outreach process(es): $pids"
  echo "Sending graceful SIGTERM..."

  for pid in $pids; do
    kill -15 "$pid" 2>/dev/null || true
  done

  # Wait up to 3 seconds for clean exit
  local waited=0
  while [ $waited -lt 3 ]; do
    sleep 1
    waited=$((waited + 1))
    pids=$(get_all_outreach_pids)
    if [ -z "$pids" ]; then
      break
    fi
  done

  # Force kill any stubborn survivors
  pids=$(get_all_outreach_pids)
  if [ -n "$pids" ]; then
    echo "Force terminating stubborn process(es): $pids"
    for pid in $pids; do
      kill -9 "$pid" 2>/dev/null || true
    done
  fi

  # Clean locks
  rm -f "$LOCK_FILE" "$PROJECT_DIR/form_results/tray.lock"

  # Update status.json to reflect clean stop
  if [ -f "$STATUS_JSON" ]; then
    node -e '
      try {
        const fs = require("fs");
        const path = "'"$STATUS_JSON"'";
        const d = JSON.parse(fs.readFileSync(path, "utf8"));
        d.state = "stopped";
        d.message = "All outreach processes stopped cleanly";
        d.last_updated = new Date().toISOString();
        fs.writeFileSync(path, JSON.stringify(d, null, 2));
      } catch (_) {}
    ' 2>/dev/null || true
  fi

  # Notification
  if command -v kdialog >/dev/null 2>&1; then
    kdialog --passivepopup "All DigiForge background outreach processes stopped cleanly." 5 --title "🛑 DigiForge: Service Stopped" >/dev/null 2>&1 &
  fi

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🛑 All outreach processes stopped cleanly. Zero lingering PIDs." >> "$LOG_FILE"

  echo "✅ All DigiForge outreach processes stopped cleanly. Zero lingering PIDs."
}

show_status() {
  local orch_pids worker_pids
  orch_pids=$(get_orchestrator_pids)
  worker_pids=$(pgrep -f "node.*main\.js" | grep -v "$$" || true)

  echo "═══════════════════════════════════════════════════════════════"
  if [ -n "$orch_pids" ]; then
    echo "   🟢 DIGIFORGE OUTREACH SERVICE: RUNNING                      "
    echo "═══════════════════════════════════════════════════════════════"
    echo "• Supervisor PID:    $orch_pids"
    if [ -n "$worker_pids" ]; then
      echo "• Batch Worker PID:  $worker_pids (actively submitting forms)"
    else
      echo "• Batch Worker PID:  None (currently resting in cooldown break)"
    fi
  else
    echo "   🔴 DIGIFORGE OUTREACH SERVICE: STOPPED                      "
    echo "═══════════════════════════════════════════════════════════════"
    echo "• Active Processes:  0 (No outreach processes running)"
  fi

  # Print structured metrics from orchestrator
  node orchestrator.js --status

  echo "──────────────── Recent Log Activity ────────────────"
  if [ -f "$LOG_FILE" ]; then
    tail -n 10 "$LOG_FILE"
  else
    echo "No log file found yet ($LOG_FILE)."
  fi
  echo "──────────────────────────────────────────────────────"
  echo "💡 Tip: Check your KDE Panel Bell Icon for notification history."
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
    sleep 1
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
