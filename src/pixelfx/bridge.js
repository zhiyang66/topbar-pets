import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { createFrame, clearFrame, createFx, composite } from './core/index.js';

// Melee & Martial
import * as clawSwipe from './fx/melee/claw-swipe.js';
import * as doubleSlash from './fx/melee/double-slash.js';
import * as hammerSmash from './fx/melee/hammer-smash.js';
import * as heavyCleave from './fx/melee/heavy-cleave.js';
import * as spinSlash from './fx/melee/spin-slash.js';
import * as uppercut from './fx/melee/uppercut.js';
import * as daggerFlurry from './fx/melee/dagger-flurry.js';
import * as scytheReap from './fx/melee/scythe-reap.js';
import * as spearSweep from './fx/melee/spear-sweep.js';
import * as whipCrack from './fx/melee/whip-crack.js';
import * as swordSlash from './fx/melee/sword-slash.js';
import * as thrust from './fx/melee/thrust.js';

// Fire
import * as fireball from './fx/fire/fireball.js';
import * as fireBreath from './fx/fire/fire-breath.js';
import * as fireRing from './fx/fire/fire-ring.js';
import * as flamePillar from './fx/fire/flame-pillar.js';
import * as fireTornado from './fx/fire/fire-tornado.js';
import * as meteor from './fx/fire/meteor.js';
import * as campfire from './fx/fire/campfire.js';
import * as flamethrower from './fx/fire/flamethrower.js';
import * as spiritFlame from './fx/fire/spirit-flame.js';

// Ice
import * as iceLance from './fx/ice/ice-lance.js';
import * as frostBreath from './fx/ice/frost-breath.js';
import * as iceCrystal from './fx/ice/ice-crystal.js';
import * as frostNova from './fx/ice/frost-nova.js';
import * as iceSpikes from './fx/ice/ice-spikes.js';
import * as blizzardVortex from './fx/ice/blizzard-vortex.js';
import * as icicleFall from './fx/ice/icicle-fall.js';
import * as iceShatter from './fx/ice/ice-shatter.js';
import * as freeze from './fx/ice/freeze.js';

// Lightning & Storm
import * as sparkArc from './fx/lightning/spark-arc.js';
import * as zapHit from './fx/lightning/zap-hit.js';
import * as electrified from './fx/lightning/electrified.js';
import * as plasmaBall from './fx/lightning/plasma-ball.js';
import * as chargeUp from './fx/lightning/charge-up.js';
import * as chainLightning from './fx/lightning/chain-lightning.js';
import * as thunderclap from './fx/lightning/thunderclap.js';
import * as lightningStrike from './fx/lightning/lightning-strike.js';
import * as ballLightning from './fx/lightning/ball-lightning.js';
import * as stormCloud from './fx/lightning/storm-cloud.js';
import * as teslaCoil from './fx/lightning/tesla-coil.js';

// Arcane & Shadow
import * as arcaneMissiles from './fx/arcane/arcane-missiles.js';
import * as arcaneOrb from './fx/arcane/arcane-orb.js';
import * as blinkOut from './fx/arcane/blink-out.js';
import * as blinkIn from './fx/arcane/blink-in.js';
import * as magicCircleCast from './fx/arcane/magic-circle-cast.js';
import * as timeStop from './fx/arcane/time-stop.js';
import * as starFall from './fx/arcane/star-fall.js';
import * as arcaneBeam from './fx/arcane/arcane-beam.js';
import * as portal from './fx/arcane/portal.js';
import * as runeCircle from './fx/arcane/rune-circle.js';
import * as manaBurst from './fx/arcane/mana-burst.js';
import * as blackHole from './fx/shadow/black-hole.js';
import * as darkExplosion from './fx/shadow/dark-explosion.js';
import * as graspingHands from './fx/shadow/grasping-hands.js';
import * as lifeSteal from './fx/shadow/life-steal.js';
import * as voidOrb from './fx/shadow/void-orb.js';
import * as shadowTendrils from './fx/shadow/shadow-tendrils.js';
import * as curse from './fx/shadow/curse.js';

