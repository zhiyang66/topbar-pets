/**
 * Modular 2.5D Composable Skill Engine & 4-Slot Cross-Class Loadout System.
 *
 * Every skill is composed of:
 *   - movement: 'step_in' | 'leap_slam' | 'dash_through' | 'blink_behind' | 'backflip_shot' | 'stand_channel'
 *   - delivery: 'melee_combo' | 'linear_proj' | 'lob_boulder' | 'sky_strike' | 'ground_zone' | 'beam_sweep' | 'aura_ward'
 *   - element:  'physical' | 'fire' | 'ice' | 'storm' | 'arcane' | 'nature' | 'holy'
 *   - zRadius:  2.5D depth hit width (narrow projectiles/beams can be Z-sidestepped!)
 */

export const ELEMENT_META = {
    physical: { id: 'physical', label: '武道', icon: '⚔️', color: '#f8f8f2' },
    fire:     { id: 'fire',     label: '烈焰', icon: '🔥', color: '#ff6e40' },
    ice:      { id: 'ice',      label: '寒冰', icon: '❄️', color: '#8be9fd' },
    storm:    { id: 'storm',    label: '雷霆', icon: '⚡', color: '#f1fa8c' },
    arcane:   { id: 'arcane',   label: '暗影', icon: '🔮', color: '#bd93f9' },
    nature:   { id: 'nature',   label: '森毒', icon: '🌿', color: '#50fa7b' },
    holy:     { id: 'holy',     label: '圣光', icon: '✨', color: '#ffd866' },
};

/**
 * 2.5D Elemental Reaction Table (triggered when target already carries an elemental aura
 * from your 2v2 partner OR your previous cross-element skill!).
 */
export function resolveElementalReaction(auraElement, incomingElement) {
    if (!auraElement || !incomingElement || auraElement === incomingElement)
        return null;
    if (auraElement === 'physical' || incomingElement === 'physical')
        return null;

    const pair = [auraElement, incomingElement].sort().join('+');
    switch (pair) {
        case 'fire+ice':
            return {
                id: 'melt',
                name: '💥 融化高爆',
                dmgMult: 1.65,
                fx: 'explosions/plasma-explosion',
                clearAura: true,
            };
        case 'ice+storm':
            return {
                id: 'superconduct',
                name: '⚡ 超导破甲',
                dmgMult: 1.32,
                vulnerableSec: 4.8,
                fx: 'ice/ice-shatter',
                clearAura: true,
            };
        case 'fire+storm':
            return {
                id: 'overload',
                name: '🌪️ 超载雷爆',
                dmgMult: 1.38,
                aoeRadius: 96,
                knockback: 34,
                fx: 'explosions/big-explosion',
                clearAura: true,
            };
        case 'fire+nature':
            return {
                id: 'venom_blast',
                name: '☠️ 剧毒爆燃',
                dmgMult: 1.46,
                aoeRadius: 86,
                fx: 'nature/spore-burst',
                clearAura: true,
            };
        case 'arcane+holy':
            return {
                id: 'eclipse',
                name: '✨ 光暗湮灭',
                dmgMult: 1.42,
                bonusTrueHpPct: 0.06,
                healSelfPct: 0.08,
                fx: 'holy/sunburst',
                clearAura: true,
            };
        case 'arcane+storm':
        case 'nature+storm':
            return {
                id: 'aggravate',
                name: '🔮 超激化',
                dmgMult: 1.38,
                cdRefundSec: 1.5,
                fx: 'arcane/mana-burst',
                clearAura: false, // Keeps aura briefly for multi-hit follow-ups!
            };
        case 'ice+nature':
            return {
                id: 'shatter_root',
                name: '🧊 霜蔓封锁',
                dmgMult: 1.30,
                snareSec: 1.6,
                fx: 'nature/root-snare',
                clearAura: true,
            };
        default:
            return null;
    }
}

