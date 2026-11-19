'use strict';

const { exec } = require('child_process');

/**
 * Universal desktop notification helper for Linux (KDE Plasma, GNOME, etc.)
 * Uses kdialog --passivepopup, notify-send, or gdbus without external npm dependencies.
 */
function notify(title, message, timeoutSeconds = 6) {
  // Sanitize message to prevent shell command breakages
  const safeTitle = (title || 'DigiForge Outreach').replace(/["`$\\]/g, '');
  const safeMsg = (message || '').replace(/["`$\\]/g, '');
  const timeoutMs = timeoutSeconds * 1000;

  // 1. Try kdialog (KDE native)
  const kdialogCmd = `kdialog --passivepopup "${safeMsg}" ${timeoutSeconds} --title "${safeTitle}" >/dev/null 2>&1`;

  // 2. Try gdbus (Universal freedesktop D-Bus standard)
  const gdbusCmd = `gdbus call --session --dest org.freedesktop.Notifications --object-path /org/freedesktop/Notifications --method org.freedesktop.Notifications.Notify "DigiForge" 0 "" "${safeTitle}" "${safeMsg}" "[]" "{}" ${timeoutMs} >/dev/null 2>&1`;

  // Try KDE kdialog first, then gdbus fallback
  exec(kdialogCmd, (err) => {
    if (err) {
      exec(gdbusCmd, () => {});
    }
  });
}

module.exports = { notify };

