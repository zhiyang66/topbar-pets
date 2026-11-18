import GLib from 'gi://GLib';

export const MAX_ADOPTED_PETS = 3;

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
        desc: '近身搏击宗师，高攻高速高连击，擅长突进爪击与裂地霸斩。',
        baseHp: 430, hpPerLv: 68,
        baseAtk: 17, atkPerLv: 3.1,
        baseSpd: 1.15, critRate: 0.22,
        skills: [
            { id: 'm1', unlockLv: 1, name: '疾风连爪', type: 'melee', power: 1.0, cd: 1.9, fxMain: 'melee/claw-swipe', fxHit: 'explosions/cartoon-pow' },
            { id: 'm2', unlockLv: 2, name: '旋风双斩', type: 'melee', power: 1.32, cd: 3.6, fxMain: 'melee/double-slash', fxHit: 'impacts/crit-hit' },
            { id: 'm3', unlockLv: 4, name: '裂地重锤', type: 'leap_melee', power: 1.58, cd: 5.4, knockback: 26, fxMain: 'melee/hammer-smash', fxHit: 'impacts/ground-slam' },
            { id: 'm4', unlockLv: 6, name: '无影乱刃', type: 'melee', power: 1.72, cd: 6.5, lifesteal: 0.22, fxMain: 'melee/dagger-flurry', fxHit: 'explosions/cartoon-pow' },
            { id: 'm5', unlockLv: 9, name: '破甲大旋风', type: 'leap_melee', power: 2.05, cd: 7.8, knockback: 32, fxMain: 'melee/spin-slash', fxHit: 'impacts/crit-hit' },
            { id: 'm6', unlockLv: 12, name: '奥义·天地霸斩', type: 'ultimate', power: 2.75, cd: 12.0, knockback: 42, fxCast: 'lightning/charge-up', fxMain: 'melee/heavy-cleave', fxHit: 'explosions/big-explosion' },
        ],
    },
    fire: {
        id: 'fire',
        name: '烈焰魔导',
        badge: '🔥 烈焰',
        desc: '远程与爆发兼备的火焰法师，擅长火球轰炸、龙炎吐息与陨星天降。',
        baseHp: 395, hpPerLv: 62,
        baseAtk: 19, atkPerLv: 3.4,
        baseSpd: 1.05, critRate: 0.20,
        skills: [
            { id: 'f1', unlockLv: 1, name: '烈火升龙拳', type: 'melee', power: 1.02, cd: 2.0, fxMain: 'melee/uppercut', fxHit: 'explosions/cartoon-pow' },
            { id: 'f2', unlockLv: 2, name: '爆裂火球', type: 'projectile', power: 1.32, cd: 3.4, fxMain: 'fire/fireball', fxHit: 'explosions/cartoon-pow' },
            { id: 'f3', unlockLv: 4, name: '龙炎吐息', type: 'ranged_instant', power: 1.58, cd: 5.2, fxMain: 'fire/fire-breath', fxHit: 'impacts/crit-hit' },
            { id: 'f4', unlockLv: 6, name: '炽热火环护体', type: 'buff_shield', power: 0.85, healPct: 0.12, shieldSec: 4.0, cd: 7.8, fxMain: 'fire/fire-ring' },
            { id: 'f5', unlockLv: 9, name: '熔岩火柱喷发', type: 'ranged_instant', power: 2.05, cd: 7.6, knockback: 24, fxMain: 'fire/flame-pillar', fxHit: 'impacts/crit-hit' },
            { id: 'f6', unlockLv: 12, name: '奥义·业火陨星龙卷', type: 'ultimate', power: 2.90, cd: 12.5, fxCast: 'arcane/magic-circle-cast', fxMain: 'fire/meteor', fxHit: 'fire/fire-tornado' },
        ],
    },
    ice: {
        id: 'ice',
        name: '凛冬冰霜',
        badge: '❄️ 冰霜',
        desc: '控场与坚韧兼修的寒冰术士，冰枪减速、冰晶护甲与暴风雪控场。',
        baseHp: 465, hpPerLv: 74,
        baseAtk: 15.5, atkPerLv: 2.9,
        baseSpd: 1.0, critRate: 0.16,
        skills: [
            { id: 'i1', unlockLv: 1, name: '霜刃挥击', type: 'melee', power: 1.0, cd: 2.0, fxMain: 'melee/claw-swipe', fxHit: 'ice/ice-crystal' },
            { id: 'i2', unlockLv: 2, name: '寒冰穿刺枪', type: 'projectile', power: 1.30, cd: 3.5, slowSec: 2.4, fxMain: 'ice/ice-lance', fxHit: 'ice/ice-crystal' },
            { id: 'i3', unlockLv: 4, name: '极寒霜息', type: 'ranged_instant', power: 1.50, cd: 5.2, slowSec: 2.8, fxMain: 'ice/frost-breath' },
            { id: 'i4', unlockLv: 6, name: '冰晶守护盾', type: 'buff_shield', power: 0.0, healPct: 0.15, shieldSec: 4.8, cd: 8.2, fxMain: 'ice/ice-crystal', fxHit: 'impacts/shield-block' },
            { id: 'i5', unlockLv: 9, name: '寒冰新星地刺', type: 'ranged_instant', power: 1.95, cd: 7.4, slowSec: 3.2, fxMain: 'ice/frost-nova', fxHit: 'ice/ice-spikes' },
            { id: 'i6', unlockLv: 12, name: '奥义·绝对零度漩涡', type: 'ultimate', power: 2.70, cd: 12.2, slowSec: 4.5, fxCast: 'arcane/magic-circle-cast', fxMain: 'ice/blizzard-vortex', fxHit: 'impacts/crit-hit' },
        ],
    },
    storm: {
        id: 'storm',
        name: '雷霆幻影',
        badge: '⚡ 雷霆',
        desc: '极致速度与暴击刺客，幻影瞬移绕后、高压电浆与九霄天雷轰顶。',
        baseHp: 385, hpPerLv: 60,
        baseAtk: 18, atkPerLv: 3.3,
        baseSpd: 1.25, critRate: 0.30,
        skills: [
            { id: 's1', unlockLv: 1, name: '电弧疾袭', type: 'melee', power: 1.02, cd: 1.8, fxMain: 'lightning/spark-arc', fxHit: 'lightning/spark-arc' },
            { id: 's2', unlockLv: 2, name: '高压电浆球', type: 'projectile', power: 1.32, cd: 3.4, fxMain: 'lightning/plasma-ball', fxHit: 'impacts/crit-hit' },
            { id: 's3', unlockLv: 4, name: '幻影瞬步背刺', type: 'blink_strike', power: 1.62, cd: 5.5, fxCast: 'arcane/blink-out', fxMain: 'arcane/blink-in', fxHit: 'melee/double-slash' },
            { id: 's4', unlockLv: 6, name: '超载雷能激活', type: 'buff_shield', power: 0.0, healPct: 0.12, shieldSec: 3.5, cd: 7.6, fxMain: 'lightning/charge-up' },
            { id: 's5', unlockLv: 9, name: '狂暴连锁闪电', type: 'ranged_instant', power: 2.08, cd: 7.2, fxMain: 'lightning/chain-lightning', fxHit: 'impacts/crit-hit' },
            { id: 's6', unlockLv: 12, name: '奥义·九霄雷霆天谴', type: 'ultimate', power: 2.95, cd: 12.5, fxCast: 'lightning/thunderclap', fxMain: 'lightning/lightning-strike', fxHit: 'explosions/big-explosion' },
        ],
    },
    arcane: {
        id: 'arcane',
        name: '星界奥术',
        badge: '🔮 奥术',
        desc: '掌控次元与群星的秘法大师，奥术飞弹、时间凝滞、黑洞与星陨光束。',
        baseHp: 405, hpPerLv: 63,
        baseAtk: 18.5, atkPerLv: 3.4,
        baseSpd: 1.08, critRate: 0.23,
        skills: [
            { id: 'a1', unlockLv: 1, name: '秘法法球冲击', type: 'projectile', power: 1.02, cd: 2.0, fxMain: 'arcane/arcane-orb', fxHit: 'explosions/cartoon-pow' },
            { id: 'a2', unlockLv: 2, name: '追踪奥术飞弹', type: 'projectile', power: 1.35, cd: 3.5, fxMain: 'arcane/arcane-missiles', fxHit: 'impacts/crit-hit' },
            { id: 'a3', unlockLv: 4, name: '暗影虚空爆破', type: 'ranged_instant', power: 1.60, cd: 5.3, fxMain: 'shadow/dark-explosion' },
            { id: 'a4', unlockLv: 6, name: '时间凝滞领域', type: 'ranged_instant', power: 1.25, slowSec: 3.8, cd: 7.8, fxMain: 'arcane/time-stop' },
            { id: 'a5', unlockLv: 9, name: '深渊引力黑洞', type: 'ranged_instant', power: 2.10, cd: 7.8, fxMain: 'shadow/black-hole', fxHit: 'impacts/crit-hit' },
            { id: 'a6', unlockLv: 12, name: '奥义·星陨毁灭光束', type: 'ultimate', power: 3.0, cd: 12.8, fxCast: 'arcane/magic-circle-cast', fxMain: 'arcane/star-fall', fxHit: 'arcane/arcane-beam' },
        ],
    },
    holy: {
        id: 'holy',
        name: '圣光自然',
        badge: '✨ 圣光',
        desc: '生生不息的守护贤者，拥有全流派最强回血治愈、神圣护盾与天罚光柱。',
        baseHp: 485, hpPerLv: 78,
        baseAtk: 15, atkPerLv: 2.8,
        baseSpd: 1.02, critRate: 0.18,
        skills: [
            { id: 'h1', unlockLv: 1, name: '荆棘藤鞭抽击', type: 'melee', power: 1.0, cd: 1.9, fxMain: 'nature/vine-whip', fxHit: 'explosions/cartoon-pow' },
            { id: 'h2', unlockLv: 2, name: '翠绿飞叶风暴', type: 'projectile', power: 1.28, cd: 3.5, fxMain: 'nature/leaf-storm', fxHit: 'nature/healing-bloom' },
            { id: 'h3', unlockLv: 4, name: '大地岩刺突袭', type: 'ranged_instant', power: 1.55, cd: 5.2, knockback: 22, fxMain: 'nature/earth-spike' },
            { id: 'h4', unlockLv: 6, name: '复苏治愈花环', type: 'buff_shield', power: 0.0, healPct: 0.18, shieldSec: 3.0, cd: 8.2, fxMain: 'nature/healing-bloom', fxHit: 'holy/heal-aoe' },
            { id: 'h5', unlockLv: 9, name: '神圣不灭护盾', type: 'buff_shield', power: 1.25, healPct: 0.12, shieldSec: 4.8, cd: 8.5, fxMain: 'holy/divine-shield', fxHit: 'holy/smite' },
            { id: 'h6', unlockLv: 12, name: '奥义·天界圣光裁决', type: 'ultimate', power: 2.75, healPct: 0.10, cd: 12.5, fxCast: 'arcane/magic-circle-cast', fxMain: 'holy/holy-pillar', fxHit: 'holy/smite' },
        ],
    },
};

