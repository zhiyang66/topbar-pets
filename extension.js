import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { SystemMonitor } from './src/systemMonitor.js';
import { EffectsManager } from './src/effects.js';
import { RosterManager } from './src/rpg.js';
import { DesktopPerception } from './src/perception.js';
import { LanManager } from './src/lanManager.js';
import { BattleArenaManager } from './src/battleArena.js';
import { PetStageManager } from './src/petStageManager.js';
import { PetPanelIndicator } from './src/panelMenu.js';
import { UpdateChecker } from './src/updateChecker.js';

export default class TopBarPetExtension extends Extension {
    enable() {
        if (this._isEnabled)
            return;
        this._isEnabled = true;

        try {
            this._enableCore();
        } catch (err) {
            this.disable();
            throw err;
        }
    }

    _enableCore() {
        this._settings = this.getSettings();
        this._effects = new EffectsManager();
        this._prefsProc = null;
        this._panelDestroySignal = 0;

        if (Main.layoutManager?.panelBox) {
            this._panelDestroySignal = Main.layoutManager.panelBox.connect('destroy', () => {
                this._panelDestroySignal = 0;
                this.disable();
            });
        }

        this._updateChecker = new UpdateChecker({
            extensionPath: this.path,
            settings: this._settings,
            onUpdateStateChanged: () => {
                this._indicator?.refreshUpdateItem();
            },
        });

        this._sysMonitor = new SystemMonitor(() => {
            this._indicator?.refreshStats();
        });
        this._sysMonitor.start(2000);

        this._roster = new RosterManager(this._settings, {
            onRosterStructureChanged: () => {
                this._stageManager?.syncLocalRoster();
                this._indicator?.refreshStats();
            },
            onPetAdopted: newPet => {
                this._stageManager?.syncLocalRoster();
                const actor = this._stageManager?.localActors.get(newPet.id);
                actor?.say(`🎉 新伙伴「${newPet.name}」加入顶部栏大家庭啦！✨`, 2800);
            },
            onLevelUp: (pet, unlockedSkills) => {
                const actor = this._stageManager?.localActors.get(pet.id);
                actor?.celebrateLevelUp(unlockedSkills);
                this._indicator?.refreshStats();
            },
            onStatsUpdated: () => {
                this._indicator?.refreshStats();
            },
        });

        this._perception = new DesktopPerception({
            selfExtensionUuid: this.uuid,
            onAppLaunched: ({ appName }) => {
                this._roster.grantAllActivePetsXp(5);
                const primary = this._stageManager?.getPrimaryActor();
                primary?.reactToNewApp(appName);
            },
            onAppFocused: () => {
                this._roster.grantAllActivePetsXp(2);
            },
            onMonitorsChanged: () => {
                this._stageManager?.onMonitorsChanged();
            },
        });

        this._lanManager = new LanManager({
            settings: this._settings,
            roster: this._roster,
            getPrimaryMotionState: () => this._stageManager?.getPrimaryMotionState() ?? { normX: 0.5, state: 'walk', facing: 'right' },
            callbacks: {
                onPeerBeacon: (peer, isNew) => this._stageManager?.onPeerBeacon(peer, isNew),
                onPeerLeft: peerId => this._stageManager?.onPeerLeft(peerId),
                onPeerSkinReady: peerId => this._stageManager?.onPeerSkinReady(peerId),
                onPeerGreet: msg => {
                    const primary = this._stageManager?.getPrimaryActor();
                    primary?.say(`👋 收到「${msg.fromOwner}」的 ${msg.fromPetName} 发来的热情问候！❤️`, 2800);
                },
                onBattleChallengeReceived: info => {
                    this._battleArena?.showChallengePrompt(info);
                },
                onBattleStart: battleInit => {
                    this._battleArena?.openBattle(battleInit);
                },
                onBattleDeclined: msg => {
                    const primary = this._stageManager?.getPrimaryActor();
                    primary?.say(`「${msg.fromOwner}」的 ${msg.fromPetName} 暂时婉拒了对战~`, 2400);
                },
            },
        });

        this._battleArena = new BattleArenaManager({
            extensionPath: this.path,
            settings: this._settings,
            roster: this._roster,
            lanManager: this._lanManager,
            onBattleFinished: () => {
                this._indicator?.refreshStats();
            },
        });

        this._stageManager = new PetStageManager({
            extensionPath: this.path,
            settings: this._settings,
            roster: this._roster,
            perception: this._perception,
            effects: this._effects,
            sysMonitor: this._sysMonitor,
            lanManager: this._lanManager,
            callbacks: {
                onStartPracticeBattle: opponent => this._battleArena.startPracticeBattle(opponent),
                onChallengeLanPeer: peer => {
                    this._lanManager.sendBattleRequest(peer.peerId);
                    this._stageManager.getPrimaryActor()?.say(`已向「${peer.ownerName}」的 ${peer.petName} 发送对战申请！⚔️`, 2500);
                },
                onOpenPrefs: () => this._openPetPreferences(),
            },
        });

        // Connect BattleArena <-> StageManager so fighting pets run to Top-Center & hide during battle!
        this._battleArena.setStageManager(this._stageManager);

        // Start silent periodic GitHub Releases update check (first check 12s after startup)
        this._updateChecker.startAutoCheck(info => {
            this._stageManager?.getPrimaryActor()?.say(
                `🎉 发现新版本 v${info.latestVersion}！可在右上角菜单一键更新哟 ✨`,
                3800
            );
        });

        this._indicator = null;
        this._syncPanelIndicator();

        this._panelIconSignal = this._settings.connect('changed::show-panel-icon', () => {
            this._syncPanelIndicator();
        });

        this._startupSignal = 0;
        if (Main.layoutManager._startingUp) {
            this._startupSignal = Main.layoutManager.connect('startup-complete', () => {
                this._stageManager?.onMonitorsChanged();
                if (GLib.getenv('TOPBAR_PET_PREVIEW') === '1' && Main.overview?.visible)
                    Main.overview.hide();
            });
        }
    }

