import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { addChromeActor, removeChromeActor } from './compat.js';
import { loadSpriteBankForProfile } from './spriteLoader.js';
import { getArchetype } from './rpg.js';
import { SKILL_CATALOG } from './skillSystem.js';

const QUOTES = {
    cat: {
        idle: ['喵呜~ 🐾', '今天也要开心喵~', '伸个大懒腰~ ✨', '盯—— 👀'],
        pet: ['喵~ 好舒服 ❤️', '再摸摸头嘛~', '呼噜呼噜~ 💕'],
        cpuHigh: ['CPU 火力全开！冲鸭 🔥', '光速跑酷喵！！💨'],
        battleCry: ['喵呜！我来也，看招 ⚔️', '猫猫拳准备就绪！冲鸭 🔥', '擂台见真章喵！💨'],
    },
    shiba: {
        idle: ['汪！今天天气真好 🐾', '摇尾巴~ ✨', '在顶部栏巡逻中！'],
        pet: ['汪汪！好开心 ❤️', '摸肚皮最棒啦！✨'],
        cpuHigh: ['全速冲刺汪！！🔥', 'CPU 狂飙陪跑中 ⚡'],
        battleCry: ['汪！我来也，绝不退缩 ⚔️', '柴柴旋风出击！！🔥', '应战！看我一招制敌 💨'],
    },
    slime: {
        idle: ['噗噜噗噜~ 💧', 'Q弹果冻晃呀晃~', '啵唧！✨'],
        pet: ['噗叽 ❤️ 好软乎！', '开心到冒泡~ 🫧'],
        cpuHigh: ['超音速弹射！！⚡', '果冻氮气加速 🔥'],
        battleCry: ['噗噜！我来也，弹射出击 ⚔️', 'Q弹战神登场啦！💧🔥', '看招！果冻重击 💨'],
    },
    robot: {
        idle: ['BEEP-BOOP 🤖', '系统扫描：一切正常 ✨', '天线信号满格 📡'],
        pet: ['好感度 +999 ❤️', 'HAPPY_INTERRUPT ✨'],
        cpuHigh: ['检测到高负载！喷射推进 🔥', 'OVERCLOCK 涡轮全开 ⚡'],
        battleCry: ['战斗协议启动：我来也 ⚔️', '推进器全开，目标擂台！🤖🔥', '锁定对手，出击 ⚡'],
    },
    dragon: {
        idle: ['嗷呜~ 喷口小火苗 🔥', '拍拍小翅膀~ ✨', '守护你的桌面！🐲'],
        pet: ['嗷呜 ❤️ 鳞片暖呼呼的~', '开心喷出小火花 ✨'],
        cpuHigh: ['龙炎推进全开！！🔥', '展翅极速滑翔 💨'],
        battleCry: ['嗷呜！本龙来也，接招 ⚔️🔥', '展翅俯冲进擂台咯！🐲', '龙炎觉醒，一决高下 🔥'],
    },
    ghost: {
        idle: ['呜哇~ 飘来飘去 👻', '星光闪烁~ ✨', '穿墙路过中~'],
        pet: ['嘿嘿~ 摸到星尘啦 ❤️', '开心转圈圈 ✨'],
        cpuHigh: ['星界灵体加速！！⚡', '化作流星飞驰 💫'],
        battleCry: ['嘿嘿~ 我来也，小心背后 👻⚔️', '化作星光跃入擂台！✨', '吃我一记星界秘术 🔮'],
    },
};

const CLASS_PRACTICE_FX = {
    martial: 'melee/claw-swipe',
    fire: 'fire/fire-ring',
    ice: 'ice/ice-crystal',
    storm: 'lightning/electrified',
    arcane: 'arcane/magic-circle-cast',
    holy: 'holy/heal-aoe',
};

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function nowTimeStr() {
    const dt = GLib.DateTime.new_now_local();
    return dt ? dt.format('%H:%M') : '';
}

/**
 * Represents one adopted local pet roaming across the entire GNOME Top Panel
 * with rich icon interactions, partner duo choreography, solo stunts, and arena entrance!
 */
export class PetActor {
    constructor({
        extensionPath,
        settings,
        petRecord,
        slotIndex = 0,
        roster,
        perception,
        effects,
        sysMonitor,
        callbacks = {},
    }) {
        this._extensionPath = extensionPath;
        this._settings = settings;
        this.pet = petRecord;
        this._slotIndex = slotIndex;
        this._roster = roster;
        this._perception = perception;
        this._effects = effects;
        this._sysMonitor = sysMonitor;
        this._callbacks = callbacks;

        this._bank = null;
        this._petW = 32;
        this._petH = 32;

        // Position & physics
        this._x = 200 + slotIndex * 160;
        this._y = 0;
        this._jumpY = 0;
        this._lungeX = 0;
        this._vy = 0;
        this._facing = slotIndex % 2 === 0 ? 'right' : 'left';

        // AI & Choreography State
        this._state = 'walk';
        this._stateTimerMs = 3600 + slotIndex * 900;
        this._statePhaseMs = 0;
        this._frameIdx = 0;
        this._frameElapsedMs = 0;
        this._sleepParticleAccMs = 0;
        this._bubbleAccMs = slotIndex * 11000;
        this._lastCpuShoutTime = 0;
        this._lastHoverTime = 0;
        this._lastRoofTime = 0;
        this._isReleasing = false;
        this._inArenaBattle = false;
        this._arenaTargetX = 0;
        this._arenaDiveStarted = false;
        this._onArenaArrived = null;

        // Top-bar widget, full-screen surface, stunt & social state
        this._widgetCooldowns = new WeakMap();
        this._activeTarget = null;
        this._roamSurface = 'topbar'; // 'topbar' | 'ledge' | 'floor' | 'air'
        this._activeLedge = null;     // { metaWin, appName, x1, x2, y }
        this._fallVy = 0;
        this._climbDirY = -1;
        this._ascendTargetY = 0;
        this._ascendLedge = null;
        this._propBadge = null;       // Non-reactive prop badge above pet
        this._grappleLine = null;     // Non-reactive pendulum line during grapple_swing
        this._roamRole = 'active_roamer'; // 'active_roamer' | 'topbar_patrol' | 'camp_resting'
        this._campSpotX = null;
        this._ecoMode = false;
        this._parkourArc = null;      // { x0, y0, x1, y1, durMs, targetLedge }
        this._grappleArc = null;      // { ax, ay, len, ang0, ang1, durMs, targetLedge }
        this._bezelClimb = null;      // { x, yTarget, ledge, onLeft }
        this._worldBossTargetX = null;
        this._lastTreasureMs = Date.now() - Math.floor(Math.random() * 20000);
        this._lastHitComboStep = -1;
        this._stuntTriggered = false;
        this._sneakExitX = null;
        this._hurdleTargetX = null;
        this._sneakFootstepAccMs = 0;
        this._duoData = null;
        this.lastSocialMs = 0;

        // Click & drag
        this._dragging = false;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._actorStartX = 0;
        this._actorStartY = 0;
        this._stageCaptureId = 0;
        this._clickCombo = 0;
        this._lastClickMs = 0;
        this._replyTimerId = 0;

        const clickThrough = this._settings.get_boolean('click-through');
        this._actor = new St.Widget({
            style_class: 'topbar-pet-actor',
            reactive: !clickThrough,
            track_hover: !clickThrough,
            can_focus: false,
            opacity: this._settings.get_int('pet-opacity'),
        });
        this._actor.set_pivot_point(0.5, 1.0);

        this._chromeAdded = false;
        this._syncChromeRegistration();

        this._contextMenu = null;
        this._contextMenuManager = null;
        this._buildContextMenu();

        this._actorSignals = [
            this._actor.connect('button-press-event', (_a, event) => this._onButtonPress(event)),
            this._actor.connect('enter-event', () => this._onHoverEnter()),
            this._actor.connect('scroll-event', (_a, event) => this._onScroll(event)),
            this._actor.connect('destroy', () => {
                this._actor = null;
                this._chromeAdded = false;
                if (this._loopId) {
                    GLib.Source.remove(this._loopId);
                    this._loopId = 0;
                }
            }),
        ];

        this._settingsSignals = [
            this._settings.connect('changed::pet-size', () => this.reloadSprites()),
            this._settings.connect('changed::pixel-art-scaling', () => this.reloadSprites()),
            this._settings.connect('changed::click-through', () => {
                this._syncChromeRegistration();
                this._rebuildContextMenuItems();
            }),
            this._settings.connect('changed::pet-opacity', () => {
                if (this._actor && !this._inArenaBattle)
                    this._actor.opacity = Math.max(50, Math.min(255, this._settings.get_int('pet-opacity')));
            }),
            this._settings.connect('changed::free-roam-enabled', () => {
                this._onFreeRoamToggled();
                this._rebuildContextMenuItems();
            }),
        ];

        this.reloadSprites();
        const bounds = this._getBounds();
        if (bounds) {
            const tbMin = bounds.topBarMinX ?? bounds.minX;
            const tbMax = bounds.topBarMaxX ?? bounds.maxX;
            const span = Math.max(60, tbMax - tbMin);
            this._x = Math.round(tbMin + span * ((0.18 + slotIndex * 0.25) % 0.82));
            this._y = bounds.groundY;
            this._applyPosition();
        } else {
            this._x = Number.NaN;
        }

        this._loopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
            this._tick(33);
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        if (this._replyTimerId) {
            GLib.Source.remove(this._replyTimerId);
            this._replyTimerId = 0;
        }
        if (this._loopId) {
            GLib.Source.remove(this._loopId);
            this._loopId = 0;
        }
        this._endStageDragCapture();
        this._clearPropBadge();
        this._clearGrappleLine();

        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = [];

        if (this._actor) {
            for (const id of this._actorSignals)
                this._actor.disconnect(id);
        }
        this._actorSignals = [];

        if (this._contextMenu) {
            this._contextMenu.destroy();
            this._contextMenu = null;
            this._contextMenuManager = null;
        }

        if (this._chromeAdded && this._actor) {
            removeChromeActor(this._actor);
            this._chromeAdded = false;
        }
        if (this._actor) {
            this._actor.destroy();
            this._actor = null;
        }
        this._bank = null;
    }

    updateProfile(updatedPet) {
        const skinChanged = (
            this.pet.skinMode !== updatedPet.skinMode ||
            this.pet.presetId !== updatedPet.presetId ||
            this.pet.customPath !== updatedPet.customPath ||
            this.pet.cols !== updatedPet.cols ||
            this.pet.rows !== updatedPet.rows ||
            this.pet.baseFacingRight !== updatedPet.baseFacingRight ||
            this.pet.autoRemoveBg !== updatedPet.autoRemoveBg
        );
        this.pet = updatedPet;
        if (skinChanged)
            this.reloadSprites();
    }

    isAvailableForSocial() {
        return !this._isReleasing && !this._inArenaBattle && !this._ecoMode &&
            this._worldBossTargetX === null &&
            !['drag', 'arena_enter', 'sleep', 'parachute_glide', 'balloon_ascend', 'wall_climb', 'free_fall',
                'window_parkour', 'grapple_swing', 'window_bezel_climb', 'class_glider', 'dig_treasure'].includes(this._state);
    }

    isAirborneRoamState() {
        return ['parachute_glide', 'balloon_ascend', 'wall_climb', 'free_fall', 'window_parkour', 'grapple_swing', 'window_bezel_climb', 'class_glider'].includes(this._state);
    }

    getActiveLedgeWindow() {
        return this._roamSurface === 'ledge' ? (this._activeLedge?.metaWin || null) : null;
    }

    setEcoMode(enabled) {
        const next = Boolean(enabled);
        if (this._ecoMode === next)
            return;
        this._ecoMode = next;
        if (next && !this._inArenaBattle && !this._isReleasing) {
            this._clearPropBadge();
            this._clearGrappleLine();
            this._resetPoseTransform();
            if (this.isAirborneRoamState()) {
                const bounds = this._getBounds();
                if (bounds) {
                    this._y = bounds.groundY;
                    this._roamSurface = 'topbar';
                }
            }
            this._setState('sleep', 60000);
        } else if (!next && this._state === 'sleep' && !this._inArenaBattle) {
            this._setState('idle', 1800);
        }
    }

    setRoamAssignment(role = 'active_roamer', campSpotX = null) {
        this._roamRole = role;
        this._campSpotX = campSpotX;
        if (!this.isFreeRoamEnabled() || this._inArenaBattle || this._isReleasing)
            return;
        const bounds = this._getBounds();
        if (!bounds)
            return;

        if (role === 'topbar_patrol' && this._roamSurface !== 'topbar' && !this.isAirborneRoamState()) {
            this._roamSurface = 'topbar';
            this._activeLedge = null;
            this._y = bounds.groundY;
            this._applyPosition();
        } else if (role === 'camp_resting' && this._roamSurface !== 'floor' && !this.isAirborneRoamState() && Number.isFinite(campSpotX)) {
            this._roamSurface = 'floor';
            this._activeLedge = null;
            this._x = Math.max(bounds.minX, Math.min(bounds.maxX, campSpotX));
            this._y = bounds.bottomGroundY;
            this._setState(Math.random() < 0.55 ? 'sleep' : 'idle', 12000);
            this._applyPosition();
        }
    }

    recallToTopBar(targetX = null) {
        if (this._inArenaBattle || this._isReleasing)
            return;
        const bounds = this._getBounds();
        if (!bounds)
            return;
        this._clearPropBadge();
        this._clearGrappleLine();
        this._resetPoseTransform();
        this._effects.spawnPixelFxBurst(this._x + this._petW / 2, this._y + this._petH, 'arcane/blink-out', 1);
        this._roamSurface = 'topbar';
        this._activeLedge = null;
        if (Number.isFinite(targetX))
            this._x = Math.max(bounds.minX, Math.min(bounds.maxX, targetX));
        this._y = bounds.groundY;
        this._jump(-4.5);
        this._setState('happy', 1300);
        this._effects.spawnPixelFxBurst(this._x + this._petW / 2, this._y + this._petH, 'arcane/blink-in', 1);
        this._applyPosition();
    }

