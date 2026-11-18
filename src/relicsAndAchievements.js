/**
 * Roguelite Relics (18), AI Tactical Stances (4), Mystery Egg Innate Traits (6),
 * Random Raid / World Boss Pool (5 Bosses + 5 Minion Wave Types), and Achievements & Titles (12).
 */

export const TACTICAL_STANCES = {
    balanced: {
        id: 'balanced',
        label: '⚖️ 均衡博弈',
        desc: '攻守兼备，根据距离灵活切换下蹲、格挡与上下 Z 轴走位。',
        defenseProb: 0.78,
        crouchBias: 0.33,
        guardBias: 0.34,
        zSidestepBias: 0.33,
        parryWindowSec: 0.25,
        aggroSpeedMult: 1.0,
        disengageChance: 0.45,
    },
    berserk: {
        id: 'berserk',
        label: '🔥 狂暴压制',
        desc: '放弃保守退缩，全速突脸抢攻，怒气积攒加快 30%！',
        defenseProb: 0.42,
        crouchBias: 0.35,
        guardBias: 0.45,
        zSidestepBias: 0.20,
        parryWindowSec: 0.22,
        aggroSpeedMult: 1.24,
        rageGainMult: 1.30,
        disengageChance: 0.12,
    },
    counter: {
        id: 'counter',
        label: '🛡️ 宗师防反',
        desc: '极高概率识破敌方前摇，精准弹反窗口延长至 0.34 秒！',
        defenseProb: 0.94,
        crouchBias: 0.30,
        guardBias: 0.50,
        zSidestepBias: 0.20,
        parryWindowSec: 0.34,
        aggroSpeedMult: 0.94,
        disengageChance: 0.48,
    },
    kite: {
        id: 'kite',
        label: '🍃 灵巧风筝',
        desc: '高频上下 Z 轴错位侧闪与后跳拉扯，远程法师与猎手首选。',
        defenseProb: 0.88,
        crouchBias: 0.20,
        guardBias: 0.20,
        zSidestepBias: 0.60,
        parryWindowSec: 0.25,
        aggroSpeedMult: 1.12,
        disengageChance: 0.82,
    },
};

export function getStanceConfig(stanceId) {
    return TACTICAL_STANCES[stanceId] || TACTICAL_STANCES.balanced;
}

export const EGG_TRAITS = {
    sparkle:      { id: 'sparkle',      label: '✨ 星耀异色', desc: '全属性 +6%，暴击率 +5%', hpMult: 1.06, atkMult: 1.06, critBonus: 0.05 },
    swift:        { id: 'swift',        label: '⚡ 疾风血统', desc: '移动速度 +15%，技能冷却缩减 8%', spdMult: 1.15, cdr: 0.08 },
    vampiric:     { id: 'vampiric',     label: '🧛 嗜血本能', desc: '全技能获得 +8% 生命偷取', lifestealBonus: 0.08 },
    ironhide:     { id: 'ironhide',     label: '🛡️ 金刚龙骨', desc: '最大生命 +16%，受到伤害降低 6%', hpMult: 1.16, dmgReduct: 0.06 },
    lucky:        { id: 'lucky',        label: '🍀 寻宝灵鼻', desc: '桌面挖宝金币翻倍，暴击率 +8%', critBonus: 0.08, coinMult: 2.0 },
    elementalist: { id: 'elementalist', label: '🔮 元素亲和', desc: '触发元素连携反应伤害额外 +22%', reactionBonus: 0.22 },
};

