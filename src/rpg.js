import GLib from 'gi://GLib';
import {
    SKILL_CATALOG,
    ALL_SKILL_IDS,
    getSkillsBySchool,
    normalizeSkillLoadout,
    resolveCombatSkillList,
    recommendSkillLoadout,
} from './skillSystem.js';
import {
    RELIC_CATALOG,
    ALL_RELIC_IDS,
    EGG_TRAITS,
    TACTICAL_STANCES,
    ACHIEVEMENT_CATALOG,
    aggregateRelicModifiers,
    findNewlyUnlockedAchievements,
} from './relicsAndAchievements.js';

export const MAX_ADOPTED_PETS = Infinity;

export const SPECIES_PRESETS = [
    { id: 'cat', label: '🐱 像素橘猫', defaultName: '团子', defaultArchetype: 'martial' },
    { id: 'shiba', label: '🐕 像素柴犬', defaultName: '旺财', defaultArchetype: 'fire' },
    { id: 'slime', label: '💧 果冻史莱姆', defaultName: '噗噜', defaultArchetype: 'ice' },
    { id: 'robot', label: '🤖 赛博小机甲', defaultName: '哔啵', defaultArchetype: 'storm' },
    { id: 'dragon', label: '🐲 烈焰小火龙', defaultName: '小焰', defaultArchetype: 'fire' },
    { id: 'ghost', label: '👻 星界小幽灵', defaultName: '星尘', defaultArchetype: 'arcane' },
];

export const CLASS_ARCHETYPES = {
    martial: {
        id: 'martial',
        name: '狂战武道',
        badge: '⚔️ 武道',
        desc: '近身多段体术宗师，高攻高速高连击，擅长穿身乱刃、长枪横扫与裂地霸斩。',
        baseHp: 440, hpPerLv: 70,
        baseAtk: 17.5, atkPerLv: 3.2,
        baseSpd: 1.16, critRate: 0.22,
        skills: getSkillsBySchool('martial'),
    },
    fire: {
        id: 'fire',
        name: '烈焰魔导',
        badge: '🔥 烈焰',
        desc: '远程轰炸与灼烧领域大师，擅长后跃火球、熔岩火柱陷阱与陨星天降。',
        baseHp: 400, hpPerLv: 63,
        baseAtk: 19.2, atkPerLv: 3.45,
        baseSpd: 1.05, critRate: 0.20,
        skills: getSkillsBySchool('fire'),
    },
    ice: {
        id: 'ice',
        name: '凛冬冰霜',
        badge: '❄️ 冰霜',
        desc: '控场与冰封术士，叠满 3 层寒冰直接冻结目标，完美配合烈焰/雷霆打出融化与超导。',
        baseHp: 470, hpPerLv: 75,
        baseAtk: 16.0, atkPerLv: 2.95,
        baseSpd: 1.0, critRate: 0.17,
        skills: getSkillsBySchool('ice'),
    },
    storm: {
        id: 'storm',
        name: '雷霆幻影',
        badge: '⚡ 雷霆',
        desc: '极致移速与暴击刺客，擅长跨 Z 轴瞬移背刺、磁暴电塔与九霄天雷。',
        baseHp: 390, hpPerLv: 61,
        baseAtk: 18.2, atkPerLv: 3.35,
        baseSpd: 1.25, critRate: 0.30,
        skills: getSkillsBySchool('storm'),
    },
    arcane: {
        id: 'arcane',
        name: '星界奥术',
        badge: '🔮 奥术',
        desc: '掌控暗影与引力次元，擅长生命汲取、时间凝滞、黑洞聚怪与贯穿光束。',
        baseHp: 410, hpPerLv: 64,
        baseAtk: 18.6, atkPerLv: 3.4,
        baseSpd: 1.08, critRate: 0.23,
        skills: getSkillsBySchool('arcane'),
    },
    holy: {
        id: 'holy',
        name: '圣光自然',
        badge: '✨ 圣光',
        desc: '团队守护与森毒陷阱大师，兼备剧毒泥潭、藤蔓禁锢、全队治愈与圣光裁决。',
        baseHp: 490, hpPerLv: 78,
        baseAtk: 15.5, atkPerLv: 2.85,
        baseSpd: 1.03, critRate: 0.18,
        skills: getSkillsBySchool('holy'),
    },
};

export function getArchetype(archetypeId) {
    return CLASS_ARCHETYPES[archetypeId] || CLASS_ARCHETYPES.martial;
}

export function xpRequiredForLevel(level) {
    const lv = Math.max(1, Number(level) || 1);
    return Math.round(180 * Math.pow(lv, 1.35));
}