    setWorldBossTarget(bossX = null) {
        this._worldBossTargetX = Number.isFinite(bossX) ? bossX : null;
        if (this._worldBossTargetX !== null && !this._inArenaBattle && !this._isReleasing) {
            const bounds = this._getBounds();
            if (bounds && this._roamSurface !== 'topbar') {
                this._clearPropBadge();
                this._clearGrappleLine();
                this._roamSurface = 'topbar';
                this._activeLedge = null;
                this._y = bounds.groundY;
            }
            this._setState('run', 4000);
        }
    }

    isInArenaBattle() {
        return this._inArenaBattle;
    }

    isFreeRoamEnabled() {
        return this._settings.get_boolean('free-roam-enabled');
    }

    getMotionSnapshot() {
        const bounds = this._getBounds();
        const spanX = bounds ? Math.max(1, bounds.maxX - bounds.minX) : 1200;
        const baseMinX = bounds ? bounds.minX : 0;
        const safeX = Number.isFinite(this._x) ? this._x : 240;
        const safeY = Number.isFinite(this._y) ? this._y : (bounds?.groundY ?? 0);
        const freeRoam = this.isFreeRoamEnabled();
        let normY = 0;
        if (freeRoam && bounds && bounds.bottomGroundY > bounds.groundY) {
            normY = Math.max(0, Math.min(1, (safeY - bounds.groundY) / (bounds.bottomGroundY - bounds.groundY)));
        }

        const animKey = this._resolveAnimKey();
        const netState = ['attack', 'sneak', 'cast', 'hurt', 'sleep', 'happy', 'run', 'walk', 'idle', 'crouch', 'guard'].includes(animKey)
            ? animKey
            : 'walk';

        return {
            normX: Math.max(0, Math.min(1, (safeX - baseMinX) / spanX)),
            normY,
            freeRoam: freeRoam && normY > 0.02,
            state: netState,
            facing: this._facing,
            x: safeX,
            y: safeY,
            width: this._petW,
            height: this._petH,
        };
    }

    getAnchorRect() {
        return {
            x: this._x + this._lungeX,
            y: this._y + this._jumpY,
            width: this._petW,
            height: this._petH,
        };
    }

    reloadSprites() {
        if (!this._actor)
            return;
        this._bank = loadSpriteBankForProfile(this._extensionPath, this.pet, {
            targetHeight: this._settings.get_int('pet-size'),
            pixelCrisp: this._settings.get_boolean('pixel-art-scaling'),
        });
        this._petW = this._bank.width;
        this._petH = this._bank.height;
        this._actor.set_size(this._petW, this._petH);
        this._frameIdx = 0;
        this._frameElapsedMs = 0;
        this._renderCurrentFrame();
        this._applyPosition();
    }

    clampToMonitor() {
        const bounds = this._getBounds();
        if (!bounds)
            return;
        this._x = Math.max(bounds.minX, Math.min(bounds.maxX, Number.isFinite(this._x) ? this._x : bounds.minX + 180));
        if (!this.isFreeRoamEnabled() || this._roamSurface === 'topbar')
            this._y = bounds.groundY;
        else
            this._y = Math.max(bounds.groundY, Math.min(bounds.bottomGroundY, Number.isFinite(this._y) ? this._y : bounds.groundY));
        this._applyPosition();
    }

    _onFreeRoamToggled() {
        if (this._isReleasing)
            return;
        if (this._inArenaBattle) {
            this._clearPropBadge();
            this._roamSurface = 'topbar';
            this._activeLedge = null;
            return;
        }

        const bounds = this._getBounds();
        this._clearPropBadge();
        this._resetPoseTransform();

        if (this.isFreeRoamEnabled()) {
            if (this.isAvailableForSocial() && bounds) {
                if (this._slotIndex === 0) {
                    this.say('🎉 解锁全屏自由漫游！去窗口屋顶和桌面探险咯~ 🪂✨', 2600);
                    this._startParachuteDive(bounds, false);
                } else if (this._slotIndex % 2 === 1) {
                    this._startWallClimb(bounds, false);
                } else {
                    this._startParachuteDive(bounds, false);
                }
            }
        } else {
            // Smoothly return to Top Bar when Full-Screen Free Roam is turned off!
            this._roamSurface = 'topbar';
            this._activeLedge = null;
            this._ascendLedge = null;
            this._fallVy = 0;
            if (bounds) {
                this._y = bounds.groundY;
                this._jumpY = 16;
                this._vy = -5.4;
                this._setState('happy', 1200);
                this._applyPosition();
            }
            if (this._slotIndex === 0)
                this.say('回到顶部栏乖乖巡逻咯~ 🐾', 2000);
        }
    }

    _setPropBadge(symbol) {
        if (!symbol) {
            this._clearPropBadge();
            return;
        }
        if (this._propBadge) {
            this._propBadge.text = symbol;
            return;
        }
        const lbl = new St.Label({
            text: symbol,
            style_class: 'topbar-pet-particle',
            reactive: false,
            opacity: 245,
        });
        lbl.connect('destroy', () => {
            if (this._propBadge === lbl)
                this._propBadge = null;
        });
        addChromeActor(lbl, { interactive: false, trackFullscreen: true });
        this._propBadge = lbl;
    }

    _clearPropBadge() {
        if (this._propBadge) {
            removeChromeActor(this._propBadge);
            this._propBadge.destroy();
            this._propBadge = null;
        }
    }

    _clearGrappleLine() {
        if (this._grappleLine) {
            removeChromeActor(this._grappleLine);
            this._grappleLine.destroy();
            this._grappleLine = null;
        }
    }

    _ensureGrappleLine() {
        if (this._grappleLine)
            return this._grappleLine;
        const line = new St.Widget({
            style_class: 'topbar-pet-grapple-line',
            width: 2,
            height: 20,
            reactive: false,
        });
        line.set_pivot_point(0.5, 0.0);
        line.connect('destroy', () => {
            if (this._grappleLine === line)
                this._grappleLine = null;
        });
        addChromeActor(line, { interactive: false, trackFullscreen: true });
        this._grappleLine = line;
        return line;
    }

    _startWindowParkourLeap(targetLedge, speak = true) {
        if (!targetLedge)
            return false;
        this._activeTarget = null;
        this._activeLedge = null;
        this._roamSurface = 'air';
        this._resetPoseTransform();
        const destX = Math.max(targetLedge.x1, Math.min(targetLedge.x2, Math.round((targetLedge.x1 + targetLedge.x2) / 2 + (Math.random() - 0.5) * 80)));
        this._parkourArc = {
            x0: this._x,
            y0: this._y,
            x1: destX,
            y1: targetLedge.y,
            durMs: 880,
            targetLedge,
        };
        this._facing = destX >= this._x ? 'right' : 'left';
        this._effects.spawnParticle(this._x + this._petW / 2, this._y + 4, '💨', 14);
        this._setState('window_parkour', 960);
        if (speak && Math.random() < 0.65)
            this.say(`助跑跨窗跑酷——翻跃到「${targetLedge.appName}」屋顶！🤸💨`, 2100);
        return true;
    }

    _startWindowBezelClimb(targetLedge, bounds, speak = true) {
        if (!targetLedge?.winRect)
            return false;
        this._activeTarget = null;
        this._activeLedge = null;
        this._roamSurface = 'air';
        this._resetPoseTransform();
        const wr = targetLedge.winRect;
        const onLeft = Math.abs(this._x - wr.x) <= Math.abs(this._x - (wr.x + wr.width));
        const bezelX = onLeft
            ? Math.max(bounds.minX, wr.x - Math.round(this._petW * 0.45))
            : Math.min(bounds.maxX, wr.x + wr.width - Math.round(this._petW * 0.55));
        this._x = bezelX;
        this._y = Math.min(bounds.bottomGroundY, Math.max(targetLedge.y + 90, Math.min(wr.y + wr.height - this._petH, this._y)));
        this._bezelClimb = { x: bezelX, yTarget: targetLedge.y, ledge: targetLedge, onLeft };
        this._setState('window_bezel_climb', 5500);
        if (speak && Math.random() < 0.65)
            this.say(`扒着「${targetLedge.appName}」窗口边框往上爬咯 🧗✨`, 2100);
        return true;
    }

    _startGrappleSwing(bounds, targetLedge = null, speak = true) {
        this._activeTarget = null;
        this._activeLedge = null;
        this._roamSurface = 'air';
        this._resetPoseTransform();
        const span = bounds.maxX - bounds.minX;
        const goRight = this._x < bounds.minX + span * 0.5;
        const anchorX = Math.max(bounds.minX + 80, Math.min(bounds.maxX - 80, Math.round(this._x + (goRight ? 150 : -150))));
        const anchorY = targetLedge ? targetLedge.y : (bounds.panelY + bounds.panelH);
        const ropeLen = Math.max(95, Math.min(260, Math.round((bounds.bottomGroundY - anchorY) * 0.52)));
        this._grappleArc = {
            ax: anchorX,
            ay: anchorY,
            len: ropeLen,
            ang0: goRight ? -1.05 : 1.05,
            ang1: goRight ? 0.95 : -0.95,
            durMs: 1250,
            targetLedge,
        };
        this._facing = goRight ? 'right' : 'left';
        this._ensureGrappleLine();
        this._setState('grapple_swing', 1320);
        if (speak && Math.random() < 0.7)
            this.say('发射像素抓钩——泰山摆荡横跨桌面！🪝💨', 2200);
    }

    _startPortalHop(bounds, targetLedge = null, speak = true) {
        this._clearPropBadge();
        this._clearGrappleLine();
        this._resetPoseTransform();
        this._effects.spawnPixelFxBurst(this._x + this._petW / 2, this._y + this._petH, 'arcane/blink-out', 1);

        if (targetLedge) {
            this._x = Math.round((targetLedge.x1 + targetLedge.x2) / 2);
            this._y = targetLedge.y;
            this._roamSurface = 'ledge';
            this._activeLedge = targetLedge;
        } else if (this._roamSurface === 'topbar') {
            this._x = Math.round(bounds.minX + Math.random() * (bounds.maxX - bounds.minX));
            this._y = bounds.bottomGroundY;
            this._roamSurface = 'floor';
            this._activeLedge = null;
        } else {
            this._x = Math.round(bounds.minX + Math.random() * (bounds.maxX - bounds.minX));
            this._y = bounds.groundY;
            this._roamSurface = 'topbar';
            this._activeLedge = null;
        }

        this._jump(-4.0);
        this._setState('happy', 1100);
        this._effects.spawnPixelFxBurst(this._x + this._petW / 2, this._y + this._petH, 'arcane/blink-in', 1);
        if (speak && Math.random() < 0.65)
            this.say('🌀 开启星界传送门，闪现抵达新据点！✨', 2100);
    }

    _startClassGlider(bounds, speak = true) {
        this._activeTarget = null;
        this._activeLedge = null;
        this._roamSurface = 'air';
        this._resetPoseTransform();
        const gliderIcons = { fire: '🔥', ice: '❄️', storm: '⚡', arcane: '🔮', holy: '🍃', martial: '🛸' };
        this._setPropBadge(gliderIcons[this.pet.archetype] || '🛸');
        this._facing = this._x < (bounds.minX + bounds.maxX) / 2 ? 'right' : 'left';
        this._setState('class_glider', 9000);
        if (speak && Math.random() < 0.65)
            this.say('展开流派专属推进滑翔翼，斜向巡航桌面~ 🛸✨', 2200);
    }

    _startDigTreasure() {
        const now = Date.now();
        if (now - this._lastTreasureMs < 38000)
            return false;
        this._lastTreasureMs = now;
        this._resetPoseTransform();
        this._jump(-4.5);
        this._setState('dig_treasure', 1450);

        const luckyMult = this.pet.trait === 'lucky' ? 2 : 1;
        const coins = (8 + Math.floor(Math.random() * 11)) * luckyMult;
        this._roster.addCoins(coins, true);
        this._roster.grantXp(this.pet.id, 6);

        const cx = this._x + this._petW / 2;
        const fy = this._y + this._petH;
        this._effects.spawnPixelFxBurst(cx, fy, 'spawn/coin-drop', 1, { coins: 6 });

        if (!this._roster.activeEgg && Math.random() < 0.08) {
            this._roster.activeEgg = { progress: 10, presetId: 'dragon' };
            this._roster.save();
            this._callbacks.onEggFound?.();
            this.say(`🎉 哇！挖宝挖到【+${coins}🪙】还捡到一颗神秘宠物蛋 🥚✨`, 3000);
        } else {
            this.say(`✨ 嗅嗅鼻子挖到小金库啦！金币 +${coins} 🪙`, 2300);
        }
        return true;
    }

    _startParachuteDive(bounds, speak = true) {
        this._activeTarget = null;
        this._activeLedge = null;
        this._roamSurface = 'air';
        this._resetPoseTransform();
        this._setPropBadge('🪂');
        this._setState('parachute_glide', 14000);
        if (speak && Math.random() < 0.7)
            this.say('开小降落伞去屏幕下面兜风咯~ 🪂✨', 2200);
        void bounds;
    }