export const RELIC_CATALOG = {
    // Common (6)
    fang_charm: {
        id: 'fang_charm', rarity: 'common', icon: '🧛', name: '猩红虎牙吊坠',
        desc: '近战与突进技能造成伤害的 14% 转化为自身生命。',
        mods: { meleeLifesteal: 0.14 },
    },
    feather_boots: {
        id: 'feather_boots', rarity: 'common', icon: '🪶', name: '疾风轻羽靴',
        desc: '2.5D 走位移速 +16%，Z 轴侧闪冷却缩短。',
        mods: { spdMult: 1.16 },
    },
    iron_buckler: {
        id: 'iron_buckler', rarity: 'common', icon: '🛡️', name: '矮人精钢圆盾',
        desc: '最大生命 +12%，格挡减伤额外提高 10%。',
        mods: { hpMult: 1.12, guardBonus: 0.10 },
    },
    crit_lens: {
        id: 'crit_lens', rarity: 'common', icon: '🎯', name: '鹰眼暴击目镜',
        desc: '暴击率提高 +10%，暴击伤害 +15%。',
        mods: { critRateBonus: 0.10, critDmgBonus: 0.15 },
    },
    mana_dew: {
        id: 'mana_dew', rarity: 'common', icon: '💧', name: '晨曦魔力露珠',
        desc: '所有主动与奥义技能冷却时间缩减 10%。',
        mods: { cdr: 0.10 },
    },
    fury_pepper: {
        id: 'fury_pepper', rarity: 'common', icon: '🌶️', name: '爆燃朝天椒',
        desc: '开局初始怒气 +35，更快释放第一发奥义！',
        mods: { startRageBonus: 35 },
    },

    // Rare (6)
    chrono_watch: {
        id: 'chrono_watch', rarity: 'rare', icon: '⏱️', name: '幻影时停怀表',
        desc: '触发精准弹反（Parry）时，所有技能冷却立即减少 2.4 秒！',
        mods: { parryCdRefund: 2.4 },
    },
    thorn_crown: {
        id: 'thorn_crown', rarity: 'rare', icon: '🌿', name: '荆棘反伤王冠',
        desc: '处于护盾或格挡状态时，向攻击者反弹 30% 伤害并挂流血。',
        mods: { thornsReflect: 0.30 },
    },
    prism_ring: {
        id: 'prism_ring', rarity: 'rare', icon: '💎', name: '霜火元素棱镜',
        desc: '触发融化/超导/超载等元素连携反应时，爆发伤害额外 +28%！',
        mods: { reactionDmgBonus: 0.28 },
    },
    exec_axe: {
        id: 'exec_axe', rarity: 'rare', icon: '🪓', name: '断头台处决战斧',
        desc: '对生命值低于 40% 的敌人与 Boss 造成伤害提高 +26%。',
        mods: { executeMult: 0.26 },
    },
    healer_leaf: {
        id: 'healer_leaf', rarity: 'rare', icon: '🍀', name: '世界树嫩芽',
        desc: '每秒自动回复 1.6% 最大生命，护盾与治疗效果提升 +25%。',
        mods: { regenPctPerSec: 0.016, healShieldMult: 1.25 },
    },
    giant_slayer: {
        id: 'giant_slayer', rarity: 'rare', icon: '🗡️', name: '屠龙者徽记',
        desc: '对世界 Boss、深渊领主及其召唤小怪伤害提高 +25%。',
        mods: { bossMinionBonus: 0.25 },
    },

    // Legendary (6)
    phoenix_plume: {
        id: 'phoenix_plume', rarity: 'legendary', icon: '🐦‍🔥', name: '涅槃不死火羽',
        desc: '每场战斗首次受到致命伤害时免疫死亡，立即回复 32% 生命并震退四周！',
        mods: { reviveHpPct: 0.32 },
    },
    void_heart: {
        id: 'void_heart', rarity: 'legendary', icon: '🌌', name: '深渊引力魔核',
        desc: '攻击力 +18%，释放奥义时额外回复自身 15% 生命并挂暗影易伤。',
        mods: { atkMult: 1.18, ultHealPct: 0.15 },
    },
    thunder_drum: {
        id: 'thunder_drum', rarity: 'legendary', icon: '🥁', name: '雷神连击战鼓',
        desc: '每次暴击额外降下一道落雷造成 35% 攻击力溅射伤害！',
        mods: { critChainLightning: 0.35 },
    },
    fate_dice: {
        id: 'fate_dice', rarity: 'legendary', icon: '🎲', name: '命运赌徒金骰',
        desc: '开局同时获得 3.5 秒神圣护盾与 +20% 暴击率加成！',
        mods: { startShieldSec: 3.5, critRateBonus: 0.20 },
    },
    twin_bond: {
        id: 'twin_bond', rarity: 'legendary', icon: '🤝', name: '双子共鸣羁绊石',
        desc: '2v2 或组队讨伐中，全队伙伴攻击力 +14% 且共享 15% 治疗量！',
        mods: { atkMult: 1.14, teamAuraAtk: 0.14, shareHeal: 0.15 },
    },
    crown_king: {
        id: 'crown_king', rarity: 'legendary', icon: '👑', name: '黄金霸者圣冠',
        desc: '最大生命 +18%，攻击力 +15%，冷却缩减 +8%。',
        mods: { hpMult: 1.18, atkMult: 1.15, cdr: 0.08 },
    },
};

