import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { addChromeActor, removeChromeActor, boxLayoutProps } from './compat.js';
import { loadSpriteBankForProfile } from './spriteLoader.js';
import { computeCombatStats } from './rpg.js';
import { PixelFxSurface } from './pixelfx/bridge.js';
import {
    ELEMENT_META,
    SKILL_CATALOG,
    resolveElementalReaction,
    resolveCombatSkillList,
} from './skillSystem.js';
import {
    getStanceConfig,
    BOSS_POOL,
    MINION_TEMPLATES,
    pickBossBySeed,
} from './relicsAndAchievements.js';

const STAGE_W = 660;
const STAGE_H = 224;
const PILL_W = STAGE_W - 28; // 632px — exact match with zLanePad width!
const DETAILS_H = 148;
const TEAM_BAR_W = 80;
const PIXEL_SCALE = 1;
const FIGHTER_BASE_SIZE = 50;

// 2.5D Belt-Scroller Depth Lane (Z in 0..68 maps to footY in 126..194)
const Z_MIN = 0;
const Z_MAX = 68;
const BASE_FOOT_Y = 126;

const FLOOR_ROOTED_FX = new Set([
    'spawn/poof', 'spawn/spawn-portal', 'spawn/respawn-beam', 'spawn/summon-rise', 'spawn/coin-drop',
    'ui/level-up', 'arcane/magic-circle-cast', 'arcane/rune-circle', 'arcane/time-stop',
    'fire/flame-pillar', 'fire/fire-tornado', 'fire/meteor',
    'holy/holy-pillar', 'holy/smite', 'holy/heal-aoe', 'holy/resurrection', 'holy/blessing',
    'nature/earth-spike', 'nature/healing-bloom', 'nature/quake', 'nature/root-snare', 'nature/toxic-puddle',
    'ice/frost-nova', 'ice/ice-spikes', 'ice/icicle-fall', 'ice/freeze',
    'impacts/ground-slam', 'impacts/heavy-landing',
    'lightning/lightning-strike', 'lightning/thunderclap', 'lightning/storm-cloud', 'lightning/tesla-coil',
    'explosions/big-explosion', 'shadow/dark-explosion', 'shadow/grasping-hands',
    'status/burning', 'status/frozen', 'status/poisoned', 'status/bleeding', 'status/rage', 'status/stunned',
]);

function getFxSpawnY(fxId, footY, jumpY = 0) {
    if (FLOOR_ROOTED_FX.has(fxId))
        return Math.round(footY + jumpY);
    return Math.round(footY - 22 + jumpY);
}

/**
 * Deterministic Mulberry32 PRNG so LAN 1v1, 2v2 & Co-op Boss Raids play out 100% identically!
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

function buildFighterPacketFromPet(pet, ownerName, unlockedPool = []) {
    return {
        ownerName,
        id: pet.id,
        name: pet.name,
        level: pet.level,
        archetype: pet.archetype,
        presetId: pet.presetId,
        skinMode: pet.skinMode,
        customPath: pet.customPath,
        cols: pet.cols,
        rows: pet.rows,
        baseFacingRight: pet.baseFacingRight,
        autoRemoveBg: pet.autoRemoveBg,
        stance: pet.stance || 'balanced',
        trait: pet.trait || null,
        relicIds: Array.isArray(pet.relicIds) ? [...pet.relicIds] : [],
        equippedSkills: resolveCombatSkillList(pet, unlockedPool).map(s => s.id),
    };
}

/**
 * Frameless Desktop-Top 2.5D (X, Z, JumpH) Auto-Battle Arena Manager.
 * - Top Dynamic-Island Control Pill is draggable & closeable (`interactive: true`)
 * - Entire 660x224 2.5D Battlefield underneath is 100% mouse click-through (`interactive: false`)!
 * - Supports 1v1, 2v2 Elemental Duo Battles, Bench Assist, and 5 Random Bosses + Minion Waves!
 */
export class BattleArenaManager {
    constructor({ extensionPath, settings, roster, lanManager, onBattleFinished }) {
        this._extensionPath = extensionPath;
        this._settings = settings;
        this._roster = roster;
        this._lanManager = lanManager;
        this._stageManager = null;
        this._onBattleFinished = onBattleFinished;

        this._pillBar = null;
        this._detailsDrawer = null;
        this._stageRoot = null;
        this._loopId = 0;
        this._closeIdleId = 0;
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
        this._dismissChallengePrompt();
    }