// Holy & Nature
import * as vineWhip from './fx/nature/vine-whip.js';
import * as leafStorm from './fx/nature/leaf-storm.js';
import * as earthSpike from './fx/nature/earth-spike.js';
import * as poisonCloud from './fx/nature/poison-cloud.js';
import * as healingBloom from './fx/nature/healing-bloom.js';
import * as boulder from './fx/nature/boulder.js';
import * as quake from './fx/nature/quake.js';
import * as rootSnare from './fx/nature/root-snare.js';
import * as thorns from './fx/nature/thorns.js';
import * as tornado from './fx/nature/tornado.js';
import * as toxicPuddle from './fx/nature/toxic-puddle.js';
import * as sporeBurst from './fx/nature/spore-burst.js';
import * as healAoe from './fx/holy/heal-aoe.js';
import * as divineShield from './fx/holy/divine-shield.js';
import * as holyPillar from './fx/holy/holy-pillar.js';
import * as smite from './fx/holy/smite.js';
import * as sunburst from './fx/holy/sunburst.js';
import * as blessing from './fx/holy/blessing.js';
import * as featherBurst from './fx/holy/feather-burst.js';
import * as resurrection from './fx/holy/resurrection.js';

// Impacts, Explosions, Spawn, Status & UI
import * as hitFlash from './fx/impacts/hit-flash.js';
import * as critHit from './fx/impacts/crit-hit.js';
import * as shieldBlock from './fx/impacts/shield-block.js';
import * as parry from './fx/impacts/parry.js';
import * as groundSlam from './fx/impacts/ground-slam.js';
import * as heavyLanding from './fx/impacts/heavy-landing.js';
import * as cartoonPow from './fx/explosions/cartoon-pow.js';
import * as bigExplosion from './fx/explosions/big-explosion.js';
import * as plasmaExplosion from './fx/explosions/plasma-explosion.js';
import * as implosion from './fx/explosions/implosion.js';
import * as smokeBomb from './fx/explosions/smoke-bomb.js';
import * as poof from './fx/spawn/poof.js';
import * as spawnPortal from './fx/spawn/spawn-portal.js';
import * as respawnBeam from './fx/spawn/respawn-beam.js';
import * as soulRise from './fx/spawn/soul-rise.js';
import * as coinDrop from './fx/spawn/coin-drop.js';
import * as eggHatch from './fx/spawn/egg-hatch.js';
import * as summonRise from './fx/spawn/summon-rise.js';
import * as shatterDeath from './fx/spawn/shatter-death.js';

// Status Effects
import * as statusBurning from './fx/status/burning.js';
import * as statusFrozen from './fx/status/frozen.js';
import * as statusPoisoned from './fx/status/poisoned.js';
import * as statusBleeding from './fx/status/bleeding.js';
import * as statusRage from './fx/status/rage.js';
import * as statusStunned from './fx/status/stunned.js';
import * as statusSlowed from './fx/status/slowed.js';
import * as statusHaste from './fx/status/haste.js';
import * as statusCursed from './fx/status/cursed.js';

// UI Banners & Numbers
import * as damageNumber from './fx/ui/damage-number.js';
import * as critNumber from './fx/ui/crit-number.js';
import * as countdown from './fx/ui/countdown.js';
import * as levelUp from './fx/ui/level-up.js';
import * as confetti from './fx/ui/confetti.js';
import * as achievement from './fx/ui/achievement.js';
import * as coinCollect from './fx/ui/coin-collect.js';
import * as comboCounter from './fx/ui/combo-counter.js';
import * as questComplete from './fx/ui/quest-complete.js';