export const ALL_RELIC_IDS = Object.keys(RELIC_CATALOG);

export function aggregateRelicModifiers(relicIds = [], traitId = null) {
    const out = {
        hpMult: 1.0,
        atkMult: 1.0,
        spdMult: 1.0,
        critRateBonus: 0,
        critDmgBonus: 0,
        cdr: 0,
        dmgReduct: 0,
        meleeLifesteal: 0,
        lifestealAll: 0,
        guardBonus: 0,
        startRageBonus: 0,
        startShieldSec: 0,
        parryCdRefund: 0,
        thornsReflect: 0,
        reactionDmgBonus: 0,
        executeMult: 0,
        regenPctPerSec: 0,
        healShieldMult: 1.0,
        bossMinionBonus: 0,
        reviveHpPct: 0,
        ultHealPct: 0,
        critChainLightning: 0,
    };

    const trait = traitId ? EGG_TRAITS[traitId] : null;
    if (trait) {
        if (trait.hpMult) out.hpMult *= trait.hpMult;
        if (trait.atkMult) out.atkMult *= trait.atkMult;
        if (trait.spdMult) out.spdMult *= trait.spdMult;
        if (trait.critBonus) out.critRateBonus += trait.critBonus;
        if (trait.cdr) out.cdr += trait.cdr;
        if (trait.dmgReduct) out.dmgReduct += trait.dmgReduct;
        if (trait.lifestealBonus) out.lifestealAll += trait.lifestealBonus;
        if (trait.reactionBonus) out.reactionDmgBonus += trait.reactionBonus;
    }

    if (Array.isArray(relicIds)) {
        for (const id of relicIds.slice(0, 3)) {
            const rel = RELIC_CATALOG[id];
            if (!rel?.mods)
                continue;
            const m = rel.mods;
            if (m.hpMult) out.hpMult *= m.hpMult;
            if (m.atkMult) out.atkMult *= m.atkMult;
            if (m.spdMult) out.spdMult *= m.spdMult;
            if (m.critRateBonus) out.critRateBonus += m.critRateBonus;
            if (m.critDmgBonus) out.critDmgBonus += m.critDmgBonus;
            if (m.cdr) out.cdr = Math.min(0.42, out.cdr + m.cdr);
            if (m.meleeLifesteal) out.meleeLifesteal += m.meleeLifesteal;
            if (m.guardBonus) out.guardBonus += m.guardBonus;
            if (m.startRageBonus) out.startRageBonus += m.startRageBonus;
            if (m.startShieldSec) out.startShieldSec = Math.max(out.startShieldSec, m.startShieldSec);
            if (m.parryCdRefund) out.parryCdRefund += m.parryCdRefund;
            if (m.thornsReflect) out.thornsReflect += m.thornsReflect;
            if (m.reactionDmgBonus) out.reactionDmgBonus += m.reactionDmgBonus;
            if (m.executeMult) out.executeMult += m.executeMult;
            if (m.regenPctPerSec) out.regenPctPerSec += m.regenPctPerSec;
            if (m.healShieldMult) out.healShieldMult *= m.healShieldMult;
            if (m.bossMinionBonus) out.bossMinionBonus += m.bossMinionBonus;
            if (m.reviveHpPct) out.reviveHpPct = Math.max(out.reviveHpPct, m.reviveHpPct);
            if (m.ultHealPct) out.ultHealPct += m.ultHealPct;
            if (m.critChainLightning) out.critChainLightning += m.critChainLightning;
        }
    }

    return out;
}

