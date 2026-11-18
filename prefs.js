import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { populatePreferencesWindow } from './src/prefsBuilder.js';

export default class TopBarPetPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        populatePreferencesWindow(window, this.getSettings());
    }
}