export function getArchetype(archetypeId) {
    return CLASS_ARCHETYPES[archetypeId] || CLASS_ARCHETYPES.martial;
}

export function xpRequiredForLevel(level) {
    const lv = Math.max(1, Number(level) || 1);
    return Math.round(180 * Math.pow(lv, 1.35));
}

export function computeCombatStats(pet) {
    const lv = Math.max(1, Number(pet.level) || 1);
    const arch = getArchetype(pet.archetype);
    const maxHp = Math.round(arch.baseHp + (lv - 1) * arch.hpPerLv);
    const atk = Math.round(arch.baseAtk + (lv - 1) * arch.atkPerLv);
    const unlockedSkills = arch.skills.filter(s => s.unlockLv <= lv);

    return {
        maxHp,
        atk,
        spd: arch.baseSpd,
        critRate: arch.critRate,
        archetypeName: arch.name,
        archetypeBadge: arch.badge,
        unlockedSkills,
    };
}

export function createNewPetRecord(opts = {}) {
    const presetId = opts.presetId || 'cat';
    const presetMeta = SPECIES_PRESETS.find(p => p.id === presetId) || SPECIES_PRESETS[0];
    const id = opts.id || `pet-${GLib.uuid_string_random().slice(0, 8)}`;

    return {
        id,
        name: (opts.name || presetMeta.defaultName || '团子').trim(),
        archetype: CLASS_ARCHETYPES[opts.archetype] ? opts.archetype : presetMeta.defaultArchetype,
        skinMode: opts.skinMode || 'preset', // 'preset' | 'gif' | 'spritesheet'
        presetId,
        customPath: opts.customPath || '',
        cols: Number(opts.cols) || 4,
        rows: Number(opts.rows) || 10,
        fps: Number(opts.fps) || 8,
        baseFacingRight: opts.baseFacingRight !== false,
        autoRemoveBg: opts.autoRemoveBg !== false,
        onTopBar: opts.onTopBar !== false,
        level: Math.max(1, Number(opts.level) || 1),
        xp: Math.max(0, Number(opts.xp) || 0),
        hunger: Math.min(100, Math.max(20, Number(opts.hunger ?? 90))),
        mood: Math.min(100, Math.max(20, Number(opts.mood ?? 95))),
        energy: Math.min(100, Math.max(20, Number(opts.energy ?? 95))),
        wins: Math.max(0, Number(opts.wins) || 0),
        losses: Math.max(0, Number(opts.losses) || 0),
        petsCount: Math.max(0, Number(opts.petsCount) || 0),
        treatsFed: Math.max(0, Number(opts.treatsFed) || 0),
    };
}

