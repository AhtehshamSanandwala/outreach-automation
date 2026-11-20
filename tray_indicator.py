#!/usr/bin/env python3
"""
tray_indicator.py — Native KDE Plasma Wayland System Tray Status Icon

PURPOSE:
  Implements the standard Freedesktop / KDE StatusNotifierItem (SNI) D-Bus protocol.
  Renders natively in the KDE Plasma panel system tray (corner next to clock/volume)
  on both Wayland and X11 sessions.

  Polls form_results/status.json and form_results/orchestrator.lock every 3 seconds,
  updating tooltip and icon in real time.
"""

import sys
import os
import json
import subprocess
import signal

# Ensure DBus and GLib are available
try:
    import dbus
    import dbus.service
    from dbus.mainloop.glib import DBusGMainLoop
    from gi.repository import GLib
except ImportError as e:
    print(f"Error importing DBus/GLib: {e}", file=sys.stderr)
    sys.exit(1)

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
STATUS_FILE = os.path.join(PROJECT_DIR, "form_results", "status.json")
LOCK_FILE   = os.path.join(PROJECT_DIR, "form_results", "orchestrator.lock")
LOG_FILE    = os.path.join(PROJECT_DIR, "form_results", "orchestrator.log")

class DigiForgeSNI(dbus.service.Object):
    def __init__(self, bus, bus_name):
        super().__init__(bus_name, "/StatusNotifierItem")
        self.bus = bus
        self.bus_name = bus_name
        self.title = "DigiForge Outreach"
        self.status = "Active"
        self.icon_name = "network-transmit-receive"
        self.tooltip_text = "DigiForge Outreach: Initializing..."
        self.last_state = ""

    # ── Signals ───────────────────────────────────────────────────────────────
    @dbus.service.signal("org.kde.StatusNotifierItem")
    def NewTitle(self):
        pass

    @dbus.service.signal("org.kde.StatusNotifierItem")
    def NewIcon(self):
        pass

    @dbus.service.signal("org.kde.StatusNotifierItem")
    def NewToolTip(self):
        pass

    @dbus.service.signal("org.kde.StatusNotifierItem", signature="s")
    def NewStatus(self, status):
        pass

    # ── Properties via org.freedesktop.DBus.Properties ─────────────────────────
    @dbus.service.method("org.freedesktop.DBus.Properties", in_signature="ss", out_signature="v")
    def Get(self, interface_name, property_name):
        return self.GetAll(interface_name).get(property_name, "")

    @dbus.service.method("org.freedesktop.DBus.Properties", in_signature="s", out_signature="a{sv}")
    def GetAll(self, interface_name):
        if interface_name in ("org.kde.StatusNotifierItem", "org.freedesktop.StatusNotifierItem"):
            return {
                "Category": dbus.String("ApplicationStatus"),
                "Id": dbus.String("DigiForgeOutreach"),
                "Title": dbus.String(self.title),
                "Status": dbus.String(self.status),
                "WindowId": dbus.Int32(0),
                "IconName": dbus.String(self.icon_name),
                "IconThemePath": dbus.String(""),
                "AttentionIconName": dbus.String("mail-mark-important"),
                "OverlayIconName": dbus.String(""),
                "AttentionMovieName": dbus.String(""),
                "ItemIsMenu": dbus.Boolean(False),
                "Menu": dbus.ObjectPath("/NO_DBUSMENU"),
                "ToolTip": dbus.Struct((
                    dbus.String(self.icon_name),
                    dbus.Array([], signature="(iiay)"),
                    dbus.String("DigiForge Outreach Automation"),
                    dbus.String(self.tooltip_text)
                ), signature="(sa(iiay)ss)")
            }
        return {}

    # ── Interaction Methods ───────────────────────────────────────────────────
    @dbus.service.method("org.kde.StatusNotifierItem", in_signature="ii")
    def Activate(self, x, y):
        """Triggered on left-click: Show full status dialog."""
        self.show_status_dialog()

    @dbus.service.method("org.kde.StatusNotifierItem", in_signature="ii")
    def SecondaryActivate(self, x, y):
        """Triggered on middle click."""
        self.show_status_dialog()

    @dbus.service.method("org.kde.StatusNotifierItem", in_signature="ii")
    def ContextMenu(self, x, y):
        """Triggered on right-click: Pop up menu."""
        self.show_context_menu()

    @dbus.service.method("org.kde.StatusNotifierItem", in_signature="is")
    def Scroll(self, delta, orientation):
        pass

    # ── Helper Actions ────────────────────────────────────────────────────────
    def load_status_data(self):
        if os.path.exists(STATUS_FILE):
            try:
                with open(STATUS_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return None

    def is_orchestrator_alive(self):
        if os.path.exists(LOCK_FILE):
            try:
                with open(LOCK_FILE, "r") as f:
                    pid = int(f.read().strip())
                os.kill(pid, 0)
                return True, pid
            except Exception:
                return False, None
        return False, None

    def poll_and_update(self):
        alive, pid = self.is_orchestrator_alive()
        status = self.load_status_data()

        changed = False

        if not alive:
            new_status = "Passive"
            new_icon = "media-playback-stop"
            new_tip = "DigiForge Outreach: STOPPED\n(Click to view details or start service)"
        else:
            state = (status.get("state") if status else "running").upper()
            sgt_time = status.get("singapore_time", "") if status else ""
            batches = status.get("today_batches_completed", 0) if status else 0
            max_batches = status.get("max_daily_batches", 3) if status else 3
            msg = status.get("message", "") if status else ""
            inhibiting = status.get("inhibiting_shutdown", False) if status else False

            new_status = "Active"
            if state == "RUNNING":
                new_icon = "mail-send"
            elif state == "COOLDOWN":
                new_icon = "media-playback-pause"
            else:
                new_icon = "network-transmit-receive"

            prot_tag = "🔒 Shutdown Protected" if inhibiting else "☕ Safe to Shutdown"
            new_tip = (
                f"State: {state} | {sgt_time}\n"
                f"Batches Today: {batches}/{max_batches}\n"
                f"{msg}\n"
                f"{prot_tag}"
            )

        if new_tip != self.tooltip_text or new_icon != self.icon_name or new_status != self.status:
            self.tooltip_text = new_tip
            self.icon_name = new_icon
            self.status = new_status
            changed = True

        if changed:
            self.NewToolTip()
            self.NewIcon()
            self.NewStatus(self.status)

        return True  # Keep GLib timeout ticking

    def show_status_dialog(self):
        alive, pid = self.is_orchestrator_alive()
        status = self.load_status_data()
        if not alive:
            body = "DigiForge Outreach Service is currently STOPPED.\n\nStart it using: ./start.sh or the Desktop shortcut."
        else:
            state = (status.get("state") if status else "running").upper()
            sgt_time = status.get("singapore_time", "N/A") if status else "N/A"
            batches = status.get("today_batches_completed", 0) if status else 0
            max_batches = status.get("max_daily_batches", 3) if status else 3
            msg = status.get("message", "Active") if status else "Active"
            inhibiting = "YES (Form submission active)" if status and status.get("inhibiting_shutdown") else "NO (Cooldown / Resting)"

            body = (
                f"═══ DIGIFORGE OUTREACH STATUS ═══\n\n"
                f"• Process State:      {state}\n"
                f"• Background PID:     {pid}\n"
                f"• Singapore Time:     {sgt_time}\n"
                f"• Batches Today:      {batches} / {max_batches} completed\n"
                f"• Current Activity:   {msg}\n"
                f"• Shutdown Inhibited: {inhibiting}\n"
            )

        subprocess.Popen([
            "kdialog", "--msgbox", body, "--title", "DigiForge Outreach Status"
        ])

    def show_context_menu(self):
        alive, pid = self.is_orchestrator_alive()
        # Use kdialog menu
        cmd = [
            "kdialog", "--menu", "DigiForge Outreach Menu",
            "1", "📊 View Full Status",
            "2", "📜 View Live Logs",
            "3", "🛑 Stop Outreach Service",
            "4", "✖ Close Menu"
        ]
        try:
            choice = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL).strip()
            if choice == "1":
                self.show_status_dialog()
            elif choice == "2":
                subprocess.Popen(["konsole", "-e", "tail", "-f", LOG_FILE])
            elif choice == "3":
                stop_script = os.path.join(PROJECT_DIR, "stop.sh")
                subprocess.Popen([stop_script])
        except subprocess.CalledProcessError:
            pass  # User canceled menu