export const FX_MODULES = {
    'melee/claw-swipe': clawSwipe,
    'melee/double-slash': doubleSlash,
    'melee/hammer-smash': hammerSmash,
    'melee/heavy-cleave': heavyCleave,
    'melee/spin-slash': spinSlash,
    'melee/uppercut': uppercut,
    'melee/dagger-flurry': daggerFlurry,
    'melee/scythe-reap': scytheReap,
    'melee/spear-sweep': spearSweep,
    'melee/whip-crack': whipCrack,
    'melee/sword-slash': swordSlash,
    'melee/thrust': thrust,

    'fire/fireball': fireball,
    'fire/fire-breath': fireBreath,
    'fire/fire-ring': fireRing,
    'fire/flame-pillar': flamePillar,
    'fire/fire-tornado': fireTornado,
    'fire/meteor': meteor,
    'fire/campfire': campfire,
    'fire/flamethrower': flamethrower,
    'fire/spirit-flame': spiritFlame,

    'ice/ice-lance': iceLance,
    'ice/frost-breath': frostBreath,
    'ice/ice-crystal': iceCrystal,
    'ice/frost-nova': frostNova,
    'ice/ice-spikes': iceSpikes,
    'ice/blizzard-vortex': blizzardVortex,
    'ice/icicle-fall': icicleFall,
    'ice/ice-shatter': iceShatter,
    'ice/freeze': freeze,

    'lightning/spark-arc': sparkArc,
    'lightning/zap-hit': zapHit,
    'lightning/electrified': electrified,
    'lightning/plasma-ball': plasmaBall,
    'lightning/charge-up': chargeUp,
    'lightning/chain-lightning': chainLightning,
    'lightning/thunderclap': thunderclap,
    'lightning/lightning-strike': lightningStrike,
    'lightning/ball-lightning': ballLightning,
    'lightning/storm-cloud': stormCloud,
    'lightning/tesla-coil': teslaCoil,

    'arcane/arcane-missiles': arcaneMissiles,
    'arcane/arcane-orb': arcaneOrb,
    'arcane/blink-out': blinkOut,
    'arcane/blink-in': blinkIn,
    'arcane/magic-circle-cast': magicCircleCast,
    'arcane/time-stop': timeStop,
    'arcane/star-fall': starFall,
    'arcane/arcane-beam': arcaneBeam,
    'arcane/portal': portal,
    'arcane/rune-circle': runeCircle,
    'arcane/mana-burst': manaBurst,
    'shadow/black-hole': blackHole,
    'shadow/dark-explosion': darkExplosion,
    'shadow/grasping-hands': graspingHands,
    'shadow/life-steal': lifeSteal,
    'shadow/void-orb': voidOrb,
    'shadow/shadow-tendrils': shadowTendrils,
    'shadow/curse': curse,

    'nature/vine-whip': vineWhip,
    'nature/leaf-storm': leafStorm,
    'nature/earth-spike': earthSpike,
    'nature/poison-cloud': poisonCloud,
    'nature/healing-bloom': healingBloom,
    'nature/boulder': boulder,
    'nature/quake': quake,
    'nature/root-snare': rootSnare,
    'nature/thorns': thorns,
    'nature/tornado': tornado,
    'nature/toxic-puddle': toxicPuddle,
    'nature/spore-burst': sporeBurst,
    'holy/heal-aoe': healAoe,
    'holy/divine-shield': divineShield,
    'holy/holy-pillar': holyPillar,
    'holy/smite': smite,
    'holy/sunburst': sunburst,
    'holy/blessing': blessing,
    'holy/feather-burst': featherBurst,
    'holy/resurrection': resurrection,

    'impacts/hit-flash': hitFlash,
    'impacts/crit-hit': critHit,
    'impacts/shield-block': shieldBlock,
    'impacts/parry': parry,
    'impacts/ground-slam': groundSlam,
    'impacts/heavy-landing': heavyLanding,
    'explosions/cartoon-pow': cartoonPow,
    'explosions/big-explosion': bigExplosion,
    'explosions/plasma-explosion': plasmaExplosion,
    'explosions/implosion': implosion,
    'explosions/smoke-bomb': smokeBomb,
    'spawn/poof': poof,
    'spawn/spawn-portal': spawnPortal,
    'spawn/respawn-beam': respawnBeam,
    'spawn/soul-rise': soulRise,
    'spawn/coin-drop': coinDrop,
    'spawn/egg-hatch': eggHatch,
    'spawn/summon-rise': summonRise,
    'spawn/shatter-death': shatterDeath,

    'status/burning': statusBurning,
    'status/frozen': statusFrozen,
    'status/poisoned': statusPoisoned,
    'status/bleeding': statusBleeding,
    'status/rage': statusRage,
    'status/stunned': statusStunned,
    'status/slowed': statusSlowed,
    'status/haste': statusHaste,
    'status/cursed': statusCursed,

    'ui/damage-number': damageNumber,
    'ui/crit-number': critNumber,
    'ui/countdown': countdown,
    'ui/level-up': levelUp,
    'ui/confetti': confetti,
    'ui/achievement': achievement,
    'ui/coin-collect': coinCollect,
    'ui/combo-counter': comboCounter,
    'ui/quest-complete': questComplete,
};