/**
 * Generate ready-to-copy AI Sprite Sheet Prompts (Chinese & English) matching
 * the exact 10-row x 4-column TopBar Pet combat & roaming rig standard!
 */
export function buildAiPetPrompt(subjectDesc, artStyle = '16-bit 精致像素画', bgType = '纯白背景 #FFFFFF') {
    const subject = (subjectDesc || '一只戴着魔法护目镜的可爱小狐狸').trim();
    const bgEn = bgType.includes('绿') ? 'solid pure chroma green (#00FF00)' : 'solid pure flat white (#FFFFFF)';

    const zh = [
        `请为我生成一张严格对齐网格的游戏角色精灵图（Sprite Sheet），单张 PNG 图片：`,
        `【角色设定】：${subject}，${artStyle}，带清晰 1px 深色轮廓描边，全程统一面朝右侧（Side-view facing RIGHT），所有帧角色体型比例与画格基线保持严格一致。`,
        `【背景要求】：${bgType}（无阴影、无棋盘格、无渐变背景、无文字水印、无网格分割线），方便自动抠图。`,
        `【严格网格布局】：共 10 行 × 4 列（总计 40 个等大正方形帧格，建议总分辨率 512×1280 或 1024×2560，每格 4 帧连续循环动画）：`,
        `  • 第 1 行 (Row 0 - idle)：待机呼吸、眨眼、轻微晃动尾巴；`,
        `  • 第 2 行 (Row 1 - walk)：轻快向前漫步的 4 帧走动循环；`,
        `  • 第 3 行 (Row 2 - run)：全力加速奔跑冲刺 / 腾空跃起的 4 帧循环；`,
        `  • 第 4 行 (Row 3 - sleep)：趴在地面蜷缩打盹、轻微呼吸起伏；`,
        `  • 第 5 行 (Row 4 - happy)：开心跳跃欢呼 / 对战胜利庆祝动作；`,
        `  • 第 6 行 (Row 5 - drag)：被鼠标从后颈拎起、四肢自然悬空摇晃；`,
        `  • 第 7 行 (Row 6 - attack)：近战攻击连招（蓄力 -> 挥爪/出拳 -> 重击 -> 腾空飞踢）；`,
        `  • 第 8 行 (Row 7 - sneak)：压低身体、蹑手蹑脚小心翼翼向前潜行；`,
        `  • 第 9 行 (Row 8 - cast)：施放魔法技能动作（双手/身前凝聚发光能量球并向前释放法术）；`,
        `  • 第 10 行 (Row 9 - hurt)：受击硬直动作（闭眼后仰退缩、头顶冒眩晕小星星）。`,
    ].join('\n');

    const en = [
        `2D pixel art character sprite sheet, ${subject}, ${artStyle.includes('Q版') ? 'cute chibi pixel art' : 'crisp 16-bit retro game pixel art'}, clean 1px dark outline, side-view facing RIGHT consistently across all frames.`,
        `STRICT GRID LAYOUT: Exactly 10 rows by 4 columns (40 equal square cells arranged in a clean invisible grid, NO visible grid lines, NO labels, NO drop shadows on background).`,
        `BACKGROUND: Completely ${bgEn} uniform flat background for clean chroma key cutout.`,
        `ROW-BY-ROW ANIMATION SPECIFICATION (4 frames per row, top to bottom):`,
        `Row 1 (Idle): standing breathing, blinking, subtle tail/body bob.`,
        `Row 2 (Walk): 4-frame smooth walking cycle facing right.`,
        `Row 3 (Run/Jump): 4-frame energetic dash sprint and leap.`,
        `Row 4 (Sleep): curled up sleeping peacefully on ground.`,
        `Row 5 (Happy/Victory): joyful jumping celebration pose.`,
        `Row 6 (Dragged): picked up from scruff, limbs dangling adorably.`,
        `Row 7 (Melee Attack): 4-frame martial combo — wind-up, punch/claw slash, uppercut, flying kick.`,
        `Row 8 (Sneak): crouched low stealth tiptoeing forward.`,
        `Row 9 (Skill Cast): channeling glowing magic energy orb in front and casting spell.`,
        `Row 10 (Hurt/Hit): knocked back wincing with dizzy stars.`,
    ].join('\n');

    return { zh, en };
}

