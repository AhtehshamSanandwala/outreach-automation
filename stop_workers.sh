#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# stop_workers.sh — Stop all scraper workers and kill the tmux session
# ════════════════════════════════════════════════════════════════════════════

SESSION_NAME="scrapers"

tmux kill-session -t "$SESSION_NAME" 2>/dev/null
pkill -f "unified_scraper.js" 2>/dev/null

echo "🛑 All scraper workers stopped and tmux session '$SESSION_NAME' terminated."