/**
 * High-speed nearest-neighbor integer upscaler for RGBA pixel buffers.
 */
function upscaleNearestRgba(src, srcW, srcH, dst, scale) {
    if (scale <= 1) {
        dst.set(src);
        return;
    }
    const dstW = srcW * scale;
    const src32 = new Uint32Array(src.buffer, src.byteOffset, srcW * srcH);
    const dst32 = new Uint32Array(dst.buffer, dst.byteOffset, dstW * srcH * scale);

    for (let y = 0; y < srcH; y++) {
        const srcRow = y * srcW;
        const baseDstRow = y * scale * dstW;
        let outIdx = baseDstRow;
        for (let x = 0; x < srcW; x++) {
            const px = src32[srcRow + x];
            for (let sx = 0; sx < scale; sx++)
                dst32[outIdx++] = px;
        }
        for (let sy = 1; sy < scale; sy++) {
            dst32.copyWithin(baseDstRow + sy * dstW, baseDstRow, baseDstRow + dstW);
        }
    }
}

/**
 * Push raw RGBA Uint8Array into an St.ImageContent across GNOME 45–50+.
 */
function uploadRgbaToContent(content, rgbaBytes, width, height) {
    const gbytes = GLib.Bytes.new(rgbaBytes);
    const rowstride = width * 4;
    if (content.set_bytes.length >= 6) {
        const coglContext = global.stage.context.get_backend().get_cogl_context();
        content.set_bytes(coglContext, gbytes, Cogl.PixelFormat.RGBA_8888, width, height, rowstride);
    } else {
        content.set_bytes(gbytes, Cogl.PixelFormat.RGBA_8888, width, height, rowstride);
    }
}

/**
 * Fast sparse RGBA compositor tailored for transparent battle/desktop surfaces:
 * skips empty pixels ((c | l) === 0) with a single 32-bit write (~10x faster on 660x224 arenas!).
 */
function compositeFastTransparentRgba(f, outBytes, out32, lightK = 1) {
    const n = f.w * f.h;
    const C = f.color;
    const L = f.light;
    for (let i = 0; i < n; i++) {
        const c = C[i];
        const l = L[i] & 0xffffff;
        if ((c | l) === 0) {
            out32[i] = 0;
            continue;
        }
        const ca = c >>> 24;
        let r = c & 255;
        let g = (c >>> 8) & 255;
        let b = (c >>> 16) & 255;
        let a = ca;
        if (l) {
            const lr = (l & 255) * lightK;
            const lg = ((l >>> 8) & 255) * lightK;
            const lb = ((l >>> 16) & 255) * lightK;
            if (a < 255) {
                const pa = a / 255;
                const pr = r * pa + lr;
                const pg = g * pa + lg;
                const pb = b * pa + lb;
                const na = Math.min(1, Math.max(pa, Math.max(lr, lg, lb) / 255));
                if (na > 0) {
                    r = Math.min(255, pr / na);
                    g = Math.min(255, pg / na);
                    b = Math.min(255, pb / na);
                    a = na * 255;
                }
            } else {
                r = Math.min(255, r + lr);
                g = Math.min(255, g + lg);
                b = Math.min(255, b + lb);
            }
        }
        const j = i * 4;
        outBytes[j] = r;
        outBytes[j + 1] = g;
        outBytes[j + 2] = b;
        outBytes[j + 3] = a;
    }
}

const MAX_ACTIVE_SURFACE_FX = 8;

/**
 * Real-time PixelFX rendering surface backed by an St.ImageContent.
 * Allocates buffers once and renders active effects at crisp 1x/2x/3x pixel scale!
 */
export class PixelFxSurface {
    constructor(logicalW = 240, logicalH = 115, pixelScale = 2) {
        this.logicalW = logicalW;
        this.logicalH = logicalH;
        this.pixelScale = Math.max(1, Math.round(pixelScale));
        this.displayW = logicalW * this.pixelScale;
        this.displayH = logicalH * this.pixelScale;

        this._frame = createFrame(logicalW, logicalH);
        this._rgba1x = new Uint8Array(logicalW * logicalH * 4);
        this._rgba1x32 = new Uint32Array(this._rgba1x.buffer);
        this._rgbaOut = this.pixelScale === 1
            ? this._rgba1x
            : new Uint8Array(this.displayW * this.displayH * 4);

        this._instances = [];
        this._wasDirty = false;
        this.content = new St.ImageContent({
            preferred_width: this.displayW,
            preferred_height: this.displayH,
        });
    }