/**
 * Multi-Pet Roster & Progression Manager (up to 3 adopted pets!).
 */
export class RosterManager {
    constructor(settings, callbacks = {}) {
        this._settings = settings;
        this._callbacks = callbacks;

        this.pets = [];
        this.primaryPetId = '';
        this._lastSavedJson = '';
        this._loadFromSettings();

        // Watch external changes from Preferences UI (Adopt / Release / Class change / Rename!)
        this._settingsSig = this._settings.connect('changed::roster-json', () => {
            const raw = this._settings.get_string('roster-json');
            if (raw !== this._lastSavedJson) {
                this._loadFromSettings();
                if (this._callbacks.onRosterStructureChanged)
                    this._callbacks.onRosterStructureChanged();
            }
        });

        // Passive companion growth tick every 25s
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
                if (Array.isArray(parsed.pets) && parsed.pets.length > 0) {
                    this.pets = parsed.pets
                        .slice(0, MAX_ADOPTED_PETS)
                        .map(p => createNewPetRecord(p));
                    this.primaryPetId = parsed.primaryPetId || this.pets[0].id;
                    if (!this.pets.some(p => p.id === this.primaryPetId))
                        this.primaryPetId = this.pets[0].id;
                    this._lastSavedJson = raw;
                    return;
                }
            }
        } catch (_e) {
            // Fallback to default initial pet
        }

        const starter = createNewPetRecord({
            name: this._settings.get_string('pet-name') || '团子',
            presetId: 'cat',
            archetype: 'martial',
        });
        this.pets = [starter];
        this.primaryPetId = starter.id;
        this.save();
    }

    save() {
        try {
            const payload = JSON.stringify({
                primaryPetId: this.primaryPetId,
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

    getPrimaryPet() {
        return this.pets.find(p => p.id === this.primaryPetId) || this.pets[0];
    }

    getPetById(id) {
        return this.pets.find(p => p.id === id) || null;
    }

    setPrimaryPet(petId) {
        const pet = this.getPetById(petId);
        if (!pet)
            return false;
        this.primaryPetId = pet.id;
        pet.onTopBar = true;
        this.save();
        if (this._callbacks.onRosterStructureChanged)
            this._callbacks.onRosterStructureChanged();
        return true;
    }

    canAdoptMore() {
        return this.pets.length < MAX_ADOPTED_PETS;
    }

    adoptPet(opts = {}) {
        if (!this.canAdoptMore())
            return null;
        const newPet = createNewPetRecord(opts);
        this.pets.push(newPet);
        this.save();
        if (this._callbacks.onPetAdopted)
            this._callbacks.onPetAdopted(newPet);
        if (this._callbacks.onRosterStructureChanged)
            this._callbacks.onRosterStructureChanged();
        return newPet;
    }

    releasePet(petId) {
        const idx = this.pets.findIndex(p => p.id === petId);
        if (idx < 0)
            return null;

        const [released] = this.pets.splice(idx, 1);

        // Always ensure at least 1 companion remains; if user released their last one,
        // adopt a fresh Lv.1 starter kitten after farewell!
        if (this.pets.length === 0) {
            const fresh = createNewPetRecord({ name: '新伙伴', presetId: 'cat', archetype: 'martial' });
            this.pets.push(fresh);
        }
        if (!this.pets.some(p => p.id === this.primaryPetId))
            this.primaryPetId = this.pets[0].id;

        this.save();
        if (this._callbacks.onPetReleased)
            this._callbacks.onPetReleased(released);
        if (this._callbacks.onRosterStructureChanged)
            this._callbacks.onRosterStructureChanged();
        return released;
    }

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
                if (sk.unlockLv === pet.level)
                    newlyUnlockedSkills.push(sk);
            }
        }

        if (leveledUp && this._callbacks.onLevelUp)
            this._callbacks.onLevelUp(pet, newlyUnlockedSkills);

        this.save();
        if (this._callbacks.onStatsUpdated)
            this._callbacks.onStatsUpdated();

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

    recordBattleOutcome(petId, won) {
        const pet = this.getPetById(petId) || this.getPrimaryPet();
        if (!pet)
            return;
        if (won) {
            pet.wins = (pet.wins || 0) + 1;
            pet.mood = Math.min(100, pet.mood + 12);
            this.grantXp(pet.id, 32);
        } else {
            pet.losses = (pet.losses || 0) + 1;
            this.grantXp(pet.id, 18);
        }
    }

    _onCompanionTick() {
        for (const pet of this.pets) {
            pet.energy = Math.min(100, Math.max(45, pet.energy + 0.4));
            pet.mood = Math.min(100, Math.max(55, pet.mood + 0.2));
            if (pet.onTopBar !== false)
                this.grantXp(pet.id, 2);
        }
        this.save();
    }
}
