import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { addChromeActor, removeChromeActor } from './compat.js';
import { loadSpriteBankForProfile } from './spriteLoader.js';
import { getArchetype } from './rpg.js';
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
 * Renders a LAN Peer's Visitor Pet on your Top Panel, smoothly interpolating
 * normalized coordinates (0..1) across any screen resolution, with social reactions
 * and Arena entrance/exit choreography!
 */
class RemotePetActor {
    constructor({ extensionPath, settings, peerInfo, perception, lanManager, effects, onChallengePeer }) {
        this._extensionPath = extensionPath;
        this._settings = settings;
        this.peer = peerInfo;
        this._perception = perception;
        this._lanManager = lanManager;
        this._effects = effects;
        this._onChallengePeer = onChallengePeer;

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
            text: `🌐 ${peerInfo.ownerName}·${peerInfo.petName} Lv.${peerInfo.level}`,
            style_class: 'topbar-pet-lan-badge',
            reactive: false,
            opacity: 215,
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

    say(text, durationMs = 1600) {
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
        this._menu.addMenuItem(new PopupMenu.PopupMenuItem(
            `🌐 ${this.peer.ownerName} 的「${this.peer.petName}」 Lv.${this.peer.level} [${arch.badge}]`,
            { reactive: false }
        ));
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._menu.addAction('⚔️ 申请局域网对战！', () => {
            this._onChallengePeer?.(this.peer);
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

        // Respect local user's free-roam switch: only roam into screen space when local user also enabled it!
        const localFreeRoam = this._settings.get_boolean('free-roam-enabled');
        const peerNormY = (localFreeRoam && peerInfo.freeRoam) ? Math.max(0, Math.min(1, Number(peerInfo.normY) || 0)) : 0;
        this._targetY = bounds.groundY + peerNormY * Math.max(0, bounds.bottomGroundY - bounds.groundY);

        if (snapImmediate || !Number.isFinite(this._curX) || !Number.isFinite(this._curY)) {
            this._curX = this._targetX;
            this._curY = this._targetY;
        }

        if (this._badge)
            this._badge.text = `🌐 ${peerInfo.ownerName}·${peerInfo.petName} Lv.${peerInfo.level}`;
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

        // Pre-battle 2D sprint to Top-Center + downward dive into Arena!
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

        // Normal 2D LAN interpolation & local social reaction flair
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
 * Coordinates up to 3 local adopted pets + unlimited LAN visitor pets on the Top Panel,
 * including 9 sibling/visitor social choreographies and Arena entrance/exit transitions!
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

        this.localActors = new Map();  // petId -> PetActor
        this.remoteActors = new Map(); // peerId -> RemotePetActor
        this._releasingIds = new Set();
        this._arenaFallbackTimerId = 0;

        this._visSignalId = this._settings.connect('changed::pets-visible', () => {
            if (!this._settings.get_boolean('pets-visible'))
                this._effects?.clearAllBubbles?.();
            this.syncLocalRoster();
        });

        this.syncLocalRoster();

        this._socialTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
            if (!Main.layoutManager?.panelBox?.get_stage?.()) {
                this._socialTimerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (!this._settings.get_boolean('pets-visible'))
                return GLib.SOURCE_CONTINUE;
            for (const remote of this.remoteActors.values())
                remote.tick(40);
            this._checkPetToPetEncounters();
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        if (this._visSignalId && this._settings) {
            this._settings.disconnect(this._visSignalId);
            this._visSignalId = 0;
        }
        if (this._arenaFallbackTimerId) {
            GLib.Source.remove(this._arenaFallbackTimerId);
            this._arenaFallbackTimerId = 0;
        }
        if (this._socialTimerId) {
            GLib.Source.remove(this._socialTimerId);
            this._socialTimerId = 0;
        }
        for (const actor of this.localActors.values())
            actor.destroy();
        this.localActors.clear();

        for (const remote of this.remoteActors.values())
            remote.destroy();
        this.remoteActors.clear();
    }

    getPrimaryActor() {
        const primary = this._roster.getPrimaryPet();
        return primary ? (this.localActors.get(primary.id) || Array.from(this.localActors.values())[0]) : null;
    }

    getPrimaryMotionState() {
        const actor = this.getPrimaryActor();
        return actor ? actor.getMotionSnapshot() : { normX: 0.5, state: 'walk', facing: 'right' };
    }

    /**
     * Have participating Top-Bar pets shout "我来也！", run to Top-Center, leap down
     * into the Arena, and hide from the Top Bar until the fight ends!
     */
    playArenaEntrance(leftFighter, rightFighter, onReady) {
        // Restore any stale hidden state from an interrupted previous fight first
        this.returnFightersFromArena(null, true);

        const participants = [];
        const panelBox = Main.layoutManager?.panelBox;
        const px = Number.isFinite(panelBox?.x) ? panelBox.x : 0;
        const pw = (Number.isFinite(panelBox?.width) && panelBox.width > 64) ? panelBox.width : 1280;
        const centerX = Math.round(px + pw / 2);

        const findParticipant = (fighter, slotOffset) => {
            if (!fighter)
                return;
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
        };

        findParticipant(leftFighter, -44);
        findParticipant(rightFighter, 12);

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

    /**
     * Restore any pets that dived into the Arena back onto the Top Bar!
     */
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
                            onStartPracticeBattle: opp => this._callbacks.onStartPracticeBattle?.(opp),
                            onRequestReleasePet: id => this.releasePetWithAnimation(id),
                            onOpenPrefs: () => this._callbacks.onOpenPrefs?.(),
                        },
                    });
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
    }

    releasePetWithAnimation(petId) {
        const actor = this.localActors.get(petId);
        if (actor) {
            this._releasingIds.add(petId);
            this.localActors.delete(petId);
            actor.playFarewellAndDestroy(() => {
                this._releasingIds.delete(petId);
                this._roster.releasePet(petId);
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
                onChallengePeer: peer => this._callbacks.onChallengeLanPeer?.(peer),
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

    /**
     * Automatic Pet-to-Pet Duo Interactions (9 choreographies across Sibling & LAN Visitor Pets!)
     */
    _checkPetToPetEncounters() {
        const now = Date.now();
        const locals = Array.from(this.localActors.values()).filter(a => a.isAvailableForSocial());

        // 1. Sibling-to-Sibling encounters (among all active adopted pets!)
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

        // 2. Local-to-LAN Visitor encounters (2D aware)!
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
                    // For leapfrog with a remote visitor, remote crouches ('A') while local vaults over ('B')!
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