    spawn(fxId, opts = {}) {
        const mod = FX_MODULES[fxId];
        if (!mod)
            return null;

        // Cap simultaneous particle simulations so 2v2 / Boss waves never overload software rendering!
        if (this._instances.length >= MAX_ACTIVE_SURFACE_FX) {
            const evictIdx = this._instances.findIndex(it => !it._manualLifetime);
            if (evictIdx >= 0)
                this._instances.splice(evictIdx, 1);
            else
                return null;
        }

        try {
            const { manualLifetime = false, maxDuration = null, ...fxOpts } = opts;
            const inst = createFx(mod, {
                seed: Math.floor(Math.random() * 9999) + 1,
                ...fxOpts,
            });
            const baseDur = Number(mod.meta?.duration) || 1.0;
            inst._manualLifetime = Boolean(manualLifetime);
            if (manualLifetime) {
                inst._maxLifeSec = maxDuration ?? 3.2;
            } else if (mod.meta?.loop) {
                inst._maxLifeSec = maxDuration ?? Math.min(1.25, Math.max(0.55, baseDur * 0.95));
            } else {
                inst._maxLifeSec = maxDuration ?? (baseDur + 0.25);
            }
            inst._hardKillSec = inst._maxLifeSec + 0.36;
            this._instances.push(inst);
            return inst;
        } catch (err) {
            console.warn(`[TopBarPet PixelFX] Failed to spawn ${fxId}:`, err);
            return null;
        }
    }

    removeInstance(inst) {
        if (!inst)
            return;
        const idx = this._instances.indexOf(inst);
        if (idx >= 0)
            this._instances.splice(idx, 1);
    }

    clear() {
        this._instances = [];
        this._wasDirty = false;
        clearFrame(this._frame);
        this._rgba1x32.fill(0);
        if (this._rgbaOut !== this._rgba1x)
            this._rgbaOut.fill(0);
        uploadRgbaToContent(this.content, this._rgbaOut, this.displayW, this.displayH);
    }

    hasActiveEffects() {
        return this._instances.length > 0;
    }

    step(dtSec) {
        if (this._instances.length === 0) {
            if (this._wasDirty) {
                this._wasDirty = false;
                clearFrame(this._frame);
                this._rgba1x32.fill(0);
                if (this._rgbaOut !== this._rgba1x)
                    this._rgbaOut.fill(0);
                uploadRgbaToContent(this.content, this._rgbaOut, this.displayW, this.displayH);
            }
            return false;
        }

        this._wasDirty = true;
        clearFrame(this._frame);

        for (let i = this._instances.length - 1; i >= 0; i--) {
            const fx = this._instances[i];
            try {
                fx.update(dtSec);
                if (fx.t >= fx._maxLifeSec)
                    fx.stop();
                if (fx.done() || fx.t >= fx._hardKillSec) {
                    this._instances.splice(i, 1);
                    continue;
                }
                fx.draw(this._frame);
            } catch (err) {
                console.warn('[TopBarPet PixelFX] Dropped faulty FX instance:', err);
                this._instances.splice(i, 1);
            }
        }

        if (this._instances.length === 0) {
            this._wasDirty = false;
            clearFrame(this._frame);
            this._rgba1x32.fill(0);
            if (this._rgbaOut !== this._rgba1x)
                this._rgbaOut.fill(0);
            uploadRgbaToContent(this.content, this._rgbaOut, this.displayW, this.displayH);
            return false;
        }

        compositeFastTransparentRgba(this._frame, this._rgba1x, this._rgba1x32, 1.0);
        if (this.pixelScale > 1) {
            upscaleNearestRgba(
                this._rgba1x,
                this.logicalW,
                this.logicalH,
                this._rgbaOut,
                this.pixelScale
            );
        }
        uploadRgbaToContent(this.content, this._rgbaOut, this.displayW, this.displayH);
        return true;
    }
}