    _startBalloonAscent(bounds, targetLedge = null, speak = true) {
        this._activeTarget = null;
        this._activeLedge = null;
        this._roamSurface = 'air';
        this._ascendLedge = targetLedge;
        this._ascendTargetY = targetLedge ? targetLedge.y : bounds.groundY;
        this._resetPoseTransform();
        this._setPropBadge('🎈');
        this._setState('balloon_ascend', 14000);
        if (speak && Math.random() < 0.7) {
            this.say(
                targetLedge
                    ? `抓着气球飞去「${targetLedge.appName}」窗口顶上看看 🎈✨`
                    : '乘着小气球飞回顶部栏咯~ 🎈🐾',
                2200
            );
        }
    }

    _startWallClimb(bounds, speak = true) {
        this._activeTarget = null;
        this._activeLedge = null;
        this._roamSurface = 'air';
        this._resetPoseTransform();
        // Climb UP if currently in lower half of screen, otherwise climb DOWN!
        const midScreenY = (bounds.groundY + bounds.bottomGroundY) / 2;
        this._climbDirY = this._y > midScreenY ? -1 : 1;
        this._x = (Math.abs(this._x - bounds.minX) <= Math.abs(this._x - bounds.maxX))
            ? bounds.minX
            : bounds.maxX;
        this._setState('wall_climb', 2800 + Math.random() * 1800);
        if (speak && Math.random() < 0.72)
            this.say('飞檐走壁爬屏幕边框咯！🧗🐾', 2100);
    }

    // =========================================================================
    // Arena Entrance Choreography & Return (Hide on Top Bar while Fighting!)
    // =========================================================================
    enterArenaBattle(targetX, customLine, onArrived) {
        if (!this._actor || this._isReleasing) {
            onArrived?.();
            return;
        }
        if (this._contextMenu?.isOpen)
            this._contextMenu.close();
        this._endStageDragCapture();
        this._clearPropBadge();
        this._clearGrappleLine();
        this._dragging = false;
        this._resetPoseTransform();

        this._inArenaBattle = true;
        this._arenaDiveStarted = false;
        this._arenaTargetX = targetX;
        this._onArenaArrived = onArrived;

        const cry = customLine || `${this.pet.name}：${pick(this._getQuoteSet().battleCry)}`;
        this.say(cry, 1500);
        this._effects.spawnParticle(this._x + this._petW / 2, this._y, '⚔️', 18);

        this._facing = targetX >= this._x ? 'right' : 'left';
        this._jump(-3.8);
        this._setState('arena_enter', 4000);
    }

