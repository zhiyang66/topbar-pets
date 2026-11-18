import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { boxLayoutProps } from './compat.js';
import {
    SPECIES_PRESETS,
    getArchetype,
    xpRequiredForLevel,
} from './rpg.js';

const STAT_BAR_WIDTH = 146;

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
        updateChecker,
        onOpenPrefs,
    }) {
        super._init(0.5, 'TopBar Pet Indicator', false);
        this.add_style_class_name('topbar-pet-panel-btn');
        this.menu.actor.add_style_class_name('topbar-pet-popup-menu');

        this._extensionPath = extensionPath;
        this._settings = settings;
        this._roster = roster;
        this._stageManager = stageManager;
        this._lanManager = lanManager;
        this._battleArena = battleArena;
        this._sysMonitor = sysMonitor;
        this._updateChecker = updateChecker;
        this._onOpenPrefs = onOpenPrefs;
        this._mockPeerProc = null;

        const iconPath = GLib.build_filenamev([
            extensionPath, 'assets', 'icons', 'pet-indicator-symbolic.svg',
        ]);
        const capsule = new St.BoxLayout(boxLayoutProps(false, {
            style_class: 'topbar-pet-panel-capsule',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            style_class: 'system-status-icon topbar-pet-status-icon',
            icon_size: 15,
        });
        this._inlineSubBadge = new St.Label({
            text: '',
            style_class: 'topbar-pet-panel-subbadge',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        capsule.add_child(this._icon);
        capsule.add_child(this._inlineSubBadge);
        this.add_child(capsule);

        this._buildMenu();

        this._settingsSignals = [
            this._settings.connect('changed::pets-visible', () => {
                if (this._petsVisibleSwitch)
                    this._petsVisibleSwitch.setToggleState(this._settings.get_boolean('pets-visible'));
            }),
            this._settings.connect('changed::click-through', () => {
                if (this._ghostSwitch)
                    this._ghostSwitch.setToggleState(this._settings.get_boolean('click-through'));
            }),
            this._settings.connect('changed::free-roam-enabled', () => {
                if (this._freeRoamSwitch)
                    this._freeRoamSwitch.setToggleState(this._settings.get_boolean('free-roam-enabled'));
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
            this._stageManager.getPrimaryActor()?.say('🧪 已召唤模拟队友「阿泽·冰火双宠小队」，2秒后发起 2v2 双打邀请！', 3200);
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
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const label = new St.Label({
            text: labelText,
            style_class: 'topbar-pet-stat-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const track = new St.Widget({
            style_class: 'topbar-pet-bar-track',
            layout_manager: new Clutter.FixedLayout(),
            width: STAT_BAR_WIDTH,
            height: 7,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const fill = new St.Widget({
            style_class: fillClass,
            width: STAT_BAR_WIDTH,
            height: 7,
            x: 0,
            y: 0,
        });
        track.add_child(fill);

        const value = new St.Label({
            text: '100%',
            style_class: 'topbar-pet-stat-value',
            y_align: Clutter.ActorAlign.CENTER,
        });

        row.add_child(label);
        row.add_child(track);
        row.add_child(value);
        return { row, fill, value };
    }

    _makeActionTileButton(labelText, onClick) {
        const btn = new St.Button({
            label: labelText,
            style_class: 'topbar-pet-menu-tile-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
        });
        btn.connect('clicked', () => {
            this.menu.close();
            onClick?.();
        });
        return btn;
    }

    _setupAccordionSubmenus(subItems) {
        for (const sub of subItems) {
            sub.menu.connect('open-state-changed', (_m, isOpen) => {
                if (!isOpen)
                    return;
                for (const other of subItems) {
                    if (other !== sub && other.menu.isOpen)
                        other.menu.close(true);
                }
            });
        }
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

        this._walletLabel = new St.Label({
            text: '🪙 金币: 85 · 💎 圣物: 1',
            style_class: 'topbar-pet-sys-label',
        });
        this._sysLabel = new St.Label({
            text: '🖥️ CPU: 0% · 内存: 0%',
            style_class: 'topbar-pet-sys-label',
        });
        cardCol.add_child(this._walletLabel);
        cardCol.add_child(this._sysLabel);

        cardItem.add_child(cardCol);
        this.menu.addMenuItem(cardItem);

        // Compact 2-Row Quick-Action Tile Grid (frees ~210px height so Submenus open wide & roomy!)
        const gridItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const gridCol = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-stat-container',
            x_expand: true,
        }));

        const combatGridRow = new St.BoxLayout(boxLayoutProps(false, {
            style_class: 'topbar-pet-menu-grid-row',
            x_expand: true,
        }));
        combatGridRow.add_child(this._makeActionTileButton('⚡ 2.5D擂台', () => {
            this._battleArena.startPracticeBattle(null);
        }));
        combatGridRow.add_child(this._makeActionTileButton('🐉 深渊Boss', () => {
            this._battleArena.startSoloBossRaid();
        }));
        combatGridRow.add_child(this._makeActionTileButton('📯 世界Boss', () => {
            if (!this._stageManager.summonWorldBoss())
                this._stageManager.getPrimaryActor()?.say('当前顶部栏已有世界 Boss 正在交战中！⚔️', 2000);
        }));

        const utilGridRow = new St.BoxLayout(boxLayoutProps(false, {
            style_class: 'topbar-pet-menu-grid-row',
            x_expand: true,
        }));
        this._focusTileBtn = this._makeActionTileButton('🍅 25m专注', () => {
            this._stageManager.toggleFocusExpedition(25);
            this.refreshStats();
        });
        utilGridRow.add_child(this._focusTileBtn);
        utilGridRow.add_child(this._makeActionTileButton('🎺 集合哨', () => {
            this._stageManager.recallAllPetsToTopBar();
        }));
        utilGridRow.add_child(this._makeActionTileButton('🐟 投喂小队', () => {
            const primary = this._roster.getPrimaryPet();
            if (primary) {
                this._roster.recordFed(primary.id, 30);
                this._stageManager.getPrimaryActor()?.say('🐟 啊呜一口吃掉小鱼干，全队元气满满！❤️', 2300);
            }
        }));

        gridCol.add_child(combatGridRow);
        gridCol.add_child(utilGridRow);
        gridItem.add_child(gridCol);
        this.menu.addMenuItem(gridItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Accordion Submenus (only one open at a time, plenty of vertical room!)
        this._rosterSub = new PopupMenu.PopupSubMenuMenuItem('🐾 我的宠物小队');
        this._shopSub = new PopupMenu.PopupSubMenuMenuItem('🎒 圣物抽卡 · 技能秘籍 · 神秘孵蛋');
        this._lanSub = new PopupMenu.PopupSubMenuMenuItem('🌐 局域网联机伙伴 (0 在线)');

        this.menu.addMenuItem(this._rosterSub);
        this.menu.addMenuItem(this._shopSub);
        this.menu.addMenuItem(this._lanSub);
        this._setupAccordionSubmenus([this._rosterSub, this._shopSub, this._lanSub]);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._petsVisibleSwitch = new PopupMenu.PopupSwitchMenuItem(
            '🐾 显示桌面宠物 (总开关)',
            this._settings.get_boolean('pets-visible')
        );
        this._petsVisibleSwitch.connect('toggled', (_item, state) => {
            this._settings.set_boolean('pets-visible', state);
        });
        this.menu.addMenuItem(this._petsVisibleSwitch);

        this._freeRoamSwitch = new PopupMenu.PopupSwitchMenuItem(
            '🖥️ 全屏自由漫游 2.0 (跑酷/抓钩/篝火)',
            this._settings.get_boolean('free-roam-enabled')
        );
        this._freeRoamSwitch.connect('toggled', (_item, state) => {
            this._settings.set_boolean('free-roam-enabled', state);
        });
        this.menu.addMenuItem(this._freeRoamSwitch);

        this._ghostSwitch = new PopupMenu.PopupSwitchMenuItem(
            '👻 鼠标穿透模式',
            this._settings.get_boolean('click-through')
        );
        this._ghostSwitch.connect('toggled', (_item, state) => {
            this._settings.set_boolean('click-through', state);
        });
        this.menu.addMenuItem(this._ghostSwitch);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._updateMenuItem = this.menu.addAction(
            `🔍 检查插件更新 (v${this._updateChecker?.currentVersion || '2.1.0'})`,
            () => this._handleUpdateMenuClick()
        );
        this.refreshUpdateItem();

        this.menu.addAction('⚙️ 自由配招 / 圣物工坊 / 领养 / ✨AI提示词…', () => {
            this._onOpenPrefs?.();
        });
    }

    _handleUpdateMenuClick() {
        if (!this._updateChecker)
            return;
        if (this._updateChecker.hasUpdate) {
            this._stageManager.getPrimaryActor()?.say(`⬇️ 正在下载安装 v${this._updateChecker.latestVersion} 更新…`, 3000);
            this._updateChecker.downloadAndInstallUpdate().then(res => {
                this._stageManager.getPrimaryActor()?.say(res.message, 4000);
            });
        } else {
            this._stageManager.getPrimaryActor()?.say('🔍 正在连接 GitHub 检查插件新版本…', 2200);
            this._updateChecker.checkForUpdates().then(snap => {
                this._stageManager.getPrimaryActor()?.say(snap.statusText, 3200);
            });
        }
    }

    refreshUpdateItem() {
        if (!this._updateMenuItem || !this._updateChecker)
            return;
        const snap = this._updateChecker.getSnapshot();
        if (snap.isInstalling)
            this._updateMenuItem.label.text = `⏳ 正在安装 v${snap.latestVersion || ''} 更新…`;
        else if (snap.isChecking)
            this._updateMenuItem.label.text = '🔍 正在检查 GitHub 新版本…';
        else if (snap.hasUpdate)
            this._updateMenuItem.label.text = `🚀 发现新版本 v${snap.latestVersion}（点此一键更新！）`;
        else
            this._updateMenuItem.label.text = `🔍 检查插件更新 (当前 v${snap.currentVersion})`;
    }

    _rebuildDynamicSubmenus() {
        // 1. Roster Submenu (with single-row Quick-Adopt Emoji Bar so list stays clean & compact!)
        const activeCount = this._roster.pets.filter(p => p.onTopBar !== false).length;
        this._rosterSub.label.text = `🐾 我的宠物小队 (出场 ${activeCount} / 共 ${this._roster.pets.length} 只)`;
        this._rosterSub.menu.removeAll();

        for (const pet of this._roster.pets) {
            const isPrimary = pet.id === this._roster.primaryPetId;
            const isSec = pet.id === this._roster.secondaryPetId;
            const arch = getArchetype(pet.archetype);
            const tag = isPrimary ? ' (1号)' : (isSec ? ' (2号)' : '');
            const visItem = new PopupMenu.PopupSwitchMenuItem(
                `${isPrimary ? '👑 ' : (isSec ? '🤝 ' : '🐾 ')}${pet.name} · Lv.${pet.level} [${arch.badge}]${tag}`,
                pet.onTopBar !== false
            );
            visItem.connect('toggled', (_item, state) => {
                this._roster.setPetVisible(pet.id, state);
                if (state && !this._settings.get_boolean('pets-visible'))
                    this._settings.set_boolean('pets-visible', true);
                this.refreshStats();
            });
            this._rosterSub.menu.addMenuItem(visItem);
        }

        // Compact 1-Row Quick Adopt Strip (replaces 6 bulky vertical rows!)
        const quickAdoptItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const adoptRow = new St.BoxLayout(boxLayoutProps(false, {
            style_class: 'topbar-pet-menu-grid-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        adoptRow.add_child(new St.Label({
            text: '➕领养:',
            style_class: 'topbar-pet-sys-label',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        for (const sp of SPECIES_PRESETS) {
            const emoji = sp.label.split(' ')[0];
            const miniBtn = new St.Button({
                label: emoji,
                style_class: 'topbar-pet-adopt-mini-btn',
                reactive: true,
                track_hover: true,
            });
            miniBtn.connect('clicked', () => {
                this._roster.adoptPet({
                    name: sp.defaultName,
                    presetId: sp.id,
                    archetype: sp.defaultArchetype,
                });
                this._rebuildDynamicSubmenus();
                this.refreshStats();
            });
            adoptRow.add_child(miniBtn);
        }
        quickAdoptItem.add_child(adoptRow);
        this._rosterSub.menu.addMenuItem(quickAdoptItem);

        // 2. Gacha Shop & Mystery Egg Submenu
        this._shopSub.label.text = `🎒 圣物 · 秘籍 · 孵蛋 (持有 ${this._roster.coins}🪙)`;
        this._shopSub.menu.removeAll();

        this._shopSub.menu.addAction('🎲 祈愿抽取随机圣物 (消耗 45🪙)', () => {
            const res = this._roster.rollRandomRelic(45);
            if (res.ok)
                this._stageManager.getPrimaryActor()?.say(`🎉 抽中圣物【${res.relic.icon} ${res.relic.name}】：${res.relic.desc}`, 3400);
            else if (res.reason === 'ALL_OWNED')
                this._stageManager.getPrimaryActor()?.say('✨ 你已集齐全部 18 件圣物啦！', 2400);
            else
                this._stageManager.getPrimaryActor()?.say('🪙 金币不足 45 枚，打场擂台或挖宝攒点金币吧~', 2400);
            this.refreshStats();
        });

        this._shopSub.menu.addAction('📜 研读跨流派技能秘籍 (消耗 50🪙)', () => {
            const res = this._roster.unlockRandomSkillScroll(50);
            if (res.ok)
                this._stageManager.getPrimaryActor()?.say(`📜 领悟新技能【${res.skill.name}】！所有宠物均可跨流派装配啦 ✨`, 3400);
            else if (res.reason === 'ALL_UNLOCKED')
                this._stageManager.getPrimaryActor()?.say('✨ 已解锁图鉴中全部技能！', 2400);
            else
                this._stageManager.getPrimaryActor()?.say('🪙 金币不足 50 枚~', 2200);
            this.refreshStats();
        });

        if (this._roster.activeEgg) {
            this._shopSub.menu.addAction(`🥚 神秘宠物蛋孵化中 (${this._roster.activeEgg.progress}% · 点此花费 15🪙 加速 +25%)`, () => {
                if (this._roster.spendCoins(15)) {
                    this._roster.advanceEggProgress(25);
                    this.refreshStats();
                } else {
                    this._stageManager.getPrimaryActor()?.say('加速需 15🪙，陪伴挂机也会自动免费孵化哟~ 🥚', 2400);
                }
            });
        } else {
            this._shopSub.menu.addAction('🥚 购买神秘异色宠物蛋 (消耗 60🪙 · 必带天生词条)', () => {
                const res = this._roster.startMysteryEgg(60);
                if (res.ok)
                    this._stageManager.getPrimaryActor()?.say('🥚 已在顶部栏状态胶囊安放神秘宠物蛋，零遮挡孵化启动！✨', 2800);
                else
                    this._stageManager.getPrimaryActor()?.say('🪙 金币不足 60 枚~', 2200);
                this.refreshStats();
            });
        }

        // 3. LAN Multiplayer Submenu
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
                    `⚡ 2v2 双打挑战「${peer.ownerName}」(${peer.petName} Lv.${peer.level} ${arch.badge})`,
                    () => {
                        this._lanManager.sendBattleRequest(peer.peerId, '2v2');
                        this._stageManager.getPrimaryActor()?.say(`已向「${peer.ownerName}」发出 2v2 元素双打战书！⚡`, 2500);
                    }
                );
                this._lanSub.menu.addAction(
                    `🐉 邀「${peer.ownerName}」组队讨伐随机深渊 Boss`,
                    () => {
                        this._lanManager.sendBattleRequest(peer.peerId, 'boss_raid');
                        this._stageManager.getPrimaryActor()?.say(`已邀请「${peer.ownerName}」并肩讨伐随机深渊 Boss！🐉`, 2500);
                    }
                );
            }
        }
        this._lanSub.menu.addAction(
            this._mockPeerProc ? '🛑 关闭本地模拟联机队友' : '🧪 召唤模拟冰火双宠队友 (单机测 2v2 与打Boss)',
            () => this._toggleMockPeer()
        );
    }

    refreshStats() {
        const p = this._roster.getPrimaryPet();
        if (!p)
            return;
        const arch = getArchetype(p.archetype);
        const nextXp = xpRequiredForLevel(p.level);
        const titleBadge = this._roster.getEquippedTitleBadge();
        const titlePrefix = titleBadge ? `[${titleBadge}] ` : '';

        this._titleLabel.text = `👑 ${titlePrefix}${p.name} [${arch.badge}] (${p.wins}胜)`;
        this._levelBadge.text = `Lv.${p.level} (${p.xp}/${nextXp})`;

        const applyBar = (rowObj, pct) => {
            const clamped = Math.max(0, Math.min(100, Math.round(pct)));
            rowObj.value.text = `${clamped}%`;
            rowObj.fill.width = Math.max(4, Math.round((clamped / 100) * STAT_BAR_WIDTH));
        };
        const xpPct = Math.round((p.xp / Math.max(1, nextXp)) * 100);
        applyBar(this._xpRow, xpPct);
        applyBar(this._moodRow, p.mood);
        applyBar(this._energyRow, p.energy);

        this._walletLabel.text = `🪙 金币: ${this._roster.coins} · 💎 圣物: ${this._roster.relicInventory.length}/18 · 📜 技能库: ${this._roster.unlockedSkillPool.length}`;

        const cpu = this._sysMonitor?.cpuPercent ?? 0;
        const mem = this._sysMonitor?.memPercent ?? 0;
        const peersCount = this._lanManager?.peers.size ?? 0;
        const ecoTag = this._stageManager?.isEcoModeActive?.() ? ' · 🌱节能中' : '';
        this._sysLabel.text = `🖥️ CPU ${cpu}% · 内存 ${mem}% · 联机 ${peersCount} 人${ecoTag}`;

        const parts = [];
        if (this._roster.activeEgg)
            parts.push(`🥚${this._roster.activeEgg.progress}%`);
        const focusRem = this._stageManager?.getFocusRemainingSec?.() || 0;
        if (focusRem > 0) {
            const mm = String(Math.floor(focusRem / 60)).padStart(2, '0');
            const ss = String(focusRem % 60).padStart(2, '0');
            parts.push(`🍅${mm}:${ss}`);
            if (this._focusTileBtn)
                this._focusTileBtn.label = `🛑 ${mm}:${ss}`;
        } else if (this._focusTileBtn) {
            this._focusTileBtn.label = '🍅 25m专注';
        }

        if (parts.length > 0) {
            this._inlineSubBadge.text = parts.join(' ');
            this._inlineSubBadge.visible = true;
        } else {
            this._inlineSubBadge.text = '';
            this._inlineSubBadge.visible = false;
        }
    }
});
