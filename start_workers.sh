#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# start_workers.sh — Launch all 7 parallel scraper workers in a tmux grid
# ════════════════════════════════════════════════════════════════════════════

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR" || exit 1

SESSION_NAME="scrapers"

# Kill previous session if running
tmux kill-session -t "$SESSION_NAME" 2>/dev/null

echo "🚀 Starting 7 parallel scraper workers in tmux session: '$SESSION_NAME'..."

# Start worker 1 in a new background session at idle CPU priority (nice -n 19)
tmux new-session -d -s "$SESSION_NAME" -n "workers" "nice -n 19 node run1.js"

# Split panes for workers 2 through 7 and arrange in tiled grid
for i in {2..7}; do
  tmux split-window -t "$SESSION_NAME" "nice -n 19 node run$i.js"
  tmux select-layout -t "$SESSION_NAME" tiled
done

echo "✅ All 7 workers started."
echo "📺 Attaching to tmux session now... (Press 'Ctrl+b' then 'd' to detach and leave running in background)"
echo ""

# Attach to view live output
tmux attach -t "$SESSION_NAME"