    // =========================================================================
    // Incoming LAN Challenge Prompt (1v1 / 2v2 / Co-op Boss Raid)
    // =========================================================================
    showChallengePrompt(challengeInfo) {
        this._dismissChallengePrompt();

        const card = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-challenge-card',
            reactive: true,
        }));

        const mode = challengeInfo.mode || '1v1';
        const c = challengeInfo.challenger;
        let modeHeader = '⚔️ 收到局域网宠物决斗战书！';
        let modeDesc = `来自「${c.ownerName}」的 ${c.name} (Lv.${c.level}) 向你的小队发起单挑！`;
        if (mode === '2v2') {
            modeHeader = '⚡ 收到局域网 2v2 双打元素战书！';
            const subName = challengeInfo.challengerSub ? ` + 「${challengeInfo.challengerSub.name}」` : '';
            modeDesc = `「${c.ownerName}」派出「${c.name}」${subName} 邀请进行 2v2 巅峰对决！`;
        } else if (mode === 'boss_raid') {
            const bossMeta = pickBossBySeed(challengeInfo.bossSeed || 1);
            modeHeader = '🐉 收到局域网组队讨伐深渊 Boss 邀请！';
            modeDesc = `「${c.ownerName}」的 ${c.name} 邀你并肩讨伐【${bossMeta.name}】！`;
        }

        const title = new St.Label({
            text: modeHeader,
            style_class: 'topbar-pet-challenge-title',
        });
        const desc = new St.Label({
            text: modeDesc,
            style_class: 'topbar-pet-challenge-desc',
        });

        const btnRow = new St.BoxLayout(boxLayoutProps(false, {
            style_class: 'topbar-pet-challenge-btns',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const acceptBtn = new St.Button({
            label: mode === 'boss_raid' ? '🤝 并肩出战！' : '🔥 迎战开打！',
            style_class: 'topbar-pet-btn-accept',
            reactive: true,
            can_focus: true,
            track_hover: true,
        });
        const declineBtn = new St.Button({
            label: '婉拒',
            style_class: 'topbar-pet-btn-decline',
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        acceptBtn.connect('clicked', () => {
            this._dismissChallengePrompt();
            this._lanManager?.acceptBattleChallenge(challengeInfo);
        });
        declineBtn.connect('clicked', () => {
            this._dismissChallengePrompt();
            this._lanManager?.declineBattleChallenge(challengeInfo);
        });

        btnRow.add_child(acceptBtn);
        btnRow.add_child(declineBtn);
        card.add_child(title);
        card.add_child(desc);
        card.add_child(btnRow);

        card.connect('destroy', () => {
            if (this._challengeCard === card)
                this._challengeCard = null;
        });
        addChromeActor(card, { interactive: true, trackFullscreen: true });
        this._challengeCard = card;

        const panelBox = Main.layoutManager.panelBox;
        const px = Number.isFinite(panelBox?.x) ? panelBox.x : 0;
        const py = Number.isFinite(panelBox?.y) ? panelBox.y : 0;
        const pw = (panelBox?.width > 64) ? panelBox.width : 1280;
        const ph = panelBox?.height || 32;
        const [, natW] = card.get_preferred_width(-1);
        card.set_position(Math.round(px + (pw - Math.max(300, natW)) / 2), py + ph + 8);

        this._challengeTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 18, () => {
            this._challengeTimerId = 0;
            this._dismissChallengePrompt();
            return GLib.SOURCE_REMOVE;
        });
    }

    _dismissChallengePrompt() {
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
    // Practice 1v1, Practice 2v2 Elemental Duo, & Random Boss Raid Entrypoints
    // =========================================================================
    startPracticeBattle(opponentPetRecord = null, preferMode = null) {
        const owner = this._roster.getOwnerName();
        const pool = this._roster.unlockedSkillPool;
        const myPrimary = this._roster.getPrimaryPet();
        const mySecondary = this._roster.getSecondaryPet();

        const use2v2 = !opponentPetRecord && (preferMode === '2v2' || (!preferMode && Boolean(mySecondary)));
        const leftTeam = [buildFighterPacketFromPet(myPrimary, owner, pool)];
        if (use2v2 && mySecondary)
            leftTeam.push(buildFighterPacketFromPet(mySecondary, owner, pool));

        const wildPresets = [
            { name: '赤焰幼龙', presetId: 'dragon', archetype: 'fire', stance: 'berserk', equippedSkills: ['f2', 'f3', 'f5', 'f6'] },
            { name: '霜冠果冻', presetId: 'slime', archetype: 'ice', stance: 'counter', equippedSkills: ['i2', 'i3', 'i5', 'i6'] },
            { name: '雷霆柴丸', presetId: 'shiba', archetype: 'storm', stance: 'kite', equippedSkills: ['s2', 's3', 's5', 's6'] },
            { name: '星界幽幽', presetId: 'ghost', archetype: 'arcane', stance: 'kite', equippedSkills: ['a2', 'a3', 'a5', 'a6'] },
            { name: '圣藤小机甲', presetId: 'robot', archetype: 'holy', stance: 'balanced', equippedSkills: ['h1', 'h2', 'h4', 'h6'] },
        ];

        const rightTeam = [];
        if (opponentPetRecord) {
            rightTeam.push(buildFighterPacketFromPet(opponentPetRecord, owner, pool));
        } else {
            const idx1 = Math.floor(Math.random() * wildPresets.length);
            const idx2 = (idx1 + 1 + Math.floor(Math.random() * (wildPresets.length - 1))) % wildPresets.length;
            const w1 = wildPresets[idx1];
            rightTeam.push({
                ownerName: '野生挑战者',
                id: 'wild-ai-1',
                name: w1.name,
                level: Math.max(1, myPrimary.level + (Math.floor(Math.random() * 3) - 1)),
                archetype: w1.archetype,
                presetId: w1.presetId,
                skinMode: 'preset',
                stance: w1.stance,
                equippedSkills: w1.equippedSkills,
            });
            if (use2v2) {
                const w2 = wildPresets[idx2];
                const refLv = mySecondary ? mySecondary.level : myPrimary.level;
                rightTeam.push({
                    ownerName: '野生搭档',
                    id: 'wild-ai-2',
                    name: w2.name,
                    level: Math.max(1, refLv),
                    archetype: w2.archetype,
                    presetId: w2.presetId,
                    skinMode: 'preset',
                    stance: w2.stance,
                    equippedSkills: w2.equippedSkills,
                });
            }
        }

        const assistLeft = (!use2v2 && mySecondary && (!opponentPetRecord || opponentPetRecord.id !== mySecondary.id))
            ? buildFighterPacketFromPet(mySecondary, owner, pool)
            : null;

        this.openBattle({
            seed: Math.floor(Math.random() * 899999) + 100000,
            mode: use2v2 ? '2v2' : '1v1',
            leftTeam,
            rightTeam,
            assistLeft,
            localPetIds: leftTeam.map(f => f.id),
            isLanBattle: false,
        });
    }

    startSoloBossRaid(customSeed = null) {
        const seed = customSeed || (Math.floor(Math.random() * 899999) + 100000);
        const owner = this._roster.getOwnerName();
        const pool = this._roster.unlockedSkillPool;
        const p1 = this._roster.getPrimaryPet();
        const p2 = this._roster.getSecondaryPet();

        const leftTeam = [buildFighterPacketFromPet(p1, owner, pool)];
        if (p2)
            leftTeam.push(buildFighterPacketFromPet(p2, owner, pool));

        this.openBattle({
            seed,
            mode: 'boss_raid',
            leftTeam,
            rightTeam: [],
            localPetIds: leftTeam.map(f => f.id),
            isLanBattle: false,
        });
    }

    openBattle(battleInit) {
        this.closeArena();

        // Backward-compatible normalization from { leftFighter, rightFighter }
        const leftTeam = Array.isArray(battleInit.leftTeam) && battleInit.leftTeam.length > 0
            ? battleInit.leftTeam
            : (battleInit.leftFighter ? [battleInit.leftFighter] : []);
        const rightTeam = Array.isArray(battleInit.rightTeam) && battleInit.rightTeam.length > 0
            ? battleInit.rightTeam
            : (battleInit.rightFighter ? [battleInit.rightFighter] : []);

        const normalizedInit = {
            ...battleInit,
            mode: battleInit.mode || ((leftTeam.length > 1 || rightTeam.length > 1) ? '2v2' : '1v1'),
            leftTeam,
            rightTeam,
            localPetIds: battleInit.localPetIds || (battleInit.localPetId ? [battleInit.localPetId] : leftTeam.map(f => f.id)),
        };

        const token = ++this._battleToken;
        this._lastWinnerId = null;
        this._arenaParticipantsActive = true;

        if (this._stageManager) {
            this._stageManager.playArenaEntrance(
                [...leftTeam, ...rightTeam],
                () => {
                    if (token !== this._battleToken)
                        return;
                    this._openArenaStageNow(normalizedInit);
                }
            );
        } else {
            this._openArenaStageNow(normalizedInit);
        }
    }

    // =========================================================================
    // Frameless 2.5D Stage Construction & Real-Time Simulation
    // =========================================================================
    _openArenaStageNow(init) {
        const {
            seed,
            mode = '1v1',
            leftTeam = [],
            rightTeam = [],
            assistLeft = null,
            assistRight = null,
            localPetIds = [],
            isLanBattle = false,
        } = init;

        const rng = createSeededRng(seed);
        const isBossRaid = mode === 'boss_raid';
        const bossTemplate = isBossRaid ? pickBossBySeed(seed) : null;

        // 1. Top Fixed-Width Dynamic-Island Control Pill (strictly 632px wide to match zLanePad!)
        const pillBar = new St.BoxLayout(boxLayoutProps(false, {
            style_class: 'topbar-pet-arena-pill',
            width: PILL_W,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const allyBarTrack = new St.Widget({
            style_class: 'topbar-pet-pill-team-track',
            width: TEAM_BAR_W,
            height: 7,
            x_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const allyBarFill = new St.Widget({ style_class: 'topbar-pet-pill-ally-fill', width: TEAM_BAR_W, height: 7 });
        allyBarTrack.add_child(allyBarFill);

        const modeTitle = isBossRaid
            ? `🐉 讨伐 · ${bossTemplate.name}`
            : (mode === '2v2' ? (isLanBattle ? '🌐 2v2 联机双打' : '⚡ 2v2 元素双打') : (isLanBattle ? '🌐 局域网决斗' : '⚔️ 宠物擂台'));
        const pillStatusLabel = new St.Label({
            text: `${modeTitle} · 准备开战！`,
            style_class: 'topbar-pet-pill-status',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        pillStatusLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        pillStatusLabel.clutter_text.single_line_mode = true;
        pillStatusLabel.clutter_text.line_wrap = false;

        const dragHandle = new St.Bin({
            reactive: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            child: pillStatusLabel,
        });
        dragHandle.set_style('min-width: 0px;');

        const enemyBarTrack = new St.Widget({
            style_class: 'topbar-pet-pill-team-track',
            width: TEAM_BAR_W,
            height: 7,
            x_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const enemyBarFill = new St.Widget({ style_class: 'topbar-pet-pill-enemy-fill', width: TEAM_BAR_W, height: 7 });
        enemyBarTrack.add_child(enemyBarFill);

        let detailsExpanded = false;
        const detailBtn = new St.Button({
            label: '📋 详情 ▾',
            style_class: 'topbar-pet-arena-detail-btn',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const closeBtn = new St.Button({
            label: '✕',
            style_class: 'topbar-pet-arena-close',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        closeBtn.connect('button-press-event', () => {
            if (!this._closeIdleId) {
                this._closeIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._closeIdleId = 0;
                    this.closeArena();
                    return GLib.SOURCE_REMOVE;
                });
            }
            return Clutter.EVENT_STOP;
        });
        closeBtn.connect('clicked', () => this.closeArena());

        pillBar.add_child(allyBarTrack);
        pillBar.add_child(dragHandle);
        pillBar.add_child(enemyBarTrack);
        pillBar.add_child(detailBtn);
        pillBar.add_child(closeBtn);

        // 1b. Expandable Battle Details & Live Scrollable Combat Log Drawer (exact 632px width!)
        const detailsDrawer = new St.BoxLayout(boxLayoutProps(false, {
            style_class: 'topbar-pet-arena-details-drawer',
            width: PILL_W,
            height: DETAILS_H,
            reactive: true,
            visible: false,
        }));

        const leftDetailsCol = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-details-col',
            width: 278,
            x_expand: false,
            y_expand: true,
        }));
        leftDetailsCol.add_child(new St.Label({
            text: '⚔️ 参战单位实时状态',
            style_class: 'topbar-pet-details-header',
        }));
        const unitStatsBox = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-details-col',
            y_expand: true,
        }));
        const detailsSummaryLabel = new St.Label({
            text: '⏱️ 0.0s · ⚡弹反 0 · 💥连携 0 · 🔥连击 0',
            style_class: 'topbar-pet-details-summary',
        });
        leftDetailsCol.add_child(unitStatsBox);
        leftDetailsCol.add_child(detailsSummaryLabel);

        const detailsDivider = new St.Widget({
            style_class: 'topbar-pet-details-divider',
            width: 1,
            y_expand: true,
        });

        const rightDetailsCol = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-details-col',
            x_expand: true,
            y_expand: true,
        }));
        rightDetailsCol.add_child(new St.Label({
            text: '📜 完整战报日志 (可滚轮翻阅)',
            style_class: 'topbar-pet-details-header',
        }));
        const logScroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
        });
        logScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        const logListBox = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-details-log-box',
            x_expand: true,
        }));
        if (typeof logScroll.set_child === 'function')
            logScroll.set_child(logListBox);
        else
            logScroll.add_actor(logListBox);
        rightDetailsCol.add_child(logScroll);

        detailsDrawer.add_child(leftDetailsCol);
        detailsDrawer.add_child(detailsDivider);
        detailsDrawer.add_child(rightDetailsCol);

        // 2. Frameless Click-Through 2.5D Stage (`interactive: false`!)
        const stageRoot = new St.Widget({
            style_class: 'topbar-pet-arena-stage-transparent',
            layout_manager: new Clutter.FixedLayout(),
            width: STAGE_W,
            height: STAGE_H,
            reactive: false,
            clip_to_allocation: false,
        });

        // Subtle semi-transparent horizon Z-lane pad
        const zLanePad = new St.Widget({
            style_class: 'topbar-pet-arena-z-lane',
            width: PILL_W,
            height: Z_MAX + 18,
            x: 14,
            y: BASE_FOOT_Y - 8,
            reactive: false,
        });
        const zMidLine = new St.Widget({
            style_class: 'topbar-pet-arena-z-midline',
            width: STAGE_W - 80,
            height: 1,
            x: 40,
            y: BASE_FOOT_Y + Math.round(Z_MAX / 2),
            reactive: false,
        });
        stageRoot.add_child(zLanePad);
        stageRoot.add_child(zMidLine);

        // Optional Boss Phase Sub-Bar (fixed width 420px, dead-center aligned!)
        let bossBarTitle = null;
        let bossBarFill = null;
        if (isBossRaid && bossTemplate) {
            const BOSS_BOX_W = 420;
            const bossBox = new St.BoxLayout(boxLayoutProps(false, {
                style_class: 'topbar-pet-boss-bar-box',
                width: BOSS_BOX_W,
                reactive: false,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            bossBarTitle = new St.Label({
                text: `${bossTemplate.name} [${bossTemplate.title}]`,
                style_class: 'topbar-pet-boss-bar-title',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            bossBarTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            const bTrack = new St.Widget({ style_class: 'topbar-pet-boss-hp-track', width: 170, height: 8, y_align: Clutter.ActorAlign.CENTER });
            bossBarFill = new St.Widget({ style_class: 'topbar-pet-boss-hp-fill', width: 170, height: 8 });
            bTrack.add_child(bossBarFill);
            bossBox.add_child(bossBarTitle);
            bossBox.add_child(bTrack);
            bossBox.set_position(Math.round((STAGE_W - BOSS_BOX_W) / 2), 2);
            stageRoot.add_child(bossBox);
        }

        // Shadow container -> Back VFX -> Depth-Sorted Unit Layer -> Front VFX -> Overhead HUDs -> Float Damage Layer
        const shadowLayer = new St.Widget({ layout_manager: new Clutter.FixedLayout(), width: STAGE_W, height: STAGE_H, reactive: false });
        const fxBack = new PixelFxSurface(STAGE_W, STAGE_H, PIXEL_SCALE);
        const fxBackWidget = new St.Widget({ width: STAGE_W, height: STAGE_H, reactive: false });
        fxBackWidget.set_content(fxBack.content);

        const unitLayer = new St.Widget({ layout_manager: new Clutter.FixedLayout(), width: STAGE_W, height: STAGE_H, reactive: false });

        const fxFront = new PixelFxSurface(STAGE_W, STAGE_H, PIXEL_SCALE);
        const fxFrontWidget = new St.Widget({ width: STAGE_W, height: STAGE_H, reactive: false });
        fxFrontWidget.set_content(fxFront.content);

        const hudLayer = new St.Widget({ layout_manager: new Clutter.FixedLayout(), width: STAGE_W, height: STAGE_H, reactive: false });
        const floatLayer = new St.Widget({ layout_manager: new Clutter.FixedLayout(), width: STAGE_W, height: STAGE_H, reactive: false });

        stageRoot.add_child(shadowLayer);
        stageRoot.add_child(fxBackWidget);
        stageRoot.add_child(unitLayer);
        stageRoot.add_child(fxFrontWidget);
        stageRoot.add_child(hudLayer);
        stageRoot.add_child(floatLayer);

        this._spawnFloatText = (centerX, topY, text, kind = 'normal') => {
            const clsMap = {
                crit: 'topbar-pet-dmg-crit',
                reaction: 'topbar-pet-dmg-reaction',
                heal: 'topbar-pet-dmg-heal',
                guard: 'topbar-pet-dmg-guard',
                evade: 'topbar-pet-dmg-evade',
                normal: 'topbar-pet-dmg-normal',
            };
            const lbl = new St.Label({
                text,
                style_class: clsMap[kind] || clsMap.normal,
                reactive: false,
            });
            let lblAlive = true;
            lbl.connect('destroy', () => {
                lblAlive = false;
            });
            floatLayer.add_child(lbl);
            const sx = Math.max(12, Math.min(STAGE_W - 110, Math.round(centerX - 24)));
            const sy = Math.max(8, Math.round(topY));
            lbl.set_position(sx, sy);
            lbl.ease({
                y: Math.max(2, sy - 26),
                opacity: 0,
                duration: kind === 'reaction' ? 920 : 680,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        if (lblAlive && lbl.get_parent())
                            lbl.destroy();
                        return GLib.SOURCE_REMOVE;
                    });
                },
            });
        };

        // Position Pill Bar, Expandable Details Drawer & Transparent Stage right below Top Panel
        pillBar.connect('destroy', () => {
            if (this._pillBar === pillBar)
                this._pillBar = null;
        });
        detailsDrawer.connect('destroy', () => {
            if (this._detailsDrawer === detailsDrawer)
                this._detailsDrawer = null;
        });
        stageRoot.connect('destroy', () => {
            if (this._stageRoot === stageRoot)
                this._stageRoot = null;
        });

        addChromeActor(stageRoot, { interactive: false, trackFullscreen: true });
        addChromeActor(detailsDrawer, { interactive: true, trackFullscreen: true });
        detailsDrawer.hide(); // Must hide AFTER addChromeActor (addChrome auto-shows actors)!
        addChromeActor(pillBar, { interactive: true, trackFullscreen: true });
        this._pillBar = pillBar;
        this._detailsDrawer = detailsDrawer;
        this._stageRoot = stageRoot;

        const panelBox = Main.layoutManager.panelBox;
        const px = Number.isFinite(panelBox?.x) ? panelBox.x : 0;
        const py = Number.isFinite(panelBox?.y) ? panelBox.y : 0;
        const pw = (panelBox?.width > 64) ? panelBox.width : 1280;
        const ph = panelBox?.height || 32;

        const stageX = Math.round(px + (pw - STAGE_W) / 2);
        const pillX = stageX + 14; // Exact X match with zLanePad (x=14 inside stageRoot)!
        const pillY = py + ph + 4;
        pillBar.set_position(pillX, pillY);
        detailsDrawer.set_position(pillX, pillY + 32);
        stageRoot.set_position(stageX, pillY + 30);

        this._setupLinkedDrag(dragHandle, pillBar, detailsDrawer, stageRoot);

        // 3. Spawn Combatants in 2.5D Space!
        const units = [];
        const spawnFighterUnit = (pkt, side, slotIdx, totalSlots, roleOpts = {}) => {
            const unitScale = roleOpts.unitScale || 1.0;
            const spriteH = Math.round(FIGHTER_BASE_SIZE * unitScale);
            const profile = this._resolveFighterSpriteProfile(pkt);
            const bank = loadSpriteBankForProfile(this._extensionPath, profile, {
                targetHeight: spriteH,
                pixelCrisp: this._settings.get_boolean('pixel-art-scaling'),
            });

            const baseStats = computeCombatStats(pkt, this._roster.unlockedSkillPool);
            if (roleOpts.hpMult)
                baseStats.maxHp = Math.round(baseStats.maxHp * roleOpts.hpMult);
            if (roleOpts.atkMult)
                baseStats.atk = Math.max(4, Math.round(baseStats.atk * roleOpts.atkMult));
            if (roleOpts.spdOverride)
                baseStats.spd = roleOpts.spdOverride;

            // Single-pet vs Duo handicap balance in 2v2!
            if (roleOpts.soloEliteBoost) {
                baseStats.maxHp = Math.round(baseStats.maxHp * 1.75);
                baseStats.atk = Math.round(baseStats.atk * 1.25);
            }

            const zPos = totalSlots <= 1
                ? Math.round(Z_MAX * 0.48)
                : Math.round(14 + (slotIdx / Math.max(1, totalSlots - 1)) * (Z_MAX - 24));
            const startX = side === 'left'
                ? (82 + slotIdx * 42)
                : (STAGE_W - 82 - bank.width - slotIdx * 42);

            const shadow = new St.Widget({
                style_class: 'topbar-pet-ground-shadow',
                width: Math.round(bank.width * 0.72),
                height: Math.max(6, Math.round(bank.width * 0.18)),
                reactive: false,
            });
            shadowLayer.add_child(shadow);

            const actor = new St.Widget({ width: bank.width, height: bank.height, reactive: false });
            actor.set_pivot_point(0.5, 1.0);
            unitLayer.add_child(actor);

            const microHud = this._createOverheadMicroHud(pkt, side, Boolean(roleOpts.isMinion), Boolean(roleOpts.isBoss));
            hudLayer.add_child(microHud.root);

            const u = this._makeRuntimeUnit({
                side,
                info: pkt,
                stats: baseStats,
                bank,
                actor,
                shadow,
                microHud,
                startX,
                startZ: zPos,
                facing: side === 'left' ? 'right' : 'left',
                isBoss: Boolean(roleOpts.isBoss),
                isMinion: Boolean(roleOpts.isMinion),
                minionMeta: roleOpts.minionMeta || null,
            });

            units.push(u);
            const portalFx = roleOpts.isMinion ? 'spawn/summon-rise' : 'spawn/spawn-portal';
            fxBack.spawn(portalFx, { x: Math.round(u.x + bank.width / 2), y: BASE_FOOT_Y + u.z });
            return u;
        };

        const avgAllyLv = Math.max(1, Math.round(leftTeam.reduce((s, f) => s + (Number(f.level) || 1), 0) / Math.max(1, leftTeam.length)));
        const soloBoostLeft = (mode === '2v2' && leftTeam.length === 1 && rightTeam.length >= 2);
        const soloBoostRight = (mode === '2v2' && rightTeam.length === 1 && leftTeam.length >= 2);

        leftTeam.forEach((pkt, i) => spawnFighterUnit(pkt, 'left', i, leftTeam.length, { soloEliteBoost: soloBoostLeft }));

        let bossUnit = null;
        const summonMinionWave = (count = 2) => {
            if (!bossTemplate)
                return;
            const mTpl = MINION_TEMPLATES[bossTemplate.minionType] || MINION_TEMPLATES.fire_imp;
            for (let i = 0; i < count; i++) {
                const mZ = Math.round(10 + rng() * (Z_MAX - 16));
                const mX = Math.round(STAGE_W - 180 + (rng() - 0.5) * 90);
                const mPkt = {
                    ownerName: bossTemplate.name,
                    id: `minion-${Math.floor(rng() * 99999)}`,
                    name: mTpl.name,
                    level: avgAllyLv,
                    archetype: mTpl.archetype,
                    presetId: mTpl.presetId,
                    skinMode: 'preset',
                    stance: 'berserk',
                    equippedSkills: mTpl.equippedSkills,
                };
                const mu = spawnFighterUnit(mPkt, 'right', i, count, {
                    isMinion: true,
                    minionMeta: mTpl,
                    unitScale: mTpl.scale || 0.74,
                    hpMult: mTpl.hpRatio * Math.max(1, leftTeam.length * 0.75),
                    atkMult: mTpl.atkRatio,
                    spdOverride: mTpl.spd,
                });
                mu.x = Math.max(STAGE_W * 0.52, Math.min(STAGE_W - 60, mX));
                mu.z = mZ;
            }
        };

        if (isBossRaid && bossTemplate) {
            const teamScale = leftTeam.length >= 2 ? 1.45 : 1.0;
            const bossPkt = {
                ownerName: bossTemplate.title,
                id: `boss-${bossTemplate.id}`,
                name: bossTemplate.name,
                level: avgAllyLv + 1,
                archetype: bossTemplate.archetype,
                presetId: bossTemplate.presetId,
                skinMode: 'preset',
                stance: bossTemplate.stance,
                equippedSkills: bossTemplate.equippedSkills,
            };
            bossUnit = spawnFighterUnit(bossPkt, 'right', 0, 1, {
                isBoss: true,
                unitScale: bossTemplate.scale || 1.34,
                hpMult: bossTemplate.hpMult * teamScale,
                atkMult: bossTemplate.atkMult,
            });
            bossUnit.x = STAGE_W - 148;
            bossUnit.z = Math.round(Z_MAX * 0.5);
            summonMinionWave(2);
            pillStatusLabel.text = bossTemplate.introLine;
        } else {
            rightTeam.forEach((pkt, i) => spawnFighterUnit(pkt, 'right', i, rightTeam.length, { soloEliteBoost: soloBoostRight }));
        }

        // Bench Assist state (for 1v1 mode when player has a secondary pet!)
        const benchState = {
            left: assistLeft ? { pkt: assistLeft, usesLeft: 1, cdSec: 4.5 } : null,
            right: assistRight ? { pkt: assistRight, usesLeft: 1, cdSec: 4.5 } : null,
        };

        const projectiles = [];
        const groundZones = [];
        const telemetry = { parries: 0, reactions: 0, comboCount: 0, overtimeMult: 1.0, logFn: null, isBossRaid };
        const bossWavesTriggered = { w65: false, w32: false };
        let overtimeTriggered = false;

        let phase = 'intro';
        let elapsedSec = 0;
        let finishCloseSec = 0;
        let freezeMs = 0;
        let detailsRefreshAcc = 0;
        let lastLoggedMsg = '';
        const unitStatLabels = [];

        const appendCombatLog = msg => {
            if (!msg || msg === lastLoggedMsg || !this._detailsDrawer)
                return;
            lastLoggedMsg = msg;
            const line = new St.Label({
                text: `[${elapsedSec.toFixed(1).padStart(4, '0')}s] ${msg}`,
                style_class: 'topbar-pet-details-log-line',
                x_expand: true,
            });
            line.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            line.clutter_text.line_wrap = true;
            line.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            logListBox.add_child(line);
            while (logListBox.get_n_children() > 40) {
                const oldest = logListBox.get_first_child();
                if (oldest)
                    oldest.destroy();
                else
                    break;
            }
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                try {
                    const vAdj = logScroll.vscroll?.adjustment || logScroll.get_vscroll_bar?.()?.get_adjustment?.();
                    if (vAdj)
                        vAdj.value = Math.max(0, vAdj.upper - vAdj.page_size);
                } catch (_e) {}
                return GLib.SOURCE_REMOVE;
            });
        };
        telemetry.logFn = appendCombatLog;

        const refreshDetailsDrawer = () => {
            if (!this._detailsDrawer)
                return;
            const mainUnits = units.filter(u => !u.isMinion);
            const liveMinions = units.filter(u => u.isMinion && u.hp > 0).length;
            const linesData = mainUnits.map(u => {
                const sideIcon = u.side === 'left' ? '🟢' : (u.isBoss ? '💀' : '🔴');
                const aura = u.auraElement && ELEMENT_META[u.auraElement] ? ` ${ELEMENT_META[u.auraElement].icon}` : '';
                const tags = [
                    u.shieldSec > 0 ? '🛡️盾' : '',
                    u.frozenSec > 0 ? '🧊冻' : '',
                    u.burnSec > 0 ? '🔥灼' : '',
                    u.poisonSec > 0 ? '☠️毒' : '',
                    u.bleedSec > 0 ? '🩸血' : '',
                ].filter(Boolean).join('');
                const hpPct = Math.max(0, Math.round((u.hp / Math.max(1, u.maxHp)) * 100));
                return `${sideIcon} ${u.info.name} Lv.${u.info.level || 1}${aura} · HP ${Math.max(0, Math.round(u.hp))}/${u.maxHp} (${hpPct}%) · 怒${Math.round(u.rage)}% ${tags}`;
            });
            if (liveMinions > 0)
                linesData.push(`👾 场上存活随从杂兵：${liveMinions} 只`);

            while (unitStatLabels.length < linesData.length) {
                const lbl = new St.Label({ style_class: 'topbar-pet-details-unit-line', x_expand: true });
                lbl.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                unitStatsBox.add_child(lbl);
                unitStatLabels.push(lbl);
            }
            for (let i = 0; i < unitStatLabels.length; i++) {
                if (i < linesData.length) {
                    unitStatLabels[i].visible = true;
                    if (unitStatLabels[i].text !== linesData[i])
                        unitStatLabels[i].text = linesData[i];
                } else {
                    unitStatLabels[i].visible = false;
                }
            }

            const pauseHint = (phase === 'finished' && detailsExpanded) ? ' · 📖已暂停自动关闭' : '';
            detailsSummaryLabel.text = `⏱️ ${elapsedSec.toFixed(1)}s · ⚡弹反 ${telemetry.parries} · 💥连携 ${telemetry.reactions} · 🔥连击 ${telemetry.comboCount}${pauseHint}`;
        };

        const syncVerticalStackLayout = () => {
            if (!this._pillBar || !this._stageRoot)
                return;
            const pxCur = this._pillBar.x;
            const pyCur = this._pillBar.y;
            if (this._detailsDrawer) {
                this._detailsDrawer.set_position(pxCur, pyCur + 32);
                this._detailsDrawer.visible = detailsExpanded;
            }
            this._stageRoot.set_position(pxCur - 14, pyCur + (detailsExpanded ? (32 + DETAILS_H + 6) : 30));
        };

        detailBtn.connect('clicked', () => {
            detailsExpanded = !detailsExpanded;
            detailBtn.label = detailsExpanded ? '📋 收起 ▴' : '📋 详情 ▾';
            syncVerticalStackLayout();
            if (detailsExpanded)
                refreshDetailsDrawer();
        });

        appendCombatLog(pillStatusLabel.text);
        refreshDetailsDrawer();

        // Schedule below Clutter.PRIORITY_REDRAW (150) so GNOME Shell redraws & X11 input NEVER starve!
        const arenaPriority = (Clutter.PRIORITY_REDRAW || 150) + 15;
        this._loopId = GLib.timeout_add(arenaPriority, 33, () => {
            if (!this._stageRoot) {
                this._loopId = 0;
                return GLib.SOURCE_REMOVE;
            }

            try {
                const dtMs = 33;
                const dtSec = dtMs / 1000;
                elapsedSec += dtSec;

                if (freezeMs > 0) {
                    freezeMs = Math.max(0, freezeMs - dtMs);
                    fxBack.step(dtSec * 0.35);
                    fxFront.step(dtSec * 0.35);
                    return GLib.SOURCE_CONTINUE;
                }

                const announce = msg => {
                    if (pillStatusLabel)
                        pillStatusLabel.text = msg;
                    appendCombatLog(msg);
                };
                const addFreeze = ms => {
                    freezeMs = Math.max(freezeMs, ms);
                };

                if (phase === 'intro') {
                    if (elapsedSec >= 1.2) {
                        phase = 'fight';
                        if (!isBossRaid)
                            announce(`⚔️ ${mode === '2v2' ? '2v2 元素双打开始！Z轴走位 · 元素连携！' : '对决开始！下蹲闪避 · 精准弹反 · 2.5D 博弈！'}`);
                    }
                } else if (phase === 'fight') {
                    // Anti-stalemate Overtime Enrage at 45s!
                    if (!overtimeTriggered && elapsedSec >= 45.0) {
                        overtimeTriggered = true;
                        telemetry.overtimeMult = 2.0;
                        announce('🔥 巅峰死斗狂暴阶段！全场攻击伤害 ×2.0！');
                    }

                    // Boss HP Wave Reinforcements!
                    if (bossUnit && bossUnit.hp > 0) {
                        const hpRatio = bossUnit.hp / bossUnit.maxHp;
                        if (!bossWavesTriggered.w65 && hpRatio <= 0.65) {
                            bossWavesTriggered.w65 = true;
                            summonMinionWave(2);
                            announce(`🌀 ${bossUnit.info.name} 开启次元裂隙，召唤随从杂兵增援！`);
                        } else if (!bossWavesTriggered.w32 && hpRatio <= 0.32) {
                            bossWavesTriggered.w32 = true;
                            bossUnit.rage = 100;
                            summonMinionWave(2);
                            fxFront.spawn('status/rage', { x: Math.round(bossUnit.x + bossUnit.bank.width / 2), y: BASE_FOOT_Y + bossUnit.z, maxDuration: 3.5 });
                            announce(`🔥 ${bossUnit.info.name} 进入狂暴二阶段，精英杂兵涌入战场！`);
                        }
                    }

                    // Step all living units
                    for (const u of units) {
                        if (u.hp <= 0)
                            continue;
                        const allies = units.filter(o => o.side === u.side && o.hp > 0);
                        const foes = units.filter(o => o.side !== u.side && o.hp > 0);
                        if (foes.length === 0)
                            break;
                        this._stepUnit25D(u, allies, foes, dtSec, rng, fxBack, fxFront, projectiles, groundZones, telemetry, announce, addFreeze);
                    }

                    // Step Bench Assist (1v1 Tag-Team Jump-In!)
                    this._stepBenchAssists(benchState, units, dtSec, rng, fxFront, telemetry, announce, addFreeze);

                    // Step 2.5D Projectiles & Ground Trap Zones
                    this._stepProjectiles25D(projectiles, units, dtSec, rng, fxFront, telemetry, announce, addFreeze);
                    this._stepGroundZones25D(groundZones, units, dtSec, rng, fxFront, telemetry, announce, addFreeze);

                    // Clean up dead summoned minions smoothly
                    for (let i = units.length - 1; i >= 0; i--) {
                        const u = units[i];
                        if (u.isMinion && u.hp <= 0 && !u._deadCleaned) {
                            u._deadCleaned = true;
                            const cx = Math.round(u.x + u.bank.width / 2);
                            const fy = BASE_FOOT_Y + Math.round(u.z);
                            if (u.minionMeta?.deathExplosionFx)
                                fxFront.spawn(u.minionMeta.deathExplosionFx, { x: cx, y: fy });
                            fxFront.spawn('spawn/coin-drop', { x: cx, y: fy, coins: 3 });
                            u.actor.hide();
                            u.shadow.hide();
                            u.microHud.root.hide();
                        }
                    }

                    // 75s Sudden-Death Tiebreaker safety guarantee
                    if (elapsedSec >= 75.0) {
                        const lSum = units.filter(u => u.side === 'left' && !u.isMinion).reduce((s, u) => s + Math.max(0, u.hp), 0);
                        const lMax = Math.max(1, units.filter(u => u.side === 'left' && !u.isMinion).reduce((s, u) => s + u.maxHp, 0));
                        const rSum = units.filter(u => u.side === 'right' && !u.isMinion).reduce((s, u) => s + Math.max(0, u.hp), 0);
                        const rMax = Math.max(1, units.filter(u => u.side === 'right' && !u.isMinion).reduce((s, u) => s + u.maxHp, 0));
                        const loseSide = (lSum / lMax) >= (rSum / rMax) ? 'right' : 'left';
                        for (const u of units) {
                            if (u.side === loseSide)
                                u.hp = 0;
                        }
                    }

                    const leftAlive = units.filter(u => u.side === 'left' && u.hp > 0);
                    const rightAlive = units.filter(u => u.side === 'right' && u.hp > 0);

                    if (leftAlive.length === 0 || rightAlive.length === 0) {
                        phase = 'finished';
                        const winningSide = leftAlive.length > 0 ? 'left' : 'right';
                        const winners = units.filter(u => u.side === winningSide && !u.isMinion);
                        const losers = units.filter(u => u.side !== winningSide && !u.isMinion);

                        for (const w of winners) {
                            if (w.hp > 0) {
                                w.anim = 'happy';
                                w.vy = -6.2;
                                const wx = Math.round(w.x + w.bank.width / 2);
                                const wy = BASE_FOOT_Y + Math.round(w.z);
                                fxFront.spawn('ui/confetti', { x: wx, y: wy - 44 });
                                fxFront.spawn('ui/level-up', { x: wx, y: wy });
                                if (isBossRaid && winningSide === 'left')
                                    fxFront.spawn('spawn/coin-drop', { x: wx + 24, y: wy, coins: 8 });
                            }
                        }
                        for (const l of losers)
                            l.anim = 'hurt';

                        for (const remP of projectiles) {
                            if (remP.fxInst)
                                fxFront.removeInstance(remP.fxInst);
                        }
                        projectiles.length = 0;
                        for (const z of groundZones) {
                            if (z.fxInst)
                                fxBack.removeInstance(z.fxInst);
                        }
                        groundZones.length = 0;

                        const localOnLeft = leftTeam.some(f => localPetIds.includes(f.id)) || !isLanBattle;
                        const localWon = localOnLeft ? (winningSide === 'left') : (winningSide === 'right');
                        this._lastWinnerId = winners[0]?.info?.id || null;

                        let rewardSuffix = localWon ? '+22 金币 ✨' : '+8 安慰金币';
                        if (localPetIds.length > 0) {
                            const out = this._roster.recordBattleOutcome(localPetIds, localWon, telemetry);
                            if (out) {
                                rewardSuffix = `+${out.coinReward}🪙`;
                                if (out.droppedSkill)
                                    rewardSuffix += ` · 📜领悟【${out.droppedSkill.name}】!`;
                                if (out.droppedRelic)
                                    rewardSuffix += ` · 💎获【${out.droppedRelic.name}】!`;
                            }
                        }

                        const winLabel = winningSide === 'left'
                            ? `${leftTeam.map(f => f.name).join('&')}`
                            : (bossUnit ? bossUnit.info.name : `${rightTeam.map(f => f.name).join('&')}`);
                        announce(`🏆 胜者：${winLabel}！(${rewardSuffix})`);
                        refreshDetailsDrawer();

                        this._onBattleFinished?.({ winningSide, localWon, telemetry });
                    }
                } else if (phase === 'finished') {
                    // Pause auto-close while user has expanded Battle Details Drawer!
                    if (!detailsExpanded) {
                        finishCloseSec += dtSec;
                        if (finishCloseSec >= 6.5) {
                            this.closeArena();
                            return GLib.SOURCE_REMOVE;
                        }
                    }
                }

                // Update Physics, 2.5D Depth Scale, Overhead Micro-HUD & Z-Order Sorting!
                for (const u of units) {
                    if (!u._deadCleaned)
                        this._updateUnitPhysicsAndRender25D(u, dtMs);
                }
                this._sortUnitsByDepthZ(unitLayer, units);
                this._refreshTopPillBars(units, allyBarFill, enemyBarFill, bossUnit, bossBarFill, bossBarTitle);

                if (detailsExpanded) {
                    detailsRefreshAcc += dtSec;
                    if (detailsRefreshAcc >= 0.2) {
                        detailsRefreshAcc = 0;
                        refreshDetailsDrawer();
                    }
                }

                fxBack.step(dtSec);
                fxFront.step(dtSec);
            } catch (err) {
                console.error('[TopBarPet Arena Tick Error]', err);
            }

            return GLib.SOURCE_CONTINUE;
        });
    }

    closeArena() {
        this._battleToken += 1;
        this._spawnFloatText = null;
        if (this._closeIdleId) {
            GLib.Source.remove(this._closeIdleId);
            this._closeIdleId = 0;
        }
        if (this._loopId) {
            GLib.Source.remove(this._loopId);
            this._loopId = 0;
        }
        if (this._dragCaptureId) {
            global.stage.disconnect(this._dragCaptureId);
            this._dragCaptureId = 0;
        }
        if (this._pillBar) {
            removeChromeActor(this._pillBar);
            this._pillBar.destroy();
            this._pillBar = null;
        }
        if (this._detailsDrawer) {
            removeChromeActor(this._detailsDrawer);
            this._detailsDrawer.destroy();
            this._detailsDrawer = null;
        }
        if (this._stageRoot) {
            removeChromeActor(this._stageRoot);
            this._stageRoot.destroy();
            this._stageRoot = null;
        }
        if (this._arenaParticipantsActive) {
            this._arenaParticipantsActive = false;
            this._stageManager?.returnFightersFromArena(this._lastWinnerId);
            this._lastWinnerId = null;
        }
    }

    // =========================================================================
    // Helpers: Overhead Micro-HUD, Linked Drag, Z-Order & 2.5D AI Engine
    // =========================================================================
    _setupLinkedDrag(dragHandle, pillBar, detailsDrawer, stageRoot) {
        dragHandle.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const [sx, sy] = event.get_coords();
            const pStartX = pillBar.x;
            const pStartY = pillBar.y;
            const dStartX = detailsDrawer ? detailsDrawer.x : 0;
            const dStartY = detailsDrawer ? detailsDrawer.y : 0;
            const sStartX = stageRoot.x;
            const sStartY = stageRoot.y;

            if (this._dragCaptureId)
                global.stage.disconnect(this._dragCaptureId);

            this._dragCaptureId = global.stage.connect('captured-event', (_st, ev) => {
                if (ev.type() === Clutter.EventType.MOTION) {
                    const [mx, my] = ev.get_coords();
                    const dx = Math.round(mx - sx);
                    const dy = Math.round(my - sy);
                    const clampedDy = Math.max(-pStartY, dy);
                    pillBar.set_position(pStartX + dx, pStartY + clampedDy);
                    if (detailsDrawer)
                        detailsDrawer.set_position(dStartX + dx, dStartY + clampedDy);
                    stageRoot.set_position(sStartX + dx, sStartY + clampedDy);
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

    _createOverheadMicroHud(info, side, isMinion, isBoss) {
        const barW = isMinion ? 26 : (isBoss ? 52 : 42);
        const barH = isMinion ? 3 : 5;

        const root = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-overhead-box',
            reactive: false,
            x_align: Clutter.ActorAlign.CENTER,
        }));

        let nameLbl = null;
        if (!isMinion) {
            nameLbl = new St.Label({
                text: isBoss ? '💀 BOSS' : info.name,
                style_class: side === 'left' ? 'topbar-pet-overhead-name-ally' : 'topbar-pet-overhead-name-enemy',
                x_align: Clutter.ActorAlign.CENTER,
            });
            root.add_child(nameLbl);
        }

        const hpBg = new St.Widget({
            style_class: 'topbar-pet-micro-hp-bg',
            layout_manager: new Clutter.FixedLayout(),
            width: barW + 2,
            height: barH + 2,
        });
        const hpGhost = new St.Widget({
            style_class: 'topbar-pet-micro-hp-ghost',
            width: barW,
            height: barH,
            x: 1,
            y: 1,
        });
        const hpFill = new St.Widget({
            style_class: side === 'left' ? 'topbar-pet-micro-hp-ally' : 'topbar-pet-micro-hp-enemy',
            width: barW,
            height: barH,
            x: 1,
            y: 1,
        });
        hpBg.add_child(hpGhost);
        hpBg.add_child(hpFill);
        root.add_child(hpBg);

        let rageFill = null;
        if (!isMinion) {
            const rageBg = new St.Widget({
                style_class: 'topbar-pet-micro-rage-bg',
                layout_manager: new Clutter.FixedLayout(),
                width: barW + 2,
                height: 3,
            });
            rageFill = new St.Widget({
                style_class: 'topbar-pet-micro-rage-fill',
                width: 0,
                height: 2,
                x: 1,
                y: 0,
            });
            rageBg.add_child(rageFill);
            root.add_child(rageBg);
        }

        if (isMinion)
            root.opacity = 0; // Minion HP bar appears only once damaged!

        return { root, nameLbl, hpFill, hpGhost, rageFill, barW };
    }

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

    _makeRuntimeUnit({ side, info, stats, bank, actor, shadow, microHud, startX, startZ, facing, isBoss, isMinion, minionMeta }) {
        const stanceCfg = getStanceConfig(stats.stance || info.stance || 'balanced');
        const mods = stats.relicMods || {};
        return {
            side,
            info,
            stats,
            stanceCfg,
            mods,
            bank,
            actor,
            shadow,
            microHud,
            isBoss,
            isMinion,
            minionMeta,
            hp: stats.maxHp,
            ghostHp: stats.maxHp,
            maxHp: stats.maxHp,
            rage: Math.min(100, 20 + (mods.startRageBonus || 0)),
            x: startX,
            z: startZ,
            jumpY: 0,
            vy: 0,
            vxKnock: 0,
            vzDodge: 0,
            zDodgeSec: 0,
            facing,
            anim: 'idle',
            // Tactical timers & 2.5D states
            actionLockSec: 0,
            staggerSec: 0,
            frozenSec: 0,
            snareSec: 0,
            vulnerableSec: 0,
            crouchSec: 0,
            crouchCounterReady: false,
            guardSec: 0,
            parryWindowSec: 0,
            rollSec: 0,
            rollVx: 0,
            footsieDirX: 0,
            footsieDirZ: 0,
            footsieSec: 0,
            comboHitsLanded: 0,
            defenseCdSec: 0,
            jumpCdSec: 0.8,
            shieldSec: mods.startShieldSec || 0,
            reviveUsed: false,
            // Elemental Aura & Status DoTs
            auraElement: null,
            auraSec: 0,
            chillStacks: 0,
            burnSec: 0,
            poisonSec: 0,
            bleedSec: 0,
            dotTickAcc: 0,
            minionSupportCd: 3.5,
            hitFlashMs: 0,
            pendingStrike: null,
            cooldowns: new Map(),
            frameIdx: 0,
            frameAccMs: 0,
        };
    }

    _stepUnit25D(me, allies, foes, dtSec, rng, fxBack, fxFront, projectiles, groundZones, telemetry, announce, addFreeze) {
        // 1. Tick timers & passive relic regen / DoT ticks
        me.actionLockSec = Math.max(0, me.actionLockSec - dtSec);
        me.staggerSec = Math.max(0, me.staggerSec - dtSec);
        me.frozenSec = Math.max(0, me.frozenSec - dtSec);
        me.snareSec = Math.max(0, me.snareSec - dtSec);
        me.vulnerableSec = Math.max(0, me.vulnerableSec - dtSec);
        me.crouchSec = Math.max(0, me.crouchSec - dtSec);
        me.guardSec = Math.max(0, me.guardSec - dtSec);
        me.parryWindowSec = Math.max(0, me.parryWindowSec - dtSec);
        me.defenseCdSec = Math.max(0, me.defenseCdSec - dtSec);
        me.jumpCdSec = Math.max(0, me.jumpCdSec - dtSec);
        me.shieldSec = Math.max(0, me.shieldSec - dtSec);
        me.footsieSec = Math.max(0, me.footsieSec - dtSec);

        if (me.auraSec > 0) {
            me.auraSec = Math.max(0, me.auraSec - dtSec);
            if (me.auraSec <= 0) {
                me.auraElement = null;
                me.chillStacks = 0;
            }
        }
        me.burnSec = Math.max(0, me.burnSec - dtSec);
        me.poisonSec = Math.max(0, me.poisonSec - dtSec);
        me.bleedSec = Math.max(0, me.bleedSec - dtSec);

        const rageMult = me.stanceCfg.rageGainMult || 1.0;
        me.rage = Math.min(100, me.rage + dtSec * 10.5 * rageMult);

        // Relic passive regen & DoT damage every 0.65s
        me.dotTickAcc += dtSec;
        if (me.dotTickAcc >= 0.65) {
            me.dotTickAcc = 0;
            if (me.mods.regenPctPerSec > 0 && me.hp < me.maxHp) {
                const heal = Math.max(1, Math.round(me.maxHp * me.mods.regenPctPerSec * 0.65));
                me.hp = Math.min(me.maxHp, me.hp + heal);
            }
            let dotDmg = 0;
            if (me.burnSec > 0) dotDmg += Math.max(3, Math.round(me.maxHp * 0.018));
            if (me.poisonSec > 0) dotDmg += Math.max(3, Math.round(me.maxHp * 0.016));
            if (me.bleedSec > 0) dotDmg += Math.max(2, Math.round(me.maxHp * 0.014));
            if (dotDmg > 0 && me.shieldSec <= 0) {
                me.hp = Math.max(1, me.hp - dotDmg); // DoTs leave at least 1 HP
                this._spawnFloatText?.(me.x + me.bank.width / 2, BASE_FOOT_Y + me.z - me.bank.height, `-${dotDmg}`, 'normal');
            }
        }

        // Frost Slime Minion special mechanic: grants Ice Shield to Boss!
        if (me.isMinion && me.minionMeta?.grantsBossShield) {
            me.minionSupportCd -= dtSec;
            if (me.minionSupportCd <= 0) {
                me.minionSupportCd = 6.5;
                const bossAlly = allies.find(a => a.isBoss && a.hp > 0);
                if (bossAlly) {
                    bossAlly.shieldSec = Math.max(bossAlly.shieldSec, 2.6);
                    fxFront.spawn('ice/ice-crystal', { x: Math.round(bossAlly.x + bossAlly.bank.width / 2), y: BASE_FOOT_Y + Math.round(bossAlly.z) - 20 });
                    this._spawnFloatText?.(bossAlly.x + bossAlly.bank.width / 2, BASE_FOOT_Y + bossAlly.z - bossAlly.bank.height, '❄️ 护卫冰盾', 'guard');
                }
            }
        }

        for (const [skId, rem] of me.cooldowns.entries()) {
            if (rem <= dtSec)
                me.cooldowns.delete(skId);
            else
                me.cooldowns.set(skId, rem - dtSec);
        }

        const meCenter = me.x + me.bank.width / 2;

        // Pick nearest / best target in 2.5D space (prioritize low-HP minions or elemental-primed foes!)
        let foe = foes[0];
        let bestScore = Infinity;
        for (const cand of foes) {
            const d2d = Math.abs((cand.x + cand.bank.width / 2) - meCenter) + Math.abs(cand.z - me.z) * 1.4;
            const primeBonus = cand.auraElement ? -45 : 0;
            const minionPrio = (cand.isMinion && cand.minionMeta?.grantsBossShield) ? -70 : 0;
            const score = d2d + primeBonus + minionPrio;
            if (score < bestScore) {
                bestScore = score;
                foe = cand;
            }
        }

        const foeCenter = foe.x + foe.bank.width / 2;
        const dx = foeCenter - meCenter;
        const dz = foe.z - me.z;
        const distX = Math.abs(dx);
        const distZ = Math.abs(dz);
        const dirToFoe = dx >= 0 ? 1 : -1;

        // 2. Frozen or Staggered check
        if (me.frozenSec > 0) {
            me.pendingStrike = null;
            me.anim = 'hurt';
            return;
        }

        if (me.pendingStrike) {
            me.pendingStrike.timerSec -= dtSec;
            if (me.pendingStrike.timerSec <= 0) {
                const strike = me.pendingStrike;
                me.pendingStrike = null;
                this._executeSkillDelivery(me, allies, foes, strike, rng, fxBack, fxFront, projectiles, groundZones, telemetry, announce, addFreeze);
            }
            return;
        }

        if (me.staggerSec > 0) {
            me.anim = 'hurt';
            return;
        }

        if (me.zDodgeSec > 0) {
            me.zDodgeSec = Math.max(0, me.zDodgeSec - dtSec);
            if (me.snareSec <= 0)
                me.z = Math.max(Z_MIN, Math.min(Z_MAX, me.z + me.vzDodge * dtSec));
            me.anim = 'sneak';
            return;
        }

        if (me.rollSec > 0) {
            me.rollSec = Math.max(0, me.rollSec - dtSec);
            if (me.snareSec <= 0)
                me.x += me.rollVx * dtSec;
            me.anim = 'sneak';
            if (me.rollSec <= 0)
                me.facing = foe.x >= me.x ? 'right' : 'left';
            return;
        }

        if (me.crouchSec > 0) {
            me.anim = 'crouch';
            me.facing = dirToFoe > 0 ? 'right' : 'left';
            if (me.crouchCounterReady && distX <= 82 && distZ <= 30) {
                me.crouchCounterReady = false;
                me.crouchSec = 0;
                me.vy = -6.4;
                me.anim = 'attack';
                me.actionLockSec = 0.65;
                const fy = BASE_FOOT_Y + Math.round((me.z + foe.z) / 2);
                fxFront.spawn('melee/uppercut', {
                    x: Math.round((meCenter + foeCenter) / 2),
                    y: getFxSpawnY('melee/uppercut', fy, 0),
                    flip: me.facing === 'left',
                });
                announce(`⬆️ ${me.info.name} 下蹲潜避接【升龙反击】击飞！`);
                foe.vy = -6.6;
                this._applySkillDamage25D(me, foe, allies, foes, {
                    name: '升龙反击', element: 'physical', power: 1.38, knockback: 22, fxHit: 'impacts/crit-hit',
                }, rng, fxFront, telemetry, announce, addFreeze);
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

        // 3. 2.5D REACTIVE DEFENSIVE AI (Z-Sidestep, Crouch Duck, or Perfect Parry!)
        if (!me.isMinion && me.jumpY === 0 && me.defenseCdSec <= 0) {
            const incomingProj = projectiles.find(p =>
                p.ownerSide !== me.side &&
                Math.abs(p.x - meCenter) < 105 &&
                Math.abs(p.z - me.z) <= (p.zRadius + 10) &&
                (p.vx * (meCenter - p.x) > 0)
            );
            const foeWindingClose = foes.find(f =>
                f.pendingStrike &&
                Math.abs((f.x + f.bank.width / 2) - meCenter) <= (f.pendingStrike.skill.range + 26) &&
                Math.abs(f.z - me.z) <= (f.pendingStrike.skill.zRadius + 12)
            );

            if ((incomingProj || foeWindingClose) && rng() < me.stanceCfg.defenseProb) {
                const r = rng();
                const cCut = me.stanceCfg.crouchBias;
                const gCut = cCut + me.stanceCfg.guardBias;

                // Option 1: Z-Axis Depth Sidestep! (Especially great vs linear projectiles & beams!)
                if (r >= gCut && me.snareSec <= 0) {
                    const dodgeUp = me.z > (Z_MAX * 0.52);
                    me.vzDodge = dodgeUp ? -145 : 145;
                    me.zDodgeSec = 0.34;
                    me.defenseCdSec = 1.45 * (1 / Math.max(1, me.mods.spdMult || 1));
                    me.anim = 'sneak';
                    fxBack.spawn('spawn/poof', { x: Math.round(meCenter), y: BASE_FOOT_Y + Math.round(me.z) });
                    this._spawnFloatText?.(meCenter, BASE_FOOT_Y + me.z - me.bank.height, '💨 Z轴侧闪', 'evade');
                    return;
                }
                // Option 2: Crouch Duck (only if not a parabolic boulder!)
                if (r < cCut && incomingProj?.delivery !== 'lob_boulder') {
                    me.crouchSec = 0.60;
                    me.defenseCdSec = 1.65;
                    me.anim = 'crouch';
                    return;
                }
                // Option 3: Guard / Street-Fighter Perfect Parry!
                me.guardSec = 0.66;
                me.parryWindowSec = me.stanceCfg.parryWindowSec;
                me.defenseCdSec = 1.75;
                me.anim = 'guard';
                fxBack.spawn('impacts/shield-block', {
                    x: Math.round(meCenter),
                    y: getFxSpawnY('impacts/shield-block', BASE_FOOT_Y + me.z),
                    flip: me.facing === 'left',
                });
                return;
            }
        }

        // 4. Corner Escape Roll
        const pinnedLeft = me.x < 32 && dirToFoe > 0 && distX < 88;
        const pinnedRight = me.x > STAGE_W - me.bank.width - 32 && dirToFoe < 0 && distX < 88;
        if (!me.isBoss && me.snareSec <= 0 && (pinnedLeft || pinnedRight) && me.jumpY === 0 && rng() < 0.48) {
            me.rollSec = 0.36;
            me.rollVx = dirToFoe * 270;
            fxBack.spawn('arcane/blink-out', { x: Math.round(meCenter), y: getFxSpawnY('arcane/blink-out', BASE_FOOT_Y + me.z) });
            this._spawnFloatText?.(meCenter, BASE_FOOT_Y + me.z - me.bank.height, '💨 翻滚绕背', 'evade');
            return;
        }

        // 5. Hit-and-Run Spacing Disengage (modulated by Tactical Stance!)
        if (!me.isBoss && me.snareSec <= 0 && me.comboHitsLanded >= 2 && distX < 70 && rng() < me.stanceCfg.disengageChance) {
            me.comboHitsLanded = 0;
            me.vxKnock = -dirToFoe * 7.8;
            me.vy = -2.6;
            me.footsieDirX = -dirToFoe;
            me.footsieDirZ = (rng() < 0.5 ? -1 : 1) * 0.7;
            me.footsieSec = 0.48;
            me.actionLockSec = 0.32;
            fxBack.spawn('spawn/poof', { x: Math.round(meCenter), y: BASE_FOOT_Y + Math.round(me.z) });
            return;
        }

        // 6. 2.5D Footsies Weaving
        const slowFactor = me.chillStacks > 0 ? Math.max(0.48, 1 - me.chillStacks * 0.16) : 1.0;
        const moveSpd = 2.35 * me.stats.spd * me.stanceCfg.aggroSpeedMult * slowFactor;

        if (me.footsieSec > 0 && me.snareSec <= 0) {
            me.x += me.footsieDirX * moveSpd;
            me.z = Math.max(Z_MIN, Math.min(Z_MAX, me.z + me.footsieDirZ * moveSpd * 0.65));
            me.anim = 'walk';
            return;
        }

        // 7. Pick Best Modular Skill from 4-Slot Loadout!
        const skills = me.stats.equippedSkills || [SKILL_CATALOG.m1];
        const readySkills = skills.filter(sk => {
            if (me.cooldowns.has(sk.id))
                return false;
            if (sk.slotType === 'ultimate' && me.rage < 85)
                return false;
            return true;
        });

        let chosen = null;
        if (readySkills.length > 0) {
            // Prioritize Ultimate, Team Heal when ally < 58% HP, or Elemental Combo reaction trigger!
            const ult = readySkills.find(s => s.slotType === 'ultimate');
            const needHeal = allies.some(a => a.hp / a.maxHp < 0.58);
            const healSk = needHeal ? readySkills.find(s => s.healPct || s.shieldSec) : null;
            const comboSk = foe.auraElement
                ? readySkills.find(s => resolveElementalReaction(foe.auraElement, s.element))
                : null;

            chosen = ult || healSk || comboSk || readySkills[Math.floor(rng() * readySkills.length)];
        }

        if (!chosen) {
            // Skills on cooldown: weave in X & Z
            if (me.snareSec <= 0) {
                const idealDist = me.stanceCfg.id === 'kite' ? 165 : 88;
                if (distX > idealDist + 18)
                    me.x += dirToFoe * moveSpd;
                else if (distX < idealDist - 22)
                    me.x -= dirToFoe * moveSpd * 0.8;
                me.z = Math.max(Z_MIN, Math.min(Z_MAX, me.z + Math.sign(dz) * 0.8));
                me.anim = 'walk';
            } else {
                me.anim = 'idle';
            }
            return;
        }

        // Align X and Z into skill range!
        const reachX = chosen.range || 72;
        const reachZ = (chosen.zRadius || 26) - 4;

        if ((distX > reachX || distZ > reachZ) && chosen.movement !== 'blink_behind' && chosen.delivery !== 'aura_ward') {
            if (me.snareSec <= 0) {
                if (distX > reachX)
                    me.x += dirToFoe * moveSpd * 1.3;
                if (distZ > reachZ)
                    me.z = Math.max(Z_MIN, Math.min(Z_MAX, me.z + Math.sign(dz) * moveSpd * 0.85));
                me.anim = distX > 140 ? 'run' : 'walk';
            } else {
                me.anim = 'idle';
            }
            return;
        }

        // Commit to Skill Wind-Up & Movement Choreography!
        const cdr = me.mods.cdr || 0;
        me.cooldowns.set(chosen.id, Math.max(0.8, chosen.cd * (1 - cdr)));
        if (chosen.slotType === 'ultimate') {
            me.rage = 0;
            addFreeze(95);
            if (me.mods.ultHealPct > 0) {
                const uHeal = Math.round(me.maxHp * me.mods.ultHealPct);
                me.hp = Math.min(me.maxHp, me.hp + uHeal);
            }
        }

        if (chosen.fxCast) {
            fxBack.spawn(chosen.fxCast, {
                x: Math.round(meCenter),
                y: getFxSpawnY(chosen.fxCast, BASE_FOOT_Y + me.z, me.jumpY),
            });
        }

        // Execute Pre-Delivery Movement Component!
        if (chosen.movement === 'leap_slam' && me.snareSec <= 0) {
            me.vy = -7.2;
            me.vxKnock = dirToFoe * Math.min(7.5, distX * 0.055);
            me.z += dz * 0.65;
            me.anim = 'attack';
        } else if (chosen.movement === 'backflip_shot' && me.snareSec <= 0) {
            me.vy = -4.8;
            me.vxKnock = -dirToFoe * 5.8;
            me.anim = 'cast';
        } else if (chosen.movement === 'blink_behind' && me.snareSec <= 0) {
            const behindX = foe.x + (dirToFoe > 0 ? foe.bank.width + 8 : -me.bank.width - 8);
            me.x = Math.max(16, Math.min(STAGE_W - me.bank.width - 16, behindX));
            me.z = foe.z;
            me.facing = foe.x >= me.x ? 'right' : 'left';
            me.anim = 'attack';
        } else if (chosen.movement === 'dash_through' && me.snareSec <= 0) {
            me.vxKnock = dirToFoe * 10.5;
            me.z += dz * 0.5;
            me.anim = 'attack';
        } else if (chosen.movement === 'step_in' && me.snareSec <= 0) {
            me.vxKnock = dirToFoe * 3.4;
            me.anim = chosen.delivery === 'melee_combo' ? 'attack' : 'cast';
        } else {
            me.anim = chosen.delivery === 'melee_combo' ? 'attack' : 'cast';
        }

        const windupSec = chosen.delivery === 'melee_combo' ? 0.22 : 0.20;
        me.actionLockSec = chosen.slotType === 'ultimate' ? 0.86 : 0.58;
        me.pendingStrike = {
            timerSec: windupSec,
            skill: chosen,
            target: foe,
        };
    }

    _executeSkillDelivery(me, allies, foes, strike, rng, fxBack, fxFront, projectiles, groundZones, telemetry, announce, addFreeze) {
        const sk = strike.skill;
        const primaryFoe = foes.includes(strike.target) && strike.target.hp > 0 ? strike.target : foes[0];
        if (!primaryFoe)
            return;

        const meCenter = me.x + me.bank.width / 2;
        const meFootY = BASE_FOOT_Y + Math.round(me.z);
        const dirSign = me.facing === 'right' ? 1 : -1;

        // 1. Aura Ward / Team Heal
        if (sk.delivery === 'aura_ward') {
            const shieldBoost = me.mods.healShieldMult || 1.0;
            if (sk.shieldSec)
                me.shieldSec = Math.max(me.shieldSec, sk.shieldSec * shieldBoost);

            const recipients = sk.teamHeal ? allies : [me];
            for (const ally of recipients) {
                if (sk.healPct) {
                    const h = Math.round(ally.maxHp * sk.healPct * shieldBoost);
                    ally.hp = Math.min(ally.maxHp, ally.hp + h);
                    this._spawnFloatText?.(ally.x + ally.bank.width / 2, BASE_FOOT_Y + ally.z - ally.bank.height, `+${h}`, 'heal');
                }
                if (sk.teamHeal && sk.shieldSec && ally !== me)
                    ally.shieldSec = Math.max(ally.shieldSec, sk.shieldSec * 0.75);
            }

            fxFront.spawn(sk.fxMain, { x: Math.round(meCenter), y: getFxSpawnY(sk.fxMain, meFootY) });
            if (sk.power > 0) {
                for (const f of foes) {
                    if (Math.abs((f.x + f.bank.width / 2) - meCenter) <= (sk.range || 105) && Math.abs(f.z - me.z) <= (sk.zRadius || 38))
                        this._applySkillDamage25D(me, f, allies, foes, sk, rng, fxFront, telemetry, announce, addFreeze);
                }
            } else {
                announce(`🛡️ ${me.info.name} 施放【${sk.name}】守护小队！`);
            }
            return;
        }

        // 2. Linear Projectile & Parabolic Lob Boulder!
        if (sk.delivery === 'linear_proj' || sk.delivery === 'lob_boulder') {
            const startX = meCenter + dirSign * 22;
            const speed = sk.projSpeed || (sk.delivery === 'lob_boulder' ? 235 : 280);
            const fxInst = fxFront.spawn(sk.fxMain, {
                x: Math.round(startX),
                y: getFxSpawnY(sk.fxMain, meFootY, me.jumpY),
                flip: dirSign < 0,
                manualLifetime: true,
                maxDuration: 2.5,
            });
            projectiles.push({
                owner: me,
                ownerSide: me.side,
                skill: sk,
                delivery: sk.delivery,
                x: startX,
                startX,
                targetX: primaryFoe.x + primaryFoe.bank.width / 2,
                z: me.z,
                vx: dirSign * speed,
                vz: (primaryFoe.z - me.z) * (sk.delivery === 'lob_boulder' ? 1.2 : 0.25),
                zRadius: sk.zRadius || 22,
                fxInst,
                elapsed: 0,
            });
            return;
        }

        // 3. Persistent 2.5D Ground Zone Trap (Lava Pillar / Toxic Puddle / Black Hole / Tesla Coil!)
        if (sk.delivery === 'ground_zone') {
            const zx = Math.max(48, Math.min(STAGE_W - 48, Math.round(primaryFoe.x + primaryFoe.bank.width / 2)));
            const zz = primaryFoe.z;
            const zFootY = BASE_FOOT_Y + Math.round(zz);
            const fxInst = fxBack.spawn(sk.fxMain, {
                x: zx,
                y: getFxSpawnY(sk.fxMain, zFootY),
                maxDuration: sk.zoneSec || 3.0,
            });
            groundZones.push({
                owner: me,
                ownerSide: me.side,
                skill: sk,
                x: zx,
                z: zz,
                radiusX: 56,
                radiusZ: sk.zRadius || 36,
                remainSec: sk.zoneSec || 3.0,
                tickAcc: 0.45, // Trigger initial tick quickly!
                fxInst,
            });
            announce(`🌀 ${me.info.name} 布下【${sk.name}】领域！`);
            return;
        }

        // 4. Sky Strike (Top-Down Locked AoE!)
        if (sk.delivery === 'sky_strike') {
            const tx = Math.round(primaryFoe.x + primaryFoe.bank.width / 2);
            const tz = primaryFoe.z;
            const tFootY = BASE_FOOT_Y + Math.round(tz);
            fxFront.spawn(sk.fxMain, { x: tx, y: getFxSpawnY(sk.fxMain, tFootY), flip: dirSign < 0 });
            if (sk.teamHeal) {
                for (const ally of allies) {
                    const h = Math.round(ally.maxHp * (sk.healPct || 0.12));
                    ally.hp = Math.min(ally.maxHp, ally.hp + h);
                    this._spawnFloatText?.(ally.x + ally.bank.width / 2, BASE_FOOT_Y + ally.z - ally.bank.height, `+${h}`, 'heal');
                }
            }
            for (const f of foes) {
                if (Math.abs((f.x + f.bank.width / 2) - tx) <= 78 && Math.abs(f.z - tz) <= (sk.zRadius || 42))
                    this._applySkillDamage25D(me, f, allies, foes, sk, rng, fxFront, telemetry, announce, addFreeze);
            }
            return;
        }

        // 5. Beam Sweep (Pierces all foes in forward X & Z corridor!)
        if (sk.delivery === 'beam_sweep') {
            fxFront.spawn(sk.fxMain, {
                x: Math.round(meCenter + dirSign * 36),
                y: getFxSpawnY(sk.fxMain, meFootY),
                flip: dirSign < 0,
            });
            for (const f of foes) {
                const fCx = f.x + f.bank.width / 2;
                const inFront = dirSign > 0 ? (fCx >= meCenter - 10 && fCx <= meCenter + (sk.range || 220)) : (fCx <= meCenter + 10 && fCx >= meCenter - (sk.range || 220));
                if (inFront && Math.abs(f.z - me.z) <= (sk.zRadius || 32))
                    this._applySkillDamage25D(me, f, allies, foes, sk, rng, fxFront, telemetry, announce, addFreeze);
            }
            return;
        }

        // 6. Default: Multi-Hit Melee Combo in 2.5D!
        fxFront.spawn(sk.fxMain, {
            x: Math.round(meCenter + dirSign * 26),
            y: getFxSpawnY(sk.fxMain, meFootY, me.jumpY),
            flip: dirSign < 0,
        });

        let hitAny = false;
        for (const f of foes) {
            const distX = Math.abs((f.x + f.bank.width / 2) - meCenter);
            const distZ = Math.abs(f.z - me.z);
            if (distX <= (sk.range || 76) + 22 && distZ <= (sk.zRadius || 28) && f.rollSec <= 0) {
                hitAny = true;
                this._resolveCloseDefensiveCheckAndDamage(me, f, allies, foes, sk, rng, fxFront, telemetry, announce, addFreeze);
            }
        }
        if (!hitAny)
            this._spawnFloatText?.(primaryFoe.x + primaryFoe.bank.width / 2, BASE_FOOT_Y + primaryFoe.z - primaryFoe.bank.height, '💨 落空', 'evade');
    }

    _resolveCloseDefensiveCheckAndDamage(attacker, defender, allies, foes, sk, rng, fxFront, telemetry, announce, addFreeze) {
        const defCx = defender.x + defender.bank.width / 2;
        const defFootY = BASE_FOOT_Y + Math.round(defender.z);

        // Perfect Parry check!
        if (defender.parryWindowSec > 0 && sk.slotType !== 'ultimate') {
            defender.parryWindowSec = 0;
            defender.guardSec = 0;
            defender.rage = Math.min(100, defender.rage + 28);
            attacker.staggerSec = attacker.isBoss ? 0.45 : 0.92;
            attacker.vxKnock = (attacker.x < defender.x ? -1 : 1) * 7.2;

            // Chrono Watch Relic: refund cooldowns on Perfect Parry!
            if (defender.mods.parryCdRefund > 0) {
                for (const [k, rem] of defender.cooldowns.entries())
                    defender.cooldowns.set(k, Math.max(0, rem - defender.mods.parryCdRefund));
            }
            if (defender.side === 'left')
                telemetry.parries += 1;

            fxFront.spawn('impacts/parry', { x: Math.round((attacker.x + defCx) / 2), y: getFxSpawnY('impacts/parry', defFootY) });
            this._spawnFloatText?.(defCx, defFootY - defender.bank.height, '⚡ 精准弹反!', 'crit');
            announce(`⚡ ${defender.info.name} 打出【精准弹反】震晕了 ${attacker.info.name}！`);
            addFreeze(105);
            return;
        }

        this._applySkillDamage25D(attacker, defender, allies, foes, sk, rng, fxFront, telemetry, announce, addFreeze);
    }

    _applySkillDamage25D(attacker, defender, allies, foes, sk, rng, fxFront, telemetry, announce, addFreeze, dmgMultOverride = 1.0) {
        if (defender.hp <= 0)
            return;

        const defCx = defender.x + defender.bank.width / 2;
        const defFootY = BASE_FOOT_Y + Math.round(defender.z);

        // Same-school 15% Mastery Bonus!
        const masteryMult = (sk.school && sk.school === attacker.info.archetype) ? 1.15 : 1.0;
        const isCrit = rng() < attacker.stats.critRate;
        const critMult = isCrit ? (1.52 + (attacker.mods.critDmgBonus || 0)) : 1.0;

        let mult = masteryMult * critMult * dmgMultOverride * (telemetry.overtimeMult || 1.0);

        // Relic: Execute Low HP & Boss/Minion Slayer
        if (attacker.mods.executeMult > 0 && (defender.hp / defender.maxHp) < 0.40)
            mult *= (1 + attacker.mods.executeMult);
        if (attacker.mods.bossMinionBonus > 0 && (defender.isBoss || defender.isMinion))
            mult *= (1 + attacker.mods.bossMinionBonus);
        if (defender.vulnerableSec > 0)
            mult *= 1.28;
        if (defender.mods.dmgReduct > 0)
            mult *= (1 - defender.mods.dmgReduct);

        // Guard & Shield Mitigation + Thorns Reflect Relic!
        const isGuarding = defender.guardSec > 0;
        if (isGuarding)
            mult *= Math.max(0.20, 0.36 - (defender.mods.guardBonus || 0));
        else if (defender.shieldSec > 0)
            mult *= 0.55;

        // Check Elemental Combo Reaction!
        let reaction = null;
        const inElem = sk.element || 'physical';
        if (inElem !== 'physical') {
            reaction = resolveElementalReaction(defender.auraElement, inElem);
            if (reaction) {
                const reactBonus = 1 + (attacker.mods.reactionDmgBonus || 0);
                mult *= reaction.dmgMult * reactBonus;
                if (reaction.clearAura) {
                    defender.auraElement = null;
                    defender.auraSec = 0;
                }
                if (reaction.vulnerableSec)
                    defender.vulnerableSec = Math.max(defender.vulnerableSec, reaction.vulnerableSec);
                if (reaction.snareSec)
                    defender.snareSec = Math.max(defender.snareSec, reaction.snareSec);
                if (reaction.cdRefundSec && attacker.cooldowns) {
                    for (const [k, rem] of attacker.cooldowns.entries())
                        attacker.cooldowns.set(k, Math.max(0, rem - reaction.cdRefundSec));
                }
                if (reaction.fx)
                    fxFront.spawn(reaction.fx, { x: Math.round(defCx), y: getFxSpawnY(reaction.fx, defFootY) });

                if (attacker.side === 'left')
                    telemetry.reactions += 1;
                telemetry.comboCount += 1;
                fxFront.spawn('ui/combo-counter', { x: Math.round(defCx), y: Math.max(28, defFootY - 62) });
            } else {
                // Prime target with new Elemental Aura!
                defender.auraElement = inElem;
                defender.auraSec = 6.0;
            }
        }

        let dmg = Math.max(5, Math.round(attacker.stats.atk * (sk.power || 1.0) * mult * (0.93 + rng() * 0.14)));
        if (reaction?.bonusTrueHpPct)
            dmg += Math.min(140, Math.round(defender.maxHp * reaction.bonusTrueHpPct));

        // Phoenix Plume Legendary Relic: cheat death once!
        if (dmg >= defender.hp && !defender.reviveUsed && defender.mods.reviveHpPct > 0) {
            defender.reviveUsed = true;
            defender.hp = Math.max(1, Math.round(defender.maxHp * defender.mods.reviveHpPct));
            defender.shieldSec = 2.5;
            fxFront.spawn('holy/resurrection', { x: Math.round(defCx), y: defFootY });
            this._spawnFloatText?.(defCx, defFootY - defender.bank.height, '🐦‍🔥 涅槃重生!', 'crit');
            announce(`🐦‍🔥 ${defender.info.name} 触发【涅槃不死火羽】浴火重生！`);
            return;
        }

        defender.hp = Math.max(0, defender.hp - dmg);
        defender.rage = Math.min(100, defender.rage + 13);
        attacker.rage = Math.min(100, attacker.rage + 12);
        attacker.comboHitsLanded += 1;
        defender.hitFlashMs = 130;

        // Thorns Reflect when guarding/shielded!
        if ((isGuarding || defender.shieldSec > 0) && defender.mods.thornsReflect > 0) {
            const refl = Math.max(3, Math.round(dmg * defender.mods.thornsReflect));
            attacker.hp = Math.max(1, attacker.hp - refl);
            attacker.bleedSec = Math.max(attacker.bleedSec, 3.0);
        }

        // Lifesteal (Skill + Relic + Eclipse reaction)
        let totalLs = (sk.lifesteal || 0) + (attacker.mods.lifestealAll || 0);
        if (sk.delivery === 'melee_combo')
            totalLs += (attacker.mods.meleeLifesteal || 0);
        if (totalLs > 0 && attacker.hp > 0) {
            const heal = Math.max(2, Math.round(dmg * totalLs));
            attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
            this._spawnFloatText?.(attacker.x + attacker.bank.width / 2, BASE_FOOT_Y + attacker.z - attacker.bank.height, `+${heal}`, 'heal');
        }
        if (reaction?.healSelfPct) {
            const rHeal = Math.round(attacker.maxHp * reaction.healSelfPct);
            attacker.hp = Math.min(attacker.maxHp, attacker.hp + rHeal);
        }

        // Overload / Venom Blast AoE Splash to nearby foes!
        if (reaction?.aoeRadius) {
            for (const other of foes) {
                if (other !== defender && other.hp > 0 && Math.hypot((other.x - defender.x), (other.z - defender.z)) <= reaction.aoeRadius) {
                    const splash = Math.max(5, Math.round(dmg * 0.55));
                    other.hp = Math.max(0, other.hp - splash);
                    this._spawnFloatText?.(other.x + other.bank.width / 2, BASE_FOOT_Y + other.z - other.bank.height, `-${splash}`, 'crit');
                }
            }
        }

        // Thunder Drum Relic: Crit triggers bonus lightning splash!
        if (isCrit && attacker.mods.critChainLightning > 0) {
            const bolt = Math.max(4, Math.round(attacker.stats.atk * attacker.mods.critChainLightning));
            defender.hp = Math.max(0, defender.hp - bolt);
            fxFront.spawn('lightning/zap-hit', { x: Math.round(defCx), y: defFootY - 22 });
        }

        // Apply Status Effects & PixelFX Status Visuals!
        if (sk.status && !isGuarding) {
            const st = sk.status;
            if (st.kind === 'burn') {
                defender.burnSec = Math.max(defender.burnSec, st.sec);
                fxFront.spawn('status/burning', { x: Math.round(defCx), y: defFootY, maxDuration: 1.2 });
            } else if (st.kind === 'chill') {
                defender.chillStacks = Math.min(3, defender.chillStacks + (st.stacks || 1));
                if (defender.chillStacks >= 3 && !defender.isBoss) {
                    defender.chillStacks = 0;
                    defender.frozenSec = 1.15;
                    fxFront.spawn('status/frozen', { x: Math.round(defCx), y: defFootY, maxDuration: 1.15 });
                    this._spawnFloatText?.(defCx, defFootY - defender.bank.height - 12, '🧊 冰封定身!', 'guard');
                }
            } else if (st.kind === 'poison') {
                defender.poisonSec = Math.max(defender.poisonSec, st.sec);
                fxFront.spawn('status/poisoned', { x: Math.round(defCx), y: defFootY, maxDuration: 1.2 });
            } else if (st.kind === 'bleed') {
                defender.bleedSec = Math.max(defender.bleedSec, st.sec);
            } else if (st.kind === 'stun' && !defender.isBoss) {
                defender.staggerSec = Math.max(defender.staggerSec, st.sec);
                fxFront.spawn('status/stunned', { x: Math.round(defCx), y: defFootY, maxDuration: st.sec });
            } else if (st.kind === 'snare') {
                defender.snareSec = Math.max(defender.snareSec, st.sec);
            }
        }

        // Knockback & Launch
        if (!isGuarding && !defender.isBoss) {
            const pushDir = defender.x >= attacker.x ? 1 : -1;
            if (sk.launchVy)
                defender.vy = sk.launchVy;
            if (sk.knockback)
                defender.vxKnock = pushDir * (sk.knockback * 0.22);
        }

        const hitFx = isGuarding ? 'impacts/shield-block' : (sk.fxHit || (isCrit ? 'impacts/crit-hit' : 'impacts/hit-flash'));
        fxFront.spawn(hitFx, { x: Math.round(defCx), y: getFxSpawnY(hitFx, defFootY, defender.jumpY) });

        if (reaction) {
            this._spawnFloatText?.(defCx, defFootY - defender.bank.height - 14, `${reaction.name} -${dmg}!`, 'reaction');
            announce(`${reaction.name}！${attacker.info.name} 的【${sk.name}】引爆元素连携造成 ${dmg} 伤害！`);
            addFreeze(55);
        } else if (isGuarding) {
            this._spawnFloatText?.(defCx, defFootY - defender.bank.height, `🛡️ 格挡 -${dmg}`, 'guard');
            telemetry.logFn?.(`🛡️ ${defender.info.name} 举盾格挡【${sk.name}】，仅受 ${dmg} 点伤害`);
        } else if (isCrit) {
            this._spawnFloatText?.(defCx, defFootY - defender.bank.height - 6, `💥 暴击 -${dmg}`, 'crit');
            announce(`💥 ${attacker.info.name}【${sk.name}】暴击命中造成 ${dmg} 点伤害！`);
        } else {
            this._spawnFloatText?.(defCx, defFootY - defender.bank.height, `-${dmg}`, 'normal');
            if (!attacker.isMinion && dmgMultOverride >= 0.9)
                telemetry.logFn?.(`⚔️ ${attacker.info.name}【${sk.name}】命中 ${defender.info.name} (-${dmg})`);
        }
    }

    _stepProjectiles25D(projectiles, units, dtSec, rng, fxFront, telemetry, announce, addFreeze) {
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            p.elapsed += dtSec;
            p.x += p.vx * dtSec;
            p.z = Math.max(Z_MIN, Math.min(Z_MAX, p.z + p.vz * dtSec));

            // Parabolic arc height for boulders!
            let arcOffsetY = 0;
            if (p.delivery === 'lob_boulder') {
                const totalSpan = Math.max(60, Math.abs(p.targetX - p.startX));
                const prog = Math.min(1, Math.abs(p.x - p.startX) / totalSpan);
                arcOffsetY = -Math.sin(prog * Math.PI) * 54;
            }

            if (p.fxInst?.options) {
                p.fxInst.options.x = Math.round(p.x);
                p.fxInst.options.y = getFxSpawnY(p.skill.fxMain, BASE_FOOT_Y + p.z, arcOffsetY);
            }

            if (p.x < -30 || p.x > STAGE_W + 30 || p.elapsed > 2.4) {
                if (p.fxInst)
                    fxFront.removeInstance(p.fxInst);
                projectiles.splice(i, 1);
                continue;
            }

            const foes = units.filter(u => u.side !== p.ownerSide && u.hp > 0);
            const allies = units.filter(u => u.side === p.ownerSide && u.hp > 0);
            let consumed = false;

            for (const f of foes) {
                const fCx = f.x + f.bank.width / 2;
                if (Math.abs(p.x - fCx) <= 24 && Math.abs(p.z - f.z) <= p.zRadius) {
                    // Ducking evades linear projectiles (NOT parabolic boulders!)
                    if (p.delivery !== 'lob_boulder' && (f.crouchSec > 0 || f.rollSec > 0 || f.jumpY < -24)) {
                        if (!p._whiffNotified) {
                            p._whiffNotified = true;
                            if (f.crouchSec > 0)
                                f.crouchCounterReady = true;
                            this._spawnFloatText?.(fCx, BASE_FOOT_Y + f.z - f.bank.height, '⬇️ 潜避!', 'evade');
                        }
                        continue;
                    }
                    if (p.fxInst)
                        fxFront.removeInstance(p.fxInst);
                    this._resolveCloseDefensiveCheckAndDamage(p.owner, f, allies, foes, p.skill, rng, fxFront, telemetry, announce, addFreeze);
                    projectiles.splice(i, 1);
                    consumed = true;
                    break;
                }
            }
            if (consumed)
                continue;
        }
    }

    _stepGroundZones25D(groundZones, units, dtSec, rng, fxFront, telemetry, announce, addFreeze) {
        for (let i = groundZones.length - 1; i >= 0; i--) {
            const z = groundZones[i];
            z.remainSec -= dtSec;
            if (z.remainSec <= 0) {
                groundZones.splice(i, 1);
                continue;
            }

            const foes = units.filter(u => u.side !== z.ownerSide && u.hp > 0);
            const allies = units.filter(u => u.side === z.ownerSide && u.hp > 0);

            // Black Hole Pull Force across X & Z!
            if (z.skill.pullForce) {
                for (const f of foes) {
                    if (!f.isBoss && Math.abs((f.x + f.bank.width / 2) - z.x) < 150) {
                        f.x += Math.sign(z.x - (f.x + f.bank.width / 2)) * 55 * dtSec;
                        f.z += Math.sign(z.z - f.z) * 38 * dtSec;
                    }
                }
            }

            z.tickAcc += dtSec;
            if (z.tickAcc >= 0.72) {
                z.tickAcc = 0;
                for (const f of foes) {
                    if (Math.abs((f.x + f.bank.width / 2) - z.x) <= z.radiusX && Math.abs(f.z - z.z) <= z.radiusZ)
                        this._applySkillDamage25D(z.owner, f, allies, foes, z.skill, rng, fxFront, telemetry, announce, addFreeze, 0.42);
                }
            }
        }
    }

    _stepBenchAssists(benchState, units, dtSec, rng, fxFront, telemetry, announce, addFreeze) {
        for (const side of ['left', 'right']) {
            const b = benchState[side];
            if (!b || b.usesLeft <= 0)
                continue;
            b.cdSec = Math.max(0, b.cdSec - dtSec);
            if (b.cdSec > 0)
                continue;

            const mainAlly = units.find(u => u.side === side && u.hp > 0);
            const mainFoe = units.find(u => u.side !== side && u.hp > 0);
            if (!mainAlly || !mainFoe)
                continue;

            // Trigger Assist when ally drops below 55% HP or opponent is staggered!
            if ((mainAlly.hp / mainAlly.maxHp) <= 0.55 || mainFoe.staggerSec > 0.2) {
                b.usesLeft -= 1;
                const assistStats = computeCombatStats(b.pkt, this._roster.unlockedSkillPool);
                const sigSkill = assistStats.equippedSkills[0] || SKILL_CATALOG.f2;
                const fxX = Math.round((mainAlly.x + mainFoe.x) / 2 + 24);
                const fxY = BASE_FOOT_Y + Math.round(mainFoe.z);

                fxFront.spawn('arcane/blink-in', { x: fxX, y: fxY - 18 });
                fxFront.spawn(sigSkill.fxMain, { x: Math.round(mainFoe.x + mainFoe.bank.width / 2), y: getFxSpawnY(sigSkill.fxMain, fxY) });

                const fakeAttacker = {
                    side,
                    info: b.pkt,
                    stats: assistStats,
                    mods: assistStats.relicMods || {},
                    bank: mainAlly.bank,
                    x: fxX,
                    z: mainFoe.z,
                    hp: assistStats.maxHp,
                    maxHp: assistStats.maxHp,
                    rage: 50,
                    comboHitsLanded: 0,
                    crouchSec: 0,
                    guardSec: 0,
                    shieldSec: 0,
                    bleedSec: 0,
                    burnSec: 0,
                    poisonSec: 0,
                    chillStacks: 0,
                    frozenSec: 0,
                    snareSec: 0,
                    vulnerableSec: 0,
                    reviveUsed: true,
                    cooldowns: new Map(),
                };
                const allies = units.filter(u => u.side === side && u.hp > 0);
                const foes = units.filter(u => u.side !== side && u.hp > 0);
                this._applySkillDamage25D(fakeAttacker, mainFoe, allies, foes, sigSkill, rng, fxFront, telemetry, announce, addFreeze, 1.15);
                announce(`🤝 场边副将「${b.pkt.name}」闪现援助释放【${sigSkill.name}】！`);
            }
        }
    }

    _updateUnitPhysicsAndRender25D(u, dtMs) {
        if (!Number.isFinite(u.x))
            u.x = u.side === 'left' ? 96 : STAGE_W - 140;
        if (!Number.isFinite(u.z))
            u.z = Math.round(Z_MAX * 0.5);
        if (!Number.isFinite(u.jumpY))
            u.jumpY = 0;
        if (u.jumpY < 0 || u.vy !== 0) {
            u.jumpY += u.vy;
            u.vy += 0.52;
            if (u.jumpY >= 0) {
                u.jumpY = 0;
                u.vy = 0;
            }
        }

        if (Math.abs(u.vxKnock) > 0.1) {
            u.x += u.vxKnock;
            u.vxKnock *= 0.80;
            if (Math.abs(u.vxKnock) < 0.2)
                u.vxKnock = 0;
        }

        u.x = Math.max(12, Math.min(STAGE_W - u.bank.width - 12, u.x));
        u.z = Math.max(Z_MIN, Math.min(Z_MAX, u.z));

        if (u.hitFlashMs > 0)
            u.hitFlashMs = Math.max(0, u.hitFlashMs - dtMs);

        // Smooth delayed white HP ghost catch-up!
        if (u.ghostHp > u.hp)
            u.ghostHp = Math.max(u.hp, u.ghostHp - (u.maxHp * 0.018));
        else
            u.ghostHp = u.hp;

        // 2.5D Perspective Depth Scale (0.93 at back Z=0 -> 1.05 at front Z=Z_MAX)
        const depthScale = 0.93 + 0.12 * (u.z / Z_MAX);
        if (u.crouchSec > 0)
            u.actor.set_scale(depthScale * 1.14, depthScale * 0.72);
        else if (u.rollSec > 0)
            u.actor.set_scale(depthScale * 1.12, depthScale * 0.78);
        else
            u.actor.set_scale(depthScale, depthScale);

        const stateFrames = u.bank.states[u.anim] || u.bank.states.idle;
        if (stateFrames?.length) {
            const cur = stateFrames[u.frameIdx % stateFrames.length];
            u.frameAccMs += dtMs;
            if (u.frameAccMs >= Math.max(36, cur.delayMs)) {
                u.frameAccMs = 0;
                u.frameIdx = (u.frameIdx + 1) % stateFrames.length;
            }
            const frame = stateFrames[u.frameIdx % stateFrames.length];
            const useFlash = u.hitFlashMs > 0 && frame.flashRight;
            const content = u.facing === 'left'
                ? (useFlash ? frame.flashLeft : frame.left)
                : (useFlash ? frame.flashRight : frame.right);
            if (u.actor.content !== content)
                u.actor.set_content(content);
        }

        const footY = BASE_FOOT_Y + Math.round(u.z);
        const rx = Math.round(u.x);
        const ry = Math.round(footY - u.bank.height + u.jumpY);
        u.actor.set_position(rx, ry);

        // Ground Contact Shadow Oval (locked to ground footY, shrinks as jumpY rises!)
        const jumpHeight = Math.abs(u.jumpY);
        const shScale = Math.max(0.42, 1 - jumpHeight / 95) * depthScale;
        const shW = Math.round(u.bank.width * 0.68 * shScale);
        const shH = Math.max(4, Math.round(u.bank.width * 0.16 * shScale));
        u.shadow.set_size(shW, shH);
        u.shadow.opacity = Math.round(190 * shScale);
        u.shadow.set_position(Math.round(rx + (u.bank.width - shW) / 2), footY - Math.round(shH / 2));

        // Overhead Micro-HUD update
        const hud = u.microHud;
        if (u.isMinion && u.hp < u.maxHp && u.hp > 0)
            hud.root.opacity = 240;

        if (hud.nameLbl) {
            const auraIcon = u.auraElement && ELEMENT_META[u.auraElement] ? ` ${ELEMENT_META[u.auraElement].icon}` : '';
            const freezeIcon = u.frozenSec > 0 ? ' 🧊' : (u.shieldSec > 0 ? ' 🛡️' : '');
            const baseText = u.isBoss ? '💀 BOSS' : u.info.name;
            const nextText = `${baseText}${auraIcon}${freezeIcon}`;
            if (hud.nameLbl.text !== nextText)
                hud.nameLbl.text = nextText;
        }

        const hpRatio = Math.max(0, Math.min(1, u.hp / u.maxHp));
        const ghostRatio = Math.max(hpRatio, Math.min(1, u.ghostHp / u.maxHp));
        hud.hpFill.width = Math.round(hud.barW * hpRatio);
        hud.hpGhost.width = Math.round(hud.barW * ghostRatio);
        if (hud.rageFill)
            hud.rageFill.width = Math.round(hud.barW * Math.max(0, Math.min(1, u.rage / 100)));

        const [, hudW] = hud.root.get_preferred_width(-1);
        const [, hudH] = hud.root.get_preferred_height(-1);
        hud.root.set_position(
            Math.max(2, Math.min(STAGE_W - hudW - 2, Math.round(rx + u.bank.width / 2 - hudW / 2))),
            Math.max(2, ry - (hudH || 18) - 3)
        );
    }

    _sortUnitsByDepthZ(unitLayer, units) {
        const sorted = units.filter(u => !u._deadCleaned && u.actor.get_parent() === unitLayer).sort((a, b) => a.z - b.z);
        for (let i = 1; i < sorted.length; i++) {
            unitLayer.set_child_above_sibling(sorted[i].actor, sorted[i - 1].actor);
        }
    }

    _refreshTopPillBars(units, allyFill, enemyFill, bossUnit, bossBarFill, bossBarTitle) {
        const leftPets = units.filter(u => u.side === 'left' && !u.isMinion);
        const rightMain = units.filter(u => u.side === 'right' && !u.isMinion);

        const sumHp = arr => arr.reduce((s, u) => s + Math.max(0, u.hp), 0);
        const sumMax = arr => Math.max(1, arr.reduce((s, u) => s + u.maxHp, 0));

        allyFill.width = Math.round(TEAM_BAR_W * (sumHp(leftPets) / sumMax(leftPets)));
        enemyFill.width = Math.round(TEAM_BAR_W * (sumHp(rightMain) / sumMax(rightMain)));

        if (bossUnit && bossBarFill) {
            const pct = Math.max(0, Math.min(1, bossUnit.hp / bossUnit.maxHp));
            bossBarFill.width = Math.round(170 * pct);
            if (bossBarTitle) {
                const pctInt = Math.ceil(pct * 100);
                bossBarTitle.text = `${bossUnit.info.name} · ${pctInt}%`;
            }
        }
    }
}
