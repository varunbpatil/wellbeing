import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";

// Extension States
const State = {
  RUNNING: "running", // In user mode, timers and UI active
  SUSPENDED: "suspended", // In non-user mode (lock screen), everything destroyed
};

const WellbeingIndicator = GObject.registerClass(
  class WellbeingIndicator extends PanelMenu.Button {
    _init(extension) {
      super._init(0.0, "Wellbeing");

      this._extension = extension;
      this._settings = extension.getSettings();

      // Initialize state based on current session mode (user vs lock screen)
      this._state =
        Main.sessionMode.currentMode === "user"
          ? State.RUNNING
          : State.SUSPENDED;

      // Core state variables
      this._enabled = false; // Whether the extension is enabled by user

      // Timer IDs (0 means no timer active)
      this._timer = 0; // Main break interval timer
      this._breakTimer = 0; // Break duration timer
      this._countdownTimer = 0; // UI countdown timer
      this._snoozeTimer = 0; // Snooze delay timer

      // UI elements
      this._overlay = null; // Full-screen break overlay
      this._countdownLabel = null; // Countdown display
      this._grab = null; // Input grab for overlay
      this._keyEventId = null; // Keyboard event handler ID
      this._unredirectDisabled = false; // Track if we disabled unredirect

      // Create status area icon
      this._icon = new St.Icon({
        icon_name: "org.gnome.Settings-wellbeing-symbolic",
        style_class: "system-status-icon",
      });
      this.add_child(this._icon);

      // Set up menu and settings
      this._createMenu();

      // Monitor session mode changes (user mode vs lock screen)
      this._sessionModeId = Main.sessionMode.connect("updated", () => {
        this._onSessionModeChanged();
      });

      // Initialize based on current session mode
      this._onSessionModeChanged();
    }

    _createMenu() {
      // Create toggle switch for enabling/disabling the extension
      this._toggleItem = new PopupMenu.PopupSwitchMenuItem(_("Enabled"), false);

      // Update settings when toggle is changed
      this._toggleItem.connect("toggled", (item) => {
        this._settings.set_boolean("enabled", item.state);
      });

      // Override activate to prevent menu from closing when toggled
      this._toggleItem.activate = function (event) {
        this.toggle();
      };

      this.menu.addMenuItem(this._toggleItem);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // Add preferences menu item
      let prefsItem = new PopupMenu.PopupMenuItem(_("Preferences"));
      prefsItem.connect("activate", () => {
        this._extension.openPreferences();
      });
      this.menu.addMenuItem(prefsItem);

      // Listen for settings changes and update state accordingly
      this._settings.connect("changed::enabled", () => {
        this._enabled = this._settings.get_boolean("enabled");
        this._toggleItem.setToggleState(this._enabled);
        this._updateIconState();

        // Start or stop timer based on new enabled state
        if (this._state === State.RUNNING) {
          this._updateTimer();
        }
      });

      // Listen for break-related setting changes and restart timers with new values
      this._settings.connect("changed::break-interval", () => {
        if (this._state === State.RUNNING) {
          this._updateTimer();
        }
      });

      this._settings.connect("changed::break-duration", () => {
        // If currently in a break, restart it with new duration
        if (this._state === State.RUNNING && this._overlay) {
          this._destroyBreakTimers();
          this._destroyOverlay();
          this._startBreak();
        }
      });

      this._settings.connect("changed::snooze-duration", () => {
        // Snooze duration change doesn't need immediate action
        // Will be used next time snooze is triggered
      });

      // Initialize enabled state from settings
      this._enabled = this._settings.get_boolean("enabled");
      this._toggleItem.setToggleState(this._enabled);
      this._updateIconState();
    }

    _onSessionModeChanged() {
      const isUserMode = Main.sessionMode.currentMode === "user";

      // Handle transitions between user mode and lock screen
      if (isUserMode && this._state === State.SUSPENDED) {
        // Resuming from lock screen - start fresh
        this._resume();
      } else if (!isUserMode && this._state === State.RUNNING) {
        // Going to lock screen - suspend everything
        this._suspend();
      } else if (
        isUserMode &&
        this._state === State.RUNNING &&
        this._enabled &&
        this._timer === 0
      ) {
        // Initial load case - start timer if enabled but no timer running
        this._startTimer();
      }
    }

    _suspend() {
      if (this._state === State.SUSPENDED) return;

      // Clean slate approach: destroy everything without saving state
      this._destroyAllTimers();
      this._destroyOverlay();
      this._state = State.SUSPENDED;
    }

    _resume() {
      if (this._state === State.RUNNING) return;

      // Resume with fresh state
      this._state = State.RUNNING;
      this._updateIconState();

      // Start new timer if extension is enabled
      if (this._enabled) {
        this._startTimer();
      }
    }

    _updateIconState() {
      // Visual feedback: full opacity when enabled, dimmed when disabled
      if (this._enabled) {
        this._icon.set_opacity(255);
      } else {
        this._icon.set_opacity(128);
      }
    }

    _updateTimer() {
      // Called when enabled setting changes
      if (this._state !== State.RUNNING) return;

      this._destroyTimer();

      if (this._enabled) {
        this._startTimer();
      }
    }

    _startTimer() {
      // Only start timer if we're running and enabled
      if (this._state !== State.RUNNING || !this._enabled) {
        return;
      }

      // Destroy any existing timer to prevent duplicates
      this._destroyTimer();

      const interval = this._settings.get_int("break-interval");

      // Start main break interval timer
      this._timer = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        interval,
        () => {
          this._timer = 0; // Clear timer ID when it fires
          this._startBreak();
          return GLib.SOURCE_REMOVE;
        }
      );
    }

    _startBreak() {
      // Safety check before starting break
      if (this._state !== State.RUNNING || !this._enabled || this._overlay) {
        return;
      }

      const duration = this._settings.get_int("break-duration");
      this._remainingSeconds = duration;

      // Create the full-screen break overlay
      this._createOverlay();

      // Update countdown display every second
      this._countdownTimer = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        1,
        () => {
          // Safety check - ensure we're still in a valid break state
          if (this._state !== State.RUNNING || !this._enabled || !this._overlay) {
            return GLib.SOURCE_REMOVE;
          }

          this._remainingSeconds--;
          if (this._countdownLabel) {
            this._countdownLabel.set_text(
              this._formatTime(this._remainingSeconds)
            );
          }

          if (this._remainingSeconds <= 0) {
            this._endBreak();
            return GLib.SOURCE_REMOVE;
          }
          return GLib.SOURCE_CONTINUE;
        }
      );

      // Backup timer to ensure break ends even if countdown fails
      this._breakTimer = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        duration,
        () => {
          this._endBreak();
          return GLib.SOURCE_REMOVE;
        }
      );
    }

    _createOverlay() {
      // Don't create overlay if already exists or not running
      if (this._state !== State.RUNNING || this._overlay) return;

      // Create full-screen overlay widget
      this._overlay = new St.Widget({
        style_class: "wellbeing-overlay",
        reactive: true,
        can_focus: true,
        track_hover: true,
        layout_manager: new Clutter.BinLayout(),
      });

      // FULLSCREEN VIDEO FIX: Prevent layout manager errors
      // When added to top_window_group, layout manager expects meta_window property
      // Setting to null prevents "can't access property get_window_type" errors
      this._overlay.meta_window = null;

      // Vertical container for all content
      const contentBox = new St.BoxLayout({
        vertical: true,
        style_class: "wellbeing-content-box",
      });

      // Main break message
      const label = new St.Label({
        text: _("Time to hydrate, stretch, or take a quick walk."),
        style_class: "wellbeing-overlay-text",
      });

      // Countdown timer display
      this._countdownLabel = new St.Label({
        text: this._formatTime(this._remainingSeconds),
        style_class: "wellbeing-overlay-countdown",
      });

      // Horizontal container for buttons
      const buttonBox = new St.BoxLayout({
        vertical: false,
        style_class: "wellbeing-button-box",
        x_expand: true,
      });

      // Snooze button - delays break for snooze duration
      const snoozeButton = new St.Button({
        label: _("Snooze"),
        style_class: "wellbeing-overlay-button snooze-button",
        x_expand: true,
      });

      snoozeButton.connect("clicked", () => {
        this._snoozeBreak();
      });

      // Skip button - ends break immediately and starts next interval
      const skipButton = new St.Button({
        label: _("Skip Break"),
        style_class: "wellbeing-overlay-button skip-button",
        x_expand: true,
      });

      skipButton.connect("clicked", () => {
        this._skipBreak();
      });

      buttonBox.add_child(snoozeButton);
      buttonBox.add_child(skipButton);

      // Keyboard hint
      const hintLabel = new St.Label({
        text: _("Press Space to snooze, Esc to skip break"),
        style_class: "wellbeing-overlay-hint",
      });

      // Assemble the UI
      contentBox.add_child(label);
      contentBox.add_child(this._countdownLabel);
      contentBox.add_child(buttonBox);
      contentBox.add_child(hintLabel);

      // Center the content
      contentBox.set_x_align(Clutter.ActorAlign.CENTER);
      contentBox.set_y_align(Clutter.ActorAlign.CENTER);

      this._overlay.add_child(contentBox);

      // FULLSCREEN VIDEO FIX: Use top_window_group instead of chrome system
      // This ensures overlay appears above all windows, including fullscreen video
      global.top_window_group.add_child(this._overlay);
      this._overlay.set_position(0, 0);
      this._overlay.set_size(global.screen_width, global.screen_height);

      // FULLSCREEN VIDEO FIX: Disable unredirection
      // Fullscreen apps normally bypass the compositor for performance (unredirection)
      // This causes overlays to be hidden behind fullscreen video in Chrome/Firefox/VLC
      // Disabling unredirection forces all rendering through the compositor
      global.compositor.disable_unredirect();
      this._unredirectDisabled = true;

      // Ensure overlay is at the very top of the stacking order
      global.top_window_group.set_child_above_sibling(this._overlay, null);

      // Start with zero opacity and fade in smoothly
      this._overlay.set_opacity(0);
      this._overlay.ease({
        opacity: 255,
        duration: 500,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      });

      // Setup input focus and keyboard handling
      // When using top_window_group, we need explicit focus management
      this._grab = global.stage.grab(this._overlay);
      this._overlay.grab_key_focus();
      global.stage.set_key_focus(this._overlay);

      // Handle keyboard shortcuts: Escape to skip, Space to snooze
      this._keyEventId = this._overlay.connect(
        "key-press-event",
        (actor, event) => {
          const key = event.get_key_symbol();
          if (key === Clutter.KEY_Escape) {
            this._skipBreak();
            return Clutter.EVENT_STOP;
          } else if (key === Clutter.KEY_space) {
            this._snoozeBreak();
            return Clutter.EVENT_STOP;
          }
          return Clutter.EVENT_PROPAGATE;
        }
      );
    }

    _formatTime(seconds) {
      // Format remaining time in human-readable format
      if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        let timeText = minutes === 1 ? "1 minute" : `${minutes} minutes`;
        if (remainingSeconds > 0) {
          timeText +=
            remainingSeconds === 1
              ? " 1 second"
              : ` ${remainingSeconds} seconds`;
        }
        return timeText + " remaining";
      } else {
        return seconds === 1
          ? "1 second remaining"
          : `${seconds} seconds remaining`;
      }
    }

    _snoozeBreak() {
      const snoozeDuration = this._settings.get_int("snooze-duration");

      // End current break and hide overlay
      this._destroyBreakTimers();
      this._destroyOverlay();

      // Only start snooze timer if we're still running and enabled
      if (this._state === State.RUNNING && this._enabled) {
        // Start snooze timer - will show break again after snooze duration
        this._snoozeTimer = GLib.timeout_add_seconds(
          GLib.PRIORITY_DEFAULT,
          snoozeDuration,
          () => {
            this._snoozeTimer = 0;
            this._startBreak();
            return GLib.SOURCE_REMOVE;
          }
        );
      }
    }

    _skipBreak() {
      // User chose to skip break entirely
      this._destroyBreakTimers();
      this._destroyOverlay();

      // Start next interval timer
      if (this._state === State.RUNNING && this._enabled) {
        this._startTimer();
      }
    }

    _endBreak() {
      // Break finished naturally (timer expired)
      this._destroyBreakTimers();
      this._destroyOverlay();

      // Start next interval timer
      if (this._state === State.RUNNING && this._enabled) {
        this._startTimer();
      }
    }

    _destroyTimer() {
      // Clean up main interval timer
      if (this._timer > 0) {
        GLib.source_remove(this._timer);
        this._timer = 0;
      }
    }

    _destroyBreakTimers() {
      // Clean up all break-related timers
      if (this._breakTimer > 0) {
        GLib.source_remove(this._breakTimer);
        this._breakTimer = 0;
      }

      if (this._countdownTimer > 0) {
        GLib.source_remove(this._countdownTimer);
        this._countdownTimer = 0;
      }

      if (this._snoozeTimer > 0) {
        GLib.source_remove(this._snoozeTimer);
        this._snoozeTimer = 0;
      }
    }

    _destroyAllTimers() {
      // Clean up all timers when suspending or destroying
      this._destroyTimer();
      this._destroyBreakTimers();
    }

    _destroyOverlay() {
      if (!this._overlay) return;

      // Fade out smoothly before destroying
      this._overlay.ease({
        opacity: 0,
        duration: 300,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onComplete: () => {
          // Clean up keyboard event handler
          if (this._keyEventId && this._overlay) {
            this._overlay.disconnect(this._keyEventId);
            this._keyEventId = null;
          }

          // Release input grab
          if (this._grab) {
            this._grab.dismiss();
            this._grab = null;
          }

          // FULLSCREEN VIDEO FIX: Re-enable unredirection for performance
          if (this._unredirectDisabled) {
            global.compositor.enable_unredirect();
            this._unredirectDisabled = false;
          }

          // Remove and destroy overlay widget
          if (this._overlay) {
            global.top_window_group.remove_child(this._overlay);
            this._overlay.destroy();
            this._overlay = null;
          }

          // Clear countdown label reference
          this._countdownLabel = null;
        },
      });
    }

    destroy() {
      // Prevent any new timers from starting
      this._state = State.SUSPENDED;

      // Disconnect session mode listener
      if (this._sessionModeId) {
        Main.sessionMode.disconnect(this._sessionModeId);
        this._sessionModeId = null;
      }

      // FULLSCREEN VIDEO FIX: Ensure unredirection is re-enabled on cleanup
      if (this._unredirectDisabled) {
        global.compositor.enable_unredirect();
        this._unredirectDisabled = false;
      }

      // Clean up all resources
      this._destroyAllTimers();
      this._destroyOverlay();

      super.destroy();
    }
  }
);

export default class WellbeingExtension extends Extension {
  enable() {
    // Load theme for styling
    Main.loadTheme();

    // Set up GSettings schema for configuration
    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
      this.dir.get_child("schemas").get_path(),
      Gio.SettingsSchemaSource.get_default(),
      false
    );

    const schemaObj = schemaSource.lookup(
      "org.gnome.shell.extensions.wellbeing",
      true
    );

    if (!schemaObj) {
      throw new Error(
        `Schema org.gnome.shell.extensions.wellbeing could not be found for extension ${this.metadata.uuid}`
      );
    }

    this._settings = new Gio.Settings({
      settings_schema: schemaObj,
    });

    // Create and add the indicator to the status area
    this._indicator = new WellbeingIndicator(this);
    Main.panel.addToStatusArea(this.uuid, this._indicator);
  }

  disable() {
    // Clean up indicator when extension is disabled
    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }

    this._settings = null;
  }

  getSettings() {
    return this._settings;
  }
}