    returnFromArena(didWin = null) {
        if (!this._inArenaBattle)
            return;
        this._inArenaBattle = false;
        this._arenaDiveStarted = false;
        this._onArenaArrived = null;

        if (!this._actor)
            return;

        const bounds = this._getBounds();
        if (bounds) {
            const center = (bounds.minX + bounds.maxX) / 2;
            this._x = Math.max(bounds.minX, Math.min(bounds.maxX, Math.round(center + (this._slotIndex - 0.5) * 56)));
            this._y = bounds.groundY;
            this._roamSurface = 'topbar';
            this._activeLedge = null;
        }

        this._resetPoseTransform();
        this._actor.remove_all_transitions();
        this._actor.visible = true;
        this._actor.opacity = 0;
        this._jumpY = 20;
        this._vy = -6.2;
        this._setState('happy', 1500);
        this._applyPosition();

        const fullOpacity = Math.max(50, Math.min(255, this._settings.get_int('pet-opacity')));
        this._actor.ease({
            opacity: fullOpacity,
            duration: 260,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._effects.spawnBurst(this._x + this._petW / 2, this._y, ['✨', '💨'], 2);
        if (didWin === true)
            this.say(`${this.pet.name}：凯旋归来！回顶部栏巡逻咯 🏆✨`, 2400);
        else if (didWin === false)
            this.say(`${this.pet.name}：切磋得好过瘾，下次一定赢回来 💪✨`, 2400);
        else
            this.say(`${this.pet.name}：跳回顶部栏继续散步咯~ 🐾`, 2000);
    }

    // =========================================================================
    // Public Spontaneous Stunt, App Reaction, Level Up & Release
    // =========================================================================
    performRandomStunt() {
        if (!this.isAvailableForSocial())
            return;
        const bounds = this._getBounds();
        if (!bounds)
            return;

        const freeRoam = this.isFreeRoamEnabled();
        const onTopBar = !freeRoam || this._roamSurface === 'topbar';

        // In Full-Screen Mode, mix in vertical skydiving / balloon / wall-climb stunts too!
        if (freeRoam && Math.random() < 0.36) {
            if (this._roamSurface === 'topbar') {
                this._startParachuteDive(bounds);
                return;
            } else if (this._roamSurface === 'floor') {
                const ledges = this._perception?.scanWindowLedges?.(this._petW, this._petH, bounds) || [];
                const pickLedge = ledges.length > 0 && Math.random() < 0.65 ? pick(ledges) : null;
                this._startBalloonAscent(bounds, pickLedge);
                return;
            } else if (this._roamSurface === 'ledge') {
                this._startParachuteDive(bounds);
                return;
            }
        }

        // Only raid a Top-Bar panel icon when actually standing on the Top Bar!
        if (onTopBar && Math.random() < 0.45 && this._perception) {
            const targets = this._perception.scanLiveTargets();
            if (targets.length > 0) {
                this._activeTarget = pick(targets);
                this._setState('raid_widget', 7500);
                return;
            }
        }
        this._triggerSoloStunt(bounds);
    }

    reactToNewApp(appName) {
        if (!this.isAvailableForSocial())
            return;
        this._jump(-4.8);
        this._setState('cast', 1350);
        this._effects.spawnParticle(this._x + this._petW / 2, this._y, '✨', 18);
        this.say(pick([
            `${this.pet.name}：检测到开启「${appName}」✨`,
            `哇，打开「${appName}」啦！陪你一起开工 🐾`,
            `盯——新开了「${appName}」👀`,
        ]), 2500);
    }

    /**
     * Triggered when two pets on the Top Bar meet! Supports 9 coordinated 2-pet choreographies!
     */
    triggerSocialInteraction(partnerName, otherX, socialKind = 'nuzzle', role = 'A') {
        if (!this.isAvailableForSocial())
            return;

        this.lastSocialMs = Date.now();
        this._resetPoseTransform();
        this._stuntTriggered = false;
        this._facing = otherX >= this._x ? 'right' : 'left';
        const midX = (this._x + otherX) / 2;
        this._duoData = { partnerName, otherX, midX, role, kind: socialKind };

        switch (socialKind) {
            case 'high_five':
                this._setState('duo_high_five', 1400);
                if (role === 'A')
                    this.say(`耶！跟 ${partnerName} 空中击掌 🙌✨`, 2100);
                else
                    this.say(`击掌成功！好默契 🙌`, 1900, 460);
                break;

            case 'leapfrog':
                if (role === 'A') {
                    // Crouches low so partner can vault over!
                    this._setState('duo_leapfrog_base', 1450);
                    this.say(`蹲稳啦，${partnerName} 快跳过来！🐾`, 2000);
                } else {
                    this._jump(-6.8);
                    this._setState('duo_leapfrog_jumper', 1350);
                    this._effects.spawnParticle(this._x + this._petW / 2, this._y + 4, '💨', 14);
                    this.say(`跳山羊翻越 ${partnerName}——芜湖！💨`, 2100, 320);
                }
                break;

            case 'sync_dance':
                this._setState('duo_sync_dance', 2600);
                this._effects.spawnBurst(this._x + this._petW / 2, this._y, ['🎵', '🎶'], 2);
                if (role === 'A')
                    this.say(`跟 ${partnerName} 来一段双宠同步摇摆舞 💃🎵`, 2400);
                break;

            case 'spar_clash':
                this._setState('duo_spar_clash', 1650);
                if (role === 'A')
                    this.say(`与 ${partnerName} 过招拼刀！看剑 ⚔️`, 2100);
                else
                    this.say(`锵！！好身手，接住了 🛡️`, 1900, 480);
                break;

            case 'magic_duel':
                this._setState('cast', 1750);
                if (role === 'A') {
                    this._effects.spawnPixelFxBurst(midX + this._petW / 2, this._y + this._petH, 'lightning/zap-hit', 1);
                    this.say(`与 ${partnerName} 元素魔力共鸣中 🔮⚡`, 2200);
                } else {
                    this._effects.spawnParticle(this._x + this._petW / 2, this._y, '🔮', 20);
                }
                break;

            case 'tag_chase':
                if (role === 'A') {
                    // Runner bolts away!
                    this._facing = this._x >= otherX ? 'right' : 'left';
                    this._jump(-4.0);
                    this._setState('run', 2700);
                    this.say(`略略略，${partnerName} 来追我呀~ 😝💨`, 2200);
                } else {
                    // Chaser pursues in same direction!
                    this._facing = otherX >= this._x ? 'right' : 'left';
                    this._setState('run', 2700);
                    this.say(`${partnerName} 别跑！看我追上你 🏃💨`, 2200, 480);
                }
                break;

            case 'gossip_chat':
                this._setState('duo_gossip', 2700);
                if (role === 'A') {
                    this.say(`嘘…偷偷跟 ${partnerName} 讲个小秘密 👀💬`, 2400);
                } else {
                    this._effects.spawnParticle(this._x + this._petW / 2, this._y, '💬', 18);
                    this.say(`真的吗真的吗？！点头点头 🤭`, 2300, 560);
                }
                break;

            case 'nap_pile':
                this._setState('sleep', 5200);
                this._effects.spawnBurst(this._x + this._petW / 2, this._y, ['💤', '❤️'], 2);
                if (role === 'A')
                    this.say(`跟 ${partnerName} 挨在一起眯五秒钟~ 💤`, 2400);
                break;

            default: // 'nuzzle'
                this._jump(-4.4);
                this._setState('duo_nuzzle', 1450);
                this._effects.spawnBurst(this._x + this._petW / 2, this._y, ['❤️', '💕'], 2);
                if (role === 'A')
                    this.say(`贴贴蹭蹭 ${partnerName}~ 💕`, 2000);
                break;
        }
    }

    celebrateLevelUp(unlockedSkills = []) {
        if (this._isReleasing || this._inArenaBattle)
            return;
        this._resetPoseTransform();
        this._jump(-6.0);
        this._setState('cast', 2200);
        const arch = getArchetype(this.pet.archetype);
        this._effects.spawnPixelFxBurst(this._x + this._petW / 2, this._y + this._petH, 'ui/level-up', 1);
        this._effects.showLevelUpToast(this.pet, arch.badge, unlockedSkills);

        if (unlockedSkills.length > 0) {
            const skillNames = unlockedSkills.map(s => `【${s.name}】`).join(' ');
            this.say(`🎉 升到 Lv.${this.pet.level}！习得 ${skillNames}！`, 3600);
        } else {
            this.say(`🎉 升到 Lv.${this.pet.level} 啦！✨`, 2800);
        }
    }

    playFarewellAndDestroy(onDone) {
        this._isReleasing = true;
        this._endStageDragCapture();
        this._clearPropBadge();
        this._clearGrappleLine();
        this._resetPoseTransform();
        this._setState('happy', 2500);
        this._jump(-4.5);

        this.say(`🍃 ${this.pet.name}：谢谢你的陪伴，我去远方冒险啦，再见~ ✨`, 2400);
        this._effects.spawnPixelFxBurst(this._x + this._petW / 2, this._y + this._petH, 'spawn/respawn-beam', 1);
        this._effects.spawnBurst(this._x + this._petW / 2, this._y, ['🍃', '✨', '❤️'], 4);

        if (this._actor) {
            this._actor.ease({
                y: Math.max(0, this._y - 22),
                opacity: 0,
                duration: 1350,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    this.destroy();
                    onDone?.();
                },
            });
        } else {
            onDone?.();
        }
    }

    toggleSleep() {
        if (this._inArenaBattle)
            return;
        this._resetPoseTransform();
        if (this._state === 'sleep') {
            this._setState('happy', 1100);
            this._jump(-4.5);
            this.say(`${this.pet.name}：睡饱啦，元气满满！✨`, 2000);
        } else {
            this._setState('sleep', 25000);
            this.say(`${this.pet.name}：先咪一会儿 💤`, 2200);
        }
    }

    say(text, durationMs = 2400, delayMs = 0) {
        if (this._replyTimerId) {
            GLib.Source.remove(this._replyTimerId);
            this._replyTimerId = 0;
        }
        const prefixed = (text.includes(`${this.pet.name}：`) || text.startsWith('🍃 ') || text.startsWith('🎉 '))
            ? text
            : `${this.pet.name}：${text}`;

        if (delayMs > 0) {
            this._replyTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
                this._replyTimerId = 0;
                if (this._actor && this._actor.visible)
                    this._effects.showBubble(() => this.getAnchorRect(), prefixed, durationMs, this.pet.id);
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        if (!this._actor || !this._actor.visible)
            return;
        this._effects.showBubble(() => this.getAnchorRect(), prefixed, durationMs, this.pet.id);
    }

    // =========================================================================
    // Rich Top-Bar Icon / Widget & Window-Roof Interactions (8 Distinct Types!)
    // =========================================================================
    _checkPanelEncounter(bounds, forceReact = false) {
        if (!this._perception)
            return false;

        const now = Date.now();
        const petLeft = this._x;
        const petRight = this._x + this._petW;
        const targets = this._perception.scanLiveTargets();

        for (const target of targets) {
            const touching = petRight >= target.x - 2 && petLeft <= target.x + target.w + 2;
            if (!touching)
                continue;

            const lastMs = this._widgetCooldowns.get(target.actor) || 0;
            if (!forceReact && now - lastMs < 8200)
                continue;

            this._widgetCooldowns.set(target.actor, now);

            if (!forceReact && Math.random() < 0.22)
                continue;

            this._roster.grantXp(this.pet.id, 3);
            this._triggerRandomWidgetBehavior(target, bounds);
            return true;
        }

        // Maximized / top-snapped window roof interaction!
        if (!forceReact && now - this._lastRoofTime > 22000 && Math.random() < 0.04) {
            const roof = this._perception.getTopSnappedWindowAt(this._x + this._petW / 2);
            if (roof) {
                this._lastRoofTime = now;
                this._roster.grantXp(this.pet.id, 3);
                const roll = Math.random();
                if (roll < 0.35) {
                    this._setState('peek', 1950);
                    this.say(`趴在「${roof.appName}」窗口屋顶往下偷看 👀`, 2300);
                } else if (roll < 0.7) {
                    this._jump(-6.2);
                    this._setState('solo_backflip', 900);
                    this.say(`在「${roof.appName}」窗口头顶来个帅气空翻 🤸✨`, 2200);
                } else {
                    this._setState('attack', 1400);
                    this.say(`在「${roof.appName}」窗口屋顶踩踩跺脚 🐾💥`, 2200);
                }
                return true;
            }
        }

        return false;
    }

    _triggerRandomWidgetBehavior(target, bounds) {
        this._stuntTriggered = false;
        const r = Math.random();
        if (r < 0.18) {
            this._beginWidgetAttack(target);
        } else if (r < 0.34) {
            this._beginWidgetHeadbuttRam(target);
        } else if (r < 0.50) {
            this._beginWidgetBackflipOff(target, bounds);
        } else if (r < 0.64) {
            this._beginWidgetMagicBuff(target);
        } else if (r < 0.76) {
            this._beginWidgetSitPolish(target);
        } else if (r < 0.86) {
            this._beginWidgetSneak(target, bounds);
        } else if (r < 0.94) {
            this._beginWidgetHurdle(target, bounds);
        } else {
            this._beginWidgetPeek(target);
        }
    }

    _alignBesideTarget(target) {
        const targetCenter = target.x + target.w / 2;
        this._facing = targetCenter >= this._x + this._petW / 2 ? 'right' : 'left';
        if (this._facing === 'right')
            this._x = Math.max(4, Math.min(this._x, target.x - Math.round(this._petW * 0.55)));
        else
            this._x = Math.max(this._x, target.x + target.w - Math.round(this._petW * 0.45));
    }

    _beginWidgetAttack(target) {
        this._activeTarget = target;
        this._lastHitComboStep = -1;
        this._resetPoseTransform();
        this._alignBesideTarget(target);
        this._setState('attack', 1600);

        if (Math.random() < 0.75) {
            const tStr = nowTimeStr();
            this.say(
                target.kind === 'clock'
                    ? pick([`${this.pet.name}：邦邦两拳！把 ${tStr} 打快点 🥊💥`, `无影飞踢暴击时钟 ${tStr} 💥`])
                    : pick([`路过「${target.label}」来一套连环拳脚 🥊💥`, `看招！对着「${target.label}」旋风飞踢 💥`]),
                2200
            );
        }
    }

    _beginWidgetHeadbuttRam(target) {
        this._activeTarget = target;
        this._stuntTriggered = false;
        this._resetPoseTransform();
        this._alignBesideTarget(target);
        this._effects.spawnParticle(this._x + this._petW / 2, this._y, '💢', 16);
        this._setState('headbutt_ram', 1350);

        if (Math.random() < 0.8) {
            this.say(
                target.kind === 'clock'
                    ? `铁头功猛撞时钟！看看能不能撞出周末 💥💫`
                    : `蓄力铁头功撞一下「${target.label}」！哎哟脑壳疼 💫`,
                2300
            );
        }
    }

    _beginWidgetBackflipOff(target, bounds) {
        this._activeTarget = target;
        this._resetPoseTransform();
        this._alignBesideTarget(target);

        const dirSign = this._facing === 'right' ? 1 : -1;
        if (target.actor)
            this._effects.joltPanelWidget(target.actor, dirSign * 1.3);
        this._effects.spawnBurst(this._x + this._petW / 2, this._y + 4, ['💨', '✨'], 2);

        // Kick off backward into a 360° mid-air flip!
        this._hurdleTargetX = Math.max(bounds.minX, Math.min(bounds.maxX, this._x - dirSign * 44));
        this._jump(-6.6);
        this._setState('backflip_off', 920);

        if (Math.random() < 0.78)
            this.say(`蹬一下「${target.label}」借力 360° 后空翻！满分落地 🤸✨`, 2300);
    }

    _beginWidgetMagicBuff(target) {
        this._activeTarget = target;
        this._resetPoseTransform();
        this._alignBesideTarget(target);
        this._setState('cast', 1650);

        const fxChoices = ['arcane/magic-circle-cast', 'holy/heal-aoe', 'lightning/electrified'];
        this._effects.spawnPixelFxBurst(target.x + target.w / 2, this._y + this._petH + 2, pick(fxChoices), 1);

        if (Math.random() < 0.82) {
            this.say(
                target.kind === 'clock'
                    ? `给时钟施一道【摸鱼时间膨胀咒】🔮✨`
                    : `给「${target.label}」注入满格好运加持魔法 🔮⚡`,
                2300
            );
        }
    }

    _beginWidgetSitPolish(target) {
        this._activeTarget = target;
        this._resetPoseTransform();
        this._x = Math.round(target.x + (target.w - this._petW) / 2);
        this._setState('sit_polish', 2400);
        this._effects.spawnBurst(this._x + this._petW / 2, this._y, ['✨', '🎵'], 2);

        if (Math.random() < 0.8) {
            this.say(
                target.kind === 'clock'
                    ? `坐在时间上面晃脚丫吹吹风~ 🎵✨`
                    : `擦擦「${target.label}」的图标，帮主人擦得锃光瓦亮 ✨`,
                2300
            );
        }
    }

    _beginWidgetSneak(target, bounds) {
        this._activeTarget = target;
        this._sneakFootstepAccMs = 0;
        this._resetPoseTransform();

        if (this._facing === 'right') {
            this._sneakExitX = Math.min(bounds.maxX, target.x + target.w + 8);
            if (this._sneakExitX <= this._x + 6)
                this._facing = 'left';
        }
        if (this._facing === 'left')
            this._sneakExitX = Math.max(bounds.minX, target.x - this._petW - 8);

        this._setState('sneak', 5000);

        if (Math.random() < 0.72) {
            const tStr = nowTimeStr();
            this.say(
                target.kind === 'clock'
                    ? `嘘…小心翼翼溜过 ${tStr}，别惊动闹钟 🤫🐾`
                    : `嘘…蹑手蹑脚潜行溜过「${target.label}」🤫🐾`,
                2300
            );
        }
    }

    _beginWidgetHurdle(target, bounds) {
        this._activeTarget = target;
        this._resetPoseTransform();

        if (this._facing === 'right')
            this._hurdleTargetX = Math.min(bounds.maxX, target.x + target.w + 8);
        else
            this._hurdleTargetX = Math.max(bounds.minX, target.x - this._petW - 8);

        this._jump(-6.2);
        this._setState('hurdle', 920);
        this._effects.spawnParticle(this._x + this._petW / 2, this._y + 4, '💨', 14);
    }

    _beginWidgetPeek(target) {
        this._activeTarget = target;
        this._resetPoseTransform();

        if (target.kind === 'clock' && Math.random() < 0.4) {
            this._x = Math.round(target.x + (target.w - this._petW) / 2);
            this._setState('sleep', 6000);
            this.say('时间上面暖呼呼的，趴着咪五秒钟 💤', 2400);
            return;
        }

        this._setState('peek', 1900);
        const tStr = nowTimeStr();
        this.say(
            target.kind === 'clock'
                ? `歪头看表：现在 ${tStr} 啦 ✨`
                : `好奇扒拉一下「${target.label}」👀🐾`,
            2200
        );
    }

    // =========================================================================
    // Solo Spontaneous Stunts & Acrobatics on the Top Bar!
    // =========================================================================
    _triggerSoloStunt(bounds) {
        this._resetPoseTransform();
        this._stuntTriggered = false;
        const r = Math.random();

        if (r < 0.26) {
            // 1. Spontaneous 360° Backflip!
            this._jump(-6.4);
            this._setState('solo_backflip', 900);
            this._effects.spawnBurst(this._x + this._petW / 2, this._y, ['✨', '🌟'], 2);
            if (Math.random() < 0.65)
                this.say(`${this.pet.name}：心情超棒，原地来个后空翻！🤸✨`, 2100);
        } else if (r < 0.52) {
            // 2. Zoomies Dash + Drift Skid!
            const center = (bounds.minX + bounds.maxX) / 2;
            this._facing = this._x < center ? 'right' : 'left';
            this._setState('zoomies_skid', 1750);
            this._effects.spawnParticle(this._x + this._petW / 2, this._y + 4, '💨', 14);
            if (Math.random() < 0.65)
                this.say(`${this.pet.name}：氮气加速——急刹漂移！！💨`, 2100);
        } else if (r < 0.78) {
            // 3. RPG Class Skill Practice!
            const fxId = CLASS_PRACTICE_FX[this.pet.archetype] || 'melee/claw-swipe';
            this._setState(this.pet.archetype === 'martial' ? 'attack' : 'cast', 1550);
            this._effects.spawnPixelFxBurst(this._x + this._petW / 2, this._y + this._petH, fxId, 1);
            if (Math.random() < 0.65)
                this.say(`${this.pet.name}：趁没人注意偷偷练一下新绝招 ✨`, 2200);
        } else {
            // 4. Knock on Screen Glass to Greet User!
            this._setState('screen_knock', 2100);
            this.say(pick([
                `咚咚咚！主人在看我吗？喝口水休息下眼睛叭 👀✨`,
                `敲敲屏幕玻璃~ 摸摸头加经验哟 🐾❤️`,
            ]), 2500);
        }
    }

    _resetPoseTransform() {
        this._lungeX = 0;
        if (!this._actor)
            return;
        this._actor.set_scale(1.0, 1.0);
        this._actor.rotation_angle_z = 0;
    }

    // =========================================================================
    // Right-Click Pet Menu (Cleaned of Fish/Yarn Clutter!)
    // =========================================================================
    _syncChromeRegistration() {
        if (!this._actor)
            return;
        const clickThrough = this._settings.get_boolean('click-through');
        if (this._chromeAdded) {
            removeChromeActor(this._actor);
            this._chromeAdded = false;
        }
        this._actor.reactive = !clickThrough;
        this._actor.track_hover = !clickThrough;
        addChromeActor(this._actor, {
            interactive: !clickThrough,
            trackFullscreen: true,
        });
        this._chromeAdded = true;
    }

    _buildContextMenu() {
        this._contextMenu = new PopupMenu.PopupMenu(this._actor, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(this._contextMenu.actor);
        this._contextMenu.actor.hide();
        this._contextMenuManager = new PopupMenu.PopupMenuManager(this._actor);
        this._contextMenuManager.addMenu(this._contextMenu);
        this._rebuildContextMenuItems();
    }

    _rebuildContextMenuItems() {
        if (!this._contextMenu)
            return;
        this._contextMenu.removeAll();

        const isPrimary = this._roster.primaryPetId === this.pet.id;
        const isSecondary = this._roster.secondaryPetId === this.pet.id;
        const arch = getArchetype(this.pet.archetype);
        const equipped = (this.pet.equippedSkills || []).map(id => SKILL_CATALOG[id]).filter(Boolean);

        const header = new PopupMenu.PopupMenuItem(
            `${isPrimary ? '👑 ' : (isSecondary ? '🤝 ' : '🐾 ')}${this.pet.name} · Lv.${this.pet.level} [${arch.badge}]`,
            { reactive: false }
        );
        this._contextMenu.addMenuItem(header);

        const skillSub = new PopupMenu.PopupSubMenuMenuItem(`⚡ 当前自由配招 (${equipped.length}/4 槽)`);
        for (const sk of equipped) {
            skillSub.menu.addMenuItem(new PopupMenu.PopupMenuItem(
                `${sk.slotType === 'ultimate' ? '🌟奥义' : '🔹主动'} · ${sk.name}`,
                { reactive: false }
            ));
        }
        skillSub.menu.addAction('✨ 一键智能搭配元素连携技能', () => {
            this._roster.applyRecommendedSkills(this.pet.id, 'combo');
            this.say(`${this.pet.name} 已换上最新元素连携配招！⚡`, 2300);
        });
        this._contextMenu.addMenuItem(skillSub);

        this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (!isPrimary) {
            this._contextMenu.addAction('👑 设为主战代表宠物', () => {
                this._roster.setPrimaryPet(this.pet.id);
                this.say(`${this.pet.name} 已成为 1号主战代表！⚔️`, 2200);
            });
            if (!isSecondary) {
                this._contextMenu.addAction('🤝 设为 2号双打/援助搭档', () => {
                    this._roster.setSecondaryPet(this.pet.id);
                    this.say(`${this.pet.name} 已就位 2号双打搭档！🤝`, 2200);
                });
            }
        }

        const siblings = this._roster.pets.filter(p => p.id !== this.pet.id);
        if (siblings.length === 1) {
            this._contextMenu.addAction(`⚔️ 与自家伙伴「${siblings[0].name}」1v1 切磋`, () => {
                this._roster.setPrimaryPet(this.pet.id);
                this._callbacks.onStartPracticeBattle?.(siblings[0], '1v1');
            });
        } else if (siblings.length > 1) {
            const sparSub = new PopupMenu.PopupSubMenuMenuItem(`⚔️ 与自家伙伴切磋 (${siblings.length} 只可选)`);
            for (const sib of siblings) {
                sparSub.menu.addAction(`🥊 挑战「${sib.name}」 (Lv.${sib.level})`, () => {
                    this._roster.setPrimaryPet(this.pet.id);
                    this._callbacks.onStartPracticeBattle?.(sib, '1v1');
                });
            }
            this._contextMenu.addMenuItem(sparSub);
        }

        this._contextMenu.addAction(
            this._roster.pets.length >= 2 ? '⚡ 开启 2.5D 双宠 2v2 元素挑战赛' : '⚔️ 开启 2.5D 擂台挑战赛',
            () => {
                this._roster.setPrimaryPet(this.pet.id);
                this._callbacks.onStartPracticeBattle?.(null, this._roster.pets.length >= 2 ? '2v2' : '1v1');
            }
        );
        this._contextMenu.addAction('🐉 讨伐随机深渊 Boss (携杂兵波次)', () => {
            this._callbacks.onStartBossRaid?.();
        });

        this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._contextMenu.addAction('🤸 来个随机耍宝特技', () => this.performRandomStunt());
        this._contextMenu.addAction(
            this._state === 'sleep' ? '☀️ 轻轻唤醒' : '💤 打个小盹',
            () => this.toggleSleep()
        );
        this._contextMenu.addAction('🙈 暂时收回休息 (隐藏此宠物)', () => {
            this._roster.setPetVisible(this.pet.id, false);
        });

        const freeRoamItem = new PopupMenu.PopupSwitchMenuItem(
            '🖥️ 全屏自由漫游模式',
            this.isFreeRoamEnabled()
        );
        freeRoamItem.connect('toggled', (_item, state) => {
            this._settings.set_boolean('free-roam-enabled', state);
        });
        this._contextMenu.addMenuItem(freeRoamItem);

        this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const releaseSub = new PopupMenu.PopupSubMenuMenuItem(`🍃 放生「${this.pet.name}」`);
        releaseSub.menu.addAction(`确认放生 ${this.pet.name} (Lv.${this.pet.level}) 道别离开`, () => {
            this._callbacks.onRequestReleasePet?.(this.pet.id);
        });
        this._contextMenu.addMenuItem(releaseSub);

        this._contextMenu.addAction('⚙️ 宠物小队管理 / 领养 / AI 提示词…', () => {
            this._callbacks.onOpenPrefs?.();
        });
    }

    _getQuoteSet() {
        return QUOTES[this.pet.presetId] || QUOTES.cat;
    }

    _getBounds() {
        const vOffset = this._settings.get_int('vertical-offset');
        if (this._perception?.getScreenRoamBounds)
            return this._perception.getScreenRoamBounds(this._petW, this._petH, vOffset);

        const panelBox = Main.layoutManager?.panelBox;
        if (!panelBox || !panelBox.get_stage?.())
            return null;

        const pw = Number.isFinite(panelBox.width) && panelBox.width > 64
            ? panelBox.width
            : (Number.isFinite(global.stage?.width) && global.stage.width > 64 ? global.stage.width : 0);
        if (pw <= 0)
            return null;

        const px = Number.isFinite(panelBox.x) ? panelBox.x : 0;
        const py = Number.isFinite(panelBox.y) ? panelBox.y : 0;
        const ph = (Number.isFinite(panelBox.height) && panelBox.height > 12) ? panelBox.height : 32;
        const groundY = Math.max(0, py + ph - this._petH + vOffset);
        const minX = px + 6;
        const maxX = Math.max(minX + 16, px + pw - this._petW - 6);

        return { minX, maxX, groundY, bottomGroundY: groundY + 600, panelY: py, panelH: ph };
    }

    // =========================================================================
    // Mouse Events & Main Tick
    // =========================================================================
    _onButtonPress(event) {
        if (this._isReleasing || this._inArenaBattle)
            return Clutter.EVENT_STOP;

        const button = event.get_button();
        if (button === 3) {
            this._rebuildContextMenuItems();
            this._contextMenu.toggle();
            return Clutter.EVENT_STOP;
        }
        if (button !== 1)
            return Clutter.EVENT_PROPAGATE;

        if (this._contextMenu?.isOpen)
            this._contextMenu.close();

        const [sx, sy] = event.get_coords();
        this._dragging = false;
        this._dragStartX = sx;
        this._dragStartY = sy;
        this._actorStartX = this._x;
        this._actorStartY = this._y;

        this._endStageDragCapture();
        this._stageCaptureId = global.stage.connect('captured-event', (_stage, ev) => {
            const type = ev.type();
            if (type === Clutter.EventType.MOTION) {
                const [mx, my] = ev.get_coords();
                if (!this._dragging && (Math.abs(mx - this._dragStartX) > 5 || Math.abs(my - this._dragStartY) > 5)) {
                    this._dragging = true;
                    this._clearPropBadge();
                    this._resetPoseTransform();
                    this._setState('drag', 60000);
                }
                if (this._dragging) {
                    const bounds = this._getBounds();
                    const freeRoam = this.isFreeRoamEnabled();
                    if (bounds) {
                        this._x = Math.max(bounds.minX, Math.min(bounds.maxX, this._actorStartX + (mx - this._dragStartX)));
                        if (freeRoam) {
                            this._y = Math.max(bounds.groundY, Math.min(bounds.bottomGroundY, this._actorStartY + (my - this._dragStartY)));
                            this._jumpY = 0;
                        } else {
                            this._jumpY = Math.max(-12, Math.min(28, my - this._dragStartY));
                        }
                    }
                    this._facing = mx >= this._dragStartX ? 'right' : 'left';
                    this._applyPosition();
                    return Clutter.EVENT_STOP;
                }
            } else if (type === Clutter.EventType.BUTTON_RELEASE) {
                const wasDragging = this._dragging;
                this._dragging = false;
                this._endStageDragCapture();

                if (wasDragging) {
                    const bounds = this._getBounds();
                    if (bounds && this.isFreeRoamEnabled()) {
                        this._handleFreeRoamDrop(bounds);
                    } else {
                        this._vy = -3.0;
                        if (!bounds || !this._checkPanelEncounter(bounds, true)) {
                            this._setState('happy', 900);
                            this._effects.spawnParticle(this._x + this._petW / 2, this._y, '✨', 18);
                        }
                    }
                } else {
                    this._handlePetClick();
                }
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        return Clutter.EVENT_STOP;
    }

    _handleFreeRoamDrop(bounds) {
        this._jumpY = 0;
        // 1. Dropped near Top Bar -> snap back onto Top Bar!
        if (this._y <= bounds.groundY + 26) {
            this._y = bounds.groundY;
            this._roamSurface = 'topbar';
            this._activeLedge = null;
            this._vy = -3.0;
            if (!this._checkPanelEncounter(bounds, true)) {
                this._setState('happy', 900);
                this._effects.spawnParticle(this._x + this._petW / 2, this._y, '✨', 18);
            }
            return;
        }

        // 2. Dropped directly onto a window titlebar ledge!
        const ledges = this._perception?.scanWindowLedges?.(this._petW, this._petH, bounds) || [];
        for (const ledge of ledges) {
            if (this._x >= ledge.x1 - 12 && this._x <= ledge.x2 + 12 && Math.abs(this._y - ledge.y) <= 26) {
                this._y = ledge.y;
                this._roamSurface = 'ledge';
                this._activeLedge = ledge;
                this._jump(-3.5);
                this._setState('happy', 1100);
                this._effects.spawnParticle(this._x + this._petW / 2, this._y, '🐾', 16);
                this.say(`稳稳站在「${ledge.appName}」窗口屋顶啦 🐾✨`, 2100);
                return;
            }
        }

        // 3. Dropped near screen bottom -> land on floor!
        if (this._y >= bounds.bottomGroundY - 24) {
            this._y = bounds.bottomGroundY;
            this._roamSurface = 'floor';
            this._activeLedge = null;
            this._jump(-3.5);
            this._setState('happy', 1000);
            this._effects.spawnParticle(this._x + this._petW / 2, this._y, '✨', 16);
            return;
        }

        // 4. Dropped mid-air -> open parachute if high up, otherwise gentle gravity fall!
        if (bounds.bottomGroundY - this._y > 160) {
            this._startParachuteDive(bounds);
        } else {
            this._roamSurface = 'air';
            this._activeLedge = null;
            this._fallVy = 1.5;
            this._setState('free_fall', 5000);
        }
    }

    _endStageDragCapture() {
        if (this._stageCaptureId) {
            global.stage.disconnect(this._stageCaptureId);
            this._stageCaptureId = 0;
        }
    }

    _handlePetClick() {
        this._resetPoseTransform();
        const now = Date.now();
        this._clickCombo = (now - this._lastClickMs < 650) ? this._clickCombo + 1 : 1;
        this._lastClickMs = now;

        this._roster.recordPetted(this.pet.id);

        if (this._clickCombo >= 3) {
            this._clickCombo = 0;
            this._jump(-6.5);
            this._setState('solo_backflip', 920);
            this._effects.spawnBurst(this._x + this._petW / 2, this._y, ['❤️', '✨', '🎵'], 4);
            this.say(`${this.pet.name}：${pick(this._getQuoteSet().pet)}`, 2300);
        } else {
            this._jump(-4.5);
            this._setState('happy', 950);
            this._effects.spawnParticle(this._x + this._petW / 2, this._y, '❤️', 22);
        }
    }

    _onHoverEnter() {
        if (this._inArenaBattle || !['walk', 'idle'].includes(this._state))
            return;
        const now = Date.now();
        if (now - this._lastHoverTime < 4200)
            return;
        this._lastHoverTime = now;
        this._jump(-2.8);
        this._effects.spawnParticle(this._x + this._petW / 2, this._y + 2, pick(['🎵', '✨', '🐾']), 16);
    }

    _onScroll(event) {
        const dir = event.get_scroll_direction();
        const cur = this._settings.get_int('pet-size');
        if (dir === Clutter.ScrollDirection.UP && cur < 64) {
            this._settings.set_int('pet-size', Math.min(64, cur + 2));
            return Clutter.EVENT_STOP;
        } else if (dir === Clutter.ScrollDirection.DOWN && cur > 18) {
            this._settings.set_int('pet-size', Math.max(18, cur - 2));
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _jump(initialVy = -4.8) {
        this._vy = initialVy;
        if (this._jumpY >= 0)
            this._jumpY = -1;
    }

    _setState(nextState, durationMs = 3500) {
        if (this._state !== nextState) {
            this._state = nextState;
            this._statePhaseMs = 0;
            this._frameIdx = 0;
            this._frameElapsedMs = 0;
            this._renderCurrentFrame();
        }
        this._stateTimerMs = durationMs;
    }

    _tick(dtMs) {
        if (!this._bank || !this._actor || this._isReleasing)
            return;

        // Hidden while fighting inside the Arena!
        if (this._inArenaBattle && this._state !== 'arena_enter')
            return;

        const bounds = this._getBounds();
        if (!bounds)
            return;

        if (!Number.isFinite(this._x)) {
            const span = Math.max(60, bounds.maxX - bounds.minX);
            this._x = Math.round(bounds.minX + span * ((0.22 + this._slotIndex * 0.27) % 0.85));
            this._y = bounds.groundY;
        }

        const freeRoam = this.isFreeRoamEnabled();
        if (!freeRoam) {
            this._roamSurface = 'topbar';
            this._activeLedge = null;
            this._y = bounds.groundY;
        } else if (!Number.isFinite(this._y)) {
            this._y = bounds.groundY;
        }

        this._statePhaseMs += dtMs;

        // ---------------------------------------------------------------------
        // Special Choreography: 2D Sprint/Fly to Top-Center & Dive into Arena!
        // ---------------------------------------------------------------------
        if (this._state === 'arena_enter') {
            if (this._arenaDiveStarted)
                return;

            if (this._jumpY < 0 || this._vy !== 0) {
                this._jumpY += this._vy;
                this._vy += 0.5;
                if (this._jumpY >= 0) {
                    this._jumpY = 0;
                    this._vy = 0;
                }
            }

            const dx = this._arenaTargetX - this._x;
            const dy = bounds.groundY - this._y;
            const stepX = Math.max(9.5, Math.abs(dx) * 0.15);
            const stepY = Math.max(10.5, Math.abs(dy) * 0.16);

            if ((Math.abs(dx) <= 14 && Math.abs(dy) <= 14) || this._statePhaseMs >= 950) {
                this._arenaDiveStarted = true;
                this._x = this._arenaTargetX;
                this._y = bounds.groundY;
                this._applyPosition();
                this._effects.spawnParticle(this._x + this._petW / 2, this._y + 4, '💨', 14);

                this._actor.ease({
                    y: Math.round(this._y + 34),
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

            this._facing = dx >= 0 ? 'right' : 'left';
            this._x += dx > 0 ? Math.min(dx, stepX) : Math.max(dx, -stepX);
            this._y += dy > 0 ? Math.min(dy, stepY) : Math.max(dy, -stepY);
            this._advanceSpriteAnimation(dtMs, 2.2);
            this._applyPosition();
            return;
        }

        // Maintain surface Y tracking when walking on Top Bar, Window Ledge, or Screen Floor!
        if (freeRoam && this._state !== 'drag') {
            if (this._roamSurface === 'topbar') {
                this._y = bounds.groundY;
            } else if (this._roamSurface === 'floor') {
                this._y = bounds.bottomGroundY;
            } else if (this._roamSurface === 'ledge' && this._activeLedge) {
                const mw = this._activeLedge.metaWin;
                let valid = false;
                try {
                    if (mw && !mw.minimized && mw.get_compositor_private?.()?.visible !== false) {
                        const r = mw.get_frame_rect();
                        const newY = Math.round(r.y - this._petH + 4);
                        const x1 = Math.max(bounds.minX, Math.round(r.x + 8));
                        const x2 = Math.min(bounds.maxX, Math.round(r.x + r.width - this._petW - 8));
                        if (x2 - x1 >= 48 && newY >= bounds.groundY + 24 && newY <= bounds.bottomGroundY - 20) {
                            // Ride smoothly along if user drags the window!
                            const prevX1 = this._activeLedge.x1;
                            this._x = Math.max(x1, Math.min(x2, this._x + (x1 - prevX1)));
                            this._activeLedge.x1 = x1;
                            this._activeLedge.x2 = x2;
                            this._activeLedge.y = newY;
                            this._y = newY;
                            valid = true;
                        }
                    }
                } catch (_e) {
                    valid = false;
                }

                if (!valid) {
                    // Window closed, minimized, or moved off-bounds -> open parachute non-destructively!
                    this._activeLedge = null;
                    this.say('哎呀窗口挪走啦，开小降落伞飘下去~ 🪂', 2000);
                    this._startParachuteDive(bounds);
                }
            }
        }

        // Standard vertical jump gravity
        if (this._state !== 'drag') {
            if (this._jumpY < 0 || this._vy !== 0) {
                this._jumpY += this._vy;
                this._vy += 0.45;
                if (this._jumpY >= 0) {
                    this._jumpY = 0;
                    this._vy = 0;
                }
            }
        }

        // 🌱 High-CPU Eco Quiet Mode: yield 100% resources when user is compiling/rendering!
        if (this._ecoMode) {
            this._advanceSpriteAnimation(dtMs, 0.24); // Throttle down to ~4-5 FPS resting animation
            this._applyPosition();
            return;
        }
        const cpuFactor = 1.0;

        // 👾 Top-Bar World Boss Co-op Swarm Combat!
        if (this._worldBossTargetX !== null) {
            this._y = bounds.groundY;
            const offset = ((this._slotIndex % 2 === 0) ? -1 : 1) * (32 + (this._slotIndex % 3) * 14);
            const goalX = Math.max(bounds.minX, Math.min(bounds.maxX, this._worldBossTargetX + offset));
            const dxBoss = goalX - this._x;
            this._facing = this._worldBossTargetX >= this._x ? 'right' : 'left';
            if (Math.abs(dxBoss) > 12) {
                this._x += Math.sign(dxBoss) * Math.min(Math.abs(dxBoss), 3.6);
                this._setState('run', 1200);
            } else {
                if (this._state !== 'attack' && this._state !== 'cast')
                    this._setState(this.pet.archetype === 'martial' ? 'attack' : 'cast', 1400);
                if (this._statePhaseMs % 660 < dtMs) {
                    const eqId = this.pet.equippedSkills?.[0];
                    const fxId = SKILL_CATALOG[eqId]?.fxMain || CLASS_PRACTICE_FX[this.pet.archetype] || 'melee/claw-swipe';
                    this._effects.spawnPixelFxBurst(this._worldBossTargetX, this._y + this._petH, fxId, 1);
                    this._callbacks.onWorldBossHit?.(this.pet);
                }
            }
            this._advanceSpriteAnimation(dtMs, 1.3);
            this._applyPosition();
            return;
        }

        const userSpeed = this._settings.get_double('walk-speed');
        const dirSign = this._facing === 'right' ? 1 : -1;
        const surfMinX = (freeRoam && this._roamSurface === 'ledge' && this._activeLedge)
            ? this._activeLedge.x1
            : ((!freeRoam || this._roamSurface === 'topbar') ? (bounds.topBarMinX ?? bounds.minX) : bounds.minX);
        const surfMaxX = (freeRoam && this._roamSurface === 'ledge' && this._activeLedge)
            ? this._activeLedge.x2
            : ((!freeRoam || this._roamSurface === 'topbar') ? (bounds.topBarMaxX ?? bounds.maxX) : bounds.maxX);

        // ---------------------------------------------------------------------
        // State Machine: Rich Icon Interactions, Duo Choreographies & Stunts!
        // ---------------------------------------------------------------------
        if (this._state === 'raid_widget' && this._activeTarget) {
            if (freeRoam && this._roamSurface !== 'topbar') {
                this._activeTarget = null;
                this._setState('walk', 4000);
            } else {
                const target = this._activeTarget;
                const approachX = target.x + target.w / 2 >= this._x + this._petW / 2
                    ? Math.max(bounds.minX, target.x - Math.round(this._petW * 0.5))
                    : Math.min(bounds.maxX, target.x + target.w - Math.round(this._petW * 0.5));
                const dx = approachX - this._x;

                if (Math.abs(dx) <= 10) {
                    this._widgetCooldowns.set(target.actor, Date.now());
                    this._facing = target.x + target.w / 2 >= this._x + this._petW / 2 ? 'right' : 'left';
                    this._triggerRandomWidgetBehavior(target, bounds);
                } else {
                    this._facing = dx > 0 ? 'right' : 'left';
                    const step = Math.min(Math.abs(dx), 2.8 * Math.max(0.7, userSpeed));
                    this._x += dx > 0 ? step : -step;
                }
            }
        } else if (this._state === 'attack') {
            const cycleMs = this._statePhaseMs % 560;
            const comboStep = Math.floor(this._statePhaseMs / 280);
            const impactX = this._facing === 'right' ? this._x + this._petW + 2 : this._x - 4;

            if (cycleMs < 130) {
                this._lungeX = -2 * dirSign;
                this._actor.set_scale(1.04, 0.94);
                this._actor.rotation_angle_z = -4 * dirSign;
            } else if (cycleMs < 280) {
                this._lungeX = 6 * dirSign;
                this._actor.set_scale(1.08, 0.96);
                this._actor.rotation_angle_z = 6 * dirSign;
                if (this._lastHitComboStep !== comboStep) {
                    this._lastHitComboStep = comboStep;
                    this._effects.spawnParticle(impactX, this._y + 4, '🥊', 16);
                    if (this._activeTarget?.actor)
                        this._effects.joltPanelWidget(this._activeTarget.actor, dirSign);
                }
            } else if (cycleMs < 420) {
                this._lungeX = 7 * dirSign;
                this._actor.set_scale(1.0, 1.06);
                this._actor.rotation_angle_z = -5 * dirSign;
            } else {
                this._lungeX = 9 * dirSign;
                if (this._jumpY === 0)
                    this._jump(-3.6);
                this._actor.set_scale(1.1, 0.95);
                this._actor.rotation_angle_z = -14 * dirSign;
                if (this._lastHitComboStep !== comboStep) {
                    this._lastHitComboStep = comboStep;
                    this._effects.spawnBurst(impactX, this._y + 2, ['💥', '💢'], 2);
                    if (this._activeTarget?.actor)
                        this._effects.joltPanelWidget(this._activeTarget.actor, dirSign * 1.4);
                }
            }
        } else if (this._state === 'headbutt_ram') {
            // Wind-up backward -> Charge headfirst -> Impact jolt + recoil dizzy!
            if (this._statePhaseMs < 420) {
                const k = this._statePhaseMs / 420;
                this._lungeX = -14 * k * dirSign;
                this._actor.set_scale(1.12, 0.84);
                this._actor.rotation_angle_z = -8 * dirSign;
            } else if (this._statePhaseMs < 620) {
                const k = (this._statePhaseMs - 420) / 200;
                this._lungeX = (-14 + 26 * k) * dirSign;
                this._actor.set_scale(1.18, 0.88);
                this._actor.rotation_angle_z = 16 * dirSign;
            } else {
                if (!this._stuntTriggered) {
                    this._stuntTriggered = true;
                    this._jump(-4.2);
                    const impactX = this._facing === 'right' ? this._x + this._petW + 4 : this._x - 4;
                    this._effects.spawnBurst(impactX, this._y + 2, ['💥', '💫'], 2);
                    if (this._activeTarget?.actor)
                        this._effects.joltPanelWidget(this._activeTarget.actor, dirSign * 1.8);
                }
                const rec = Math.min(1, (this._statePhaseMs - 620) / 650);
                this._lungeX = (12 - 22 * rec) * dirSign;
                this._actor.set_scale(0.96, 1.04);
                this._actor.rotation_angle_z = Math.sin(rec * Math.PI * 4) * 10;
            }
        } else if (this._state === 'backflip_off' || this._state === 'solo_backflip') {
            const prog = Math.min(1, this._statePhaseMs / 860);
            if (this._state === 'backflip_off')
                this._x += -dirSign * 1.5;
            this._x = Math.max(surfMinX, Math.min(surfMaxX, this._x));
            this._actor.rotation_angle_z = -360 * prog * dirSign;
            if (prog >= 1 && this._jumpY === 0) {
                this._resetPoseTransform();
                this._setState('happy', 650);
            }
        } else if (this._state === 'sit_polish') {
            const sway = Math.sin((this._statePhaseMs / 220) * Math.PI);
            this._lungeX = sway * 4;
            this._actor.set_scale(1.06, 0.92);
            this._actor.rotation_angle_z = sway * 6;
            if (!this._stuntTriggered && this._statePhaseMs > 1100) {
                this._stuntTriggered = true;
                this._effects.spawnParticle(this._x + this._petW / 2, this._y, '✨', 18);
            }
        } else if (this._state === 'zoomies_skid') {
            if (this._statePhaseMs < 1050) {
                this._x += dirSign * 4.4 * Math.max(0.8, userSpeed);
                this._actor.set_scale(1.14, 0.88);
                this._actor.rotation_angle_z = 7 * dirSign;
                if (this._x <= surfMinX + 12 || this._x >= surfMaxX - 12)
                    this._facing = this._x <= surfMinX + 12 ? 'right' : 'left';
            } else {
                // Brake skid!
                if (!this._stuntTriggered) {
                    this._stuntTriggered = true;
                    this._effects.spawnBurst(this._x + this._petW / 2, this._y + 6, ['💨', '✨'], 2);
                }
                const decel = Math.max(0, 1 - (this._statePhaseMs - 1050) / 650);
                this._x += dirSign * 2.2 * decel;
                this._actor.set_scale(1.16, 0.76);
                this._actor.rotation_angle_z = -14 * dirSign * decel;
            }
            this._x = Math.max(surfMinX, Math.min(surfMaxX, this._x));
        } else if (this._state === 'screen_knock') {
            const beat = (this._statePhaseMs % 420) / 420;
            const tap = Math.sin(beat * Math.PI);
            this._actor.set_scale(1.0 + tap * 0.14, 1.0 - tap * 0.08);
            this._actor.rotation_angle_z = Math.sin((this._statePhaseMs / 210) * Math.PI) * 5;
            const knockIdx = Math.floor(this._statePhaseMs / 420);
            if (knockIdx < 3 && this._lastHitComboStep !== knockIdx) {
                this._lastHitComboStep = knockIdx;
                this._effects.spawnParticle(this._x + this._petW / 2, this._y + 4, '✨', 14);
            }
        } else if (this._state === 'edge_peek') {
            const leanDir = this._x <= surfMinX + 16 ? -1 : 1;
            this._facing = leanDir > 0 ? 'right' : 'left';
            this._lungeX = leanDir * 5;
            this._actor.rotation_angle_z = leanDir * 18 * Math.sin(Math.min(1, this._statePhaseMs / 450) * (Math.PI / 2));
        } else if (this._state === 'duo_high_five' && this._duoData) {
            if (this._statePhaseMs < 420) {
                const targetSpot = this._duoData.midX + (this._duoData.role === 'A' ? -12 : 12);
                this._x += (targetSpot - this._x) * 0.22;
            } else if (!this._stuntTriggered) {
                this._stuntTriggered = true;
                this._jump(-5.8);
                if (this._duoData.role === 'A')
                    this._effects.spawnBurst(this._duoData.midX + this._petW / 2, this._y - 8, ['🙌', '✨', '🌟'], 3);
            }
            this._actor.rotation_angle_z = -12 * dirSign * (this._jumpY < 0 ? 1 : 0);
        } else if (this._state === 'duo_leapfrog_base') {
            this._actor.set_scale(1.18, 0.68);
            this._actor.rotation_angle_z = 0;
        } else if (this._state === 'duo_leapfrog_jumper' && this._duoData) {
            this._x += dirSign * 3.5;
            this._x = Math.max(surfMinX, Math.min(surfMaxX, this._x));
            this._actor.rotation_angle_z = 14 * dirSign * (this._jumpY < 0 ? 1 : 0);
        } else if (this._state === 'duo_sync_dance') {
            const beatIdx = Math.floor(this._statePhaseMs / 380);
            this._facing = beatIdx % 2 === 0 ? 'right' : 'left';
            const bounce = Math.abs(Math.sin((this._statePhaseMs / 190) * Math.PI));
            this._jumpY = -Math.round(bounce * 8);
            this._actor.set_scale(1.08 - bounce * 0.1, 0.92 + bounce * 0.14);
            this._actor.rotation_angle_z = Math.sin((this._statePhaseMs / 190) * Math.PI) * 11;
        } else if (this._state === 'duo_spar_clash' && this._duoData) {
            if (this._statePhaseMs < 380) {
                this._lungeX = (this._statePhaseMs / 380) * 12 * dirSign;
                this._actor.rotation_angle_z = 10 * dirSign;
            } else if (this._statePhaseMs < 620) {
                if (!this._stuntTriggered) {
                    this._stuntTriggered = true;
                    this._jump(-4.6);
                    if (this._duoData.role === 'A')
                        this._effects.spawnPixelFxBurst(this._duoData.midX + this._petW / 2, this._y + this._petH, 'impacts/parry', 1);
                }
                this._lungeX = -10 * dirSign;
                this._actor.rotation_angle_z = -14 * dirSign;
            } else {
                this._lungeX = -14 * dirSign;
                this._actor.set_scale(0.96, 1.02);
                this._actor.rotation_angle_z = -5 * dirSign;
            }
        } else if (this._state === 'duo_gossip') {
            const nod = Math.sin((this._statePhaseMs / 240) * Math.PI);
            this._actor.rotation_angle_z = (6 + nod * 5) * dirSign;
            this._actor.set_scale(1.03, 0.97);
        } else if (this._state === 'duo_nuzzle') {
            const rub = Math.sin((this._statePhaseMs / 200) * Math.PI);
            this._lungeX = rub * 5 * dirSign;
            this._actor.rotation_angle_z = rub * 8 * dirSign;
        } else if (this._state === 'sneak') {
            const rhythm = this._statePhaseMs % 780;
            if (rhythm < 520) {
                const bobSquash = Math.sin((rhythm / 520) * Math.PI) * 0.06;
                this._actor.set_scale(1.06 + bobSquash, 0.85 - bobSquash * 0.5);
                this._actor.rotation_angle_z = Math.sin((rhythm / 260) * Math.PI) * 3 * dirSign;
                this._x += dirSign * 0.48 * Math.max(0.6, userSpeed);

                this._sneakFootstepAccMs += dtMs;
                if (this._sneakFootstepAccMs >= 950) {
                    this._sneakFootstepAccMs = 0;
                    this._effects.spawnParticle(this._x + this._petW / 2, this._y + 6, Math.random() < 0.5 ? '🐾' : '🤫', 14);
                }
            } else {
                this._actor.set_scale(1.04, 0.87);
                this._actor.rotation_angle_z = 0;
            }

            const reachedExit = this._sneakExitX !== null && (
                (this._facing === 'right' && this._x >= this._sneakExitX) ||
                (this._facing === 'left' && this._x <= this._sneakExitX)
            );
            if (reachedExit || this._x <= bounds.minX || this._x >= bounds.maxX) {
                this._sneakExitX = null;
                this._resetPoseTransform();
                this._setState('walk', 4000);
            }
        } else if (this._state === 'hurdle') {
            this._x += dirSign * 3.2 * Math.max(0.8, userSpeed);
            this._actor.rotation_angle_z = -10 * dirSign * (this._jumpY < 0 ? 1 : 0);
            const cleared = this._hurdleTargetX !== null && (
                (this._facing === 'right' && this._x >= this._hurdleTargetX) ||
                (this._facing === 'left' && this._x <= this._hurdleTargetX)
            );
            if ((cleared && this._jumpY === 0) || this._x <= bounds.minX || this._x >= bounds.maxX) {
                this._hurdleTargetX = null;
                this._resetPoseTransform();
                this._setState('walk', 4000);
            }
        } else if (this._state === 'parachute_glide') {
            const sway = Math.sin((this._statePhaseMs / 380) * Math.PI);
            this._x = Math.max(bounds.minX, Math.min(bounds.maxX, this._x + sway * 1.4));
            this._facing = sway >= 0 ? 'right' : 'left';
            this._actor.rotation_angle_z = sway * 11;
            const prevY = this._y;
            this._y += 2.15;

            // Check if gliding past an open window titlebar ledge!
            const ledges = this._perception?.scanWindowLedges?.(this._petW, this._petH, bounds) || [];
            let landedLedge = null;
            for (const l of ledges) {
                if (this._x >= l.x1 && this._x <= l.x2 && prevY <= l.y && this._y >= l.y) {
                    landedLedge = l;
                    break;
                }
            }

            if (landedLedge && Math.random() < 0.72) {
                this._clearPropBadge();
                this._resetPoseTransform();
                this._y = landedLedge.y;
                this._roamSurface = 'ledge';
                this._activeLedge = landedLedge;
                this._jump(-3.2);
                this._setState('happy', 1100);
                this._effects.spawnParticle(this._x + this._petW / 2, this._y + 4, '🐾', 14);
                this.say(`降落在「${landedLedge.appName}」窗口顶上歇会儿 🪂🐾`, 2200);
            } else if (this._y >= bounds.bottomGroundY) {
                this._clearPropBadge();
                this._resetPoseTransform();
                this._y = bounds.bottomGroundY;
                this._roamSurface = 'floor';
                this._activeLedge = null;
                this._jump(-3.4);
                this._setState('happy', 1000);
                this._effects.spawnParticle(this._x + this._petW / 2, this._y + 6, '💨', 14);
            }
        } else if (this._state === 'free_fall') {
            const prevY = this._y;
            this._fallVy = Math.min(11, this._fallVy + 0.55);
            this._y += this._fallVy;

            const ledges = this._perception?.scanWindowLedges?.(this._petW, this._petH, bounds) || [];
            let hitLedge = null;
            for (const l of ledges) {
                if (this._x >= l.x1 && this._x <= l.x2 && prevY <= l.y && this._y >= l.y) {
                    hitLedge = l;
                    break;
                }
            }

            if (hitLedge) {
                this._fallVy = 0;
                this._y = hitLedge.y;
                this._roamSurface = 'ledge';
                this._activeLedge = hitLedge;
                this._jump(-3.2);
                this._setState('happy', 950);
                this._effects.spawnParticle(this._x + this._petW / 2, this._y + 6, '💨', 14);
            } else if (this._y >= bounds.bottomGroundY) {
                this._fallVy = 0;
                this._y = bounds.bottomGroundY;
                this._roamSurface = 'floor';
                this._activeLedge = null;
                this._jump(-3.6);
                this._setState('happy', 950);
                this._effects.spawnParticle(this._x + this._petW / 2, this._y + 6, '💨', 14);
            }
        } else if (this._state === 'balloon_ascend') {
            let targetLedge = this._ascendLedge;
            if (targetLedge?.metaWin) {
                let ledgeAlive = false;
                try {
                    const mw = targetLedge.metaWin;
                    if (!mw.minimized && mw.get_compositor_private?.()?.visible !== false) {
                        const r = mw.get_frame_rect();
                        const newY = Math.round(r.y - this._petH + 4);
                        const x1 = Math.max(bounds.minX, Math.round(r.x + 8));
                        const x2 = Math.min(bounds.maxX, Math.round(r.x + r.width - this._petW - 8));
                        if (x2 - x1 >= 48 && newY >= bounds.groundY + 24 && newY <= bounds.bottomGroundY - 20) {
                            targetLedge.x1 = x1;
                            targetLedge.x2 = x2;
                            targetLedge.y = newY;
                            this._ascendTargetY = newY;
                            ledgeAlive = true;
                        }
                    }
                } catch (_e) {
                    ledgeAlive = false;
                }
                if (!ledgeAlive) {
                    targetLedge = null;
                    this._ascendLedge = null;
                    this._ascendTargetY = bounds.groundY;
                }
            }

            const destX = targetLedge
                ? Math.max(targetLedge.x1, Math.min(targetLedge.x2, this._x))
                : this._x;
            const dx = destX - this._x;
            if (Math.abs(dx) > 2) {
                this._facing = dx > 0 ? 'right' : 'left';
                this._x += Math.sign(dx) * Math.min(Math.abs(dx), 2.4);
            }
            const sway = Math.sin((this._statePhaseMs / 320) * Math.PI);
            this._actor.rotation_angle_z = sway * 8;
            this._y -= 2.75;

            if (this._y <= this._ascendTargetY) {
                this._clearPropBadge();
                this._resetPoseTransform();
                this._y = this._ascendTargetY;
                if (targetLedge) {
                    this._roamSurface = 'ledge';
                    this._activeLedge = targetLedge;
                } else {
                    this._roamSurface = 'topbar';
                    this._activeLedge = null;
                }
                this._ascendLedge = null;
                this._jump(-3.4);
                this._setState('happy', 1000);
                this._effects.spawnParticle(this._x + this._petW / 2, this._y, '✨', 16);
            }
        } else if (this._state === 'window_parkour' && this._parkourArc) {
            const arc = this._parkourArc;
            const p = Math.min(1, this._statePhaseMs / arc.durMs);
            this._x = arc.x0 + (arc.x1 - arc.x0) * p;
            const linearY = arc.y0 + (arc.y1 - arc.y0) * p;
            this._y = linearY - Math.sin(p * Math.PI) * 92;
            const spinDir = arc.x1 >= arc.x0 ? 1 : -1;
            this._actor.rotation_angle_z = 360 * p * spinDir;
            if (p >= 1) {
                this._resetPoseTransform();
                this._x = arc.x1;
                this._y = arc.y1;
                this._roamSurface = 'ledge';
                this._activeLedge = arc.targetLedge;
                this._parkourArc = null;
                this._jump(-3.2);
                this._setState('happy', 1000);
                this._effects.spawnParticle(this._x + this._petW / 2, this._y + 4, '🐾', 14);
            }
        } else if (this._state === 'window_bezel_climb' && this._bezelClimb) {
            const bc = this._bezelClimb;
            this._x = bc.x;
            this._facing = bc.onLeft ? 'right' : 'left';
            this._actor.rotation_angle_z = (bc.onLeft ? -74 : 74) + Math.sin((this._statePhaseMs / 150) * Math.PI) * 6;
            this._y -= 2.35 * Math.max(0.7, userSpeed);
            if (this._y <= bc.yTarget) {
                this._resetPoseTransform();
                this._y = bc.yTarget;
                this._x = bc.onLeft ? bc.ledge.x1 + 8 : bc.ledge.x2 - 8;
                this._roamSurface = 'ledge';
                this._activeLedge = bc.ledge;
                this._bezelClimb = null;
                this._jump(-3.8);
                this._setState('happy', 1100);
                this._effects.spawnParticle(this._x + this._petW / 2, this._y, '✨', 14);
            }
        } else if (this._state === 'grapple_swing' && this._grappleArc) {
            const ga = this._grappleArc;
            const p = Math.min(1, this._statePhaseMs / ga.durMs);
            const easeP = 0.5 - 0.5 * Math.cos(p * Math.PI);
            const theta = ga.ang0 + (ga.ang1 - ga.ang0) * easeP;
            this._x = Math.max(bounds.minX, Math.min(bounds.maxX, ga.ax + Math.sin(theta) * ga.len - this._petW / 2));
            this._y = Math.max(bounds.groundY, Math.min(bounds.bottomGroundY, ga.ay + Math.cos(theta) * ga.len - this._petH / 2));
            this._actor.rotation_angle_z = -theta * 28;

            if (this._grappleLine) {
                const handX = this._x + this._petW / 2;
                const handY = this._y + 6;
                const dxL = handX - ga.ax;
                const dyL = handY - ga.ay;
                const distL = Math.max(8, Math.hypot(dxL, dyL));
                const deg = -Math.atan2(dxL, dyL) * (180 / Math.PI);
                this._grappleLine.set_size(2, Math.round(distL));
                this._grappleLine.set_position(Math.round(ga.ax), Math.round(ga.ay));
                this._grappleLine.rotation_angle_z = deg;
            }

            if (p >= 1) {
                this._clearGrappleLine();
                this._resetPoseTransform();
                this._grappleArc = null;
                this._roamSurface = 'air';
                this._fallVy = 1.2;
                this._setState('free_fall', 4000);
            }
        } else if (this._state === 'class_glider') {
            this._x += dirSign * 3.1 * Math.max(0.75, userSpeed);
            this._y += 1.45;
            this._actor.rotation_angle_z = dirSign * 12 + Math.sin((this._statePhaseMs / 260) * Math.PI) * 5;
            if (this._x <= bounds.minX + 6 || this._x >= bounds.maxX - 6)
                this._facing = this._x <= bounds.minX + 6 ? 'right' : 'left';

            const ledges = this._perception?.scanWindowLedges?.(this._petW, this._petH, bounds) || [];
            const landed = ledges.find(l => this._x >= l.x1 && this._x <= l.x2 && Math.abs(this._y - l.y) <= 10);
            if (landed && this._callbacks.canPerchOnLedge?.(landed.metaWin, this.pet.id) !== false) {
                this._clearPropBadge();
                this._resetPoseTransform();
                this._y = landed.y;
                this._roamSurface = 'ledge';
                this._activeLedge = landed;
                this._jump(-3.0);
                this._setState('happy', 1000);
            } else if (this._y >= bounds.bottomGroundY) {
                this._clearPropBadge();
                this._resetPoseTransform();
                this._y = bounds.bottomGroundY;
                this._roamSurface = 'floor';
                this._activeLedge = null;
                this._jump(-3.2);
                this._setState('happy', 950);
            }
        } else if (this._state === 'dig_treasure') {
            const digBob = Math.sin((this._statePhaseMs / 140) * Math.PI);
            this._actor.set_scale(1.08, 0.90 + digBob * 0.08);
            this._actor.rotation_angle_z = digBob * 9;
        } else if (this._state === 'wall_climb') {
            const onLeftWall = Math.abs(this._x - bounds.minX) <= 18;
            this._x = onLeftWall ? bounds.minX : bounds.maxX;
            this._facing = onLeftWall ? 'right' : 'left';
            this._actor.rotation_angle_z = (onLeftWall ? -78 : 78) + Math.sin((this._statePhaseMs / 150) * Math.PI) * 6;
            this._y += this._climbDirY * 2.1 * Math.max(0.7, userSpeed);

            this._sneakFootstepAccMs += dtMs;
            if (this._sneakFootstepAccMs >= 650) {
                this._sneakFootstepAccMs = 0;
                this._effects.spawnParticle(this._x + this._petW / 2, this._y + this._petH / 2, '🐾', 10);
            }

            if (this._y <= bounds.groundY) {
                this._y = bounds.groundY;
                this._roamSurface = 'topbar';
                this._resetPoseTransform();
                this._facing = onLeftWall ? 'right' : 'left';
                this._jump(-4.0);
                this._setState('walk', 4500);
            } else if (this._y >= bounds.bottomGroundY) {
                this._y = bounds.bottomGroundY;
                this._roamSurface = 'floor';
                this._resetPoseTransform();
                this._facing = onLeftWall ? 'right' : 'left';
                this._jump(-4.0);
                this._setState('walk', 4500);
            }
        } else if (this._state === 'peek') {
            this._actor.rotation_angle_z = Math.sin((this._statePhaseMs / 350) * Math.PI) * 9;
        } else if (this._state === 'walk' || this._state === 'run') {
            // If assigned to Cozy Corner Campfire, stay near the warm campfire zone!
            let activeMinX = surfMinX;
            let activeMaxX = surfMaxX;
            if (freeRoam && this._roamRole === 'camp_resting' && this._roamSurface === 'floor' && Number.isFinite(this._campSpotX)) {
                activeMinX = Math.max(bounds.minX, this._campSpotX - 58);
                activeMaxX = Math.min(bounds.maxX, this._campSpotX + 58);
            }

            const mult = this._state === 'run' ? 2.15 : 1.0;
            const pxPerTick = 1.05 * userSpeed * mult * cpuFactor;
            this._x += this._facing === 'right' ? pxPerTick : -pxPerTick;

            const allowAir = freeRoam && this._roamRole === 'active_roamer' && (this._callbacks.canTakeAirSlot?.(this.pet.id) !== false);

            if (this._x <= activeMinX) {
                this._x = activeMinX;
                if (allowAir && this._roamSurface !== 'ledge' && Math.random() < 0.28) {
                    this._startWallClimb(bounds);
                } else if (allowAir && this._roamSurface === 'ledge' && Math.random() < 0.28) {
                    this._startClassGlider(bounds);
                } else if (Math.random() < 0.34) {
                    this._setState('edge_peek', 1550);
                    if (Math.random() < 0.45) {
                        this.say(
                            this._roamSurface === 'ledge' && this._activeLedge
                                ? `挂在「${this._activeLedge.appName}」窗口左角晃脚丫 👀✨`
                                : '哇，最左边的风景不错呀 👀',
                            2000
                        );
                    }
                } else {
                    this._facing = 'right';
                }
            } else if (this._x >= activeMaxX) {
                this._x = activeMaxX;
                if (allowAir && this._roamSurface !== 'ledge' && Math.random() < 0.28) {
                    this._startWallClimb(bounds);
                } else if (allowAir && this._roamSurface === 'ledge' && Math.random() < 0.28) {
                    this._startClassGlider(bounds);
                } else if (Math.random() < 0.34) {
                    this._setState('edge_peek', 1550);
                    if (Math.random() < 0.45) {
                        this.say(
                            this._roamSurface === 'ledge' && this._activeLedge
                                ? `坐在「${this._activeLedge.appName}」窗口右上角吹风~ ✨`
                                : '趴在右边边往下瞄一眼 👀',
                            2000
                        );
                    }
                } else {
                    this._facing = 'left';
                }
            } else if (!freeRoam || this._roamSurface === 'topbar') {
                this._checkPanelEncounter(bounds, false);
            }
        } else if (this._state !== 'drag') {
            this._x = Math.max(surfMinX, Math.min(surfMaxX, this._x));
        }

        if (this._state !== 'drag') {
            this._stateTimerMs -= dtMs;
            if (this._stateTimerMs <= 0)
                this._pickNextAutonomousState(bounds);
        }

        if (this._state === 'sleep') {
            this._sleepParticleAccMs += dtMs;
            if (this._sleepParticleAccMs >= 4200) {
                this._sleepParticleAccMs = 0;
                this._effects.spawnParticle(this._x + this._petW * 0.65, this._y + 2, '💤', 20);
            }
        } else if (this._state === 'idle' || this._state === 'walk') {
            // Dynamic chatter throttling: scale interval up when user owns many pets!
            const totalPets = Math.max(1, this._roster.pets.filter(p => p.onTopBar !== false).length);
            const chatterThresholdMs = 42000 + (totalPets - 1) * 14000;
            this._bubbleAccMs += dtMs;
            if (this._bubbleAccMs >= chatterThresholdMs) {
                this._bubbleAccMs = 0;
                if (Math.random() < 0.45)
                    this.say(`${this.pet.name}：${pick(this._getQuoteSet().idle)}`, 2300);
            }
        }

        const speedScale = (['walk', 'run', 'raid_widget', 'hurdle', 'zoomies_skid'].includes(this._state))
            ? Math.max(0.5, Math.min(3.0, userSpeed * 0.85))
            : 1.0;
        this._advanceSpriteAnimation(dtMs, speedScale);
        this._applyPosition();
    }

    _resolveAnimKey() {
        switch (this._state) {
            case 'raid_widget':
            case 'hurdle':
            case 'arena_enter':
            case 'backflip_off':
            case 'solo_backflip':
            case 'duo_leapfrog_jumper':
            case 'wall_climb':
            case 'window_bezel_climb':
            case 'window_parkour':
            case 'free_fall':
                return 'run';
            case 'grapple_swing':
                return 'drag';
            case 'zoomies_skid':
                return this._statePhaseMs < 1050 ? 'run' : 'crouch';
            case 'headbutt_ram':
                return this._statePhaseMs < 620 ? 'attack' : 'hurt';
            case 'duo_leapfrog_base':
                return 'crouch';
            case 'duo_spar_clash':
                return this._statePhaseMs < 550 ? 'attack' : 'guard';
            case 'parachute_glide':
            case 'balloon_ascend':
            case 'class_glider':
            case 'dig_treasure':
            case 'duo_high_five':
            case 'duo_sync_dance':
            case 'duo_nuzzle':
                return 'happy';
            case 'peek':
            case 'edge_peek':
            case 'sit_polish':
            case 'screen_knock':
            case 'duo_gossip':
                return 'idle';
            default:
                return this._state;
        }
    }

    _advanceSpriteAnimation(dtMs, speedScale = 1.0) {
        const animKey = this._resolveAnimKey();
        const frames = this._bank.states[animKey] || this._bank.states.idle;
        if (frames && frames.length > 0) {
            const curFrame = frames[this._frameIdx % frames.length];
            this._frameElapsedMs += dtMs;
            if (this._frameElapsedMs >= Math.max(28, curFrame.delayMs / speedScale)) {
                this._frameElapsedMs = 0;
                this._frameIdx = (this._frameIdx + 1) % frames.length;
                this._renderCurrentFrame();
            }
        }
    }

    _pickNextAutonomousState(bounds) {
        this._clearPropBadge();
        this._clearGrappleLine();
        this._resetPoseTransform();
        this._stuntTriggered = false;
        this._lastHitComboStep = -1;

        if ((this._state === 'wall_climb' || this._state === 'window_bezel_climb') && this._roamSurface === 'air') {
            this._startClassGlider(bounds, false);
            return;
        }

        const nonWalkStates = [
            'attack', 'headbutt_ram', 'backflip_off', 'sit_polish', 'sneak', 'hurdle', 'peek',
            'happy', 'cast', 'solo_backflip', 'zoomies_skid', 'screen_knock', 'edge_peek',
            'duo_high_five', 'duo_leapfrog_base', 'duo_leapfrog_jumper', 'duo_sync_dance',
            'duo_spar_clash', 'duo_gossip', 'duo_nuzzle', 'dig_treasure',
            'parachute_glide', 'balloon_ascend', 'free_fall', 'window_parkour', 'grapple_swing', 'class_glider',
        ];

        if (nonWalkStates.includes(this._state)) {
            if (this._state === 'edge_peek') {
                const edgeMinX = (this.isFreeRoamEnabled() && this._roamSurface === 'ledge' && this._activeLedge)
                    ? this._activeLedge.x1
                    : bounds.minX;
                this._facing = this._x <= edgeMinX + 20 ? 'right' : 'left';
            }
            this._activeTarget = null;
            this._duoData = null;
            this._sneakExitX = null;
            this._hurdleTargetX = null;
            this._jumpY = 0;
            this._setState('walk', 4200 + Math.random() * 5200);
            return;
        }

        const freeRoam = this.isFreeRoamEnabled();

        // Cozy Campfire Resting Role (when user has > max-roaming-pets!)
        if (freeRoam && this._roamRole === 'camp_resting') {
            const cRoll = Math.random();
            if (cRoll < 0.48)
                this._setState('sleep', 9000 + Math.random() * 8000);
            else if (cRoll < 0.78)
                this._setState('idle', 4000 + Math.random() * 4000);
            else
                this._setState('walk', 3200 + Math.random() * 2800);
            return;
        }

        // Occasional Spontaneous Treasure Digging on Top Bar, Ledge, or Floor!
        if (Math.random() < 0.06 && this._startDigTreasure())
            return;

        // Free Roam 2.0 Rich Spatial Playground (Subject to RoamDirector Air & Ledge Quotas!)
        const allowAir = freeRoam && this._roamRole === 'active_roamer' && (this._callbacks.canTakeAirSlot?.(this.pet.id) !== false);
        if (allowAir && bounds) {
            const vRoll = Math.random();
            const allLedges = this._perception?.scanWindowLedges?.(this._petW, this._petH, bounds) || [];
            const availLedges = allLedges.filter(l =>
                l.metaWin !== this._activeLedge?.metaWin &&
                (this._callbacks.canPerchOnLedge?.(l.metaWin, this.pet.id) !== false)
            );

            if (this._roamSurface === 'topbar' && vRoll < 0.34) {
                const modeRoll = Math.random();
                if (availLedges.length > 0 && modeRoll < 0.35) {
                    this._startWindowParkourLeap(pick(availLedges));
                } else if (modeRoll < 0.62) {
                    this._startGrappleSwing(bounds, availLedges[0] || null);
                } else if (modeRoll < 0.84) {
                    this._startClassGlider(bounds);
                } else {
                    this._startPortalHop(bounds, availLedges[0] || null);
                }
                return;
            }

            if (this._roamSurface === 'floor' && vRoll < 0.36) {
                const modeRoll = Math.random();
                if (availLedges.length > 0 && modeRoll < 0.38) {
                    this._startWindowBezelClimb(pick(availLedges), bounds);
                } else if (availLedges.length > 0 && modeRoll < 0.65) {
                    this._startWindowParkourLeap(pick(availLedges));
                } else if (modeRoll < 0.85) {
                    this._startPortalHop(bounds, availLedges[0] || null);
                } else {
                    this._startBalloonAscent(bounds, availLedges[0] || null);
                }
                return;
            }

            if (this._roamSurface === 'ledge') {
                if (vRoll < 0.22 && this._activeLedge) {
                    this._setState('peek', 2200);
                    this.say(`趴在「${this._activeLedge.appName}」窗口顶上陪主人敲活儿 👀✨`, 2300);
                    return;
                } else if (vRoll < 0.48) {
                    if (availLedges.length > 0 && Math.random() < 0.55) {
                        this._startWindowParkourLeap(pick(availLedges));
                    } else if (Math.random() < 0.5) {
                        this._startGrappleSwing(bounds, null);
                    } else {
                        this._startClassGlider(bounds);
                    }
                    return;
                }
            }
        }

        const r = Math.random();
        if ((!freeRoam || this._roamSurface === 'topbar') && r < 0.18 && this._perception) {
            const targets = this._perception.scanLiveTargets();
            if (targets.length > 0) {
                this._activeTarget = pick(targets);
                this._setState('raid_widget', 7500);
                return;
            }
        }

        if (r < 0.33 && bounds) {
            this._triggerSoloStunt(bounds);
            return;
        }

        if (r < 0.46) {
            this._setState('idle', 1600 + Math.random() * 2200);
        } else if (r < 0.86) {
            if (Math.random() < 0.35)
                this._facing = this._facing === 'right' ? 'left' : 'right';
            this._setState('walk', 4800 + Math.random() * 6200);
        } else if (r < 0.95) {
            this._setState('run', 1900 + Math.random() * 2100);
        } else {
            this._setState('sleep', 8000 + Math.random() * 7000);
        }
    }

    _renderCurrentFrame() {
        if (!this._bank || !this._actor)
            return;
        const animKey = this._resolveAnimKey();
        const frames = this._bank.states[animKey] || this._bank.states.idle;
        if (!frames || frames.length === 0)
            return;

        const frame = frames[this._frameIdx % frames.length];
        const content = this._facing === 'left' ? frame.left : frame.right;
        if (this._actor.content !== content) {
            this._petW = frame.width;
            this._petH = frame.height;
            this._actor.set_size(this._petW, this._petH);
            this._actor.set_content(content);
        }
    }

    _applyPosition() {
        if (!this._actor || !Number.isFinite(this._x) || !Number.isFinite(this._y))
            return;
        const drawX = Math.round(this._x + (this._lungeX || 0));
        const drawY = Math.round(this._y + (this._jumpY || 0));
        this._actor.set_position(drawX, drawY);

        // Focus Safe-Zone Auto-Dimming: smoothly fade to translucent when crossing active focused window body!
        if (!this._inArenaBattle && !this._isReleasing && !this._dragging) {
            const baseOp = Math.max(50, Math.min(255, this._settings.get_int('pet-opacity')));
            let targetOp = baseOp;
            if (this.isFreeRoamEnabled() && this.isAirborneRoamState()) {
                const ctx = this._perception?.classifyFocusedAppContext?.();
                const r = ctx?.rect;
                if (r && drawX > r.x + 40 && drawX < r.x + r.width - 60 && drawY > r.y + 42 && drawY < r.y + r.height - 60)
                    targetOp = Math.min(baseOp, 110);
            }
            if (this._actor.opacity !== targetOp)
                this._actor.opacity = targetOp;
        }

        if (this._propBadge) {
            this._propBadge.set_position(
                Math.round(drawX + this._petW / 2 - 9),
                Math.max(0, Math.round(drawY - 18))
            );
        }
    }
}