    /**
     * Open Preferences reliably in BOTH nested mutter-devkit preview AND real desktop sessions!
     */
    _openPetPreferences() {
        const isPreview = GLib.getenv('TOPBAR_PET_PREVIEW') === '1';
        if (!isPreview) {
            try {
                const res = this.openPreferences();
                if (res && typeof res.catch === 'function')
                    res.catch(() => this._spawnStandalonePrefs());
                return;
            } catch (_e) {
                // Fall through to standalone launcher
            }
        }
        this._spawnStandalonePrefs();
    }

    _spawnStandalonePrefs() {
        try {
            const scriptPath = GLib.build_filenamev([
                this.path, 'assets', 'tools', 'open_prefs_standalone.js',
            ]);
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.NONE,
            });

            // If running inside dev-preview.sh, render the GTK4 Preferences window directly on the crisp host Wayland display
            // while inheriting DCONF_PROFILE & XDG_CONFIG_HOME so live edits immediately sync to the preview pets!
            const hostWayland = GLib.getenv('TOPBAR_PET_HOST_WAYLAND');
            const hostDisplay = GLib.getenv('TOPBAR_PET_HOST_DISPLAY');
            if (hostWayland)
                launcher.setenv('WAYLAND_DISPLAY', hostWayland, true);
            if (hostDisplay)
                launcher.setenv('DISPLAY', hostDisplay, true);
            launcher.setenv('GDK_BACKEND', 'wayland,x11', true);

            this._prefsProc = launcher.spawnv(['gjs', '-m', scriptPath, this.path]);
        } catch (e) {
            console.error('[TopBarPet] Failed to launch standalone preferences:', e);
        }
    }

    _syncPanelIndicator() {
        const shouldShow = this._settings.get_boolean('show-panel-icon');
        if (shouldShow && !this._indicator) {
            const stale = Main.panel?.statusArea?.[this.uuid];
            if (stale) {
                try {
                    stale.destroy();
                } catch (_e) {}
                delete Main.panel.statusArea[this.uuid];
            }
            this._indicator = new PetPanelIndicator({
                extensionPath: this.path,
                settings: this._settings,
                roster: this._roster,
                stageManager: this._stageManager,
                lanManager: this._lanManager,
                battleArena: this._battleArena,
                sysMonitor: this._sysMonitor,
                updateChecker: this._updateChecker,
                onOpenPrefs: () => this._openPetPreferences(),
            });
            Main.panel.addToStatusArea(this.uuid, this._indicator);
        } else if (!shouldShow && this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    disable() {
        this._isEnabled = false;
        if (this._panelDestroySignal && Main.layoutManager?.panelBox) {
            try {
                Main.layoutManager.panelBox.disconnect(this._panelDestroySignal);
            } catch (_e) {}
            this._panelDestroySignal = 0;
        }
        if (this._prefsProc) {
            try {
                this._prefsProc.force_exit();
            } catch (_e) {}
            this._prefsProc = null;
        }
        if (this._startupSignal && Main.layoutManager) {
            Main.layoutManager.disconnect(this._startupSignal);
            this._startupSignal = 0;
        }
        if (this._panelIconSignal && this._settings) {
            this._settings.disconnect(this._panelIconSignal);
            this._panelIconSignal = 0;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._updateChecker) {
            this._updateChecker.destroy();
            this._updateChecker = null;
        }

        if (this._battleArena) {
            this._battleArena.destroy();
            this._battleArena = null;
        }

        if (this._stageManager) {
            this._stageManager.destroy();
            this._stageManager = null;
        }

        if (this._lanManager) {
            this._lanManager.destroy();
            this._lanManager = null;
        }

        if (this._perception) {
            this._perception.destroy();
            this._perception = null;
        }

        if (this._roster) {
            this._roster.destroy();
            this._roster = null;
        }

        if (this._sysMonitor) {
            this._sysMonitor.stop();
            this._sysMonitor = null;
        }

        if (this._effects) {
            this._effects.destroy();
            this._effects = null;
        }

        this._settings = null;
    }
}
