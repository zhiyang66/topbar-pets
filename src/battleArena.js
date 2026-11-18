import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { addChromeActor, removeChromeActor, boxLayoutProps } from './compat.js';
import { loadSpriteBankForProfile } from './spriteLoader.js';
import { computeCombatStats, getArchetype } from './rpg.js';
import { PixelFxSurface, FX_MODULES } from './pixelfx/bridge.js';

const STAGE_LOGICAL_W = 480;
const STAGE_LOGICAL_H = 180;
const PIXEL_SCALE = 1;
const STAGE_W = STAGE_LOGICAL_W * PIXEL_SCALE; // 480
const STAGE_H = STAGE_LOGICAL_H * PIXEL_SCALE; // 180
const GROUND_Y = 118;
const FIGHTER_SIZE = 52;
const FLOOR_Y = GROUND_Y + FIGHTER_SIZE - 3; // 167: exact paw/floor contact line
const PET_BODY_Y = GROUND_Y + 34;            // 152: visual torso center of 48x48 chibi pet

// Floor-rooted effects whose local y=0 should sit directly on FLOOR_Y (167)
const FLOOR_ROOTED_FX = new Set([
    'spawn/poof', 'spawn/spawn-portal', 'spawn/respawn-beam', 'ui/level-up',
    'arcane/magic-circle-cast', 'fire/flame-pillar', 'fire/fire-tornado', 'fire/meteor',
    'holy/holy-pillar', 'holy/smite', 'holy/heal-aoe',
    'nature/earth-spike', 'nature/healing-bloom',
    'ice/frost-nova', 'ice/ice-spikes', 'ice/blizzard-vortex',
    'impacts/ground-slam', 'lightning/lightning-strike', 'lightning/thunderclap',
    'explosions/big-explosion', 'shadow/dark-explosion',
]);

// Directional beam/breath effects that originate from the caster's mouth/hand toward the foe
const CASTER_MUZZLE_FX = new Set([
    'fire/fire-breath', 'ice/frost-breath',
    'lightning/chain-lightning', 'arcane/arcane-beam', 'ice/ice-spikes',
]);

/**
 * Compute exact PixelFX Y coordinate aligned to our chibi pet's body or paws!
 * - `bg: "dark"` effects (fireball, ice-lance, fire-breath, cartoon-pow) have (0,0) at visual center -> PET_BODY_Y (152).
 * - Floor-rooted `bg: "ground"` effects (pillars, spikes, magic circles, poof) -> FLOOR_Y (167).
 * - Body-centered `bg: "ground"` effects (slashes, shields, parry, crit-hit, orbs) draw ~23px above y -> FLOOR_Y + 8 (175 -> renders at 152!).
 */
function getAlignedFxY(fxId, jumpY = 0) {
    const mod = FX_MODULES[fxId];
    const bg = mod?.meta?.bg || 'ground';
    if (bg !== 'ground')
        return Math.round(PET_BODY_Y + jumpY);
    if (FLOOR_ROOTED_FX.has(fxId))
        return Math.round(FLOOR_Y + jumpY);
    return Math.round(FLOOR_Y + 8 + jumpY);
}

/**
 * Extra render Y offset for flying projectiles whose underlying PixelFX module is `bg: "ground"`
 * (e.g. plasma-ball, arcane-orb, arcane-missiles, leaf-storm draw ~23px above options.y).
 */
function getProjectileRenderOffsetY(fxId) {
    const mod = FX_MODULES[fxId];
    return (mod?.meta?.bg === 'ground') ? 23 : 0;
}

/**
 * Deterministic Mulberry32 PRNG so LAN peers play out the exact same tactical fight!
 */
