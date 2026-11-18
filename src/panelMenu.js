import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { boxLayoutProps } from './compat.js';
import {
    MAX_ADOPTED_PETS,
    SPECIES_PRESETS,
    getArchetype,
    xpRequiredForLevel,
} from './rpg.js';

export const PetPanelIndicator = GObject.registerClass(
class PetPanelIndicator extends PanelMenu.Button {
    _init({
        extensionPath,
        settings,
        roster,
        stageManager,
        lanManager,
        battleArena,
        sysMonitor,
        onOpenPrefs,
    }) {
        super._init(0.5, 'TopBar Pet Indicator', false);

        this._extensionPath = extensionPath;
        this._settings = settings;
        this._roster = roster;
        this._stageManager = stageManager;
        this._lanManager = lanManager;
        this._battleArena = battleArena;
        this._sysMonitor = sysMonitor;
        this._onOpenPrefs = onOpenPrefs;
        this._mockPeerProc = null;

        const iconPath = GLib.build_filenamev([
            extensionPath, 'assets', 'icons', 'pet-indicator-symbolic.svg',
        ]);
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._buildMenu();

        this._settingsSignals = [
            this._settings.connect('changed::click-through', () => {
                if (this._ghostSwitch)
                    this._ghostSwitch.setToggleState(this._settings.get_boolean('click-through'));
            }),
        ];

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this.refreshStats();
                this._rebuildDynamicSubmenus();
            }
        });

        this.refreshStats();
        this._rebuildDynamicSubmenus();
    }

    destroy() {
        this._stopMockPeer();
        for (const id of this._settingsSignals || [])
            this._settings.disconnect(id);
        this._settingsSignals = [];
        super.destroy();
    }

    _toggleMockPeer() {
        if (this._mockPeerProc) {
            this._stopMockPeer();
            this._stageManager.getPrimaryActor()?.say('已关闭本地模拟联机队友~', 2000);
            return;
        }
        try {
            const scriptPath = GLib.build_filenamev([
                this._extensionPath, 'assets', 'tools', 'mock_lan_peer.js',
            ]);
            const localPort = String(this._lanManager?.getLocalTcpPort?.() || 0);
            this._mockPeerProc = Gio.Subprocess.new(
                ['gjs', '-m', scriptPath, localPort],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            this._stageManager.getPrimaryActor()?.say('🧪 已召唤模拟队友「阿泽·赤焰小火龙」，2秒后向你弹出对战邀请！', 3000);
        } catch (e) {
            console.warn('[TopBarPet] Mock LAN peer spawn failed:', e);
        }
    }

    _stopMockPeer() {
        if (this._mockPeerProc) {
            try {
                this._mockPeerProc.force_exit();
            } catch (_e) {}
            this._mockPeerProc = null;
        }
    }

    _makeStatRow(labelText, fillClass) {
        const row = new St.BoxLayout(boxLayoutProps(false, {
            style_class: 'topbar-pet-stat-line',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const label = new St.Label({
            text: labelText,
            style_class: 'topbar-pet-stat-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const track = new St.Widget({
            style_class: 'topbar-pet-bar-track',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        track.set_size(110, 7);

        const fill = new St.Widget({ style_class: fillClass });
        fill.set_size(90, 7);
        track.add_child(fill);

        const value = new St.Label({
            text: '90%',
            style_class: 'topbar-pet-stat-value',
            y_align: Clutter.ActorAlign.CENTER,
        });

        row.add_child(label);
        row.add_child(track);
        row.add_child(value);
        return { row, fill, value };
    }

    _buildMenu() {
        const cardItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const cardCol = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-stat-container',
            x_expand: true,
        }));

        const headerRow = new St.BoxLayout(boxLayoutProps(false, {
            style_class: 'topbar-pet-header-box',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._titleLabel = new St.Label({
            text: '👑 团子',
            style_class: 'topbar-pet-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._levelBadge = new St.Label({
            text: 'Lv.1',
            style_class: 'topbar-pet-level-badge',
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerRow.add_child(this._titleLabel);
        headerRow.add_child(this._levelBadge);
        cardCol.add_child(headerRow);

        this._statsBox = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-stat-container',
            x_expand: true,
        }));
        this._xpRow = this._makeStatRow('✨ 升级经验', 'topbar-pet-bar-hunger');
        this._moodRow = this._makeStatRow('💖 心情值', 'topbar-pet-bar-mood');
        this._energyRow = this._makeStatRow('⚡ 活力值', 'topbar-pet-bar-energy');
        this._statsBox.add_child(this._xpRow.row);
        this._statsBox.add_child(this._moodRow.row);
        this._statsBox.add_child(this._energyRow.row);
        cardCol.add_child(this._statsBox);

        this._sysLabel = new St.Label({
            text: '🖥️ CPU: 0% · 内存: 0%',
            style_class: 'topbar-pet-sys-label',
        });
        cardCol.add_child(this._sysLabel);

        cardItem.add_child(cardCol);
        this.menu.addMenuItem(cardItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Dynamic Pet Roster Submenu (Switch / Adopt / Release)
        this._rosterSub = new PopupMenu.PopupSubMenuMenuItem('🐾 我的宠物小队 (1/3)');
        this.menu.addMenuItem(this._rosterSub);

        // Dynamic LAN Multiplayer Submenu
        this._lanSub = new PopupMenu.PopupSubMenuMenuItem('🌐 局域网联机伙伴 (0 在线)');
        this.menu.addMenuItem(this._lanSub);

        // Battle Arena Quick Actions
        this.menu.addAction('⚔️ 开启擂台挑战赛 (顶部中央舞台)', () => {
            this._battleArena.startPracticeBattle(null);
        });
        this._siblingSparItem = this.menu.addAction('🥊 自家宠物伙伴切磋赛', () => {
            const primary = this._roster.getPrimaryPet();
            const other = this._roster.pets.find(p => p.id !== primary.id);
            if (other)
                this._battleArena.startPracticeBattle(other);
        });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addAction('🤸 来个随机耍宝特技', () => {
            this._stageManager.getPrimaryActor()?.performRandomStunt();
        });

        this._ghostSwitch = new PopupMenu.PopupSwitchMenuItem(
            '👻 鼠标穿透模式',
            this._settings.get_boolean('click-through')
        );
        this._ghostSwitch.connect('toggled', (_item, state) => {
            this._settings.set_boolean('click-through', state);
        });
        this.menu.addMenuItem(this._ghostSwitch);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addAction('⚙️ 宠物管理 / 领养 / ✨AI提示词工坊…', () => {
            this._onOpenPrefs?.();
        });
    }

    _rebuildDynamicSubmenus() {
        // 1. Rebuild Adopted Roster Submenu
        this._rosterSub.label.text = `🐾 我的宠物小队 (${this._roster.pets.length}/${MAX_ADOPTED_PETS})`;
        this._rosterSub.menu.removeAll();

        for (const pet of this._roster.pets) {
            const isPrimary = pet.id === this._roster.primaryPetId;
            const arch = getArchetype(pet.archetype);
            this._rosterSub.menu.addAction(
                `${isPrimary ? '👑 ' : '🐾 '}${pet.name} · Lv.${pet.level} [${arch.badge}]${isPrimary ? ' (主战)' : ' (点此切换主战)'}`,
                () => {
                    this._roster.setPrimaryPet(pet.id);
                    this.refreshStats();
                }
            );
        }

        if (this._roster.canAdoptMore()) {
            this._rosterSub.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            for (const sp of SPECIES_PRESETS.slice(1, 5)) {
                this._rosterSub.menu.addAction(`➕ 快速领养 ${sp.label}`, () => {
                    this._roster.adoptPet({
                        name: sp.defaultName,
                        presetId: sp.id,
                        archetype: sp.defaultArchetype,
                    });
                });
            }
            this._rosterSub.menu.addAction('✨ 导入自定义宠物 / AI生成…', () => {
                this._onOpenPrefs?.();
            });
        }

        if (this._siblingSparItem)
            this._siblingSparItem.visible = this._roster.pets.length >= 2;

        // 2. Rebuild LAN Peers Submenu
        const peers = this._lanManager ? this._lanManager.getOnlinePeers() : [];
        this._lanSub.label.text = `🌐 局域网联机伙伴 (${peers.length} 在线)`;
        this._lanSub.menu.removeAll();

        if (peers.length === 0) {
            this._lanSub.menu.addMenuItem(new PopupMenu.PopupMenuItem(
                '正在自动广播搜寻同局域网玩家…',
                { reactive: false }
            ));
        } else {
            for (const peer of peers) {
                const arch = getArchetype(peer.archetype);
                this._lanSub.menu.addAction(
                    `⚔️ 挑战「${peer.ownerName}」的 ${peer.petName} (Lv.${peer.level} ${arch.badge})`,
                    () => {
                        this._lanManager.sendBattleRequest(peer.peerId);
                        this._stageManager.getPrimaryActor()?.say(`已向「${peer.ownerName}」的 ${peer.petName} 发出对战邀请！⚔️`, 2500);
                    }
                );
            }
        }
        this._lanSub.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._lanSub.menu.addAction(
            this._mockPeerProc ? '🛑 关闭本地模拟联机队友' : '🧪 召唤模拟联机队友 (单机测联机对战)',
            () => this._toggleMockPeer()
        );
    }

    refreshStats() {
        const p = this._roster.getPrimaryPet();
        if (!p)
            return;
        const arch = getArchetype(p.archetype);
        const nextXp = xpRequiredForLevel(p.level);

        this._titleLabel.text = `👑 ${p.name} [${arch.badge}]  (${p.wins}胜 ${p.losses}负)`;
        this._levelBadge.text = `Lv.${p.level} (${p.xp}/${nextXp})`;

        const applyBar = (rowObj, pct) => {
            const clamped = Math.max(0, Math.min(100, Math.round(pct)));
            rowObj.value.text = `${clamped}%`;
            rowObj.fill.set_size(Math.max(4, Math.round((clamped / 100) * 110)), 7);
        };
        const xpPct = Math.round((p.xp / Math.max(1, nextXp)) * 100);
        applyBar(this._xpRow, xpPct);
        applyBar(this._moodRow, p.mood);
        applyBar(this._energyRow, p.energy);

        const cpu = this._sysMonitor?.cpuPercent ?? 0;
        const mem = this._sysMonitor?.memPercent ?? 0;
        const peersCount = this._lanManager?.peers.size ?? 0;
        this._sysLabel.text = `🖥️ CPU ${cpu}% · 内存 ${mem}% · 局域网 ${peersCount} 人同屏`;
    }
});