// =============================================================================
// 5 Random Bosses + Companion Minion Templates (for Co-op Raid & World Boss!)
// =============================================================================
export const MINION_TEMPLATES = {
    fire_imp: {
        id: 'fire_imp', name: '爆裂小火灵', presetId: 'dragon', archetype: 'fire',
        scale: 0.72, hpRatio: 0.22, atkRatio: 0.45, spd: 1.25,
        equippedSkills: ['f1', 'f2'],
        deathExplosionFx: 'explosions/cartoon-pow',
    },
    frost_slime: {
        id: 'frost_slime', name: '护卫冰史莱姆', presetId: 'slime', archetype: 'ice',
        scale: 0.76, hpRatio: 0.28, atkRatio: 0.38, spd: 0.92,
        equippedSkills: ['i1', 'i4'],
        grantsBossShield: true,
    },
    electro_drone: {
        id: 'electro_drone', name: '浮游电浆机兵', presetId: 'robot', archetype: 'storm',
        scale: 0.72, hpRatio: 0.20, atkRatio: 0.50, spd: 1.30,
        equippedSkills: ['s2', 's1'],
    },
    shadow_wisp: {
        id: 'shadow_wisp', name: '暗影噬魂小鬼', presetId: 'ghost', archetype: 'arcane',
        scale: 0.74, hpRatio: 0.21, atkRatio: 0.46, spd: 1.22,
        equippedSkills: ['a1', 'a7'],
    },
    spore_ling: {
        id: 'spore_ling', name: '剧毒孢子幼体', presetId: 'slime', archetype: 'holy',
        scale: 0.74, hpRatio: 0.24, atkRatio: 0.42, spd: 1.0,
        equippedSkills: ['h1', 'h2'],
        deathExplosionFx: 'nature/spore-burst',
    },
};

export const BOSS_POOL = [
    {
        id: 'crimson_dragon',
        name: '🐉 烬灭红莲魔龙',
        title: '熔火深渊霸主',
        presetId: 'dragon',
        archetype: 'fire',
        scale: 1.34,
        hpMult: 2.65,
        atkMult: 1.22,
        stance: 'berserk',
        equippedSkills: ['f3', 'f5', 'm3', 'f6'],
        minionType: 'fire_imp',
        introLine: '🔥 烬灭红莲魔龙携爆裂火灵降临！小心陨石与自爆火灵！',
    },
    {
        id: 'frost_empress',
        name: '❄️ 永冬冰霜女皇',
        title: '极寒王座之主',
        presetId: 'slime',
        archetype: 'ice',
        scale: 1.35,
        hpMult: 2.80,
        atkMult: 1.15,
        stance: 'counter',
        equippedSkills: ['i3', 'i5', 'i2', 'i6'],
        minionType: 'frost_slime',
        introLine: '❄️ 永冬冰霜女皇携护卫史莱姆登场！优先击破护盾杂兵！',
    },
    {
        id: 'cyber_colossus',
        name: '🤖 失控赛博巨像·零号',
        title: '超频歼灭兵器',
        presetId: 'robot',
        archetype: 'storm',
        scale: 1.36,
        hpMult: 2.70,
        atkMult: 1.24,
        stance: 'balanced',
        equippedSkills: ['s4', 's5', 'a6', 's6'],
        minionType: 'electro_drone',
        introLine: '⚡ 失控赛博巨像锁定全场！利用 Z 轴上下走位躲避贯穿光束！',
    },
    {
        id: 'void_archon',
        name: '👻 虚空噬魂领主',
        title: '次元裂隙主宰',
        presetId: 'ghost',
        archetype: 'arcane',
        scale: 1.34,
        hpMult: 2.60,
        atkMult: 1.25,
        stance: 'kite',
        equippedSkills: ['a3', 'a5', 'a4', 'a6'],
        minionType: 'shadow_wisp',
        introLine: '🔮 虚空噬魂领主撕裂传送门，成群暗影小鬼涌出！',
    },
    {
        id: 'thorn_treant',
        name: '🌿 远古荆棘古树王',
        title: '腐化森罗巨兽',
        presetId: 'shiba',
        archetype: 'holy',
        scale: 1.34,
        hpMult: 2.90,
        atkMult: 1.14,
        stance: 'counter',
        equippedSkills: ['h2', 'h3', 'm7', 'h6'],
        minionType: 'spore_ling',
        introLine: '🌿 远古荆棘古树王苏醒！小心地面剧毒泥潭与缠绕根须！',
    },
];

