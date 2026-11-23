'use strict';

const { exec } = require('child_process');

/**
 * Universal desktop notification helper for Linux KDE Plasma
 *
 * Sends native Freedesktop D-Bus notifications so that:
 * 1. A clean corner toast appears on the screen (5-6s).
 * 2. It automatically persists in the KDE Notification History (the panel bell icon).
 *    You can click the bell icon in your KDE panel anytime to view the entire timeline!
 * 3. Falls back gracefully to kdialog if gdbus is not present.
 */
function notify(summary, body, options = {}) {
  const safeTitle = (summary || 'DigiForge Outreach').replace(/["`$\\]/g, '');
  const safeBody = (body || '').replace(/["`$\\]/g, '');
  const urgencyByte = options.urgency === 'critical' ? 2 : (options.urgency === 'low' ? 0 : 1);
  const icon = options.icon || (options.urgency === 'critical' ? 'dialog-warning' : 'mail-send');
  const timeoutMs = options.timeoutMs || 6000;

  // 1. Freedesktop standard notification over D-Bus via gdbus
  // Notice: hints dictionary uses transient: <false> and urgency: <byte X>
  // This explicitly instructs KDE Plasma to log and retain the notification in the panel bell history!
  const gdbusCmd = `gdbus call --session \\
    --dest org.freedesktop.Notifications \\
    --object-path /org/freedesktop/Notifications \\
    --method org.freedesktop.Notifications.Notify \\
    "DigiForge Outreach" \\
    0 \\
    "${icon}" \\
    "${safeTitle}" \\
    "${safeBody}" \\
    "[]" \\
    "{'urgency': <byte ${urgencyByte}>, 'transient': <false>, 'desktop-entry': <'digiforge-outreach'>}" \\
    ${timeoutMs} >/dev/null 2>&1`;

  // 2. Fallback: KDE native kdialog
  const kdialogCmd = `kdialog --passivepopup "${safeBody}" ${Math.round(timeoutMs / 1000)} --title "${safeTitle}" >/dev/null 2>&1`;

  exec(gdbusCmd, (err) => {
    if (err) {
      exec(kdialogCmd, () => {});
    }
  });
}

module.exports = { notify };