def main():
    DBusGMainLoop(set_as_default=True)
    try:
        bus = dbus.SessionBus()
    except Exception as e:
        print(f"Warning: Session bus not available: {e}", file=sys.stderr)
        return

    pid = os.getpid()
    service_name = f"org.kde.StatusNotifierItem-{pid}-1"

    try:
        bus_name = dbus.service.BusName(service_name, bus)
        item = DigiForgeSNI(bus, bus_name)

        # Register with KDE Plasma StatusNotifierWatcher
        try:
            watcher = bus.get_object("org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher")
            watcher_iface = dbus.Interface(watcher, "org.kde.StatusNotifierWatcher")
            watcher_iface.RegisterStatusNotifierItem(service_name)
        except Exception as e:
            # Fallback registration by object path
            try:
                watcher = bus.get_object("org.freedesktop.StatusNotifierWatcher", "/StatusNotifierWatcher")
                watcher_iface = dbus.Interface(watcher, "org.freedesktop.StatusNotifierWatcher")
                watcher_iface.RegisterStatusNotifierItem(service_name)
            except Exception:
                pass

        # Initial status update
        item.poll_and_update()

        # Tick every 3 seconds
        GLib.timeout_add_seconds(3, item.poll_and_update)

        loop = GLib.MainLoop()
        loop.run()
    except Exception as e:
        print(f"Tray indicator error: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
