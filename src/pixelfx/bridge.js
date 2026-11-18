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

// Fire
import * as fireball from './fx/fire/fireball.js';
import * as fireBreath from './fx/fire/fire-breath.js';
import * as fireRing from './fx/fire/fire-ring.js';
import * as flamePillar from './fx/fire/flame-pillar.js';
import * as fireTornado from './fx/fire/fire-tornado.js';
import * as meteor from './fx/fire/meteor.js';

// Ice
import * as iceLance from './fx/ice/ice-lance.js';
import * as frostBreath from './fx/ice/frost-breath.js';
import * as iceCrystal from './fx/ice/ice-crystal.js';
import * as frostNova from './fx/ice/frost-nova.js';
import * as iceSpikes from './fx/ice/ice-spikes.js';
import * as blizzardVortex from './fx/ice/blizzard-vortex.js';

// Lightning & Storm
import * as sparkArc from './fx/lightning/spark-arc.js';
import * as zapHit from './fx/lightning/zap-hit.js';
import * as electrified from './fx/lightning/electrified.js';
import * as plasmaBall from './fx/lightning/plasma-ball.js';
import * as chargeUp from './fx/lightning/charge-up.js';
import * as chainLightning from './fx/lightning/chain-lightning.js';
import * as thunderclap from './fx/lightning/thunderclap.js';
import * as lightningStrike from './fx/lightning/lightning-strike.js';

// Arcane & Shadow
import * as arcaneMissiles from './fx/arcane/arcane-missiles.js';
import * as arcaneOrb from './fx/arcane/arcane-orb.js';
import * as blinkOut from './fx/arcane/blink-out.js';
import * as blinkIn from './fx/arcane/blink-in.js';
import * as magicCircleCast from './fx/arcane/magic-circle-cast.js';
import * as timeStop from './fx/arcane/time-stop.js';
import * as starFall from './fx/arcane/star-fall.js';
import * as arcaneBeam from './fx/arcane/arcane-beam.js';
import * as blackHole from './fx/shadow/black-hole.js';
import * as darkExplosion from './fx/shadow/dark-explosion.js';

// Holy & Nature
import * as vineWhip from './fx/nature/vine-whip.js';
import * as leafStorm from './fx/nature/leaf-storm.js';
import * as earthSpike from './fx/nature/earth-spike.js';
import * as poisonCloud from './fx/nature/poison-cloud.js';
import * as healingBloom from './fx/nature/healing-bloom.js';
import * as healAoe from './fx/holy/heal-aoe.js';
import * as divineShield from './fx/holy/divine-shield.js';
import * as holyPillar from './fx/holy/holy-pillar.js';
import * as smite from './fx/holy/smite.js';

// Impacts, Explosions, Spawn & UI
import * as hitFlash from './fx/impacts/hit-flash.js';
import * as critHit from './fx/impacts/crit-hit.js';
import * as shieldBlock from './fx/impacts/shield-block.js';
import * as parry from './fx/impacts/parry.js';
import * as groundSlam from './fx/impacts/ground-slam.js';
import * as cartoonPow from './fx/explosions/cartoon-pow.js';
import * as bigExplosion from './fx/explosions/big-explosion.js';
import * as poof from './fx/spawn/poof.js';
import * as spawnPortal from './fx/spawn/spawn-portal.js';
import * as respawnBeam from './fx/spawn/respawn-beam.js';
import * as soulRise from './fx/spawn/soul-rise.js';
import * as damageNumber from './fx/ui/damage-number.js';
import * as critNumber from './fx/ui/crit-number.js';
import * as countdown from './fx/ui/countdown.js';
import * as levelUp from './fx/ui/level-up.js';
import * as confetti from './fx/ui/confetti.js';
import * as achievement from './fx/ui/achievement.js';

