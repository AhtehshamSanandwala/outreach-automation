#!/usr/bin/env bash
# Copies desktop shortcuts to ~/Desktop
DESKTOP_DIR="$HOME/Desktop"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$DESKTOP_DIR"
cp "$SCRIPT_DIR/DigiForge-Outreach.desktop" "$DESKTOP_DIR/"
cp "$SCRIPT_DIR/DigiForge-Stop.desktop" "$DESKTOP_DIR/"
chmod +x "$DESKTOP_DIR/DigiForge-Outreach.desktop" "$DESKTOP_DIR/DigiForge-Stop.desktop"

# Mark as trusted on KDE Plasma
if command -v gio >/dev/null 2>&1; then
  gio set "$DESKTOP_DIR/DigiForge-Outreach.desktop" metadata::trusted true 2>/dev/null || true
  gio set "$DESKTOP_DIR/DigiForge-Stop.desktop" metadata::trusted true 2>/dev/null || true
fi

echo "✅ Desktop shortcuts installed to $DESKTOP_DIR"