export function computeCombatStats(pet, globalUnlockedPool = []) {
    const lv = Math.max(1, Number(pet.level) || 1);
    const arch = getArchetype(pet.archetype);
    const relicMods = aggregateRelicModifiers(pet.relicIds || [], pet.trait || null);

    const rawHp = arch.baseHp + (lv - 1) * arch.hpPerLv;
    const rawAtk = arch.baseAtk + (lv - 1) * arch.atkPerLv;
    const maxHp = Math.round(rawHp * relicMods.hpMult);
    const atk = Math.round(rawAtk * relicMods.atkMult);
    const spd = Number((arch.baseSpd * relicMods.spdMult).toFixed(2));
    const critRate = Math.min(0.78, arch.critRate + relicMods.critRateBonus);
    const equippedSkills = resolveCombatSkillList(pet, globalUnlockedPool);

    return {
        maxHp,
        atk,
        spd,
        critRate,
        archetypeName: arch.name,
        archetypeBadge: arch.badge,
        unlockedSkills: equippedSkills,
        equippedSkills,
        relicMods,
        stance: pet.stance || 'balanced',
    };
}

export function createNewPetRecord(opts = {}, globalUnlockedPool = []) {
    const presetId = opts.presetId || 'cat';
    const presetMeta = SPECIES_PRESETS.find(p => p.id === presetId) || SPECIES_PRESETS[0];
    const id = opts.id || `pet-${GLib.uuid_string_random().slice(0, 8)}`;
    const archetype = CLASS_ARCHETYPES[opts.archetype] ? opts.archetype : presetMeta.defaultArchetype;
    const level = Math.max(1, Number(opts.level) || 1);
    const stance = TACTICAL_STANCES[opts.stance] ? opts.stance : 'balanced';
    const trait = (opts.trait && EGG_TRAITS[opts.trait]) ? opts.trait : null;
    const relicIds = Array.isArray(opts.relicIds)
        ? opts.relicIds.filter(r => Boolean(RELIC_CATALOG[r])).slice(0, 3)
        : [];

    const draft = {
        id,
        name: (opts.name || presetMeta.defaultName || '团子').trim(),
        archetype,
        skinMode: opts.skinMode || 'preset', // 'preset' | 'gif' | 'spritesheet'
        presetId,
        customPath: opts.customPath || '',
        cols: Number(opts.cols) || 4,
        rows: Number(opts.rows) || 12,
        fps: Number(opts.fps) || 8,
        baseFacingRight: opts.baseFacingRight !== false,
        autoRemoveBg: opts.autoRemoveBg !== false,
        onTopBar: opts.onTopBar !== false,
        level,
        xp: Math.max(0, Number(opts.xp) || 0),
        hunger: Math.min(100, Math.max(20, Number(opts.hunger ?? 90))),
        mood: Math.min(100, Math.max(20, Number(opts.mood ?? 95))),
        energy: Math.min(100, Math.max(20, Number(opts.energy ?? 95))),
        wins: Math.max(0, Number(opts.wins) || 0),
        losses: Math.max(0, Number(opts.losses) || 0),
        petsCount: Math.max(0, Number(opts.petsCount) || 0),
        treatsFed: Math.max(0, Number(opts.treatsFed) || 0),
        stance,
        trait,
        relicIds,
        equippedSkills: Array.isArray(opts.equippedSkills) ? opts.equippedSkills : [],
    };

    draft.equippedSkills = normalizeSkillLoadout(draft, globalUnlockedPool);
    return draft;
}

/**
 * Generate ready-to-copy 12-Row x 4-Column AI Sprite Sheet Prompts (Chinese & English)
 * specifically engineered for 2.5D Z-Axis Tactical Combat, Free-Roam 2.0 Parkour,
 * and Cross-Class Custom Skill Loadouts!
 */