export const SKILL_CATALOG = {
    // =========================================================================
    // 1. MARTIAL (狂战武道 · 多段体术 / 穿身斩 / 裂地跃击)
    // =========================================================================
    m1: {
        id: 'm1', school: 'martial', unlockLv: 1, slotType: 'active',
        name: '疾风连爪', element: 'physical',
        movement: 'step_in', delivery: 'melee_combo', hits: 2,
        power: 1.04, cd: 2.0, range: 64, zRadius: 24,
        status: { kind: 'bleed', sec: 3.0 },
        fxMain: 'melee/claw-swipe', fxHit: 'explosions/cartoon-pow',
        desc: '垫步贴身快速二连爪击，附带流血撕裂。',
    },
    m2: {
        id: 'm2', school: 'martial', unlockLv: 2, slotType: 'active',
        name: '横扫长枪破', element: 'physical',
        movement: 'step_in', delivery: 'melee_combo', hits: 2,
        power: 1.34, cd: 3.6, range: 86, zRadius: 34, knockback: 18,
        fxMain: 'melee/spear-sweep', fxHit: 'impacts/crit-hit',
        desc: '大范围长兵横扫，覆盖宽广 Z 轴纵深。',
    },
    m3: {
        id: 'm3', school: 'martial', unlockLv: 4, slotType: 'active',
        name: '裂地重锤跃', element: 'physical',
        movement: 'leap_slam', delivery: 'melee_combo', hits: 1,
        power: 1.60, cd: 5.2, range: 150, zRadius: 38, knockback: 28,
        status: { kind: 'stun', sec: 0.75 },
        fxMain: 'melee/hammer-smash', fxHit: 'impacts/ground-slam',
        desc: '高高跃起锁定目标砸落，造成范围震晕。',
    },
    m4: {
        id: 'm4', school: 'martial', unlockLv: 6, slotType: 'active',
        name: '残影乱刃汲取', element: 'physical',
        movement: 'dash_through', delivery: 'melee_combo', hits: 3,
        power: 1.72, cd: 6.4, range: 120, zRadius: 26, lifesteal: 0.24,
        status: { kind: 'bleed', sec: 4.0 },
        fxMain: 'melee/dagger-flurry', fxHit: 'explosions/cartoon-pow',
        desc: '化作残影穿过敌人身躯三连斩，并回复 24% 伤害生命。',
    },
    m5: {
        id: 'm5', school: 'martial', unlockLv: 8, slotType: 'active',
        name: '断魂镰刃旋风', element: 'physical',
        movement: 'leap_slam', delivery: 'melee_combo', hits: 2,
        power: 1.98, cd: 7.4, range: 130, zRadius: 42, knockback: 30, lifesteal: 0.14,
        fxMain: 'melee/scythe-reap', fxHit: 'impacts/crit-hit',
        desc: '旋转巨镰收割周围所有敌人，对低血量目标暴击率提升。',
    },
    m6: {
        id: 'm6', school: 'martial', unlockLv: 11, slotType: 'ultimate',
        name: '奥义·天地霸斩', element: 'physical',
        movement: 'leap_slam', delivery: 'melee_combo', hits: 2,
        power: 2.85, cd: 11.5, range: 180, zRadius: 48, knockback: 44,
        fxCast: 'lightning/charge-up', fxMain: 'melee/heavy-cleave', fxHit: 'explosions/big-explosion',
        desc: '聚气跃起劈开天地，造成巨额大范围破防斩击。',
    },
    m7: {
        id: 'm7', school: 'martial', unlockLv: 5, slotType: 'active', secretScroll: true,
        name: '秘传·投掷巨岩', element: 'physical',
        movement: 'backflip_shot', delivery: 'lob_boulder',
        power: 1.56, cd: 5.0, range: 260, zRadius: 30, knockback: 26,
        status: { kind: 'stun', sec: 0.65 },
        fxMain: 'nature/boulder', fxHit: 'nature/quake',
        desc: '后空翻拉开距离并抛投重型巨岩，下蹲无法躲避！',
    },

    // =========================================================================
    // 2. FIRE (烈焰魔导 · 弹道轰炸 / 火海区域 / 天降陨星)
    // =========================================================================
    f1: {
        id: 'f1', school: 'fire', unlockLv: 1, slotType: 'active',
        name: '烈火升龙拳', element: 'fire',
        movement: 'step_in', delivery: 'melee_combo', hits: 1,
        power: 1.08, cd: 2.2, range: 66, zRadius: 24, launchVy: -6.2,
        status: { kind: 'burn', sec: 3.6 },
        fxMain: 'melee/uppercut', fxHit: 'explosions/cartoon-pow',
        desc: '裹挟烈焰将近身敌人击飞浮空并施加灼烧。',
    },
    f2: {
        id: 'f2', school: 'fire', unlockLv: 2, slotType: 'active',
        name: '后跃爆裂火球', element: 'fire',
        movement: 'backflip_shot', delivery: 'linear_proj', projSpeed: 285,
        power: 1.36, cd: 3.4, range: 320, zRadius: 20,
        status: { kind: 'burn', sec: 4.2 },
        fxMain: 'fire/fireball', fxHit: 'explosions/cartoon-pow',
        desc: '灵巧后跳拉开距离同时发射高速火球，挂烈焰附着。',
    },
    f3: {
        id: 'f3', school: 'fire', unlockLv: 4, slotType: 'active',
        name: '龙炎喷射吐息', element: 'fire',
        movement: 'step_in', delivery: 'beam_sweep',
        power: 1.62, cd: 5.2, range: 175, zRadius: 32,
        status: { kind: 'burn', sec: 4.8 },
        fxMain: 'fire/flamethrower', fxHit: 'impacts/crit-hit',
        desc: '向前持续喷吐高温龙炎扇面，灼烧前方成片敌人。',
    },
    f4: {
        id: 'f4', school: 'fire', unlockLv: 6, slotType: 'active',
        name: '炽热火环护盾', element: 'fire',
        movement: 'stand_channel', delivery: 'aura_ward',
        power: 0.95, healPct: 0.12, shieldSec: 4.2, cd: 7.6, range: 95, zRadius: 38,
        status: { kind: 'burn', sec: 3.2 },
        fxMain: 'fire/fire-ring',
        desc: '张开烈焰护盾减伤回血，并震退灼烧贴脸敌人。',
    },
    f5: {
        id: 'f5', school: 'fire', unlockLv: 9, slotType: 'active',
        name: '熔岩火柱陷阱', element: 'fire',
        movement: 'stand_channel', delivery: 'ground_zone', zoneSec: 3.2,
        power: 1.98, cd: 7.4, range: 270, zRadius: 34, knockback: 20,
        status: { kind: 'burn', sec: 5.0 },
        fxMain: 'fire/flame-pillar', fxHit: 'impacts/crit-hit',
        desc: '在目标脚下召唤持续喷发的熔岩火柱区域。',
    },
    f6: {
        id: 'f6', school: 'fire', unlockLv: 11, slotType: 'ultimate',
        name: '奥义·业火陨星雨', element: 'fire',
        movement: 'stand_channel', delivery: 'sky_strike',
        power: 2.95, cd: 12.0, range: 340, zRadius: 52, knockback: 32,
        status: { kind: 'burn', sec: 6.0 },
        fxCast: 'arcane/magic-circle-cast', fxMain: 'fire/meteor', fxHit: 'fire/fire-tornado',
        desc: '召唤天外巨型陨星砸向战场并卷起烈焰龙卷！',
    },
    f7: {
        id: 'f7', school: 'fire', unlockLv: 5, slotType: 'active', secretScroll: true,
        name: '秘传·幽冥鬼火弹', element: 'fire',
        movement: 'stand_channel', delivery: 'linear_proj', projSpeed: 245,
        power: 1.48, cd: 4.4, range: 310, zRadius: 26, lifesteal: 0.15,
        status: { kind: 'burn', sec: 4.5 },
        fxMain: 'fire/spirit-flame', fxHit: 'explosions/plasma-explosion',
        desc: '释放追踪灵魂的苍蓝鬼火，灼烧敌人并汲取体力。',
    },

    // =========================================================================
    // 3. ICE (凛冬冰霜 · 减速叠冰封 / 冰锥天降 / 绝对零度)
    // =========================================================================
    i1: {
        id: 'i1', school: 'ice', unlockLv: 1, slotType: 'active',
        name: '霜刃斩击', element: 'ice',
        movement: 'step_in', delivery: 'melee_combo', hits: 1,
        power: 1.02, cd: 2.0, range: 68, zRadius: 24,
        status: { kind: 'chill', sec: 3.4, stacks: 1 },
        fxMain: 'melee/sword-slash', fxHit: 'ice/ice-crystal',
        desc: '寒霜剑气挥砍，叠加 1 层寒冰附着（满 3 层冻结！）。',
    },
    i2: {
        id: 'i2', school: 'ice', unlockLv: 2, slotType: 'active',
        name: '极寒穿刺冰枪', element: 'ice',
        movement: 'backflip_shot', delivery: 'linear_proj', projSpeed: 300,
        power: 1.32, cd: 3.5, range: 330, zRadius: 19,
        status: { kind: 'chill', sec: 4.0, stacks: 1 },
        fxMain: 'ice/ice-lance', fxHit: 'ice/ice-crystal',
        desc: '后撤步射出高速寒冰长枪，减速并挂冰附着。',
    },
    i3: {
        id: 'i3', school: 'ice', unlockLv: 4, slotType: 'active',
        name: '天降冰锥轰炸', element: 'ice',
        movement: 'stand_channel', delivery: 'sky_strike',
        power: 1.58, cd: 5.0, range: 290, zRadius: 36,
        status: { kind: 'chill', sec: 4.2, stacks: 2 },
        fxMain: 'ice/icicle-fall', fxHit: 'ice/ice-shatter',
        desc: '在敌人头顶凝结密集冰锥坠落，直接叠 2 层寒冰！',
    },
    i4: {
        id: 'i4', school: 'ice', unlockLv: 6, slotType: 'active',
        name: '寒冰晶甲壁垒', element: 'ice',
        movement: 'stand_channel', delivery: 'aura_ward',
        power: 0.65, healPct: 0.15, shieldSec: 5.0, cd: 8.0, range: 90, zRadius: 36,
        status: { kind: 'chill', sec: 3.5, stacks: 1 },
        fxMain: 'ice/ice-crystal', fxHit: 'impacts/shield-block',
        desc: '凝结坚固冰晶护甲并回复 15% 生命。',
    },
    i5: {
        id: 'i5', school: 'ice', unlockLv: 9, slotType: 'active',
        name: '冰霜新星地刺', element: 'ice',
        movement: 'leap_slam', delivery: 'ground_zone', zoneSec: 2.8,
        power: 1.92, cd: 7.4, range: 170, zRadius: 42,
        status: { kind: 'chill', sec: 4.6, stacks: 2 },
        fxMain: 'ice/frost-nova', fxHit: 'ice/ice-spikes',
        desc: '跃入敌阵爆发寒冰新星，在地面留下减速冰刺带。',
    },
    i6: {
        id: 'i6', school: 'ice', unlockLv: 11, slotType: 'ultimate',
        name: '奥义·绝对零度漩涡', element: 'ice',
        movement: 'stand_channel', delivery: 'sky_strike',
        power: 2.75, cd: 12.0, range: 330, zRadius: 54,
        status: { kind: 'chill', sec: 5.2, stacks: 3 },
        fxCast: 'arcane/magic-circle-cast', fxMain: 'ice/blizzard-vortex', fxHit: 'ice/freeze',
        desc: '席卷全场的暴风雪漩涡，直接叠满 3 层寒冰冻结敌军！',
    },
    i7: {
        id: 'i7', school: 'ice', unlockLv: 5, slotType: 'active', secretScroll: true,
        name: '秘传·霜冻吐息波', element: 'ice',
        movement: 'step_in', delivery: 'beam_sweep',
        power: 1.46, cd: 4.6, range: 165, zRadius: 34,
        status: { kind: 'chill', sec: 4.2, stacks: 2 },
        fxMain: 'ice/frost-breath', fxHit: 'ice/ice-shatter',
        desc: '近中距离扇形极寒吐息，极易配合火系队友打出融化！',
    },

    // =========================================================================
    // 4. STORM (雷霆幻影 · Z轴瞬步背刺 / 球状闪电 / 雷云轰顶)
    // =========================================================================
    s1: {
        id: 's1', school: 'storm', unlockLv: 1, slotType: 'active',
        name: '疾电突刺', element: 'storm',
        movement: 'step_in', delivery: 'melee_combo', hits: 2,
        power: 1.05, cd: 1.8, range: 74, zRadius: 22,
        status: { kind: 'shock', sec: 3.6 },
        fxMain: 'melee/thrust', fxHit: 'lightning/electrified',
        desc: '闪电般高速二连刺击，附带雷霆感电。',
    },
    s2: {
        id: 's2', school: 'storm', unlockLv: 2, slotType: 'active',
        name: '球状电浆弹', element: 'storm',
        movement: 'backflip_shot', delivery: 'linear_proj', projSpeed: 265,
        power: 1.35, cd: 3.4, range: 320, zRadius: 24,
        status: { kind: 'shock', sec: 4.2 },
        fxMain: 'lightning/ball-lightning', fxHit: 'lightning/zap-hit',
        desc: '发射翻滚的高压球状闪电，命中挂感电印记。',
    },
    s3: {
        id: 's3', school: 'storm', unlockLv: 4, slotType: 'active',
        name: '幻影瞬步背刺', element: 'storm',
        movement: 'blink_behind', delivery: 'melee_combo', hits: 2,
        power: 1.66, cd: 5.2, range: 260, zRadius: 30,
        status: { kind: 'shock', sec: 4.0 },
        fxCast: 'arcane/blink-out', fxMain: 'arcane/blink-in', fxHit: 'melee/double-slash',
        desc: '瞬间跨越 Z 轴闪现至目标背后发动暴击双斩！',
    },
    s4: {
        id: 's4', school: 'storm', unlockLv: 6, slotType: 'active',
        name: '特斯拉磁暴线圈', element: 'storm',
        movement: 'stand_channel', delivery: 'ground_zone', zoneSec: 3.4,
        power: 1.78, healPct: 0.08, shieldSec: 2.8, cd: 7.4, range: 240, zRadius: 38,
        status: { kind: 'shock', sec: 4.5 },
        fxMain: 'lightning/tesla-coil', fxHit: 'lightning/spark-arc',
        desc: '部署磁暴电塔持续电击周围敌军，完美触发元素连携！',
    },
    s5: {
        id: 's5', school: 'storm', unlockLv: 9, slotType: 'active',
        name: '狂暴连锁闪电', element: 'storm',
        movement: 'stand_channel', delivery: 'beam_sweep',
        power: 2.08, cd: 7.0, range: 260, zRadius: 40,
        status: { kind: 'shock', sec: 4.8 },
        fxMain: 'lightning/chain-lightning', fxHit: 'impacts/crit-hit',
        desc: '释放跳跃电弧横扫敌阵，对多目标与随从小怪特效拔群。',
    },
    s6: {
        id: 's6', school: 'storm', unlockLv: 11, slotType: 'ultimate',
        name: '奥义·九霄雷云天谴', element: 'storm',
        movement: 'stand_channel', delivery: 'sky_strike',
        power: 2.98, cd: 12.2, range: 350, zRadius: 52,
        status: { kind: 'shock', sec: 5.5 },
        fxCast: 'lightning/storm-cloud', fxMain: 'lightning/lightning-strike', fxHit: 'explosions/big-explosion',
        desc: '召唤雷暴乌云降下毁灭天雷，引爆全场超载！',
    },
    s7: {
        id: 's7', school: 'storm', unlockLv: 5, slotType: 'active', secretScroll: true,
        name: '秘传·雷电长鞭抽击', element: 'storm',
        movement: 'step_in', delivery: 'melee_combo', hits: 2,
        power: 1.52, cd: 4.3, range: 115, zRadius: 30, knockback: 22,
        status: { kind: 'shock', sec: 4.2 },
        fxMain: 'melee/whip-crack', fxHit: 'lightning/zap-hit',
        desc: '中距离雷鞭破空抽打，安全试探并挂感电。',
    },

    // =========================================================================
    // 5. ARCANE & SHADOW (星界奥术 · 虚空法球 / 生命汲取 / 黑洞聚怪 / 毁灭光束)
    // =========================================================================
    a1: {
        id: 'a1', school: 'arcane', unlockLv: 1, slotType: 'active',
        name: '虚空暗影球', element: 'arcane',
        movement: 'backflip_shot', delivery: 'linear_proj', projSpeed: 270,
        power: 1.06, cd: 2.1, range: 320, zRadius: 21,
        status: { kind: 'curse', sec: 3.8 },
        fxMain: 'shadow/void-orb', fxHit: 'explosions/cartoon-pow',
        desc: '发射幽邃虚空法球，附带暗影奥术印记。',
    },
    a2: {
        id: 'a2', school: 'arcane', unlockLv: 2, slotType: 'active',
        name: '追踪奥术飞弹', element: 'arcane',
        movement: 'stand_channel', delivery: 'sky_strike',
        power: 1.38, cd: 3.5, range: 300, zRadius: 34,
        status: { kind: 'curse', sec: 4.0 },
        fxMain: 'arcane/arcane-missiles', fxHit: 'impacts/crit-hit',
        desc: '齐射多枚自动锁定 Z 轴的奥术飞弹，难以闪避。',
    },
    a3: {
        id: 'a3', school: 'arcane', unlockLv: 4, slotType: 'active',
        name: '暗影生命汲取', element: 'arcane',
        movement: 'stand_channel', delivery: 'beam_sweep',
        power: 1.56, cd: 5.4, range: 210, zRadius: 28, lifesteal: 0.32,
        status: { kind: 'curse', sec: 4.2 },
        fxMain: 'shadow/life-steal', fxHit: 'shadow/dark-explosion',
        desc: '连接暗影锁链抽取敌方生命，高达 32% 伤害转为自身血量！',
    },
    a4: {
        id: 'a4', school: 'arcane', unlockLv: 6, slotType: 'active',
        name: '时间凝滞法阵', element: 'arcane',
        movement: 'stand_channel', delivery: 'ground_zone', zoneSec: 3.0,
        power: 1.35, cd: 7.6, range: 260, zRadius: 42,
        status: { kind: 'snare', sec: 1.4 },
        fxMain: 'arcane/time-stop', fxHit: 'arcane/rune-circle',
        desc: '展开时间凝滞领域禁锢区域内敌人，为队友大招创造靶子。',
    },
    a5: {
        id: 'a5', school: 'arcane', unlockLv: 9, slotType: 'active',
        name: '深渊引力黑洞', element: 'arcane',
        movement: 'stand_channel', delivery: 'ground_zone', zoneSec: 2.8, pullForce: true,
        power: 2.12, cd: 7.8, range: 270, zRadius: 50,
        status: { kind: 'curse', sec: 5.0 },
        fxMain: 'shadow/black-hole', fxHit: 'explosions/implosion',
        desc: '生成引力黑洞将散落在不同 Z 轴的敌人强行聚拢到中心！',
    },
    a6: {
        id: 'a6', school: 'arcane', unlockLv: 11, slotType: 'ultimate',
        name: '奥义·星陨毁灭光束', element: 'arcane',
        movement: 'stand_channel', delivery: 'beam_sweep',
        power: 3.05, cd: 12.6, range: 380, zRadius: 44, knockback: 36,
        status: { kind: 'curse', sec: 5.5 },
        fxCast: 'arcane/magic-circle-cast', fxMain: 'arcane/star-fall', fxHit: 'arcane/arcane-beam',
        desc: '群星坠落并轰出贯穿整个战场的超巨型奥术毁灭光束！',
    },
    a7: {
        id: 'a7', school: 'arcane', unlockLv: 5, slotType: 'active', secretScroll: true,
        name: '秘传·冥界鬼手禁锢', element: 'arcane',
        movement: 'stand_channel', delivery: 'ground_zone', zoneSec: 2.6,
        power: 1.52, cd: 4.8, range: 250, zRadius: 34,
        status: { kind: 'snare', sec: 1.5 },
        fxMain: 'shadow/grasping-hands', fxHit: 'shadow/curse',
        desc: '从地底伸出暗影魔爪死死抓住敌人双脚。',
    },

    // =========================================================================
    // 6. HOLY & NATURE (圣光自然 · 藤蔓毒潭 / 荆棘反伤 / 团队回血 / 圣光裁决)
    // =========================================================================
    h1: {
        id: 'h1', school: 'holy', unlockLv: 1, slotType: 'active',
        name: '荆棘藤鞭抽击', element: 'nature',
        movement: 'step_in', delivery: 'melee_combo', hits: 2,
        power: 1.02, cd: 1.9, range: 96, zRadius: 28,
        status: { kind: 'poison', sec: 4.0 },
        fxMain: 'nature/vine-whip', fxHit: 'explosions/cartoon-pow',
        desc: '挥舞带刺藤蔓中距离抽击，附带森毒持续伤害。',
    },
    h2: {
        id: 'h2', school: 'holy', unlockLv: 2, slotType: 'active',
        name: '腐蚀剧毒泥潭', element: 'nature',
        movement: 'backflip_shot', delivery: 'ground_zone', zoneSec: 3.6,
        power: 1.36, cd: 3.8, range: 260, zRadius: 38,
        status: { kind: 'poison', sec: 4.8 },
        fxMain: 'nature/toxic-puddle', fxHit: 'nature/spore-burst',
        desc: '投掷毒液在地面形成剧毒泥潭，踩入火球瞬间剧毒爆燃！',
    },
    h3: {
        id: 'h3', school: 'holy', unlockLv: 4, slotType: 'active',
        name: '自然根须缠绕', element: 'nature',
        movement: 'stand_channel', delivery: 'sky_strike',
        power: 1.52, cd: 5.2, range: 260, zRadius: 34,
        status: { kind: 'snare', sec: 1.65 },
        fxMain: 'nature/root-snare', fxHit: 'nature/earth-spike',
        desc: '唤起大地岩刺与树根定身目标 1.65 秒。',
    },
    h4: {
        id: 'h4', school: 'holy', unlockLv: 6, slotType: 'active',
        name: '复苏治愈圣环', element: 'holy',
        movement: 'stand_channel', delivery: 'aura_ward', teamHeal: true,
        power: 0.70, healPct: 0.19, shieldSec: 3.4, cd: 8.0, range: 120, zRadius: 50,
        fxMain: 'nature/healing-bloom', fxHit: 'holy/heal-aoe',
        desc: '绽放生命之花，同时为自己与 2v2 队友回复生命值！',
    },
    h5: {
        id: 'h5', school: 'holy', unlockLv: 9, slotType: 'active',
        name: '神圣不灭荆棘盾', element: 'holy',
        movement: 'stand_channel', delivery: 'aura_ward', teamHeal: true,
        power: 1.30, healPct: 0.12, shieldSec: 5.0, cd: 8.4, range: 110, zRadius: 42,
        fxMain: 'holy/divine-shield', fxHit: 'holy/smite',
        desc: '全队加持神圣金盾并神罚震击近身敌人。',
    },
    h6: {
        id: 'h6', school: 'holy', unlockLv: 11, slotType: 'ultimate',
        name: '奥义·天界圣光裁决', element: 'holy',
        movement: 'stand_channel', delivery: 'sky_strike', teamHeal: true,
        power: 2.82, healPct: 0.14, cd: 12.2, range: 350, zRadius: 54,
        fxCast: 'holy/blessing', fxMain: 'holy/holy-pillar', fxHit: 'holy/sunburst',
        desc: '降下宏伟天界圣光柱净化全场敌军，并为全队抬血！',
    },
    h7: {
        id: 'h7', school: 'holy', unlockLv: 5, slotType: 'active', secretScroll: true,
        name: '秘传·森罗飓风呼唤', element: 'nature',
        movement: 'stand_channel', delivery: 'linear_proj', projSpeed: 210,
        power: 1.54, cd: 4.9, range: 310, zRadius: 34, launchVy: -6.4,
        status: { kind: 'poison', sec: 4.2 },
        fxMain: 'nature/tornado', fxHit: 'nature/leaf-storm',
        desc: '卷起翠绿狂风向前推进，将沿途敌人吹飞至半空！',
    },
};

