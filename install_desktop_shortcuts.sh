#!/usr/bin/env bash
# Installs all 4 DigiForge shortcuts to ~/.local/share/applications (GNOME All Apps)
# and ~/Desktop (Desktop icons).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$HOME/Desktop"
APPS_DIR="$HOME/.local/share/applications"

FILES=(
  "DigiForge-Outreach.desktop"
  "DigiForge-Stop.desktop"
  "DigiForge-Scraper-Start.desktop"
  "DigiForge-Scraper-Stop.desktop"
)

mkdir -p "$DESKTOP_DIR" "$APPS_DIR"

for f in "${FILES[@]}"; do
  cp "$SCRIPT_DIR/$f" "$APPS_DIR/"
  cp "$SCRIPT_DIR/$f" "$DESKTOP_DIR/"
  chmod +x "$APPS_DIR/$f" "$DESKTOP_DIR/$f"
  if command -v gio >/dev/null 2>&1; then
    gio set "$DESKTOP_DIR/$f" metadata::trusted true 2>/dev/null || true
  fi
done

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" 2>/dev/null || true
fi

echo "✅ Installed 4 shortcuts to:"
echo "   • GNOME All Apps: $APPS_DIR"
echo "   • Desktop:        $DESKTOP_DIR"