export function pickBossBySeed(seed = 1) {
    const idx = Math.abs(Math.floor(Number(seed) || 0)) % BOSS_POOL.length;
    return BOSS_POOL[idx];
}

// =============================================================================
// 12 Unlockable Achievements & Syncable LAN Honor Titles
// =============================================================================
export const ACHIEVEMENT_CATALOG = [
    { id: 'first_blood',   title: '⚔️ 初露锋芒', desc: '赢得第 1 场擂台对战胜利', check: s => s.totalWins >= 1 },
    { id: 'win_streak_10', title: '👑 百战拳王', desc: '累计赢得 10 场擂台胜利', check: s => s.totalWins >= 10 },
    { id: 'parry_master',  title: '⚡ 弹反鬼才', desc: '在自动战斗中累计打出 8 次精准弹反', check: s => s.parries >= 8 },
    { id: 'alchemist',     title: '💥 元素炼金师', desc: '累计触发 10 次双元素连携反应', check: s => s.reactions >= 10 },
    { id: 'boss_slayer',   title: '🐉 屠龙先锋', desc: '击败任意深渊/世界 Boss 1 次', check: s => s.bossKills >= 1 },
    { id: 'raid_veteran',  title: '🔥 深渊克星', desc: '累计讨伐击败 5 只随机 Boss', check: s => s.bossKills >= 5 },
    { id: 'egg_hatcher',   title: '🥚 破壳守护者', desc: '成功孵化第 1 颗神秘宠物蛋', check: s => s.eggsHatched >= 1 },
    { id: 'treasure_king', title: '💰 顶部栏富豪', desc: '累计持有或赚取超过 300 金币', check: s => s.totalCoinsEarned >= 300 },
    { id: 'relic_hunter',  title: '💎 圣物收藏家', desc: '收集解锁至少 5 件不同圣物', check: s => s.relicCount >= 5 },
    { id: 'skill_scholar', title: '📜 万法宗师', desc: '领悟解锁至少 3 卷跨流派技能秘籍', check: s => s.scrollCount >= 3 },
    { id: 'focus_hero',    title: '🍅 专注勇者', desc: '完成 1 次番茄钟专注地下城远征', check: s => s.focusCompleted >= 1 },
    { id: 'squad_leader',  title: '🐾 萌宠大家族', desc: '麾下同时拥有 3 只及以上伙伴', check: s => s.petCount >= 3 },
];

export function findNewlyUnlockedAchievements(summary, alreadyUnlocked = []) {
    const owned = new Set(alreadyUnlocked);
    const newly = [];
    for (const ach of ACHIEVEMENT_CATALOG) {
        if (!owned.has(ach.id) && ach.check(summary))
            newly.push(ach);
    }
    return newly;
}
