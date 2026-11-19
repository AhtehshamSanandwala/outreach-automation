#!/usr/bin/env bash
# ==============================================================================
# install_autostart.sh — Installs KDE mount-aware autostart watcher and desktop icon
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Installing DigiForge Outreach Autostart Watcher..."

# 1. Create ~/.config/autostart if it doesn't exist
mkdir -p "$HOME/.config/autostart"

# 2. Copy the .desktop autostart entry
cp "$SCRIPT_DIR/digiforge-watcher.desktop" "$HOME/.config/autostart/"
chmod +x "$HOME/.config/autostart/digiforge-watcher.desktop"

# 3. Create desktop launcher shortcut (if ~/Desktop exists)
if [ -d "$HOME/Desktop" ]; then
  cat > "$HOME/Desktop/DigiForge Outreach.desktop" << EOF
[Desktop Entry]
Type=Application
Name=DigiForge Outreach
Comment=Launch or inspect DigiForge Outreach Orchestrator
Exec=konsole --workdir "$PROJECT_DIR" -e node orchestrator.js
Icon=network-transmit-receive
Terminal=false
Categories=Network;Development;
EOF
  chmod +x "$HOME/Desktop/DigiForge Outreach.desktop"
  echo "✅ Created Desktop shortcut: ~/Desktop/DigiForge Outreach.desktop"
fi

echo "✅ Autostart watcher installed to ~/.config/autostart/digiforge-watcher.desktop"
echo ""
echo "Whenever you log into KDE, it will quietly wait for your HDD to unlock"
echo "and then automatically start orchestrator.js in the background!"