function createSeededRng(seed) {
    let a = (Number(seed) || 123456789) >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Top-Center Floating Tactical Auto-Battle Arena & LAN Challenge Prompt Manager.
 */
export class BattleArenaManager {
    constructor({ extensionPath, settings, roster, lanManager, onBattleFinished }) {
        this._extensionPath = extensionPath;
        this._settings = settings;
        this._roster = roster;
        this._lanManager = lanManager;
        this._stageManager = null;
        this._onBattleFinished = onBattleFinished;

        this._arenaCard = null;
        this._loopId = 0;
        this._dragCaptureId = 0;
        this._spawnFloatText = null;
        this._battleToken = 0;
        this._arenaParticipantsActive = false;
        this._lastWinnerId = null;

        this._challengeCard = null;
        this._challengeTimerId = 0;
    }

    setStageManager(stageManager) {
        this._stageManager = stageManager;
    }

    destroy() {
        this.closeArena();
        this.closeChallengePrompt();
    }

    isOpen() {
        return Boolean(this._arenaCard);
    }

    // =========================================================================
    // Incoming LAN Duel Request Banner (Top-Center Dropdown)
    // =========================================================================
    showChallengePrompt(challengeInfo) {
        this.closeChallengePrompt();

        const ch = challengeInfo.challenger;
        const arch = getArchetype(ch.archetype);

        const card = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-challenge-card',
            reactive: true,
        }));

        const title = new St.Label({
            text: '⚔️ 局域网对战邀请！',
            style_class: 'topbar-pet-challenge-title',
        });
        const desc = new St.Label({
            text: `「${ch.ownerName}」的 ${ch.name} (Lv.${ch.level} · ${arch.badge}) 向你发起决斗！`,
            style_class: 'topbar-pet-challenge-desc',
        });

        const btnRow = new St.BoxLayout(boxLayoutProps(false, {
            style_class: 'topbar-pet-challenge-btns',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const acceptBtn = new St.Button({
            label: '⚔️ 接受迎战',
            style_class: 'topbar-pet-btn-accept',
            reactive: true,
            can_focus: true,
        });
        const declineBtn = new St.Button({
            label: '婉拒',
            style_class: 'topbar-pet-btn-decline',
            reactive: true,
            can_focus: true,
        });

        acceptBtn.connect('button-press-event', () => {
            this.closeChallengePrompt();
            this._lanManager?.acceptBattleChallenge(challengeInfo);
            return Clutter.EVENT_STOP;
        });
        declineBtn.connect('button-press-event', () => {
            this.closeChallengePrompt();
            this._lanManager?.declineBattleChallenge(challengeInfo);
            return Clutter.EVENT_STOP;
        });

        btnRow.add_child(acceptBtn);
        btnRow.add_child(declineBtn);
        card.add_child(title);
        card.add_child(desc);
        card.add_child(btnRow);

        addChromeActor(card, { interactive: true, trackFullscreen: true });
        this._challengeCard = card;

        const panelBox = Main.layoutManager.panelBox;
        const px = Number.isFinite(panelBox?.x) ? panelBox.x : 0;
        const py = Number.isFinite(panelBox?.y) ? panelBox.y : 0;
        const pw = (panelBox?.width > 64) ? panelBox.width : 1280;
        const ph = panelBox?.height || 32;
        const [, natW] = card.get_preferred_width(-1);
        const w = Math.max(320, Number.isFinite(natW) ? natW : 360);
        card.set_position(Math.round(px + (pw - w) / 2), py + ph + 8);

        this._challengeTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
            this._challengeTimerId = 0;
            this.closeChallengePrompt();
            return GLib.SOURCE_REMOVE;
        });
    }

    closeChallengePrompt() {
        if (this._challengeTimerId) {
            GLib.Source.remove(this._challengeTimerId);
            this._challengeTimerId = 0;
        }
        if (this._challengeCard) {
            removeChromeActor(this._challengeCard);
            this._challengeCard.destroy();
            this._challengeCard = null;
        }
    }

    // =========================================================================
    // Launch Practice / Sibling Spar / LAN Synchronized Battle!
    // =========================================================================
    startPracticeBattle(opponentPetRecord = null) {
        const myPet = this._roster.getPrimaryPet();
        const leftPacket = {
            ownerName: this._roster.getOwnerName(),
            id: myPet.id,
            name: myPet.name,
            level: myPet.level,
            archetype: myPet.archetype,
            presetId: myPet.presetId,
            skinMode: myPet.skinMode,
            customPath: myPet.customPath,
            cols: myPet.cols,
            rows: myPet.rows,
            baseFacingRight: myPet.baseFacingRight,
            autoRemoveBg: myPet.autoRemoveBg,
        };

        let rightPacket;
        if (opponentPetRecord) {
            rightPacket = {
                ownerName: this._roster.getOwnerName(),
                id: opponentPetRecord.id,
                name: opponentPetRecord.name,
                level: opponentPetRecord.level,
                archetype: opponentPetRecord.archetype,
                presetId: opponentPetRecord.presetId,
                skinMode: opponentPetRecord.skinMode,
                customPath: opponentPetRecord.customPath,
                cols: opponentPetRecord.cols,
                rows: opponentPetRecord.rows,
                baseFacingRight: opponentPetRecord.baseFacingRight,
                autoRemoveBg: opponentPetRecord.autoRemoveBg,
            };
        } else {
            const wildPool = [
                { name: '赤焰幼龙', presetId: 'dragon', archetype: 'fire' },
                { name: '雷霆柴丸', presetId: 'shiba', archetype: 'storm' },
                { name: '星界幽幽', presetId: 'ghost', archetype: 'arcane' },
                { name: '皇冠果冻', presetId: 'slime', archetype: 'ice' },
                { name: '圣光机甲', presetId: 'robot', archetype: 'holy' },
            ];
            const pickWild = wildPool[Math.floor(Math.random() * wildPool.length)];
            const lvDelta = Math.floor(Math.random() * 3) - 1;
            rightPacket = {
                ownerName: '野生挑战者',
                id: 'wild-ai',
                name: pickWild.name,
                level: Math.max(1, myPet.level + lvDelta),
                archetype: pickWild.archetype,
                presetId: pickWild.presetId,
                skinMode: 'preset',
            };
        }

        this.openBattle({
            seed: Math.floor(Math.random() * 899999) + 100000,
            leftFighter: leftPacket,
            rightFighter: rightPacket,
            localPetId: myPet.id,
            isLanBattle: false,
        });
    }

    openBattle(battleInit) {
        this.closeArena();

        const token = ++this._battleToken;
        this._lastWinnerId = null;
        this._arenaParticipantsActive = true;

        if (this._stageManager) {
            this._stageManager.playArenaEntrance(
                battleInit.leftFighter,
                battleInit.rightFighter,
                () => {
                    if (token !== this._battleToken)
                        return;
                    this._openArenaStageNow(battleInit);
                }
            );
        } else {
            this._openArenaStageNow(battleInit);
        }
    }

    _openArenaStageNow({ seed, leftFighter, rightFighter, localPetId, isLanBattle = false }) {

        const rng = createSeededRng(seed);
        const leftProfile = this._resolveFighterSpriteProfile(leftFighter);
        const rightProfile = this._resolveFighterSpriteProfile(rightFighter);

        const leftBank = loadSpriteBankForProfile(this._extensionPath, leftProfile, {
            targetHeight: FIGHTER_SIZE,
            pixelCrisp: this._settings.get_boolean('pixel-art-scaling'),
        });
        const rightBank = loadSpriteBankForProfile(this._extensionPath, rightProfile, {
            targetHeight: FIGHTER_SIZE,
            pixelCrisp: this._settings.get_boolean('pixel-art-scaling'),
        });

        const card = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-arena-window',
            reactive: true,
        }));

        // 1. Header Bar: Separate drag handle from Close Button so ✕ ALWAYS works immediately!
        const titleBar = new St.BoxLayout(boxLayoutProps(false, {
            style_class: 'topbar-pet-arena-titlebar',
            reactive: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const modeTag = isLanBattle ? '🌐 局域网实时决斗' : '⚔️ 顶部栏宠物切磋擂台';
        const dragHandle = new St.Bin({
            reactive: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            child: new St.Label({
                text: `${modeTag}  ·  ${leftFighter.ownerName}「${leftFighter.name}」 VS ${rightFighter.ownerName}「${rightFighter.name}」`,
                style_class: 'topbar-pet-arena-title',
                y_align: Clutter.ActorAlign.CENTER,
            }),
        });

        const closeBtn = new St.Button({
            label: ' ✕ 关闭 ',
            style_class: 'topbar-pet-arena-close',
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        closeBtn.connect('button-press-event', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this.closeArena();
                return GLib.SOURCE_REMOVE;
            });
            return Clutter.EVENT_STOP;
        });
        closeBtn.connect('clicked', () => this.closeArena());

        titleBar.add_child(dragHandle);
        titleBar.add_child(closeBtn);
        card.add_child(titleBar);

        this._setupHeaderDrag(dragHandle, card);

        // 2. Dual Fighter HUD
        const leftStats = computeCombatStats(leftFighter);
        const rightStats = computeCombatStats(rightFighter);

        const hudRow = new St.BoxLayout(boxLayoutProps(false, {
            style_class: 'topbar-pet-arena-hud',
            x_expand: true,
        }));
        const leftHud = this._createFighterHud(leftFighter, leftStats, false);
        const vsLabel = new St.Label({
            text: 'VS',
            style_class: 'topbar-pet-arena-vs',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const rightHud = this._createFighterHud(rightFighter, rightStats, true);

        hudRow.add_child(leftHud.box);
        hudRow.add_child(vsLabel);
        hudRow.add_child(rightHud.box);
        card.add_child(hudRow);

        // 3. Tactical Announcer Banner
        const bannerLabel = new St.Label({
            text: '⚡ 双方宠物入场，准备战斗！',
            style_class: 'topbar-pet-arena-banner',
            x_align: Clutter.ActorAlign.CENTER,
        });
        card.add_child(bannerLabel);

        // 4. Layered 1x Crisp PixelFX + Fighter Stage (480 x 180)
        const stage = new St.Widget({
            style_class: 'topbar-pet-arena-stage',
            layout_manager: new Clutter.FixedLayout(),
            width: STAGE_W,
            height: STAGE_H,
            clip_to_allocation: true,
        });

        const floorLine = new St.Widget({
            style_class: 'topbar-pet-arena-floor',
            width: STAGE_W - 24,
            height: 4,
            x: 12,
            y: GROUND_Y + FIGHTER_SIZE - 2,
        });
        stage.add_child(floorLine);

        const fxBack = new PixelFxSurface(STAGE_LOGICAL_W, STAGE_LOGICAL_H, PIXEL_SCALE);
        const fxBackWidget = new St.Widget({ width: STAGE_W, height: STAGE_H });
        fxBackWidget.set_content(fxBack.content);
        stage.add_child(fxBackWidget);

        const leftActor = new St.Widget({ width: leftBank.width, height: leftBank.height });
        leftActor.set_pivot_point(0.5, 1.0);
        const rightActor = new St.Widget({ width: rightBank.width, height: rightBank.height });
        rightActor.set_pivot_point(0.5, 1.0);

        const leftTag = new St.Label({ text: `${leftFighter.name}`, style_class: 'topbar-pet-stage-nametag-left' });
        const rightTag = new St.Label({ text: `${rightFighter.name}`, style_class: 'topbar-pet-stage-nametag-right' });

        stage.add_child(leftActor);
        stage.add_child(rightActor);
        stage.add_child(leftTag);
        stage.add_child(rightTag);

        const fxFront = new PixelFxSurface(STAGE_LOGICAL_W, STAGE_LOGICAL_H, PIXEL_SCALE);
        const fxFrontWidget = new St.Widget({ width: STAGE_W, height: STAGE_H });
        fxFrontWidget.set_content(fxFront.content);
        stage.add_child(fxFrontWidget);

        card.add_child(stage);

        addChromeActor(card, { interactive: true, trackFullscreen: true });
        this._arenaCard = card;

        const panelBox = Main.layoutManager.panelBox;
        const px = Number.isFinite(panelBox?.x) ? panelBox.x : 0;
        const py = Number.isFinite(panelBox?.y) ? panelBox.y : 0;
        const pw = (Number.isFinite(panelBox?.width) && panelBox.width > 64) ? panelBox.width : 1280;
        const ph = (Number.isFinite(panelBox?.height) && panelBox.height > 12) ? panelBox.height : 32;
        const [, cardNatW] = card.get_preferred_width(-1);
        const finalW = Math.max(STAGE_W + 24, Number.isFinite(cardNatW) ? cardNatW : STAGE_W + 24);
        card.set_position(Math.round(px + (pw - finalW) / 2), py + ph + 6);

        this._spawnFloatText = (x, y, text, kind = 'normal') => {
            if (!this._arenaCard)
                return;
            const clsMap = {
                normal: 'topbar-pet-dmg-normal',
                crit: 'topbar-pet-dmg-crit',
                heal: 'topbar-pet-dmg-heal',
                guard: 'topbar-pet-dmg-guard',
                evade: 'topbar-pet-dmg-evade',
            };
            const lbl = new St.Label({
                text,
                style_class: clsMap[kind] || clsMap.normal,
                reactive: false,
                opacity: 255,
            });
            lbl.set_position(Math.round(Math.max(10, Math.min(STAGE_W - 78, x - 20))), Math.round(Math.max(6, y)));
            stage.add_child(lbl);
            lbl.ease({
                y: Math.round(Math.max(2, y - (kind === 'crit' ? 28 : 20))),
                opacity: 0,
                duration: kind === 'crit' ? 920 : 760,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (lbl.get_parent())
                        lbl.destroy();
                },
            });
        };

        const fA = this._makeRuntimeFighter('left', leftFighter, leftStats, leftBank, leftActor, leftTag, leftHud, 76, 'right');
        const fB = this._makeRuntimeFighter('right', rightFighter, rightStats, rightBank, rightActor, rightTag, rightHud, STAGE_W - 76 - rightBank.width, 'left');

        // Fighters leap down from the Top Bar right into the Arena!
        fA.jumpY = -48;
        fA.vy = 1.6;
        fB.jumpY = -48;
        fB.vy = 1.6;

        fxBack.spawn('spawn/poof', { x: fA.x + 26, y: FLOOR_Y });
        fxBack.spawn('spawn/poof', { x: fB.x + 26, y: FLOOR_Y });
        fxFront.spawn('ui/countdown', { x: STAGE_W / 2, y: STAGE_H / 2 });

        const projectiles = [];
        let phase = 'intro';
        let elapsedSec = 0;
        let freezeMs = 0;
        let finishCloseSec = 0;

        this._loopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
            if (!this._arenaCard)
                return GLib.SOURCE_REMOVE;

            const dtMs = 33;
            const dtSec = dtMs / 1000;
            elapsedSec += dtSec;

            if (freezeMs > 0) {
                freezeMs = Math.max(0, freezeMs - dtMs);
                fxBack.step(dtSec * 0.35);
                fxFront.step(dtSec * 0.35);
                return GLib.SOURCE_CONTINUE;
            }

            if (phase === 'intro') {
                if (elapsedSec >= 1.35) {
                    phase = 'fight';
                    bannerLabel.text = '⚔️ 对决开始！下蹲闪避 · 举盾弹反 · 走位博弈！';
                }
            } else if (phase === 'fight') {
                this._stepTacticalFighter(fA, fB, dtSec, rng, fxBack, fxFront, projectiles, t => { bannerLabel.text = t; }, ms => { freezeMs = Math.max(freezeMs, ms); });
                if (fB.hp > 0 && fA.hp > 0) {
                    this._stepTacticalFighter(fB, fA, dtSec, rng, fxBack, fxFront, projectiles, t => { bannerLabel.text = t; }, ms => { freezeMs = Math.max(freezeMs, ms); });
                }
                this._stepProjectiles(projectiles, dtSec, rng, fxFront, t => { bannerLabel.text = t; }, ms => { freezeMs = Math.max(freezeMs, ms); });

                if (fA.hp <= 0 || fB.hp <= 0) {
                    phase = 'finished';
                    const winner = fA.hp > 0 ? fA : fB;
                    const loser = winner === fA ? fB : fA;
                    winner.anim = 'happy';
                    winner.vy = -6.5;
                    loser.anim = 'hurt';

                    fxFront.spawn('ui/confetti', { x: Math.round(winner.x + 26), y: 78 });
                    fxFront.spawn('ui/level-up', { x: Math.round(winner.x + 26), y: FLOOR_Y });

                    const localWon = (localPetId && winner.info.id === localPetId) || (!isLanBattle && winner === fA);
                    this._lastWinnerId = winner.info.id || null;
                    bannerLabel.text = `🏆 胜者：${winner.info.ownerName} 的「${winner.info.name}」！(${localWon ? '经验 +35 ✨' : '切磋经验 +18 ✨'})`;

                    // Clear any leftover flying projectiles immediately when KO happens!
                    for (const remProj of projectiles) {
                        if (remProj.fxInst)
                            fxFront.removeInstance(remProj.fxInst);
                    }
                    projectiles.length = 0;

                    if (localPetId)
                        this._roster.recordBattleOutcome(localPetId, localWon);
                    if (this._onBattleFinished)
                        this._onBattleFinished({ winner: winner.info, localWon });
                }
            } else if (phase === 'finished') {
                finishCloseSec += dtSec;
                if (finishCloseSec >= 7.0) {
                    this.closeArena();
                    return GLib.SOURCE_REMOVE;
                }
            }

            this._updateFighterPhysicsAndRender(fA, dtMs);
            this._updateFighterPhysicsAndRender(fB, dtMs);
            this._refreshFighterHud(fA);
            this._refreshFighterHud(fB);

            fxBack.step(dtSec);
            fxFront.step(dtSec);

            return GLib.SOURCE_CONTINUE;
        });
    }

    closeArena() {
        this._battleToken += 1;
        this._spawnFloatText = null;
        if (this._loopId) {
            GLib.Source.remove(this._loopId);
            this._loopId = 0;
        }
        if (this._dragCaptureId) {
            global.stage.disconnect(this._dragCaptureId);
            this._dragCaptureId = 0;
        }
        if (this._arenaCard) {
            removeChromeActor(this._arenaCard);
            this._arenaCard.destroy();
            this._arenaCard = null;
        }
        if (this._arenaParticipantsActive) {
            this._arenaParticipantsActive = false;
            this._stageManager?.returnFightersFromArena(this._lastWinnerId);
            this._lastWinnerId = null;
        }
    }

    // =========================================================================
    // Tactical Fighting-Game AI (Footsies, Crouch Duck, Guard Block, Parry, Roll!)
    // =========================================================================
    _resolveFighterSpriteProfile(fighter) {
        if (fighter.customPath)
            return fighter;
        const localPet = fighter.id ? this._roster.getPetById(fighter.id) : null;
        if (localPet)
            return localPet;
        if (this._lanManager && fighter.peerId) {
            const peer = this._lanManager.peers.get(fighter.peerId);
            if (peer)
                return this._lanManager.resolvePeerSkinProfile(peer);
        }
        return {
            skinMode: 'preset',
            presetId: fighter.presetId || 'shiba',
            baseFacingRight: true,
        };
    }

    _setupHeaderDrag(dragHandle, card) {
        dragHandle.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const [sx, sy] = event.get_coords();
            const startX = card.x;
            const startY = card.y;

            if (this._dragCaptureId)
                global.stage.disconnect(this._dragCaptureId);

            this._dragCaptureId = global.stage.connect('captured-event', (_st, ev) => {
                if (ev.type() === Clutter.EventType.MOTION) {
                    const [mx, my] = ev.get_coords();
                    card.set_position(Math.round(startX + (mx - sx)), Math.max(0, Math.round(startY + (my - sy))));
                    return Clutter.EVENT_STOP;
                } else if (ev.type() === Clutter.EventType.BUTTON_RELEASE) {
                    if (this._dragCaptureId) {
                        global.stage.disconnect(this._dragCaptureId);
                        this._dragCaptureId = 0;
                    }
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            return Clutter.EVENT_STOP;
        });
    }

    _createFighterHud(info, stats, alignRight) {
        const box = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-fighter-hud',
            x_expand: true,
        }));
        const nameLabel = new St.Label({
            text: `${info.ownerName} · ${info.name}  Lv.${info.level} ${stats.archetypeBadge}`,
            style_class: 'topbar-pet-fighter-name',
            x_align: alignRight ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
        });
        const hpTrack = new St.Widget({ style_class: 'topbar-pet-hp-track', width: 196, height: 10 });
        const hpFill = new St.Widget({
            style_class: alignRight ? 'topbar-pet-hp-fill-enemy' : 'topbar-pet-hp-fill-ally',
            width: 196,
            height: 10,
        });
        hpTrack.add_child(hpFill);

        const rageTrack = new St.Widget({ style_class: 'topbar-pet-rage-track', width: 196, height: 5 });
        const rageFill = new St.Widget({ style_class: 'topbar-pet-rage-fill', width: 0, height: 5 });
        rageTrack.add_child(rageFill);

        const hpText = new St.Label({
            text: `HP ${stats.maxHp}/${stats.maxHp}`,
            style_class: 'topbar-pet-fighter-hptext',
            x_align: alignRight ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
        });

        box.add_child(nameLabel);
        box.add_child(hpTrack);
        box.add_child(rageTrack);
        box.add_child(hpText);
        return { box, hpFill, rageFill, hpText };
    }

    _makeRuntimeFighter(side, info, stats, bank, actor, nameTag, hud, startX, facing) {
        return {
            side,
            info,
            stats,
            bank,
            actor,
            nameTag,
            hud,
            hp: stats.maxHp,
            maxHp: stats.maxHp,
            rage: 20,
            x: startX,
            jumpY: 0,
            vy: 0,
            vxKnock: 0,
            facing,
            anim: 'idle',
            // Tactical timers & stances
            actionLockSec: 0,
            staggerSec: 0,       // Stunned after getting Perfect Parried!
            crouchSec: 0,        // Ducking low under projectiles / high swings!
            crouchCounterReady: false,
            guardSec: 0,         // Holding defensive shield stance!
            parryWindowSec: 0,   // First 0.24s of guard = Perfect Parry window!
            rollSec: 0,          // Invulnerable roll through opponent!
            rollVx: 0,
            footsieDir: 0,       // +1 step-in, -1 step-out spacing weave
            footsieSec: 0,
            comboHitsLanded: 0,  // Triggers backdash after 1-2 hits to avoid face-tanking!
            defenseCdSec: 0,
            jumpCdSec: 0.8,
            shieldSec: 0,        // Skill buff shield
            slowSec: 0,
            hitFlashMs: 0,
            pendingStrike: null, // { timerSec, skill, height: 'high'|'mid' }
            cooldowns: new Map(),
            frameIdx: 0,
            frameAccMs: 0,
        };
    }

    _stepTacticalFighter(me, foe, dtSec, rng, fxBack, fxFront, projectiles, announce, addFreeze) {
        // 1. Tick all tactical state timers
        me.actionLockSec = Math.max(0, me.actionLockSec - dtSec);
        me.staggerSec = Math.max(0, me.staggerSec - dtSec);
        me.crouchSec = Math.max(0, me.crouchSec - dtSec);
        me.guardSec = Math.max(0, me.guardSec - dtSec);
        me.parryWindowSec = Math.max(0, me.parryWindowSec - dtSec);
        me.defenseCdSec = Math.max(0, me.defenseCdSec - dtSec);
        me.jumpCdSec = Math.max(0, me.jumpCdSec - dtSec);
        me.shieldSec = Math.max(0, me.shieldSec - dtSec);
        me.slowSec = Math.max(0, me.slowSec - dtSec);
        me.footsieSec = Math.max(0, me.footsieSec - dtSec);
        me.rage = Math.min(100, me.rage + dtSec * 10);

        for (const [skId, rem] of me.cooldowns.entries()) {
            if (rem <= dtSec)
                me.cooldowns.delete(skId);
            else
                me.cooldowns.set(skId, rem - dtSec);
        }

        const meCenter = me.x + me.bank.width / 2;
        const foeCenter = foe.x + foe.bank.width / 2;
        const dx = foeCenter - meCenter;
        const dist = Math.abs(dx);
        const dirToFoe = dx >= 0 ? 1 : -1;

        // 2. Resolve Delayed Wind-Up Strike! (Allows opponent to duck, block, parry, or backdash!)
        if (me.pendingStrike) {
            me.pendingStrike.timerSec -= dtSec;
            if (me.pendingStrike.timerSec <= 0) {
                const strike = me.pendingStrike;
                me.pendingStrike = null;
                this._resolveStrikeImpact(me, foe, strike, dist, rng, fxBack, fxFront, announce, addFreeze);
            }
            return;
        }

        // 3. Handle Stagger (Parried!), Roll, Crouch, or Guard Stance
        if (me.staggerSec > 0) {
            me.anim = 'hurt';
            return;
        }

        if (me.rollSec > 0) {
            me.rollSec = Math.max(0, me.rollSec - dtSec);
            me.x += me.rollVx * dtSec;
            me.anim = 'sneak';
            if (me.rollSec <= 0)
                me.facing = foe.x >= me.x ? 'right' : 'left';
            return;
        }

        if (me.crouchSec > 0) {
            me.anim = 'crouch';
            me.facing = dirToFoe > 0 ? 'right' : 'left';
            // If we successfully ducked an attack and foe is close, launch an Uppercut Counter!
            if (me.crouchCounterReady && dist <= 78) {
                me.crouchCounterReady = false;
                me.crouchSec = 0;
                me.vy = -6.4;
                me.anim = 'attack';
                me.actionLockSec = 0.72;
                fxFront.spawn('melee/uppercut', {
                    x: Math.round((meCenter + foeCenter) / 2),
                    y: getAlignedFxY('melee/uppercut', 0),
                    flip: me.facing === 'left',
                });
                announce(`⬆️ ${me.info.name} 下蹲闪避后打出【升龙反击】！`);
                foe.vy = -6.5; // Launch opponent airborne!
                this._applyDamage(me, foe, { name: '升龙反击', power: 1.35, knockback: 22, fxHit: 'impacts/crit-hit' }, 'mid', rng, fxFront, announce, addFreeze);
            }
            return;
        }

        if (me.guardSec > 0) {
            me.anim = 'guard';
            me.facing = dirToFoe > 0 ? 'right' : 'left';
            return;
        }

        if (me.actionLockSec > 0)
            return;

        me.facing = dirToFoe > 0 ? 'right' : 'left';

        // 4. REACTIVE DEFENSIVE AI: Respond to incoming Projectiles or Enemy Wind-Up!
        if (me.jumpY === 0 && me.defenseCdSec <= 0) {
            const incomingProj = projectiles.find(p => p.target === me && Math.abs(p.x - meCenter) < 92 && (p.vx * (meCenter - p.x) > 0));
            const foeWindingUpClose = foe.pendingStrike && dist <= (foe.pendingStrike.reach + 22);

            if (incomingProj || foeWindingUpClose) {
                const reactRoll = rng();
                if (reactRoll < 0.34) {
                    // TACTIC A: Crouch Duck! (Ducks right under high projectiles & high swings!)
                    me.crouchSec = 0.62;
                    me.defenseCdSec = 1.6;
                    me.anim = 'crouch';
                    announce(`⬇️ ${me.info.name} 急速下蹲潜避攻击！`);
                    return;
                } else if (reactRoll < 0.68) {
                    // TACTIC B: Raise Guard / Attempt Perfect Parry!
                    me.guardSec = 0.68;
                    me.parryWindowSec = 0.25; // First 0.25s = Street-Fighter Perfect Parry!
                    me.defenseCdSec = 1.8;
                    me.anim = 'guard';
                    fxBack.spawn('impacts/shield-block', { x: Math.round(meCenter), y: getAlignedFxY('impacts/shield-block'), flip: me.facing === 'left' });
                    return;
                } else if (reactRoll < 0.86) {
                    // TACTIC C: Backdash / Jump Evade!
                    if (incomingProj && me.jumpCdSec <= 0) {
                        me.vy = -7.2;
                        me.vxKnock = dirToFoe * 3.2; // Forward jump-in over projectile!
                        me.jumpCdSec = 2.2;
                        me.defenseCdSec = 1.4;
                        me.anim = 'run';
                        fxBack.spawn('spawn/poof', { x: Math.round(meCenter), y: FLOOR_Y });
                        announce(`💨 ${me.info.name} 跃起翻越飞行道具！`);
                        return;
                    } else if (foeWindingUpClose) {
                        // Crisp Backdash out of melee range to make opponent WHIFF!
                        me.vxKnock = -dirToFoe * 8.2;
                        me.vy = -2.8;
                        me.actionLockSec = 0.35;
                        me.defenseCdSec = 1.5;
                        me.anim = 'walk';
                        fxBack.spawn('spawn/poof', { x: Math.round(meCenter), y: FLOOR_Y });
                        this._spawnFloatText?.(meCenter, GROUND_Y + 8, '💨 后撤闪避', 'evade');
                        return;
                    }
                }
            }
        }

        // 5. Corner Escape Roll! Never stay pinned in the corner!
        const pinnedLeft = me.x < 34 && dirToFoe > 0 && dist < 85;
        const pinnedRight = me.x > STAGE_W - me.bank.width - 34 && dirToFoe < 0 && dist < 85;
        if ((pinnedLeft || pinnedRight) && me.jumpY === 0 && rng() < 0.45) {
            me.rollSec = 0.38;
            me.rollVx = dirToFoe * 260;
            fxBack.spawn('arcane/blink-out', { x: Math.round(meCenter), y: getAlignedFxY('arcane/blink-out') });
            this._spawnFloatText?.(meCenter, GROUND_Y + 8, '💨 翻滚绕背', 'evade');
            announce(`💨 ${me.info.name} 灵巧翻滚脱离角落反客为主！`);
            return;
        }

        // 6. Hit-and-Run Disengage! Don't stand nose-to-nose trading punches!
        if (me.comboHitsLanded >= 1 && dist < 66 && rng() < (me.comboHitsLanded >= 2 ? 0.82 : 0.48)) {
            me.comboHitsLanded = 0;
            me.vxKnock = -dirToFoe * 7.6;
            me.vy = -2.6;
            me.footsieDir = -dirToFoe;
            me.footsieSec = 0.55;
            me.actionLockSec = 0.38;
            fxBack.spawn('spawn/poof', { x: Math.round(meCenter), y: FLOOR_Y });
            return;
        }

        // 7. Neutral Footsies Weaving (subtle back-and-forth spacing dance!)
        if (me.footsieSec > 0) {
            const slowMult = me.slowSec > 0 ? 0.55 : 1.0;
            me.x += me.footsieDir * 2.2 * me.stats.spd * slowMult;
            me.anim = 'walk';
            return;
        }
        if (dist >= 75 && dist <= 165 && rng() < 0.06) {
            me.footsieDir = rng() < 0.5 ? -dirToFoe : dirToFoe;
            me.footsieSec = 0.35 + rng() * 0.35;
            return;
        }

        // 8. Pick Skill & Approach / Execute
        const skills = me.stats.unlockedSkills;
        const readySkills = skills.filter(sk => {
            if (me.cooldowns.has(sk.id))
                return false;
            if (sk.type === 'ultimate' && me.rage < 85)
                return false;
            if (sk.type === 'buff_shield' && me.hp > me.maxHp * 0.78 && rng() < 0.75)
                return false;
            return true;
        });

        readySkills.sort((a, b) => b.unlockLv - a.unlockLv);
        const chosen = readySkills[0] || skills[0];
        const needRange = chosen.type === 'melee' ? 58 : (chosen.type === 'leap_melee' ? 125 : 290);

        if (dist > needRange) {
            const slowMult = me.slowSec > 0 ? 0.55 : 1.0;
            me.x += dirToFoe * 3.0 * me.stats.spd * slowMult;
            me.anim = 'run';
            // Occasional aerial jump-in approach!
            if (me.jumpY === 0 && me.jumpCdSec <= 0 && dist < 140 && rng() < 0.06) {
                me.vy = -6.2;
                me.vxKnock = dirToFoe * 3.5;
                me.jumpCdSec = 2.4;
            }
            return;
        }

        // Ranged casters prefer comfortable spacing before firing
        if (chosen.type === 'projectile' && dist < 85 && rng() < 0.55) {
            me.vxKnock = -dirToFoe * 6.5;
            me.actionLockSec = 0.32;
            me.anim = 'walk';
            return;
        }

        // Trigger Skill Execution!
        me.cooldowns.set(chosen.id, chosen.cd);
        if (chosen.type === 'ultimate')
            me.rage = 0;
        else
            me.rage = Math.min(100, me.rage + 12);

        const flipFx = me.facing === 'left';
        const meFxX = Math.round(meCenter);

        announce(`${me.stats.archetypeBadge} ${me.info.name} 使出【${chosen.name}】！`);

        if (chosen.fxCast)
            fxBack.spawn(chosen.fxCast, { x: meFxX, y: getAlignedFxY(chosen.fxCast, me.jumpY), flip: flipFx });

        if (chosen.type === 'buff_shield') {
            me.anim = 'cast';
            me.actionLockSec = 0.85;
            me.shieldSec = chosen.shieldSec || 3.8;
            fxBack.spawn(chosen.fxMain, { x: meFxX, y: getAlignedFxY(chosen.fxMain, me.jumpY) });
            if (chosen.fxHit)
                fxFront.spawn(chosen.fxHit, { x: meFxX, y: getAlignedFxY(chosen.fxHit, me.jumpY) });
            if (chosen.healPct) {
                const heal = Math.round(me.maxHp * chosen.healPct);
                me.hp = Math.min(me.maxHp, me.hp + heal);
                this._spawnFloatText?.(meCenter, GROUND_Y + 6, `+${heal}`, 'heal');
            }
        } else if (chosen.type === 'blink_strike') {
            fxBack.spawn('arcane/blink-out', { x: meFxX, y: getAlignedFxY('arcane/blink-out', me.jumpY) });
            const behindX = foe.x + (dx >= 0 ? 40 : -40);
            me.x = Math.max(16, Math.min(STAGE_W - me.bank.width - 16, behindX));
            me.facing = foe.x >= me.x ? 'right' : 'left';
            me.anim = 'attack';
            me.actionLockSec = 0.82;
            const newFxX = Math.round(me.x + me.bank.width / 2);
            fxBack.spawn('arcane/blink-in', { x: newFxX, y: getAlignedFxY('arcane/blink-in', me.jumpY) });
            me.pendingStrike = {
                timerSec: 0.18,
                skill: chosen,
                reach: 76,
                height: 'mid',
            };
        } else if (chosen.type === 'projectile') {
            me.anim = 'cast';
            me.actionLockSec = 0.82;
            // High lane flies at mouth/head level (145: crouching ducks right under it!); low lane flies at belly/shin (156)
            const lane = rng() < 0.72 ? 'high' : 'low';
            const spawnX = meCenter + (me.facing === 'right' ? 18 : -18);
            const spawnY = (lane === 'high' ? PET_BODY_Y - 6 : PET_BODY_Y + 5) + me.jumpY;
            const renderOffsetY = getProjectileRenderOffsetY(chosen.fxMain);
            const fxInst = fxFront.spawn(chosen.fxMain, {
                x: Math.round(spawnX),
                y: Math.round(spawnY + renderOffsetY),
                flip: flipFx,
                manualLifetime: true,
            });
            projectiles.push({
                attacker: me,
                target: foe,
                skill: chosen,
                lane,
                x: spawnX,
                y: spawnY,
                renderOffsetY,
                vx: me.facing === 'right' ? 245 : -245,
                fxInst,
            });
        } else {
            // Wind-up telegraph for melee / leap_melee / ranged_instant / ultimate!
            if (chosen.type === 'leap_melee') {
                me.vy = -5.8;
                me.vxKnock = dirToFoe * 4.5;
                me.anim = 'attack';
                me.actionLockSec = 0.88;
                me.pendingStrike = { timerSec: 0.26, skill: chosen, reach: 92, height: 'mid' };
            } else if (chosen.type === 'melee') {
                me.anim = 'attack';
                me.actionLockSec = 0.75;
                const height = rng() < 0.55 ? 'high' : 'mid';
                me.pendingStrike = { timerSec: 0.22, skill: chosen, reach: 72, height };
            } else {
                me.anim = 'cast';
                me.actionLockSec = chosen.type === 'ultimate' ? 1.15 : 0.88;
                if (chosen.type === 'ultimate')
                    me.vy = -4.2;
                me.pendingStrike = {
                    timerSec: chosen.type === 'ultimate' ? 0.34 : 0.26,
                    skill: chosen,
                    reach: 420,
                    height: chosen.type === 'ultimate' ? 'all' : 'mid',
                };
            }
        }
    }

    _resolveStrikeImpact(attacker, defender, strike, currentDist, rng, fxBack, fxFront, announce, addFreeze) {
        const skill = strike.skill;
        const flipFx = attacker.facing === 'left';
        const attCenter = attacker.x + attacker.bank.width / 2;
        const defCenter = defender.x + defender.bank.width / 2;
        const mainFxId = (skill.fxHit && skill.type === 'blink_strike') ? skill.fxHit : skill.fxMain;

        let fxX;
        let anchorJumpY = defender.jumpY;
        if (CASTER_MUZZLE_FX.has(mainFxId)) {
            fxX = Math.round(attCenter + (flipFx ? -14 : 14));
            anchorJumpY = attacker.jumpY;
        } else if (skill.type === 'melee' || skill.type === 'leap_melee' || skill.type === 'blink_strike') {
            fxX = Math.round((attCenter + defCenter) / 2);
        } else {
            fxX = Math.round(defCenter);
        }

        fxFront.spawn(mainFxId, {
            x: fxX,
            y: getAlignedFxY(mainFxId, anchorJumpY),
            flip: flipFx,
        });

        // 1. Range check (did defender Backdash or Roll out of reach?!)
        if (currentDist > strike.reach || defender.rollSec > 0) {
            this._spawnFloatText?.(defCenter, GROUND_Y - 6, '💨 闪避！', 'evade');
            attacker.comboHitsLanded = 0;
            return;
        }

        // 2. Crouch Duck check (did defender duck under a high swing?!)
        if (defender.crouchSec > 0 && strike.height === 'high') {
            defender.crouchCounterReady = true;
            this._spawnFloatText?.(defCenter, GROUND_Y + 4, '⬇️ 下蹲躲过！', 'evade');
            announce(`⬇️ ${defender.info.name} 伏低身躯完美躲过【${skill.name}】！`);
            attacker.comboHitsLanded = 0;
            return;
        }

        this._applyDamage(attacker, defender, skill, strike.height, rng, fxFront, announce, addFreeze);
    }

    _stepProjectiles(projectiles, dtSec, rng, fxFront, announce, addFreeze) {
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            p.x += p.vx * dtSec;

            if (p.fxInst) {
                p.fxInst.options.x = Math.round(p.x);
                p.fxInst.options.y = Math.round(p.y + (p.renderOffsetY || 0));
            }

            const def = p.target;
            const defCenter = def.x + def.bank.width / 2;

            if (Math.abs(p.x - defCenter) <= 22) {
                // Invulnerable roll passes right through!
                if (def.rollSec > 0)
                    continue;

                // Crouching ducks cleanly under 'high' projectiles!
                if (def.crouchSec > 0 && p.lane === 'high') {
                    if (!p.duckAnnounced) {
                        p.duckAnnounced = true;
                        def.crouchCounterReady = true;
                        this._spawnFloatText?.(defCenter, GROUND_Y + 10, '⬇️ 下蹲闪避！', 'evade');
                        announce(`⬇️ ${def.info.name} 低头下蹲，弹道擦着耳朵飞过！`);
                    }
                    continue;
                }

                // Jumping leaps cleanly over 'low' or ground projectiles!
                if (def.jumpY < -20 && p.lane === 'low')
                    continue;

                const defBodyY = PET_BODY_Y + def.jumpY;
                if (Math.abs(p.y - defBodyY) <= 26) {
                    if (p.fxInst)
                        fxFront.removeInstance(p.fxInst);
                    this._applyDamage(p.attacker, def, p.skill, p.lane, rng, fxFront, announce, addFreeze);
                    projectiles.splice(i, 1);
                    continue;
                }
            }

            if (p.x < -24 || p.x > STAGE_W + 24) {
                if (p.fxInst)
                    fxFront.removeInstance(p.fxInst);
                projectiles.splice(i, 1);
            }
        }
    }

    _applyDamage(attacker, defender, skill, _height, rng, fxFront, announce, addFreeze) {
        const defCenter = defender.x + defender.bank.width / 2;
        const pushDir = attacker.x <= defender.x ? 1 : -1;

        // 1. PERFECT PARRY CHECK! (First 0.25s of Guard Stance!)
        if (defender.parryWindowSec > 0 && skill.type !== 'ultimate') {
            defender.parryWindowSec = 0;
            defender.guardSec = 0;
            defender.rage = Math.min(100, defender.rage + 26);
            fxFront.spawn('impacts/parry', { x: Math.round(defCenter), y: getAlignedFxY('impacts/parry', defender.jumpY) });
            this._spawnFloatText?.(defCenter, GROUND_Y + 4, '✨ 完美弹反！', 'crit');
            announce(`✨ ${defender.info.name} 触发【精准弹反】震退对手！`);

            // Stagger close-range attackers!
            if (Math.abs(attacker.x - defender.x) < 110) {
                attacker.staggerSec = 0.85;
                attacker.vxKnock = -pushDir * 7.5;
                attacker.comboHitsLanded = 0;
            }
            addFreeze(80);
            return;
        }

        // 2. ACTIVE GUARD STANCE CHECK! (72% Damage Reduction + No Hitstun!)
        if (defender.guardSec > 0) {
            const chipDmg = Math.max(2, Math.round(attacker.stats.atk * (skill.power || 1.0) * 0.28));
            defender.hp = Math.max(0, defender.hp - chipDmg);
            defender.rage = Math.min(100, defender.rage + 12);
            defender.vxKnock = pushDir * 2.2;
            fxFront.spawn('impacts/shield-block', { x: Math.round(defCenter), y: getAlignedFxY('impacts/shield-block', defender.jumpY), flip: defender.facing === 'left' });
            this._spawnFloatText?.(defCenter, GROUND_Y + 8, `🛡️ 格挡 -${chipDmg}`, 'guard');
            attacker.comboHitsLanded += 1;
            addFreeze(35);
            return;
        }

        // 3. Clean Hit / Critical Hit!
        const isCrit = rng() < attacker.stats.critRate + (skill.type === 'ultimate' ? 0.25 : 0);
        const variance = 0.9 + rng() * 0.22;
        let rawDmg = attacker.stats.atk * (skill.power || 1.0) * variance * (isCrit ? 1.52 : 1.0);

        if (defender.shieldSec > 0) {
            rawDmg *= 0.55;
            fxFront.spawn('impacts/shield-block', { x: Math.round(defCenter), y: getAlignedFxY('impacts/shield-block', defender.jumpY), flip: defender.facing === 'left' });
        }

        const dmg = Math.max(4, Math.round(rawDmg));
        defender.hp = Math.max(0, defender.hp - dmg);
        defender.rage = Math.min(100, defender.rage + 14);
        defender.hitFlashMs = 130;
        defender.anim = 'hurt';
        defender.pendingStrike = null; // Hit interrupts wind-up!
        defender.actionLockSec = Math.max(defender.actionLockSec, 0.30);
        defender.vxKnock = pushDir * ((skill.knockback || 14) * 0.36);

        attacker.comboHitsLanded += 1;

        if (skill.slowSec)
            defender.slowSec = Math.max(defender.slowSec, skill.slowSec);
        if (skill.lifesteal)
            attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(dmg * skill.lifesteal));
        if (skill.healPct && skill.type === 'ultimate')
            attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(attacker.maxHp * skill.healPct));

        if (skill.fxHit) {
            fxFront.spawn(skill.fxHit, {
                x: Math.round(defCenter),
                y: getAlignedFxY(skill.fxHit, defender.jumpY),
                flip: pushDir < 0,
            });
        }

        if (isCrit) {
            this._spawnFloatText?.(defCenter, GROUND_Y + defender.jumpY - 10, `💥 -${dmg}`, 'crit');
            addFreeze(55);
        } else {
            this._spawnFloatText?.(defCenter, GROUND_Y + defender.jumpY - 4, `-${dmg}`, 'normal');
            addFreeze(22);
        }
    }

    _updateFighterPhysicsAndRender(f, dtMs) {
        if (f.jumpY < 0 || f.vy !== 0) {
            f.jumpY += f.vy;
            f.vy += 0.52;
            if (f.jumpY >= 0) {
                f.jumpY = 0;
                f.vy = 0;
            }
        }
        if (Math.abs(f.vxKnock) > 0.2) {
            f.x += f.vxKnock;
            f.vxKnock *= 0.74;
        } else {
            f.vxKnock = 0;
        }
        f.x = Math.max(12, Math.min(STAGE_W - f.bank.width - 12, f.x));

        if (f.hitFlashMs > 0)
            f.hitFlashMs = Math.max(0, f.hitFlashMs - dtMs);

        // Procedural Puppeteer squash/stretch for Crouch, Guard, Roll, Cast & Jump!
        const dirSign = f.facing === 'right' ? 1 : -1;
        if (f.crouchSec > 0 || f.anim === 'crouch') {
            f.actor.set_scale(1.16, 0.68);
            f.actor.rotation_angle_z = 0;
        } else if (f.guardSec > 0 || f.anim === 'guard') {
            f.actor.set_scale(0.96, 1.02);
            f.actor.rotation_angle_z = -5 * dirSign;
        } else if (f.rollSec > 0) {
            f.actor.set_scale(1.05, 0.80);
            f.actor.rotation_angle_z += 28 * dirSign;
        } else if (f.anim === 'cast') {
            f.actor.set_scale(1.10, 0.90);
            f.actor.rotation_angle_z = -4 * dirSign;
        } else if (f.anim === 'attack') {
            f.actor.set_scale(1.10, 0.94);
            f.actor.rotation_angle_z = 8 * dirSign;
        } else if (f.anim === 'hurt') {
            f.actor.set_scale(0.92, 1.06);
            f.actor.rotation_angle_z = -12 * dirSign;
        } else if (f.jumpY < -4) {
            f.actor.set_scale(0.95, 1.08);
            f.actor.rotation_angle_z = 6 * dirSign;
        } else {
            f.actor.set_scale(1.0, 1.0);
            f.actor.rotation_angle_z = 0;
        }

        const frames = f.bank.states[f.anim] || f.bank.states.idle;
        if (frames && frames.length > 0) {
            const cur = frames[f.frameIdx % frames.length];
            f.frameAccMs += dtMs;
            if (f.frameAccMs >= Math.max(35, cur.delayMs)) {
                f.frameAccMs = 0;
                f.frameIdx = (f.frameIdx + 1) % frames.length;
            }
            const activeFrame = frames[f.frameIdx % frames.length];
            let content;
            if (f.hitFlashMs > 0 && (activeFrame.flashLeft || activeFrame.flashRight)) {
                content = f.facing === 'left' ? activeFrame.flashLeft : activeFrame.flashRight;
            } else {
                content = f.facing === 'left' ? activeFrame.left : activeFrame.right;
            }
            if (content && f.actor.content !== content)
                f.actor.set_content(content);
        }

        const drawX = Math.round(f.x);
        const drawY = Math.round(GROUND_Y + f.jumpY);
        f.actor.set_position(drawX, drawY);
        const tagYOffset = (f.crouchSec > 0) ? -6 : -18;
        f.nameTag.set_position(drawX - 2, Math.max(4, drawY + tagYOffset));
    }

    _refreshFighterHud(f) {
        const hpRatio = Math.max(0, Math.min(1, f.hp / Math.max(1, f.maxHp)));
        const rageRatio = Math.max(0, Math.min(1, f.rage / 100));
        f.hud.hpFill.set_width(Math.round(hpRatio * 196));
        f.hud.rageFill.set_width(Math.round(rageRatio * 196));
        const stanceBadge = f.parryWindowSec > 0 ? ' ✨招架' : (f.guardSec > 0 ? ' 🛡️防御' : (f.crouchSec > 0 ? ' ⬇️下蹲' : (f.shieldSec > 0 ? ' 💠护盾' : '')));
        f.hud.hpText.text = `HP ${f.hp}/${f.maxHp} · 怒气 ${Math.round(f.rage)}%${stanceBadge}`;
    }
}