export const ALL_SKILL_IDS = Object.keys(SKILL_CATALOG);

export function getSkillById(skillId) {
    return SKILL_CATALOG[skillId] || null;
}

export function getSkillsBySchool(schoolId) {
    return Object.values(SKILL_CATALOG).filter(s => s.school === schoolId);
}

/**
 * Compute all skills available to a pet given its level + the player's global unlocked scroll pool.
 */
export function getAvailableSkillsForPet(pet, globalUnlockedPool = []) {
    const lv = Math.max(1, Number(pet?.level) || 1);
    const school = pet?.archetype || 'martial';
    const unlockedSet = new Set(Array.isArray(globalUnlockedPool) ? globalUnlockedPool : []);

    return Object.values(SKILL_CATALOG).filter(sk => {
        if (sk.school === school && !sk.secretScroll && sk.unlockLv <= lv)
            return true;
        return unlockedSet.has(sk.id);
    });
}

/**
 * Normalize a pet's 4-slot skill loadout: [active1, active2, active3, ultimate].
 * Ensures no duplicates, valid IDs, and fills empty slots with unlocked school skills.
 */
export function normalizeSkillLoadout(pet, globalUnlockedPool = []) {
    const available = getAvailableSkillsForPet(pet, globalUnlockedPool);
    const availIds = new Set(available.map(s => s.id));
    const schoolSkills = getSkillsBySchool(pet?.archetype || 'martial').filter(s => !s.secretScroll);

    // Fallback ensure at least lv1 starter skill exists
    if (availIds.size === 0 && schoolSkills[0])
        availIds.add(schoolSkills[0].id);

    const raw = Array.isArray(pet?.equippedSkills) ? pet.equippedSkills : [];
    const actives = [];
    let ult = null;

    for (const id of raw) {
        const sk = SKILL_CATALOG[id];
        if (!sk || !availIds.has(id))
            continue;
        if (sk.slotType === 'ultimate') {
            if (!ult)
                ult = id;
        } else if (actives.length < 3 && !actives.includes(id)) {
            actives.push(id);
        }
    }

    // Auto-fill active slots with highest unlocked school skills first, then any unlocked active
    const candidateActives = [
        ...available.filter(s => s.slotType === 'active' && s.school === pet?.archetype).sort((a, b) => b.unlockLv - a.unlockLv),
        ...available.filter(s => s.slotType === 'active' && s.school !== pet?.archetype),
    ];
    for (const sk of candidateActives) {
        if (actives.length >= 3)
            break;
        if (!actives.includes(sk.id))
            actives.push(sk.id);
    }

    if (!ult) {
        const candidateUlts = available.filter(s => s.slotType === 'ultimate');
        const ownUlt = candidateUlts.find(s => s.school === pet?.archetype);
        ult = (ownUlt || candidateUlts[0])?.id || null;
    }

    return [...actives, ...(ult ? [ult] : [])];
}