export function buildAiPetPrompt(subjectDesc, artStyle = '16-bit 精致像素画', bgType = '纯白背景 #FFFFFF') {
    const subject = (subjectDesc || '一只戴着魔法护目镜的可爱小狐狸').trim();
    const bgEn = bgType.includes('绿') ? 'solid pure chroma green (#00FF00)' : 'solid pure flat white (#FFFFFF)';

    const zh = [
        `请为我生成一张严格对齐网格的游戏角色像素精灵图（Sprite Sheet），单张 PNG 图片：`,
        `【角色设定】：${subject}，${artStyle}，带清晰 1px 深色像素轮廓描边，全程统一面朝右侧（Side-view facing RIGHT），所有帧角色体型大小与脚底站立基线保持严格一致。`,
        `【背景要求】：${bgType}（纯平单色背景，严禁地面投影、严禁棋盘格、严禁渐变光晕、严禁网格分割线或文字标签），以便边缘洪水填充自动抠图。`,
        `【严格网格布局】：共 12 行 × 4 列（总计 48 个等大正方形画格，建议分辨率 512×1536 或 768×2304，每行从左到右为 4 帧连续动作）：`,
        `  • 第 1 行 (Row 0 - idle)：待机呼吸、眨眼、尾巴或衣角轻微摆动；`,
        `  • 第 2 行 (Row 1 - walk)：轻快向前漫步的 4 帧循环（兼容 2.5D 纵深走位）；`,
        `  • 第 3 行 (Row 2 - run)：全力加速冲刺与腾空跨窗跑酷跃起的 4 帧循环；`,
        `  • 第 4 行 (Row 3 - sleep)：篝火露营蜷缩酣睡、平稳呼吸起伏；`,
        `  • 第 5 行 (Row 4 - happy)：挖到宝藏/对战胜利的欢呼雀跃庆祝动作；`,
        `  • 第 6 行 (Row 5 - drag)：被鼠标拎起或抓钩摆荡时的四肢悬空摇晃姿态；`,
        `  • 第 7 行 (Row 6 - attack)：近战体术四连击（垫步蓄力 -> 挥砍/爪击 -> 突刺上挑 -> 腾空重击）；`,
        `  • 第 8 行 (Row 7 - sneak)：压低身姿蹑手蹑脚潜行 / 战术侧闪翻滚；`,
        `  • 第 9 行 (Row 8 - cast)：【重要·跨流派通用施法帧】仅绘制角色结印/挥爪凝聚微光并向前推掌释放的施法体态，严禁在画格内画死特定颜色的巨大火球或冰锥（技能特效由游戏引擎动态叠加，确保搭配冰/火/雷/暗任意技能都不穿帮）；`,
        `  • 第 10 行 (Row 9 - hurt)：受击后仰硬直、闭眼头顶冒小星星；`,
        `  • 第 11 行 (Row 10 - crouch)：压低身躯原地急速下蹲（用于躲避高处飞行道具与蓄力反击）；`,
        `  • 第 12 行 (Row 11 - guard)：双臂交叉稳稳架起防御/精准弹反（Parry）格挡架势。`,
    ].join('\n');

    const en = [
        `2D game character sprite sheet, ${subject}, ${artStyle.includes('Q版') ? 'cute chibi pixel art' : 'crisp 16-bit retro game pixel art'}, clean 1px dark outline, side-view facing RIGHT consistently across all 48 frames, consistent character scale and ground baseline.`,
        `STRICT GRID LAYOUT: Exactly 12 rows by 4 columns (48 equal square cells in an invisible grid, NO visible grid lines, NO text labels, NO ground drop shadows).`,
        `BACKGROUND: Completely ${bgEn} uniform flat background for automatic flood-fill chroma cutout.`,
        `ROW-BY-ROW ANIMATION SPECIFICATION (4 frames per row, top to bottom):`,
        `Row 1 (Idle): standing breathing, blinking, subtle tail/body bob.`,
        `Row 2 (Walk): 4-frame smooth walking cycle facing right.`,
        `Row 3 (Run/Parkour Leap): 4-frame energetic dash sprint and mid-air parkour jump.`,
        `Row 4 (Sleep): curled up sleeping peacefully by campfire.`,
        `Row 5 (Happy/Loot): joyful jumping celebration pose.`,
        `Row 6 (Dragged/Grapple Swing): picked up from scruff or swinging from grappling line, limbs dangling adorably.`,
        `Row 7 (Melee Combo): 4-frame martial combo — wind-up, slash/claw, thrust uppercut, heavy slam.`,
        `Row 8 (Sneak/Evade): crouched low stealth tiptoeing and tactical dodge weave.`,
        `Row 9 (Universal Skill Cast): IMPORTANT — draw ONLY the character channeling a subtle neutral white/gold hand glow and thrusting palms forward to cast; DO NOT draw giant fireballs or ice projectiles inside the cell (external VFX are rendered dynamically for cross-element skill loadouts).`,
        `Row 10 (Hurt/Stagger): knocked back wincing with tiny dizzy stars.`,
        `Row 11 (Crouch Duck): ducking flat and low to evade overhead projectiles.`,
        `Row 12 (Guard/Parry): braced defensive guard stance with crossed arms ready to parry.`,
    ].join('\n');

    return { zh, en };
}

/**
 * Multi-Pet Roster, Economy, Custom Skill Pool, Relic Inventory, Mystery Egg & Achievement Manager.
 */