export const FX_MODULES = {
    'melee/claw-swipe': clawSwipe,
    'melee/double-slash': doubleSlash,
    'melee/hammer-smash': hammerSmash,
    'melee/heavy-cleave': heavyCleave,
    'melee/spin-slash': spinSlash,
    'melee/uppercut': uppercut,
    'melee/dagger-flurry': daggerFlurry,

    'fire/fireball': fireball,
    'fire/fire-breath': fireBreath,
    'fire/fire-ring': fireRing,
    'fire/flame-pillar': flamePillar,
    'fire/fire-tornado': fireTornado,
    'fire/meteor': meteor,

    'ice/ice-lance': iceLance,
    'ice/frost-breath': frostBreath,
    'ice/ice-crystal': iceCrystal,
    'ice/frost-nova': frostNova,
    'ice/ice-spikes': iceSpikes,
    'ice/blizzard-vortex': blizzardVortex,

    'lightning/spark-arc': sparkArc,
    'lightning/zap-hit': zapHit,
    'lightning/electrified': electrified,
    'lightning/plasma-ball': plasmaBall,
    'lightning/charge-up': chargeUp,
    'lightning/chain-lightning': chainLightning,
    'lightning/thunderclap': thunderclap,
    'lightning/lightning-strike': lightningStrike,

    'arcane/arcane-missiles': arcaneMissiles,
    'arcane/arcane-orb': arcaneOrb,
    'arcane/blink-out': blinkOut,
    'arcane/blink-in': blinkIn,
    'arcane/magic-circle-cast': magicCircleCast,
    'arcane/time-stop': timeStop,
    'arcane/star-fall': starFall,
    'arcane/arcane-beam': arcaneBeam,
    'shadow/black-hole': blackHole,
    'shadow/dark-explosion': darkExplosion,

    'nature/vine-whip': vineWhip,
    'nature/leaf-storm': leafStorm,
    'nature/earth-spike': earthSpike,
    'nature/poison-cloud': poisonCloud,
    'nature/healing-bloom': healingBloom,
    'holy/heal-aoe': healAoe,
    'holy/divine-shield': divineShield,
    'holy/holy-pillar': holyPillar,
    'holy/smite': smite,

    'impacts/hit-flash': hitFlash,
    'impacts/crit-hit': critHit,
    'impacts/shield-block': shieldBlock,
    'impacts/parry': parry,
    'impacts/ground-slam': groundSlam,
    'explosions/cartoon-pow': cartoonPow,
    'explosions/big-explosion': bigExplosion,
    'spawn/poof': poof,
    'spawn/spawn-portal': spawnPortal,
    'spawn/respawn-beam': respawnBeam,
    'spawn/soul-rise': soulRise,
    'ui/damage-number': damageNumber,
    'ui/crit-number': critNumber,
    'ui/countdown': countdown,
    'ui/level-up': levelUp,
    'ui/confetti': confetti,
    'ui/achievement': achievement,
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
        // Fill first scaled scanline
        let outIdx = baseDstRow;
        for (let x = 0; x < srcW; x++) {
            const px = src32[srcRow + x];
            for (let sx = 0; sx < scale; sx++)
                dst32[outIdx++] = px;
        }
        // Duplicate scanline (scale - 1) times
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
 * Real-time PixelFX rendering surface backed by an St.ImageContent.
 * Allocates buffers once and renders active effects at crisp 2x/3x pixel scale!
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
        const { manualLifetime = false, maxDuration = null, ...fxOpts } = opts;
        const inst = createFx(mod, {
            seed: Math.floor(Math.random() * 9999) + 1,
            ...fxOpts,
        });
        const baseDur = Number(mod.meta?.duration) || 1.0;
        if (manualLifetime) {
            // Projectile-attached FX: lives while flying, safety auto-stop after 2.6s
            inst._maxLifeSec = maxDuration ?? 2.6;
        } else if (mod.meta?.loop) {
            // Prevent looping effects (fireball, ice-lance, fire-ring, divine-shield, etc.) from lingering forever!
            inst._maxLifeSec = maxDuration ?? Math.min(1.15, Math.max(0.55, baseDur * 0.9));
        } else {
            inst._maxLifeSec = maxDuration ?? (baseDur + 0.25);
        }
        inst._hardKillSec = inst._maxLifeSec + 0.36;
        this._instances.push(inst);
        return inst;
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
        this._rgba1x.fill(0);
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
                this._rgba1x.fill(0);
                this._rgbaOut.fill(0);
                uploadRgbaToContent(this.content, this._rgbaOut, this.displayW, this.displayH);
            }
            return false;
        }

        this._wasDirty = true;
        clearFrame(this._frame);

        for (let i = this._instances.length - 1; i >= 0; i--) {
            const fx = this._instances[i];
            fx.update(dtSec);
            if (fx.t >= fx._maxLifeSec)
                fx.stop();
            if (fx.done() || fx.t >= fx._hardKillSec) {
                this._instances.splice(i, 1);
                continue;
            }
            fx.draw(this._frame);
        }

        if (this._instances.length === 0) {
            this._wasDirty = false;
            clearFrame(this._frame);
            this._rgba1x.fill(0);
            this._rgbaOut.fill(0);
            uploadRgbaToContent(this.content, this._rgbaOut, this.displayW, this.displayH);
            return false;
        }

        composite(this._frame, this._rgba1x, null, 1.0);
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
