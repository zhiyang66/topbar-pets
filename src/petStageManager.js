import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { addChromeActor, removeChromeActor } from './compat.js';
import { loadSpriteBankForProfile } from './spriteLoader.js';
import { getArchetype } from './rpg.js';
import { BOSS_POOL } from './relicsAndAchievements.js';
import { PixelFxSurface } from './pixelfx/bridge.js';
import { PetActor } from './petActor.js';

const DUO_KINDS = [
    'high_five',
    'leapfrog',
    'sync_dance',
    'spar_clash',
    'magic_duel',
    'tag_chase',
    'gossip_chat',
    'nap_pile',
    'nuzzle',
];

/**
 * Renders a LAN Peer's Visitor Pet with Honor Title badge & 1v1 / 2v2 / Co-op Raid / Gift menu!
 */
class RemotePetActor {
    constructor({ extensionPath, settings, peerInfo, perception, lanManager, effects, callbacks }) {
        this._extensionPath = extensionPath;
        this._settings = settings;
        this.peer = peerInfo;
        this._perception = perception;
        this._lanManager = lanManager;
        this._effects = effects;
        this._callbacks = callbacks || {};

        this._bank = null;
        this._petW = 32;
        this._petH = 32;
        this._curX = Number.NaN;
        this._targetX = 300;
        this._curY = Number.NaN;
        this._targetY = 0;
        this._topGroundY = 0;
        this._jumpY = 0;
        this._vy = 0;
        this._frameIdx = 0;
        this._frameAccMs = 0;
        this.lastSocialMs = 0;

        this._socialAnim = null;
        this._socialTimerMs = 0;
        this._socialPhaseMs = 0;

        this._inArenaBattle = false;
        this._arenaEntering = false;
        this._arenaDiveStarted = false;
        this._arenaTargetX = 0;
        this._arenaEnterMs = 0;
        this._onArenaArrived = null;

        const clickThrough = this._settings.get_boolean('click-through');
        this._actor = new St.Widget({
            style_class: 'topbar-pet-actor',
            reactive: !clickThrough,
            track_hover: !clickThrough,
            opacity: 235,
        });
        this._actor.set_pivot_point(0.5, 1.0);
        addChromeActor(this._actor, { interactive: !clickThrough, trackFullscreen: true });

        this._badge = new St.Label({
            text: this._formatBadgeText(peerInfo),
            style_class: 'topbar-pet-lan-badge',
            reactive: false,
            opacity: 218,
        });
        this._badge.connect('destroy', () => {
            this._badge = null;
        });
        addChromeActor(this._badge, { interactive: false, trackFullscreen: true });

        this._menu = new PopupMenu.PopupMenu(this._actor, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        this._menuManager = new PopupMenu.PopupMenuManager(this._actor);
        this._menuManager.addMenu(this._menu);

        this._actorSignals = [
            this._actor.connect('button-press-event', (_a, ev) => {
                if (this._inArenaBattle)
                    return Clutter.EVENT_STOP;
                if (ev.get_button() === 1 || ev.get_button() === 3) {
                    this._rebuildMenu();
                    this._menu.toggle();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }),
            this._actor.connect('destroy', () => {
                this._actor = null;
            }),
        ];

        this._settingsSignals = [
            this._settings.connect('changed::pet-size', () => this.reloadSkin()),
            this._settings.connect('changed::pixel-art-scaling', () => this.reloadSkin()),
            this._settings.connect('changed::free-roam-enabled', () => this.updateFromBeacon(this.peer, false)),
            this._settings.connect('changed::pets-visible', () => this._syncMasterVisibility()),
            this._settings.connect('changed::click-through', () => {
                if (!this._actor)
                    return;
                const ct = this._settings.get_boolean('click-through');
                removeChromeActor(this._actor);
                this._actor.reactive = !ct;
                this._actor.track_hover = !ct;
                addChromeActor(this._actor, { interactive: !ct, trackFullscreen: true });
            }),
        ];

        this.reloadSkin();
        this.updateFromBeacon(peerInfo, true);
        this._syncMasterVisibility();
    }

    _formatBadgeText(p) {
        const titlePrefix = p.titleBadge ? `[${p.titleBadge}] ` : '';
        return `🌐 ${titlePrefix}${p.ownerName}·${p.petName} Lv.${p.level}`;
    }

    _syncMasterVisibility() {
        const masterVis = this._settings.get_boolean('pets-visible');
        if (this._actor && !this._inArenaBattle)
            this._actor.visible = masterVis;
        if (this._badge && !this._inArenaBattle)
            this._badge.visible = masterVis;
    }

    destroy() {
        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = [];

        if (this._actor) {
            for (const id of this._actorSignals)
                this._actor.disconnect(id);
        }
        this._actorSignals = [];

        if (this._menu) {
            this._menu.destroy();
            this._menu = null;
            this._menuManager = null;
        }
        if (this._badge) {
            removeChromeActor(this._badge);
            this._badge.destroy();
            this._badge = null;
        }
        if (this._actor) {
            removeChromeActor(this._actor);
            this._actor.destroy();
            this._actor = null;
        }
    }

    isInArenaBattle() {
        return this._inArenaBattle;
    }

    say(text, durationMs = 1800) {
        if (!this._actor || !this._actor.visible)
            return;
        this._effects.showBubble(
            () => ({ x: this._curX, y: this._curY + this._jumpY, width: this._petW, height: this._petH }),
            text,
            durationMs,
            `peer-${this.peer.peerId}`
        );
    }

    enterArenaBattle(targetX, customLine, onArrived) {
        if (!this._actor) {
            onArrived?.();
            return;
        }
        if (this._menu?.isOpen)
            this._menu.close();

        this._inArenaBattle = true;
        this._arenaEntering = true;
        this._arenaDiveStarted = false;
        this._arenaEnterMs = 0;
        this._arenaTargetX = targetX;
        this._onArenaArrived = onArrived;
        if (!Number.isFinite(this._curX))
            this._curX = targetX;
        if (!Number.isFinite(this._curY))
            this._curY = this._topGroundY;
        this._actor.set_scale(1.0, 1.0);
        this._actor.rotation_angle_z = 0;

        if (this._badge)
            this._badge.visible = false;

        this.say(customLine || `${this.peer.petName}：应战！我来也 ⚔️🔥`, 1500);
        this._effects.spawnParticle(this._curX + this._petW / 2, this._curY, '🔥', 18);
        this._vy = -3.8;
        this._jumpY = -1;
    }

    returnFromArena() {
        if (!this._inArenaBattle)
            return;
        this._inArenaBattle = false;
        this._arenaEntering = false;
        this._arenaDiveStarted = false;
        this._onArenaArrived = null;

        if (!this._actor)
            return;
        const masterVis = this._settings.get_boolean('pets-visible');
        this._actor.remove_all_transitions();
        this._actor.visible = masterVis;
        this._actor.opacity = 0;
        this._actor.set_scale(1.0, 1.0);
        this._actor.rotation_angle_z = 0;
        this._curY = this._topGroundY;
        this._jumpY = 18;
        this._vy = -5.6;
        this._actor.set_position(Math.round(this._curX), Math.round(this._curY + this._jumpY));
        if (this._badge) {
            const [, bw] = this._badge.get_preferred_width(-1);
            const panelBox = Main.layoutManager.panelBox;
            const panelBottom = (panelBox?.y ?? 0) + (panelBox?.height ?? 32);
            this._badge.set_position(
                Math.round(this._curX + this._petW / 2 - bw / 2),
                Math.round(panelBottom + 2)
            );
            this._badge.visible = masterVis;
        }
        if (!masterVis)
            return;

        this._actor.ease({
            opacity: 235,
            duration: 260,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._effects.spawnParticle(this._curX + this._petW / 2, this._curY, '✨', 16);
    }

    triggerSocialReaction(socialKind, otherX) {
        if (this._inArenaBattle)
            return;
        this.lastSocialMs = Date.now();
        this._socialAnim = socialKind;
        this._socialPhaseMs = 0;
        this._socialTimerMs = socialKind === 'sync_dance' ? 2400 : 1450;
        this.peer.facing = otherX >= this._curX ? 'right' : 'left';

        if (socialKind === 'high_five' || socialKind === 'nuzzle') {
            this._vy = -4.6;
            this._jumpY = -1;
        }
    }

    reloadSkin() {
        if (!this._actor)
            return;
        const profile = this._lanManager.resolvePeerSkinProfile(this.peer);
        this._bank = loadSpriteBankForProfile(this._extensionPath, profile, {
            targetHeight: this._settings.get_int('pet-size'),
            pixelCrisp: this._settings.get_boolean('pixel-art-scaling'),
        });
        this._petW = this._bank.width;
        this._petH = this._bank.height;
        this._actor.set_size(this._petW, this._petH);
    }

    _rebuildMenu() {
        if (!this._menu)
            return;
        this._menu.removeAll();
        const arch = getArchetype(this.peer.archetype);
        const titleStr = this.peer.titleBadge ? ` [${this.peer.titleBadge}]` : '';
        this._menu.addMenuItem(new PopupMenu.PopupMenuItem(
            `🌐 ${this.peer.ownerName}${titleStr} ·「${this.peer.petName}」Lv.${this.peer.level} [${arch.badge}]`,
            { reactive: false }
        ));
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._menu.addAction('⚔️ 申请 1v1 宠物决斗', () => {
            this._callbacks.onChallengeLanPeer?.(this.peer, '1v1');
        });
        this._menu.addAction('⚡ 申请 2v2 元素双打决斗', () => {
            this._callbacks.onChallengeLanPeer?.(this.peer, '2v2');
        });
        this._menu.addAction('🐉 邀请组队讨伐随机深渊 Boss！', () => {
            this._callbacks.onChallengeLanPeer?.(this.peer, 'boss_raid');
        });
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._menu.addAction('🎁 请客投喂伴手礼 (+好感)', () => {
            this._lanManager.sendGiftTreat?.(this.peer.peerId);
            this._effects.spawnBurst(this._curX + this._petW / 2, this._curY, ['🐟', '🎁', '❤️'], 3);
            this.say(`收到投喂好开心呀，谢谢款待 🐟❤️`, 2200);
        });
        this._menu.addAction('👋 挥爪打招呼', () => {
            this._lanManager.sendGreeting(this.peer.peerId);
            this._effects.spawnBurst(this._curX + this._petW / 2, this._curY, ['👋', '✨', '❤️'], 3);
        });
    }

    updateFromBeacon(peerInfo, snapImmediate = false) {
        this.peer = peerInfo;
        const vOffset = this._settings.get_int('vertical-offset');
        const bounds = this._perception?.getScreenRoamBounds?.(this._petW, this._petH, vOffset);
        if (!bounds)
            return;

        this._topGroundY = bounds.groundY;
        const minX = bounds.minX;
        const maxX = bounds.maxX;
        this._targetX = minX + (Number(peerInfo.normX) || 0.5) * (maxX - minX);

        const localFreeRoam = this._settings.get_boolean('free-roam-enabled');
        const peerNormY = (localFreeRoam && peerInfo.freeRoam) ? Math.max(0, Math.min(1, Number(peerInfo.normY) || 0)) : 0;
        this._targetY = bounds.groundY + peerNormY * Math.max(0, bounds.bottomGroundY - bounds.groundY);

        if (snapImmediate || !Number.isFinite(this._curX) || !Number.isFinite(this._curY)) {
            this._curX = this._targetX;
            this._curY = this._targetY;
        }

        if (this._badge)
            this._badge.text = this._formatBadgeText(peerInfo);
    }

    tick(dtMs) {
        if (this._actor && (!Number.isFinite(this._curX) || !Number.isFinite(this._curY)))
            return;
        if (!this._actor || !this._bank)
            return;

        if (this._inArenaBattle && !this._arenaEntering)
            return;

        if (this._jumpY < 0 || this._vy !== 0) {
            this._jumpY += this._vy;
            this._vy += 0.48;
            if (this._jumpY >= 0) {
                this._jumpY = 0;
                this._vy = 0;
            }
        }

        if (this._arenaEntering) {
            if (this._arenaDiveStarted)
                return;
            this._arenaEnterMs += dtMs;
            const dx = this._arenaTargetX - this._curX;
            const dy = this._topGroundY - this._curY;
            const stepX = Math.max(10.5, Math.abs(dx) * 0.16);
            const stepY = Math.max(11.0, Math.abs(dy) * 0.17);

            if ((Math.abs(dx) <= 14 && Math.abs(dy) <= 14) || this._arenaEnterMs >= 950) {
                this._arenaDiveStarted = true;
                this._arenaEntering = false;
                this._curX = this._arenaTargetX;
                this._curY = this._topGroundY;
                this._actor.set_position(Math.round(this._curX), Math.round(this._curY));
                this._effects.spawnParticle(this._curX + this._petW / 2, this._curY + 4, '💨', 14);
                this._actor.ease({
                    y: Math.round(this._curY + 34),
                    opacity: 0,
                    duration: 270,
                    mode: Clutter.AnimationMode.EASE_IN_BACK,
                    onComplete: () => {
                        if (this._actor)
                            this._actor.visible = false;
                        const cb = this._onArenaArrived;
                        this._onArenaArrived = null;
                        cb?.();
                    },
                });
                return;
            }

            const facing = dx >= 0 ? 'right' : 'left';
            this._curX += dx > 0 ? Math.min(dx, stepX) : Math.max(dx, -stepX);
            this._curY += dy > 0 ? Math.min(dy, stepY) : Math.max(dy, -stepY);
            const runFrames = this._bank.states.run || this._bank.states.walk || this._bank.states.idle;
            if (runFrames?.length) {
                this._frameAccMs += dtMs;
                if (this._frameAccMs >= 55) {
                    this._frameAccMs = 0;
                    this._frameIdx = (this._frameIdx + 1) % runFrames.length;
                }
                const f = runFrames[this._frameIdx % runFrames.length];
                this._actor.set_content(facing === 'left' ? f.left : f.right);
            }
            this._actor.set_position(Math.round(this._curX), Math.round(this._curY + this._jumpY));
            return;
        }

        let stateOverride = null;
        if (this._socialTimerMs > 0) {
            this._socialTimerMs -= dtMs;
            this._socialPhaseMs += dtMs;
            if (this._socialAnim === 'sync_dance') {
                stateOverride = 'happy';
                const bounce = Math.abs(Math.sin((this._socialPhaseMs / 190) * Math.PI));
                this._jumpY = -Math.round(bounce * 8);
                this._actor.rotation_angle_z = Math.sin((this._socialPhaseMs / 190) * Math.PI) * 10;
            } else if (this._socialAnim === 'leapfrog') {
                stateOverride = 'crouch';
                this._actor.set_scale(1.15, 0.72);
            } else if (this._socialAnim === 'spar_clash') {
                stateOverride = 'attack';
                this._actor.rotation_angle_z = Math.sin((this._socialPhaseMs / 180) * Math.PI) * 9;
            } else {
                stateOverride = 'happy';
            }
            if (this._socialTimerMs <= 0) {
                this._socialAnim = null;
                this._actor.set_scale(1.0, 1.0);
                this._actor.rotation_angle_z = 0;
            }
        } else {
            this._curX += (this._targetX - this._curX) * 0.14;
            this._curY += (this._targetY - this._curY) * 0.14;
        }

        const rawState = stateOverride || this.peer.state;
        const stateKey = this._bank.states[rawState] ? rawState : 'walk';
        const frames = this._bank.states[stateKey] || this._bank.states.idle;
        if (frames && frames.length > 0) {
            const cur = frames[this._frameIdx % frames.length];
            this._frameAccMs += dtMs;
            if (this._frameAccMs >= Math.max(35, cur.delayMs)) {
                this._frameAccMs = 0;
                this._frameIdx = (this._frameIdx + 1) % frames.length;
            }
            const f = frames[this._frameIdx % frames.length];
            const content = this.peer.facing === 'left' ? f.left : f.right;
            if (this._actor.content !== content)
                this._actor.set_content(content);
        }

        const rx = Math.round(this._curX);
        const ry = Math.round(this._curY + this._jumpY);
        this._actor.set_position(rx, ry);

        if (this._badge && this._badge.visible) {
            const [, bw] = this._badge.get_preferred_width(-1);
            const panelBox = Main.layoutManager.panelBox;
            const panelBottom = (panelBox?.y ?? 0) + (panelBox?.height ?? 32);
            const bx = Math.round(rx + this._petW / 2 - bw / 2);
            const by = ry > panelBottom + 36
                ? Math.round(ry - 18)
                : Math.round(panelBottom + 2);
            this._badge.set_position(bx, by);
        }
    }

    getX() {
        return this._curX;
    }

    getY() {
        return this._curY;
    }
}

/**
 * Coordinates local adopted pets + LAN visitor pets + RoamDirector Crowd Governance
 * + Cozy Campfire + High-CPU Eco Mode + Pomodoro Focus Expedition + Top-Bar World Boss!
 */
export class PetStageManager {
    constructor({
        extensionPath,
        settings,
        roster,
        perception,
        effects,
        sysMonitor,
        lanManager,
        callbacks = {},
    }) {
        this._extensionPath = extensionPath;
        this._settings = settings;
        this._roster = roster;
        this._perception = perception;
        this._effects = effects;
        this._sysMonitor = sysMonitor;
        this._lanManager = lanManager;
        this._callbacks = callbacks;

        this.localActors = new Map();
        this.remoteActors = new Map();
        this._releasingIds = new Set();
        this._arenaFallbackTimerId = 0;

        // RoamDirector & Cozy Campfire state
        this._rotationIdx = 0;
        this._campfireWidget = null;
        this._campfireSurf = null;

        // High-CPU Eco Quiet Mode & Work Context state
        this._highCpuStreak = 0;
        this._ecoActive = false;
        this._workContextAccSec = 0;

        // Pomodoro Focus Expedition state
        this._focusRemainSec = 0;
        this._focusTimerId = 0;

        // Top-Bar World Boss Invasion state
        this._worldBoss = null; // { actor, hud, bank, hp, maxHp, x, y, frameIdx, accMs, name }
        this._worldBossSpawnAccSec = 0;

        // Safe-Gap Fallback Egg Label (used ONLY when show-panel-icon is false!)
        this._safeGapEggBadge = null;

        this._settingsSignals = [
            this._settings.connect('changed::pets-visible', () => {
                if (!this._settings.get_boolean('pets-visible')) {
                    this._effects?.clearAllBubbles?.();
                    this._destroyWorldBoss();
                }
                this.syncLocalRoster();
                this._syncCampfireVisibility();
                this.syncSafeGapEggBadge();
            }),
            this._settings.connect('changed::free-roam-enabled', () => {
                this._rebalanceRoamDirector();
            }),
            this._settings.connect('changed::max-roaming-pets', () => {
                this._rebalanceRoamDirector();
            }),
            this._settings.connect('changed::show-panel-icon', () => {
                this.syncSafeGapEggBadge();
            }),
        ];

        this.syncLocalRoster();
        this.syncSafeGapEggBadge();

        // Main 40ms Social, Campfire VFX & World Boss Loop
        this._socialTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
            if (!Main.layoutManager?.panelBox?.get_stage?.()) {
                this._socialTimerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (!this._settings.get_boolean('pets-visible'))
                return GLib.SOURCE_CONTINUE;

            for (const remote of this.remoteActors.values())
                remote.tick(40);
            if (!this._ecoActive)
                this._checkPetToPetEncounters();
            if (this._campfireSurf && this._campfireWidget?.visible && !this._ecoActive) {
                if (!this._campfireSurf.hasActiveEffects())
                    this._campfireSurf.spawn('fire/campfire', { x: 40, y: 66, maxDuration: 8.0 });
                this._campfireSurf.step(0.04);
            }
            if (this._worldBoss)
                this._tickWorldBoss(40);
            return GLib.SOURCE_CONTINUE;
        });

        // 2-Second Eco Mode, RoamDirector Rotation, Work Context & World Boss Auto-Spawn Watcher
        this._directorTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 2, () => {
            this._stepEcoAndCompanionDirector(2);
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = [];

        if (this._arenaFallbackTimerId) {
            GLib.Source.remove(this._arenaFallbackTimerId);
            this._arenaFallbackTimerId = 0;
        }
        if (this._socialTimerId) {
            GLib.Source.remove(this._socialTimerId);
            this._socialTimerId = 0;
        }
        if (this._directorTimerId) {
            GLib.Source.remove(this._directorTimerId);
            this._directorTimerId = 0;
        }
        this.stopFocusExpedition(false);
        this._destroyWorldBoss();
        this._destroyCampfire();
        this._destroySafeGapEggBadge();

        for (const actor of this.localActors.values())
            actor.destroy();
        this.localActors.clear();

        for (const remote of this.remoteActors.values())
            remote.destroy();
        this.remoteActors.clear();
    }

    // =========================================================================
    // RoamDirector: Multi-Pet Anti-Chaos Quota, Rotation & Cozy Campfire
    // =========================================================================
    canTakeAirSlot(requestingPetId) {
        if (this._ecoActive || this._focusRemainSec > 0)
            return false;
        let airCount = 0;
        for (const [id, act] of this.localActors.entries()) {
            if (id !== requestingPetId && act.isAirborneRoamState())
                airCount += 1;
        }
        return airCount < 2; // Hard cap: never more than 2 pets airborne simultaneously!
    }

    canPerchOnLedge(metaWin, requestingPetId) {
        if (!metaWin)
            return false;
        let count = 0;
        for (const [id, act] of this.localActors.entries()) {
            if (id !== requestingPetId && act.getActiveLedgeWindow() === metaWin)
                count += 1;
        }
        return count < 2; // Hard cap: max 2 pets perched on the same window titlebar!
    }

    _rebalanceRoamDirector() {
        const freeRoam = this._settings.get_boolean('free-roam-enabled');
        const maxActive = Math.max(1, this._settings.get_int('max-roaming-pets') || 4);
        const allActors = Array.from(this.localActors.values());

        if (!freeRoam || allActors.length <= maxActive) {
            for (const act of allActors)
                act.setRoamAssignment('active_roamer', null);
            this._syncCampfireVisibility(false);
            return;
        }

        const bounds = this._perception?.getScreenRoamBounds?.(38, 38, 4);
        const campCenterX = bounds ? Math.max(bounds.minX + 80, bounds.maxX - 96) : 1100;

        // Primary pet always stays active; remaining slots rotate smoothly every 3 minutes!
        const primaryId = this._roster.primaryPetId;
        const others = allActors.filter(a => a.pet.id !== primaryId);
        const activeIds = new Set([primaryId]);

        for (let i = 0; i < others.length && activeIds.size < maxActive; i++) {
            const pickActor = others[(this._rotationIdx + i) % others.length];
            activeIds.add(pickActor.pet.id);
        }

        let campCount = 0;
        others.forEach((act, idx) => {
            if (activeIds.has(act.pet.id)) {
                act.setRoamAssignment('active_roamer', null);
            } else if (idx % 2 === 0) {
                const offset = (campCount % 3 - 1) * 28;
                campCount += 1;
                act.setRoamAssignment('camp_resting', campCenterX + offset);
            } else {
                act.setRoamAssignment('topbar_patrol', null);
            }
        });

        this._syncCampfireVisibility(campCount > 0, bounds, campCenterX);
    }

    _syncCampfireVisibility(shouldShow = false, bounds = null, campCenterX = 1100) {
        const masterVis = this._settings.get_boolean('pets-visible');
        const freeRoam = this._settings.get_boolean('free-roam-enabled');
        if (!shouldShow || !masterVis || !freeRoam || this._ecoActive) {
            this._destroyCampfire();
            return;
        }
        const b = bounds || this._perception?.getScreenRoamBounds?.(38, 38, 4);
        if (!b)
            return;

        if (!this._campfireWidget) {
            this._campfireSurf = new PixelFxSurface(80, 76, 1);
            this._campfireSurf.spawn('fire/campfire', { x: 40, y: 66, maxDuration: 8.0 });
            const w = new St.Widget({
                width: 80,
                height: 76,
                reactive: false,
            });
            w.set_content(this._campfireSurf.content);
            addChromeActor(w, { interactive: false, trackFullscreen: true });
            this._campfireWidget = w;
        }
        this._campfireWidget.set_position(Math.round(campCenterX - 20), Math.round(b.bottomGroundY + 38 - 66));
        this._campfireWidget.visible = true;
    }

    _destroyCampfire() {
        if (this._campfireWidget) {
            removeChromeActor(this._campfireWidget);
            this._campfireWidget.destroy();
            this._campfireWidget = null;
        }
        this._campfireSurf = null;
    }

    recallAllPetsToTopBar() {
        const bounds = this._perception?.getScreenRoamBounds?.(38, 38, 4);
        const list = Array.from(this.localActors.values());
        list.forEach((act, idx) => {
            const targetX = bounds
                ? Math.round(bounds.minX + 120 + idx * 54)
                : null;
            act.recallToTopBar(targetX);
        });
        this.getPrimaryActor()?.say('🎺 集合哨吹响！全员瞬间归队顶部栏列队完毕 ✨', 2400);
    }

    // =========================================================================
    // 🌱 High-CPU Eco Quiet Mode, 💻 Work Context & 🍅 Pomodoro Expedition
    // =========================================================================
    _stepEcoAndCompanionDirector(dtSec) {
        const cpu = this._sysMonitor?.cpuPercent ?? 0;
        if (cpu >= 70) {
            this._highCpuStreak += dtSec;
            if (!this._ecoActive && this._highCpuStreak >= 4) {
                this._ecoActive = true;
                this._effects.setEcoMode(true);
                for (const act of this.localActors.values())
                    act.setEcoMode(true);
                this._syncCampfireVisibility(false);
                this._callbacks.onDirectorStateChanged?.();
            }
        } else if (cpu < 42) {
            this._highCpuStreak = 0;
            if (this._ecoActive) {
                this._ecoActive = false;
                this._effects.setEcoMode(false);
                for (const act of this.localActors.values())
                    act.setEcoMode(false);
                this._roster.addCoins(15, false);
                this._rebalanceRoamDirector();
                this.getPrimaryActor()?.say('🤫 刚看你高负载忙正事，全队乖乖降频省电没吵你哟！奖励 +15🪙 ✨', 3000);
                this._callbacks.onDirectorStateChanged?.();
            }
        }

        if (this._ecoActive || !this._settings.get_boolean('pets-visible'))
            return;

        this._workContextAccSec += dtSec;
        if (this._workContextAccSec >= 60) {
            this._workContextAccSec = 0;
            this._rotationIdx += 1;
            if (this._rotationIdx % 3 === 0)
                this._rebalanceRoamDirector();

            const ctx = this._perception?.classifyFocusedAppContext?.();
            if (ctx?.category === 'coding') {
                this._roster.addCoins(6, false);
                this._roster.grantAllActivePetsXp(6);
                if (this._focusRemainSec <= 0 && Math.random() < 0.35)
                    this.getPrimaryActor()?.say(`💻 陪你在「${ctx.appName || '代码编辑器'}」敲代码攒下灵感，金币 +6 🪙`, 2400);
            } else if (ctx?.category === 'creative_docs') {
                for (const p of this._roster.pets)
                    p.mood = Math.min(100, p.mood + 3);
            }
            this.syncSafeGapEggBadge();
        }

        // Periodic Top-Bar World Boss Portal Invasion (every ~22 min if enabled & idle!)
        if (this._settings.get_boolean('world-boss-enabled') && !this._worldBoss && this._focusRemainSec <= 0) {
            this._worldBossSpawnAccSec += dtSec;
            if (this._worldBossSpawnAccSec >= 1320) {
                this._worldBossSpawnAccSec = 0;
                this.summonWorldBoss();
            }
        }
    }

    isEcoModeActive() {
        return this._ecoActive;
    }

    isFocusActive() {
        return this._focusRemainSec > 0;
    }

    getFocusRemainingSec() {
        return this._focusRemainSec;
    }

    toggleFocusExpedition(minutes = 25) {
        if (this._focusRemainSec > 0) {
            this.stopFocusExpedition(true);
            return false;
        }
        this._focusRemainSec = Math.max(60, Math.round(minutes * 60));
        this._effects.setMaxConcurrentBubbles(1);
        this.getPrimaryActor()?.say(`🍅 开启 ${minutes} 分钟专注地下城远征！我们安静扎营探险，不打扰你工作哟 ✨`, 3000);
        this._callbacks.onDirectorStateChanged?.();

        this._focusTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 1, () => {
            this._focusRemainSec = Math.max(0, this._focusRemainSec - 1);
            this._callbacks.onDirectorStateChanged?.();
            if (this._focusRemainSec <= 0) {
                this._focusTimerId = 0;
                this._effects.setMaxConcurrentBubbles(2);
                const reward = this._roster.recordFocusSessionCompleted();
                const relicTxt = reward.bonusRelic ? ` · 获得圣物【${reward.bonusRelic.name}】!` : '';
                this._effects.showQuestCompleteToast(
                    '🍅 专注地下城远征凯旋完成！',
                    `获得 +${reward.coins} 金币 & 全队大量经验${relicTxt} · 快起身喝口水休息一下吧 ✨`
                );
                this._callbacks.onDirectorStateChanged?.();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        return true;
    }

    stopFocusExpedition(notify = false) {
        if (this._focusTimerId) {
            GLib.Source.remove(this._focusTimerId);
            this._focusTimerId = 0;
        }
        this._focusRemainSec = 0;
        this._effects.setMaxConcurrentBubbles(2);
        if (notify)
            this.getPrimaryActor()?.say('已提前结束专注远征，随时准备再次出发 🐾', 2200);
        this._callbacks.onDirectorStateChanged?.();
    }

    // =========================================================================
    // 👾 Top-Bar World Boss Portal Invasion (Swarm Raid right on the Top Bar!)
    // =========================================================================
    isWorldBossActive() {
        return Boolean(this._worldBoss);
    }

    summonWorldBoss() {
        if (this._worldBoss || !this._settings.get_boolean('pets-visible'))
            return false;
        const bounds = this._perception?.getScreenRoamBounds?.(52, 52, 4);
        if (!bounds)
            return false;

        const tpl = BOSS_POOL[Math.floor(Math.random() * BOSS_POOL.length)];
        const bank = loadSpriteBankForProfile(this._extensionPath, { presetId: tpl.presetId, skinMode: 'preset' }, {
            targetHeight: 50,
            pixelCrisp: this._settings.get_boolean('pixel-art-scaling'),
        });

        const safeGap = this._perception?.findSafeTopBarEmptyGap?.(70);
        const bossX = safeGap
            ? Math.max(bounds.minX + 80, Math.min(bounds.maxX - 80, safeGap.centerX - Math.round(bank.width / 2)))
            : Math.round(bounds.minX + (bounds.maxX - bounds.minX) * 0.68);
        const bossY = Math.max(0, bounds.panelY + bounds.panelH - bank.height + 4);

        const actor = new St.Widget({
            width: bank.width,
            height: bank.height,
            reactive: true,
            track_hover: true,
        });
        actor.set_position(bossX, bossY);

        const petCount = Math.max(1, this.localActors.size);
        const maxHp = 220 + petCount * 95;
        const hud = new St.Label({
            text: `${tpl.name} · 100%`,
            style_class: 'topbar-pet-worldboss-hud',
            reactive: false,
        });
        hud.set_position(Math.max(8, bossX - 24), bounds.panelY + bounds.panelH + 4);

        addChromeActor(actor, { interactive: true, trackFullscreen: true });
        addChromeActor(hud, { interactive: false, trackFullscreen: true });

        this._worldBoss = {
            tpl,
            bank,
            actor,
            hud,
            x: bossX,
            y: bossY,
            hp: maxHp,
            maxHp,
            frameIdx: 0,
            accMs: 0,
        };

        // User can also click the World Boss to help their pets smite it!
        actor.connect('button-press-event', () => {
            this._damageWorldBoss(28, true);
            return Clutter.EVENT_STOP;
        });

        this._effects.spawnPixelFxBurst(bossX + bank.width / 2, bossY + bank.height, 'spawn/spawn-portal', 1);
        for (const petAct of this.localActors.values())
            petAct.setWorldBossTarget(bossX + Math.round(bank.width / 2));

        this.getPrimaryActor()?.say(`📯 警报！世界 Boss【${tpl.name}】入侵顶部栏！全员集结围殴！！⚔️`, 2800);
        this._callbacks.onDirectorStateChanged?.();
        return true;
    }

    _damageWorldBoss(amount, fromClick = false) {
        if (!this._worldBoss)
            return;
        const wb = this._worldBoss;
        wb.hp = Math.max(0, wb.hp - amount);
        const pct = Math.ceil((wb.hp / wb.maxHp) * 100);
        wb.hud.text = `${wb.tpl.name} · ${pct}%`;
        if (fromClick)
            this._effects.spawnPixelFxBurst(wb.x + wb.bank.width / 2, wb.y + wb.bank.height - 10, 'holy/smite', 1);

        if (wb.hp <= 0) {
            const bx = wb.x + wb.bank.width / 2;
            const by = wb.y + wb.bank.height;
            this._destroyWorldBoss();
            this._effects.spawnPixelFxBurst(bx, by, 'explosions/big-explosion', 1);
            this._effects.spawnPixelFxBurst(bx, by, 'spawn/coin-drop', 1, { coins: 9 });
            this._roster.stats.bossKills = (this._roster.stats.bossKills || 0) + 1;
            this._roster.addCoins(38, true);
            this._roster.grantAllActivePetsXp(28);
            this.getPrimaryActor()?.say(`🎉 成功击退世界 Boss【${wb.tpl.name}】！爆出满地金币 +38🪙 ✨`, 3200);
            this._callbacks.onDirectorStateChanged?.();
        }
    }

    _tickWorldBoss(dtMs) {
        const wb = this._worldBoss;
        if (!wb || !wb.actor)
            return;
        wb.accMs += dtMs;
        const frames = wb.bank.states.attack || wb.bank.states.idle;
        if (frames?.length && wb.accMs >= 110) {
            wb.accMs = 0;
            wb.frameIdx = (wb.frameIdx + 1) % frames.length;
            wb.actor.set_content(frames[wb.frameIdx].left);
        }
    }

    _destroyWorldBoss() {
        for (const petAct of this.localActors.values())
            petAct.setWorldBossTarget(null);
        if (!this._worldBoss)
            return;
        if (this._worldBoss.hud) {
            removeChromeActor(this._worldBoss.hud);
            this._worldBoss.hud.destroy();
        }
        if (this._worldBoss.actor) {
            removeChromeActor(this._worldBoss.actor);
            this._worldBoss.actor.destroy();
        }
        this._worldBoss = null;
    }

    // =========================================================================
    // 🥚 Zero-Occlusion Mystery Egg Safe-Gap Fallback & Hatch Celebration
    // =========================================================================
    syncSafeGapEggBadge() {
        const egg = this._roster.activeEgg;
        const panelIconShown = this._settings.get_boolean('show-panel-icon');
        const petsVis = this._settings.get_boolean('pets-visible');

        // When panel icon is shown, the egg is embedded INSIDE our own PanelMenu button (100% zero overlap!).
        // Only place a non-reactive click-through safe-gap badge when panel icon is hidden!
        if (!egg || panelIconShown || !petsVis) {
            this._destroySafeGapEggBadge();
            return;
        }

        const gap = this._perception?.findSafeTopBarEmptyGap?.(48);
        if (!gap) {
            this._destroySafeGapEggBadge();
            return;
        }

        if (!this._safeGapEggBadge) {
            const lbl = new St.Label({
                text: `🥚${egg.progress}%`,
                style_class: 'topbar-pet-lan-badge',
                reactive: false, // 100% click-through!
            });
            addChromeActor(lbl, { interactive: false, trackFullscreen: true });
            this._safeGapEggBadge = lbl;
        } else {
            this._safeGapEggBadge.text = `🥚${egg.progress}%`;
        }
        this._safeGapEggBadge.set_position(Math.round(gap.centerX - 22), Math.round(gap.panelY + 6));
    }

    _destroySafeGapEggBadge() {
        if (this._safeGapEggBadge) {
            removeChromeActor(this._safeGapEggBadge);
            this._safeGapEggBadge.destroy();
            this._safeGapEggBadge = null;
        }
    }

    playEggHatchCelebration(babyPet, traitMeta) {
        this.syncSafeGapEggBadge();
        const primary = this.getPrimaryActor();
        if (primary) {
            const rect = primary.getAnchorRect();
            this._effects.spawnPixelFxBurst(rect.x + rect.width / 2 + 28, rect.y + rect.height, 'spawn/egg-hatch', 1);
        }
        const traitStr = traitMeta ? ` · 天生词条【${traitMeta.label}】` : '';
        this._effects.showBannerToast(
            `🥚 神秘宠物蛋破壳诞生！「${babyPet.name}」加入小队！`,
            `初始 Lv.${babyPet.level}${traitStr} ✨`,
            null,
            4800
        );
    }

    // =========================================================================
    // Standard Stage Coordination, Arena Entrance/Return & Social Encounters
    // =========================================================================
    getPrimaryActor() {
        const primary = this._roster.getPrimaryPet();
        return primary ? (this.localActors.get(primary.id) || Array.from(this.localActors.values())[0]) : null;
    }

    getPrimaryMotionState() {
        const actor = this.getPrimaryActor();
        return actor ? actor.getMotionSnapshot() : { normX: 0.5, state: 'walk', facing: 'right' };
    }

    playArenaEntrance(fightersOrLeft, maybeRightOrCb, maybeCb) {
        this.returnFightersFromArena(null, true);

        const onReady = typeof maybeRightOrCb === 'function' ? maybeRightOrCb : maybeCb;
        const fighterList = Array.isArray(fightersOrLeft)
            ? fightersOrLeft
            : [fightersOrLeft, typeof maybeRightOrCb === 'object' ? maybeRightOrCb : null].filter(Boolean);

        const participants = [];
        const panelBox = Main.layoutManager?.panelBox;
        const px = Number.isFinite(panelBox?.x) ? panelBox.x : 0;
        const pw = (Number.isFinite(panelBox?.width) && panelBox.width > 64) ? panelBox.width : 1280;
        const centerX = Math.round(px + pw / 2);

        fighterList.forEach((fighter, idx) => {
            if (!fighter)
                return;
            const slotOffset = (idx % 2 === 0 ? -1 : 1) * (24 + idx * 16);
            if (fighter.id && this.localActors.has(fighter.id)) {
                participants.push({
                    actor: this.localActors.get(fighter.id),
                    targetX: centerX + slotOffset,
                    cry: null,
                });
            } else if (fighter.peerId && this.remoteActors.has(fighter.peerId)) {
                participants.push({
                    actor: this.remoteActors.get(fighter.peerId),
                    targetX: centerX + slotOffset,
                    cry: `${fighter.name}：应战！我来也 ⚔️🔥`,
                });
            }
        });

        if (participants.length === 0) {
            onReady?.();
            return;
        }

        let completed = false;
        let remaining = participants.length;
        const finishOnce = () => {
            if (completed)
                return;
            completed = true;
            if (this._arenaFallbackTimerId) {
                GLib.Source.remove(this._arenaFallbackTimerId);
                this._arenaFallbackTimerId = 0;
            }
            onReady?.();
        };

        this._arenaFallbackTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1450, () => {
            this._arenaFallbackTimerId = 0;
            finishOnce();
            return GLib.SOURCE_REMOVE;
        });

        for (const p of participants) {
            p.actor.enterArenaBattle(p.targetX, p.cry, () => {
                remaining -= 1;
                if (remaining <= 0)
                    finishOnce();
            });
        }
    }

    returnFightersFromArena(winnerId = null, silentReset = false) {
        if (this._arenaFallbackTimerId) {
            GLib.Source.remove(this._arenaFallbackTimerId);
            this._arenaFallbackTimerId = 0;
        }
        for (const local of this.localActors.values()) {
            if (local.isInArenaBattle()) {
                const didWin = silentReset || !winnerId ? null : (local.pet.id === winnerId);
                local.returnFromArena(didWin);
            }
        }
        for (const remote of this.remoteActors.values()) {
            if (remote.isInArenaBattle())
                remote.returnFromArena();
        }
    }

    syncLocalRoster() {
        const masterVis = this._settings.get_boolean('pets-visible');
        const desiredIds = new Set();

        if (masterVis) {
            this._roster.pets.forEach((petRec, idx) => {
                if (petRec.onTopBar === false || this._releasingIds.has(petRec.id))
                    return;
                desiredIds.add(petRec.id);

                const existing = this.localActors.get(petRec.id);
                if (existing) {
                    existing.updateProfile(petRec);
                } else {
                    const actor = new PetActor({
                        extensionPath: this._extensionPath,
                        settings: this._settings,
                        petRecord: petRec,
                        slotIndex: idx,
                        roster: this._roster,
                        perception: this._perception,
                        effects: this._effects,
                        sysMonitor: this._sysMonitor,
                        callbacks: {
                            onStartPracticeBattle: (opp, mode) => this._callbacks.onStartPracticeBattle?.(opp, mode),
                            onStartBossRaid: () => this._callbacks.onStartBossRaid?.(),
                            onRequestReleasePet: id => this.releasePetWithAnimation(id),
                            onOpenPrefs: () => this._callbacks.onOpenPrefs?.(),
                            canTakeAirSlot: id => this.canTakeAirSlot(id),
                            canPerchOnLedge: (mw, id) => this.canPerchOnLedge(mw, id),
                            onWorldBossHit: pet => {
                                const dmg = 14 + (pet.level || 1) * 3;
                                this._damageWorldBoss(dmg, false);
                            },
                            onEggFound: () => {
                                this.syncSafeGapEggBadge();
                                this._callbacks.onDirectorStateChanged?.();
                            },
                        },
                    });
                    if (this._ecoActive)
                        actor.setEcoMode(true);
                    this.localActors.set(petRec.id, actor);
                }
            });
        }

        for (const [id, actor] of this.localActors.entries()) {
            if (!desiredIds.has(id) && !this._releasingIds.has(id)) {
                this._effects?.clearBubbleByKey?.(id);
                actor.destroy();
                this.localActors.delete(id);
            }
        }

        this._rebalanceRoamDirector();
    }

    releasePetWithAnimation(petId) {
        const actor = this.localActors.get(petId);
        if (actor) {
            this._releasingIds.add(petId);
            this.localActors.delete(petId);
            actor.playFarewellAndDestroy(() => {
                this._releasingIds.delete(petId);
                this._roster.releasePet(petId);
                this._rebalanceRoamDirector();
            });
        } else {
            this._roster.releasePet(petId);
        }
    }

    onMonitorsChanged() {
        for (const actor of this.localActors.values())
            actor.clampToMonitor();
        for (const remote of this.remoteActors.values())
            remote.updateFromBeacon(remote.peer, true);
        this._rebalanceRoamDirector();
        this.syncSafeGapEggBadge();
    }

    onPeerBeacon(peerInfo, isNew) {
        let remote = this.remoteActors.get(peerInfo.peerId);
        if (!remote) {
            remote = new RemotePetActor({
                extensionPath: this._extensionPath,
                settings: this._settings,
                peerInfo,
                perception: this._perception,
                lanManager: this._lanManager,
                effects: this._effects,
                callbacks: {
                    onChallengeLanPeer: (peer, mode) => this._callbacks.onChallengeLanPeer?.(peer, mode),
                },
            });
            this.remoteActors.set(peerInfo.peerId, remote);
            if (isNew) {
                const primary = this.getPrimaryActor();
                primary?.say(`🌐 发现局域网伙伴「${peerInfo.ownerName}」的 ${peerInfo.petName} 来串门啦！✨`, 2800);
            }
        } else {
            remote.updateFromBeacon(peerInfo, false);
        }
    }

    onPeerLeft(peerId) {
        const remote = this.remoteActors.get(peerId);
        if (remote) {
            remote.destroy();
            this.remoteActors.delete(peerId);
        }
    }

    onPeerSkinReady(peerId) {
        const remote = this.remoteActors.get(peerId);
        if (remote)
            remote.reloadSkin();
    }

    _checkPetToPetEncounters() {
        const now = Date.now();
        const locals = Array.from(this.localActors.values()).filter(a => a.isAvailableForSocial());

        for (let i = 0; i < locals.length; i++) {
            const a = locals[i];
            if (!a.isAvailableForSocial() || now - a.lastSocialMs < 8500)
                continue;
            for (let j = i + 1; j < locals.length; j++) {
                const b = locals[j];
                if (!b.isAvailableForSocial() || now - b.lastSocialMs < 8500)
                    continue;
                const snapA = a.getMotionSnapshot();
                const snapB = b.getMotionSnapshot();
                if (Math.abs(snapA.x - snapB.x) <= 42 && Math.abs(snapA.y - snapB.y) <= 36) {
                    const chosen = DUO_KINDS[Math.floor(Math.random() * DUO_KINDS.length)];
                    a.triggerSocialInteraction(b.pet.name, snapB.x, chosen, 'A');
                    b.triggerSocialInteraction(a.pet.name, snapA.x, chosen, 'B');
                    this._roster.grantXp(a.pet.id, 4);
                    this._roster.grantXp(b.pet.id, 4);
                    break;
                }
            }
        }

        for (const local of locals) {
            if (now - local.lastSocialMs < 9500)
                continue;
            const snapL = local.getMotionSnapshot();
            for (const remote of this.remoteActors.values()) {
                if (remote.isInArenaBattle() || now - remote.lastSocialMs < 9500)
                    continue;
                if (Math.abs(snapL.x - remote.getX()) <= 42 && Math.abs(snapL.y - remote.getY()) <= 36) {
                    const visitorKinds = ['high_five', 'sync_dance', 'spar_clash', 'leapfrog', 'nuzzle', 'gossip_chat'];
                    const chosen = visitorKinds[Math.floor(Math.random() * visitorKinds.length)];
                    const localRole = chosen === 'leapfrog' ? 'B' : 'A';
                    remote.triggerSocialReaction(chosen, snapL.x);
                    local.triggerSocialInteraction(remote.peer.petName, remote.getX(), chosen, localRole);
                    this._roster.grantXp(local.pet.id, 4);
                    break;
                }
            }
        }
    }
}