export class RosterManager {
    constructor(settings, callbacks = {}) {
        this._settings = settings;
        this._callbacks = callbacks;

        this.pets = [];
        this.primaryPetId = '';
        this.secondaryPetId = '';
        this.coins = 85;
        this.unlockedSkillPool = [];
        this.relicInventory = [];
        this.activeEgg = null; // { progress: 0..100, presetId: 'dragon', costPaid: 60 }
        this.unlockedAchievements = [];
        this.equippedTitle = '';
        this.stats = {
            totalWins: 0,
            parries: 0,
            reactions: 0,
            bossKills: 0,
            eggsHatched: 0,
            totalCoinsEarned: 85,
            focusCompleted: 0,
            treasuresDug: 0,
        };

        this._lastSavedJson = '';
        this._loadFromSettings();

        this._settingsSig = this._settings.connect('changed::roster-json', () => {
            const raw = this._settings.get_string('roster-json');
            if (raw !== this._lastSavedJson) {
                this._loadFromSettings();
                this._callbacks.onRosterStructureChanged?.();
            }
        });

        // Passive companion & egg incubation tick every 25s
        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 25, () => {
            this._onCompanionTick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        if (this._tickId) {
            GLib.Source.remove(this._tickId);
            this._tickId = 0;
        }
        if (this._settingsSig && this._settings) {
            this._settings.disconnect(this._settingsSig);
            this._settingsSig = 0;
        }
        this.save();
    }

    _loadFromSettings() {
        try {
            const raw = this._settings.get_string('roster-json');
            if (raw) {
                const parsed = JSON.parse(raw);
                this.coins = Math.max(0, Number(parsed.coins ?? 85));
                this.unlockedSkillPool = Array.isArray(parsed.unlockedSkillPool)
                    ? parsed.unlockedSkillPool.filter(id => Boolean(SKILL_CATALOG[id]))
                    : [];
                this.relicInventory = Array.isArray(parsed.relicInventory)
                    ? parsed.relicInventory.filter(id => Boolean(RELIC_CATALOG[id]))
                    : [];
                this.activeEgg = parsed.activeEgg && typeof parsed.activeEgg === 'object'
                    ? {
                        progress: Math.min(100, Math.max(0, Number(parsed.activeEgg.progress) || 0)),
                        presetId: parsed.activeEgg.presetId || 'dragon',
                    }
                    : null;
                this.unlockedAchievements = Array.isArray(parsed.unlockedAchievements)
                    ? parsed.unlockedAchievements
                    : [];
                this.equippedTitle = String(parsed.equippedTitle || '');
                this.stats = {
                    totalWins: Number(parsed.stats?.totalWins) || 0,
                    parries: Number(parsed.stats?.parries) || 0,
                    reactions: Number(parsed.stats?.reactions) || 0,
                    bossKills: Number(parsed.stats?.bossKills) || 0,
                    eggsHatched: Number(parsed.stats?.eggsHatched) || 0,
                    totalCoinsEarned: Math.max(this.coins, Number(parsed.stats?.totalCoinsEarned) || 85),
                    focusCompleted: Number(parsed.stats?.focusCompleted) || 0,
                    treasuresDug: Number(parsed.stats?.treasuresDug) || 0,
                };

                if (Array.isArray(parsed.pets) && parsed.pets.length > 0) {
                    this.pets = parsed.pets.map(p => createNewPetRecord(p, this.unlockedSkillPool));
                    this.primaryPetId = parsed.primaryPetId || this.pets[0].id;
                    if (!this.pets.some(p => p.id === this.primaryPetId))
                        this.primaryPetId = this.pets[0].id;
                    this.secondaryPetId = parsed.secondaryPetId || '';
                    if (this.secondaryPetId === this.primaryPetId || !this.pets.some(p => p.id === this.secondaryPetId)) {
                        const fallbackSec = this.pets.find(p => p.id !== this.primaryPetId);
                        this.secondaryPetId = fallbackSec ? fallbackSec.id : '';
                    }
                    this._syncUnlockedPoolFromRoster();
                    this._lastSavedJson = raw;
                    return;
                }
            }
        } catch (_e) {
            // Fallback to default starter
        }

        const starter = createNewPetRecord({
            name: this._settings.get_string('pet-name') || '团子',
            presetId: 'cat',
            archetype: 'martial',
        }, []);
        this.pets = [starter];
        this.primaryPetId = starter.id;
        this.secondaryPetId = '';
        this.relicInventory = ['fang_charm'];
        this._syncUnlockedPoolFromRoster();
        this.save();
    }

    /**
     * Automatically add any skill unlocked by owned pets' levels into the shared global pool
     * so siblings can cross-equip each other's mastered school techniques!
     */
    _syncUnlockedPoolFromRoster() {
        const poolSet = new Set(this.unlockedSkillPool);
        for (const pet of this.pets) {
            const schoolSkills = getSkillsBySchool(pet.archetype);
            for (const sk of schoolSkills) {
                if (!sk.secretScroll && sk.unlockLv <= pet.level)
                    poolSet.add(sk.id);
            }
        }
        this.unlockedSkillPool = Array.from(poolSet);
    }

    save() {
        try {
            const payload = JSON.stringify({
                primaryPetId: this.primaryPetId,
                secondaryPetId: this.secondaryPetId,
                coins: this.coins,
                unlockedSkillPool: this.unlockedSkillPool,
                relicInventory: this.relicInventory,
                activeEgg: this.activeEgg,
                unlockedAchievements: this.unlockedAchievements,
                equippedTitle: this.equippedTitle,
                stats: this.stats,
                pets: this.pets,
            });
            this._lastSavedJson = payload;
            if (this._settings.get_string('roster-json') !== payload)
                this._settings.set_string('roster-json', payload);
        } catch (_e) {
            // Ignore write errors
        }
    }

    getOwnerName() {
        const custom = this._settings.get_string('owner-name').trim();
        if (custom)
            return custom;
        return GLib.get_user_name() || 'Player';
    }

    getEquippedTitleBadge() {
        if (!this.equippedTitle)
            return '';
        const ach = ACHIEVEMENT_CATALOG.find(a => a.id === this.equippedTitle);
        return ach ? ach.title : '';
    }

    setEquippedTitle(achId) {
        if (!achId || this.unlockedAchievements.includes(achId)) {
            this.equippedTitle = achId || '';
            this.save();
            this._callbacks.onStatsUpdated?.();
            return true;
        }
        return false;
    }

    getPrimaryPet() {
        return this.pets.find(p => p.id === this.primaryPetId) || this.pets[0];
    }

    getSecondaryPet() {
        if (this.pets.length < 2)
            return null;
        if (this.secondaryPetId && this.secondaryPetId !== this.primaryPetId) {
            const found = this.pets.find(p => p.id === this.secondaryPetId);
            if (found)
                return found;
        }
        return this.pets.find(p => p.id !== this.primaryPetId) || null;
    }

    setSecondaryPet(petId) {
        if (!petId) {
            this.secondaryPetId = '';
            this.save();
            this._callbacks.onStatsUpdated?.();
            return true;
        }
        const pet = this.getPetById(petId);
        if (!pet || pet.id === this.primaryPetId)
            return false;
        this.secondaryPetId = pet.id;
        this.save();
        this._callbacks.onStatsUpdated?.();
        return true;
    }

    getPetById(id) {
        return this.pets.find(p => p.id === id) || null;
    }

    setPrimaryPet(petId) {
        const pet = this.getPetById(petId);
        if (!pet)
            return false;
        this.primaryPetId = pet.id;
        if (this.secondaryPetId === pet.id) {
            const nextSec = this.pets.find(p => p.id !== pet.id);
            this.secondaryPetId = nextSec ? nextSec.id : '';
        }
        pet.onTopBar = true;
        this.save();
        this._callbacks.onRosterStructureChanged?.();
        return true;
    }

    setPetVisible(petId, visible) {
        const pet = this.getPetById(petId);
        if (!pet)
            return false;
        const nextVal = Boolean(visible);
        if (Boolean(pet.onTopBar !== false) === nextVal)
            return true;
        pet.onTopBar = nextVal;
        this.save();
        this._callbacks.onRosterStructureChanged?.();
        return true;
    }

    canAdoptMore() {
        return true;
    }

    adoptPet(opts = {}) {
        const newPet = createNewPetRecord(opts, this.unlockedSkillPool);
        this.pets.push(newPet);
        if (!this.secondaryPetId && newPet.id !== this.primaryPetId)
            this.secondaryPetId = newPet.id;
        this._syncUnlockedPoolFromRoster();
        this._checkAchievements();
        this.save();
        this._callbacks.onPetAdopted?.(newPet);
        this._callbacks.onRosterStructureChanged?.();
        return newPet;
    }

    releasePet(petId) {
        const idx = this.pets.findIndex(p => p.id === petId);
        if (idx < 0)
            return null;

        const [released] = this.pets.splice(idx, 1);

        if (this.pets.length === 0) {
            const fresh = createNewPetRecord({ name: '新伙伴', presetId: 'cat', archetype: 'martial' }, this.unlockedSkillPool);
            this.pets.push(fresh);
        }
        if (!this.pets.some(p => p.id === this.primaryPetId))
            this.primaryPetId = this.pets[0].id;
        if (!this.pets.some(p => p.id === this.secondaryPetId) || this.secondaryPetId === this.primaryPetId) {
            const nextSec = this.pets.find(p => p.id !== this.primaryPetId);
            this.secondaryPetId = nextSec ? nextSec.id : '';
        }

        this.save();
        this._callbacks.onPetReleased?.(released);
        this._callbacks.onRosterStructureChanged?.();
        return released;
    }

    // =========================================================================
    // Economy, Relics, Custom Skill Scrolls & Zero-Occlusion Mystery Egg
    // =========================================================================
    addCoins(amount, isTreasure = false) {
        const gain = Math.max(0, Math.round(Number(amount) || 0));
        if (gain <= 0)
            return this.coins;
        this.coins += gain;
        this.stats.totalCoinsEarned = (this.stats.totalCoinsEarned || 0) + gain;
        if (isTreasure)
            this.stats.treasuresDug = (this.stats.treasuresDug || 0) + 1;
        this._checkAchievements();
        this.save();
        this._callbacks.onStatsUpdated?.();
        return this.coins;
    }

    spendCoins(cost) {
        const c = Math.max(0, Math.round(Number(cost) || 0));
        if (this.coins < c)
            return false;
        this.coins -= c;
        this.save();
        this._callbacks.onStatsUpdated?.();
        return true;
    }

    rollRandomRelic(cost = 45) {
        if (!this.spendCoins(cost))
            return { ok: false, reason: 'INSUFFICIENT_COINS' };

        const unowned = ALL_RELIC_IDS.filter(id => !this.relicInventory.includes(id));
        if (unowned.length === 0) {
            this.addCoins(Math.round(cost * 0.6));
            return { ok: false, reason: 'ALL_OWNED' };
        }

        const pickedId = unowned[Math.floor(Math.random() * unowned.length)];
        this.relicInventory.push(pickedId);

        // Auto-equip to primary pet if it has an open relic slot (< 3)!
        const primary = this.getPrimaryPet();
        if (primary && Array.isArray(primary.relicIds) && primary.relicIds.length < 3 && !primary.relicIds.includes(pickedId)) {
            primary.relicIds.push(pickedId);
        }

        this._checkAchievements();
        this.save();
        this._callbacks.onStatsUpdated?.();
        return { ok: true, relic: RELIC_CATALOG[pickedId] };
    }

    unlockRandomSkillScroll(cost = 50) {
        const locked = ALL_SKILL_IDS.filter(id => !this.unlockedSkillPool.includes(id));
        if (locked.length === 0)
            return { ok: false, reason: 'ALL_UNLOCKED' };
        if (!this.spendCoins(cost))
            return { ok: false, reason: 'INSUFFICIENT_COINS' };

        const pickedId = locked[Math.floor(Math.random() * locked.length)];
        this.unlockedSkillPool.push(pickedId);
        this._checkAchievements();
        this.save();
        this._callbacks.onStatsUpdated?.();
        return { ok: true, skill: SKILL_CATALOG[pickedId] };
    }

    equipPetSkills(petId, skillIds) {
        const pet = this.getPetById(petId);
        if (!pet)
            return false;
        pet.equippedSkills = skillIds;
        pet.equippedSkills = normalizeSkillLoadout(pet, this.unlockedSkillPool);
        this.save();
        this._callbacks.onStatsUpdated?.();
        return true;
    }

    applyRecommendedSkills(petId, style = 'combo') {
        const pet = this.getPetById(petId);
        if (!pet)
            return [];
        const partner = pet.id === this.primaryPetId ? this.getSecondaryPet() : this.getPrimaryPet();
        pet.equippedSkills = recommendSkillLoadout(pet, style, this.unlockedSkillPool, partner?.archetype || null);
        this.save();
        this._callbacks.onStatsUpdated?.();
        return pet.equippedSkills;
    }

    equipPetRelics(petId, relicIds) {
        const pet = this.getPetById(petId);
        if (!pet)
            return false;
        const ownedSet = new Set(this.relicInventory);
        pet.relicIds = (Array.isArray(relicIds) ? relicIds : [])
            .filter(id => ownedSet.has(id) && RELIC_CATALOG[id])
            .slice(0, 3);
        this.save();
        this._callbacks.onStatsUpdated?.();
        return true;
    }

    setPetStance(petId, stanceId) {
        const pet = this.getPetById(petId);
        if (!pet || !TACTICAL_STANCES[stanceId])
            return false;
        pet.stance = stanceId;
        this.save();
        this._callbacks.onStatsUpdated?.();
        return true;
    }

    startMysteryEgg(cost = 60) {
        if (this.activeEgg)
            return { ok: false, reason: 'ALREADY_INCUBATING' };
        if (!this.spendCoins(cost))
            return { ok: false, reason: 'INSUFFICIENT_COINS' };

        const speciesChoice = SPECIES_PRESETS[Math.floor(Math.random() * SPECIES_PRESETS.length)];
        this.activeEgg = {
            progress: 5,
            presetId: speciesChoice.id,
        };
        this.save();
        this._callbacks.onEggUpdated?.(this.activeEgg);
        this._callbacks.onStatsUpdated?.();
        return { ok: true, egg: this.activeEgg };
    }

    advanceEggProgress(deltaPct = 8) {
        if (!this.activeEgg)
            return null;
        this.activeEgg.progress = Math.min(100, Math.round(this.activeEgg.progress + deltaPct));
        if (this.activeEgg.progress >= 100) {
            return this.hatchActiveEgg();
        }
        this.save();
        this._callbacks.onEggUpdated?.(this.activeEgg);
        this._callbacks.onStatsUpdated?.();
        return null;
    }

    hatchActiveEgg() {
        if (!this.activeEgg)
            return null;
        const presetId = this.activeEgg.presetId || 'dragon';
        const presetMeta = SPECIES_PRESETS.find(p => p.id === presetId) || SPECIES_PRESETS[0];
        const traitKeys = Object.keys(EGG_TRAITS);
        const pickedTrait = traitKeys[Math.floor(Math.random() * traitKeys.length)];
        const archKeys = Object.keys(CLASS_ARCHETYPES);
        const pickedArch = archKeys[Math.floor(Math.random() * archKeys.length)];

        this.activeEgg = null;
        this.stats.eggsHatched = (this.stats.eggsHatched || 0) + 1;

        const baby = this.adoptPet({
            name: `星蛋·${presetMeta.defaultName}`,
            presetId,
            archetype: pickedArch,
            trait: pickedTrait,
            level: 2,
        });

        this._checkAchievements();
        this.save();
        this._callbacks.onEggHatched?.(baby, EGG_TRAITS[pickedTrait]);
        this._callbacks.onEggUpdated?.(null);
        return baby;
    }

    // =========================================================================
    // XP, Combat Telemetry, Focus Dungeon & Achievements
    // =========================================================================
    grantXp(petId, baseAmount) {
        const pet = petId ? this.getPetById(petId) : this.getPrimaryPet();
        if (!pet)
            return null;

        const moodBonus = pet.mood >= 80 ? 1.25 : 1.0;
        const gain = Math.max(1, Math.round(baseAmount * moodBonus));
        pet.xp += gain;

        const arch = getArchetype(pet.archetype);
        const newlyUnlockedSkills = [];
        let leveledUp = false;
        let lvGuard = 0;

        while (pet.xp >= xpRequiredForLevel(pet.level) && lvGuard < 50) {
            pet.xp -= xpRequiredForLevel(pet.level);
            pet.level += 1;
            lvGuard += 1;
            leveledUp = true;
            for (const sk of arch.skills) {
                if (!sk.secretScroll && sk.unlockLv === pet.level) {
                    newlyUnlockedSkills.push(sk);
                    if (!this.unlockedSkillPool.includes(sk.id))
                        this.unlockedSkillPool.push(sk.id);
                }
            }
        }

        if (leveledUp) {
            pet.equippedSkills = normalizeSkillLoadout(pet, this.unlockedSkillPool);
            this._callbacks.onLevelUp?.(pet, newlyUnlockedSkills);
        }

        this.save();
        this._callbacks.onStatsUpdated?.();
        return { leveledUp, newlyUnlockedSkills };
    }

    grantAllActivePetsXp(amount) {
        for (const pet of this.pets) {
            if (pet.onTopBar !== false)
                this.grantXp(pet.id, amount);
        }
    }

    recordPetted(petId) {
        const pet = this.getPetById(petId) || this.getPrimaryPet();
        if (!pet)
            return;
        pet.petsCount = (pet.petsCount || 0) + 1;
        pet.mood = Math.min(100, pet.mood + 6);
        this.grantXp(pet.id, 6);
        if (this.activeEgg)
            this.advanceEggProgress(4);
    }

    recordFed(petId, hungerBoost = 25) {
        const pet = this.getPetById(petId) || this.getPrimaryPet();
        if (!pet)
            return;
        pet.treatsFed = (pet.treatsFed || 0) + 1;
        pet.hunger = Math.min(100, pet.hunger + hungerBoost);
        pet.mood = Math.min(100, pet.mood + 10);
        pet.energy = Math.min(100, pet.energy + 8);
        this.grantXp(pet.id, 14);
    }

    recordBattleOutcome(petIdsOrSingle, won, telemetry = {}) {
        const ids = Array.isArray(petIdsOrSingle) ? petIdsOrSingle : [petIdsOrSingle];
        const validPets = ids.map(id => this.getPetById(id)).filter(Boolean);
        if (validPets.length === 0 && this.getPrimaryPet())
            validPets.push(this.getPrimaryPet());

        if (telemetry.parries)
            this.stats.parries = (this.stats.parries || 0) + telemetry.parries;
        if (telemetry.reactions)
            this.stats.reactions = (this.stats.reactions || 0) + telemetry.reactions;
        if (won && telemetry.isBossRaid)
            this.stats.bossKills = (this.stats.bossKills || 0) + 1;

        let coinReward = won ? (telemetry.isBossRaid ? 48 : 22) : 8;
        let droppedSkill = null;
        let droppedRelic = null;

        if (won) {
            this.stats.totalWins = (this.stats.totalWins || 0) + 1;
            // Chance to comprehend opponent school skill or find boss relic!
            if (Math.random() < (telemetry.isBossRaid ? 0.55 : 0.25)) {
                const locked = ALL_SKILL_IDS.filter(id => !this.unlockedSkillPool.includes(id));
                if (locked.length > 0) {
                    const sid = locked[Math.floor(Math.random() * locked.length)];
                    this.unlockedSkillPool.push(sid);
                    droppedSkill = SKILL_CATALOG[sid];
                }
            }
            if (telemetry.isBossRaid && Math.random() < 0.60) {
                const unownedRelics = ALL_RELIC_IDS.filter(id => !this.relicInventory.includes(id));
                if (unownedRelics.length > 0) {
                    const rid = unownedRelics[Math.floor(Math.random() * unownedRelics.length)];
                    this.relicInventory.push(rid);
                    droppedRelic = RELIC_CATALOG[rid];
                }
            }
        }

        for (const pet of validPets) {
            if (won) {
                pet.wins = (pet.wins || 0) + 1;
                pet.mood = Math.min(100, pet.mood + 12);
                this.grantXp(pet.id, telemetry.isBossRaid ? 52 : 34);
            } else {
                pet.losses = (pet.losses || 0) + 1;
                this.grantXp(pet.id, 18);
            }
        }

        this.addCoins(coinReward, false);
        if (this.activeEgg)
            this.advanceEggProgress(won ? 18 : 8);

        this._checkAchievements();
        this.save();
        return { coinReward, droppedSkill, droppedRelic };
    }

    recordFocusSessionCompleted() {
        this.stats.focusCompleted = (this.stats.focusCompleted || 0) + 1;
        this.addCoins(55, false);
        this.grantAllActivePetsXp(45);
        if (this.activeEgg)
            this.advanceEggProgress(35);

        let bonusRelic = null;
        const unownedRelics = ALL_RELIC_IDS.filter(id => !this.relicInventory.includes(id));
        if (unownedRelics.length > 0) {
            const rid = unownedRelics[Math.floor(Math.random() * unownedRelics.length)];
            this.relicInventory.push(rid);
            bonusRelic = RELIC_CATALOG[rid];
        }
        this._checkAchievements();
        this.save();
        return { coins: 55, bonusRelic };
    }

    _checkAchievements() {
        const secretScrollsOwned = this.unlockedSkillPool.filter(id => SKILL_CATALOG[id]?.secretScroll).length;
        const summary = {
            totalWins: this.stats.totalWins || 0,
            parries: this.stats.parries || 0,
            reactions: this.stats.reactions || 0,
            bossKills: this.stats.bossKills || 0,
            eggsHatched: this.stats.eggsHatched || 0,
            totalCoinsEarned: this.stats.totalCoinsEarned || 0,
            relicCount: this.relicInventory.length,
            scrollCount: secretScrollsOwned,
            focusCompleted: this.stats.focusCompleted || 0,
            petCount: this.pets.length,
        };

        const newly = findNewlyUnlockedAchievements(summary, this.unlockedAchievements);
        if (newly.length > 0) {
            for (const ach of newly) {
                this.unlockedAchievements.push(ach.id);
                if (!this.equippedTitle)
                    this.equippedTitle = ach.id;
                this._callbacks.onAchievementUnlocked?.(ach);
            }
        }
    }

    _onCompanionTick() {
        for (const pet of this.pets) {
            pet.hunger = Math.max(35, Number((pet.hunger - 0.35).toFixed(1)));
            pet.energy = Math.min(100, Math.max(45, Number((pet.energy + 0.4).toFixed(1))));
            pet.mood = Math.min(100, Math.max(55, Number((pet.mood + (pet.hunger > 50 ? 0.25 : -0.15)).toFixed(1))));
            if (pet.onTopBar !== false)
                this.grantXp(pet.id, 2);
        }
        if (this.activeEgg)
            this.advanceEggProgress(4);
        this.save();
    }
}
