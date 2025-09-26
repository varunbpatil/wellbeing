import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

export default class WellbeingPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
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

    const settings = new Gio.Settings({
      settings_schema: schemaObj,
    });

    const page = new Adw.PreferencesPage({
      title: _("General"),
      icon_name: "dialog-information-symbolic",
    });
    window.add(page);

    const group = new Adw.PreferencesGroup({
      title: _("Break Settings"),
    });
    page.add(group);

    const intervalRow = new Adw.SpinRow({
      title: _("Break Interval"),
      subtitle: _("Time between breaks in seconds"),
      adjustment: new Gtk.Adjustment({
        lower: 10,
        upper: 7200,
        step_increment: 5,
      }),
    });

    settings.bind(
      "break-interval",
      intervalRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT
    );

    group.add(intervalRow);

    const durationRow = new Adw.SpinRow({
      title: _("Break Duration"),
      subtitle: _("Duration of break in seconds"),
      adjustment: new Gtk.Adjustment({
        lower: 5,
        upper: 900,
        step_increment: 5,
      }),
    });

    settings.bind(
      "break-duration",
      durationRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT
    );

    group.add(durationRow);

    const snoozeRow = new Adw.SpinRow({
      title: _("Snooze Duration"),
      subtitle: _("Duration to snooze break in seconds"),
      adjustment: new Gtk.Adjustment({
        lower: 5,
        upper: 1800,
        step_increment: 5,
      }),
    });

    settings.bind(
      "snooze-duration",
      snoozeRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT
    );

    group.add(snoozeRow);
  }
}
