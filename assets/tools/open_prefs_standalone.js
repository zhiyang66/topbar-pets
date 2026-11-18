#!/usr/bin/env -S gjs -m
/**
 * Standalone GTK4 / Libadwaita Preferences Window Launcher for TopBar Pet.
 * Works 100% reliably inside nested mutter-devkit previews AND real Wayland sessions
 * without depending on D-Bus activation of org.gnome.Shell.Extensions!
 */
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import system from 'system';

import { populatePreferencesWindow } from '../../src/prefsBuilder.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.topbar-pet';

const scriptPath = Gio.File.new_for_uri(import.meta.url).get_path();
const defaultExtRoot = GLib.path_get_dirname(GLib.path_get_dirname(GLib.path_get_dirname(scriptPath)));
const extRoot = ARGV[0] || defaultExtRoot;
const schemaDir = GLib.build_filenamev([extRoot, 'schemas']);

const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
    schemaDir,
    Gio.SettingsSchemaSource.get_default(),
    false
);
const schema = schemaSource.lookup(SCHEMA_ID, true);
if (!schema) {
    console.error(`[TopBarPet] Schema ${SCHEMA_ID} not found in ${schemaDir}`);
    system.exit(1);
}
const settings = Gio.Settings.new_full(schema, null, null);

const app = new Adw.Application({
    application_id: 'local.topbarpet.Preferences',
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});

app.connect('activate', () => {
    const win = new Adw.PreferencesWindow({
        title: '顶部栏宠物 · 小队管理与 AI 提示词工坊',
        application: app,
    });
    populatePreferencesWindow(win, settings, extRoot);
    win.present();

    if (GLib.getenv('TOPBAR_PET_PREFS_SELFTEST') === '1') {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            console.log('PREFS_WINDOW_SELFTEST_OK');
            win.close();
            app.quit();
            return GLib.SOURCE_REMOVE;
        });
    }
});

app.run([]);