/**
 * Resolve full skill objects for combat from a fighter packet or pet record.
 */
export function resolveCombatSkillList(fighterOrPet, globalUnlockedPool = []) {
    if (Array.isArray(fighterOrPet?.equippedSkills) && fighterOrPet.equippedSkills.length > 0) {
        const valid = fighterOrPet.equippedSkills
            .map(id => SKILL_CATALOG[id])
            .filter(Boolean);
        if (valid.length > 0)
            return valid;
    }
    const ids = normalizeSkillLoadout(fighterOrPet, globalUnlockedPool);
    const list = ids.map(id => SKILL_CATALOG[id]).filter(Boolean);
    return list.length > 0 ? list : [SKILL_CATALOG.m1];
}

/**
 * One-Click Smart Loadout Recommender!
 * Supports 'combo' (synergizes with 2v2 partner element!), 'burst' (high offense), or 'sustain' (shield/lifesteal/control).
 */
export function recommendSkillLoadout(pet, style = 'combo', globalUnlockedPool = [], partnerArchetype = null) {
    const avail = getAvailableSkillsForPet(pet, globalUnlockedPool);
    const actives = avail.filter(s => s.slotType === 'active');
    const ults = avail.filter(s => s.slotType === 'ultimate');

    const partnerElemMap = {
        fire: ['ice', 'storm', 'nature'],
        ice: ['fire', 'storm'],
        storm: ['ice', 'fire', 'arcane'],
        arcane: ['holy', 'storm'],
        holy: ['arcane', 'fire'],
        martial: ['fire', 'ice', 'storm'],
    };
    const synergyElems = new Set(partnerElemMap[partnerArchetype || pet.archetype] || ['fire', 'ice']);

    const scoreActive = sk => {
        let score = sk.power * 10 + (sk.school === pet.archetype ? 4 : 0);
        if (style === 'combo') {
            if (synergyElems.has(sk.element))
                score += 14;
            if (sk.status)
                score += 6;
            if (sk.delivery === 'ground_zone' || sk.delivery === 'sky_strike')
                score += 4;
        } else if (style === 'burst') {
            score += sk.power * 12;
            if (sk.movement === 'blink_behind' || sk.movement === 'leap_slam')
                score += 8;
        } else if (style === 'sustain') {
            if (sk.healPct || sk.lifesteal || sk.shieldSec)
                score += 22;
            if (sk.status?.kind === 'snare' || sk.status?.kind === 'stun' || sk.status?.kind === 'chill')
                score += 10;
        }
        return score;
    };

    const pickedActives = [...actives]
        .sort((a, b) => scoreActive(b) - scoreActive(a))
        .slice(0, 3)
        .map(s => s.id);

    const bestUlt = [...ults]
        .sort((a, b) => (b.school === pet.archetype ? 1 : 0) - (a.school === pet.archetype ? 1 : 0) || b.power - a.power)[0];

    return [...pickedActives, ...(bestUlt ? [bestUlt.id] : [])];
}
