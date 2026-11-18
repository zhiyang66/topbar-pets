import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { pixbufToImageContent } from './compat.js';

export const PRESET_FILES = {
    cat: 'pixel-cat.png',
    shiba: 'pixel-shiba.png',
    slime: 'pixel-slime.png',
    robot: 'pixel-robot.png',
    dragon: 'pixel-dragon.png',
    ghost: 'pixel-ghost.png',
};

export const ALL_STATES = [
    'idle', 'walk', 'run', 'sleep', 'happy',
    'drag', 'attack', 'sneak', 'cast', 'hurt',
    'crouch', 'guard',
];

const MAX_GIF_FRAMES = 48;

export function countGifFramesFromBytes(bytes) {
    if (!bytes || bytes.length < 14)
        return 1;
    if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46)
        return 1;

    let pos = 6;
    const packed = bytes[pos + 4];
    pos += 7;
    if (packed & 0x80)
        pos += 3 * (1 << ((packed & 0x07) + 1));

    let frames = 0;
    const len = bytes.length;
    const skipSubBlocks = () => {
        while (pos < len) {
            const blockSize = bytes[pos++];
            if (blockSize === 0)
                break;
            pos += blockSize;
        }
    };

    while (pos < len && frames < MAX_GIF_FRAMES) {
        const introducer = bytes[pos++];
        if (introducer === 0x3B) {
            break;
        } else if (introducer === 0x21) {
            if (pos >= len)
                break;
            pos++;
            skipSubBlocks();
        } else if (introducer === 0x2C) {
            if (pos + 9 > len)
                break;
            frames++;
            const imgPacked = bytes[pos + 8];
            pos += 9;
            if (imgPacked & 0x80)
                pos += 3 * (1 << ((imgPacked & 0x07) + 1));
            if (pos >= len)
                break;
            pos++;
            skipSubBlocks();
        } else {
            break;
        }
    }
    return Math.max(1, frames);
}

/**
 * Edge-connected flood-fill background removal for AI-generated sprite frames!
 * Removes solid white/green/magenta/grey outer backgrounds while preserving interior eye whites.
 */
function floodKeyBackground(pixbuf, tolerance = 32) {
    const w = pixbuf.get_width();
    const h = pixbuf.get_height();
    if (w < 4 || h < 4)
        return pixbuf;

    const rgba = pixbuf.add_alpha(false, 0, 0, 0);
    const rowstride = rgba.get_rowstride();
    const nChan = rgba.get_n_channels();
    if (nChan < 4)
        return rgba;

    const bytes = rgba.get_pixels();
    // Check if corners are already transparent
    const cornerCoords = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
    let opaqueCorners = 0;
    let bgR = 0, bgG = 0, bgB = 0;
    for (const [cx, cy] of cornerCoords) {
        const idx = cy * rowstride + cx * 4;
        if (bytes[idx + 3] > 230) {
            opaqueCorners++;
            bgR = bytes[idx];
            bgG = bytes[idx + 1];
            bgB = bytes[idx + 2];
        }
    }
    if (opaqueCorners < 3)
        return rgba; // Already has alpha channel transparency!

    const outBuf = new Uint8Array(bytes);
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let qHead = 0;
    let qTail = 0;

    const matchesBg = (x, y) => {
        const i = y * rowstride + x * 4;
        if (outBuf[i + 3] < 16)
            return true;
        return (
            Math.abs(outBuf[i] - bgR) <= tolerance &&
            Math.abs(outBuf[i + 1] - bgG) <= tolerance &&
            Math.abs(outBuf[i + 2] - bgB) <= tolerance
        );
    };

    const enqueue = (x, y) => {
        const p = y * w + x;
        if (visited[p] || !matchesBg(x, y))
            return;
        visited[p] = 1;
        queue[qTail++] = p;
    };

    for (let x = 0; x < w; x++) {
        enqueue(x, 0);
        enqueue(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
        enqueue(0, y);
        enqueue(w - 1, y);
    }

    while (qHead < qTail) {
        const p = queue[qHead++];
        const x = p % w;
        const y = (p / w) | 0;
        const i = y * rowstride + x * 4;
        outBuf[i + 3] = 0;

        if (x > 0)
            enqueue(x - 1, y);
        if (x + 1 < w)
            enqueue(x + 1, y);
        if (y > 0)
            enqueue(x, y - 1);
        if (y + 1 < h)
            enqueue(x, y + 1);
    }

    return GdkPixbuf.Pixbuf.new_from_bytes(
        GLib.Bytes.new(outBuf),
        GdkPixbuf.Colorspace.RGB,
        true,
        8,
        w,
        h,
        rowstride
    );
}

/**
 * Create a pure-white silhouette flash version of a Pixbuf for arcade hit feedback.
 */
function makeWhiteFlashPixbuf(pixbuf) {
    const w = pixbuf.get_width();
    const h = pixbuf.get_height();
    const rgba = pixbuf.get_has_alpha() ? pixbuf : pixbuf.add_alpha(false, 0, 0, 0);
    const rowstride = rgba.get_rowstride();
    const src = rgba.get_pixels();
    const dst = new Uint8Array(src);

    for (let y = 0; y < h; y++) {
        const row = y * rowstride;
        for (let x = 0; x < w; x++) {
            const i = row + x * 4;
            if (dst[i + 3] > 25) {
                dst[i] = 255;
                dst[i + 1] = 250;
                dst[i + 2] = 240;
            }
        }
    }

    return GdkPixbuf.Pixbuf.new_from_bytes(
        GLib.Bytes.new(dst),
        GdkPixbuf.Colorspace.RGB,
        true,
        8,
        w,
        h,
        rowstride
    );
}

function decodeAnimationFile(filePath, autoKeyBg = false) {
    const file = Gio.File.new_for_path(filePath);
    if (!file.query_exists(null))
        return null;

    let frameCount = 1;
    try {
        const [ok, rawBytes] = file.load_contents(null);
        if (ok && rawBytes)
            frameCount = countGifFramesFromBytes(rawBytes);
    } catch (_e) {
        frameCount = 16;
    }

    const anim = GdkPixbuf.PixbufAnimation.new_from_file(filePath);
    if (anim.is_static_image()) {
        let pb = anim.get_static_image().copy();
        if (autoKeyBg)
            pb = floodKeyBackground(pb);
        return [{ pixbuf: pb, delayMs: 130 }];
    }

    const tv = new GLib.TimeVal();
    tv.tv_sec = 0;
    tv.tv_usec = 0;
    const iter = anim.get_iter(tv);

    const frames = [];
    const totalToRead = Math.min(MAX_GIF_FRAMES, Math.max(1, frameCount));

    for (let i = 0; i < totalToRead; i++) {
        const currentPb = iter.get_pixbuf();
        if (currentPb) {
            const rawDelay = iter.get_delay_time();
            const delayMs = rawDelay > 15 ? rawDelay : 90;
            let pb = currentPb.copy();
            if (autoKeyBg)
                pb = floodKeyBackground(pb);
            frames.push({ pixbuf: pb, delayMs });

            const totalUsec = tv.tv_sec * 1000000 + tv.tv_usec + delayMs * 1000;
            tv.tv_sec = Math.floor(totalUsec / 1000000);
            tv.tv_usec = totalUsec % 1000000;
            iter.advance(tv);
        }
    }
    return frames.length > 0 ? frames : null;
}

function decodeSpriteSheet(filePath, opts) {
    const file = Gio.File.new_for_path(filePath);
    if (!file.query_exists(null))
        return null;

    const sheet = GdkPixbuf.Pixbuf.new_from_file(filePath);
    const cols = Math.max(1, opts.cols || 4);
    let rows = Math.max(1, opts.rows || 12);
    const cellW = Math.max(1, sheet.get_width() / cols);
    const estSquareRows = Math.round(sheet.get_height() / cellW);
    if ((rows === 10 || rows === 12) && (estSquareRows === 10 || estSquareRows === 12) && Math.abs((sheet.get_height() / cellW) - estSquareRows) < 0.22) {
        rows = estSquareRows;
    }
    const frameW = Math.max(1, Math.floor(sheet.get_width() / cols));
    const frameH = Math.max(1, Math.floor(sheet.get_height() / rows));
    const baseDelay = Math.round(1000 / Math.max(1, opts.fps || 8));
    const autoKeyBg = Boolean(opts.autoKeyBg);

    const clampRow = r => Math.max(0, Math.min(rows - 1, r));
    const rowMap = {
        idle: clampRow(opts.idleRow ?? 0),
        walk: clampRow(opts.walkRow ?? 1),
        run: clampRow(opts.runRow ?? 2),
        sleep: clampRow(opts.sleepRow ?? 3),
        happy: clampRow(opts.happyRow ?? 4),
        drag: clampRow(opts.dragRow ?? 5),
        attack: clampRow(opts.attackRow ?? 6),
        sneak: clampRow(opts.sneakRow ?? 7),
        cast: clampRow(opts.castRow ?? 8),
        hurt: clampRow(opts.hurtRow ?? 9),
        crouch: clampRow(opts.crouchRow ?? (rows >= 12 ? 10 : 7)),
        guard: clampRow(opts.guardRow ?? (rows >= 12 ? 11 : 0)),
    };

    const stateDelays = {
        idle: Math.round(baseDelay * 1.6),
        walk: baseDelay,
        run: Math.max(45, Math.round(baseDelay * 0.65)),
        sleep: Math.round(baseDelay * 2.4),
        happy: Math.max(55, Math.round(baseDelay * 0.85)),
        drag: Math.round(baseDelay * 1.1),
        attack: Math.max(46, Math.round(baseDelay * 0.68)),
        sneak: Math.round(baseDelay * 1.85),
        cast: Math.max(55, Math.round(baseDelay * 0.85)),
        hurt: Math.max(60, Math.round(baseDelay * 0.9)),
        crouch: Math.round(baseDelay * 1.4),
        guard: Math.round(baseDelay * 1.2),
    };

    const rawStates = {};
    for (const state of ALL_STATES) {
        const r = rowMap[state];
        const list = [];
        for (let c = 0; c < cols; c++) {
            let sub = sheet.new_subpixbuf(c * frameW, r * frameH, frameW, frameH).copy();
            if (autoKeyBg)
                sub = floodKeyBackground(sub);
            list.push({
                pixbuf: sub,
                delayMs: stateDelays[state],
            });
        }
        rawStates[state] = list;
    }
    return rawStates;
}

function compileStateFrames(rawFrames, targetHeight, interpType, baseFacingRight, withHitFlash = false) {
    return rawFrames.map(({ pixbuf, delayMs }) => {
        const origW = Math.max(1, pixbuf.get_width());
        const origH = Math.max(1, pixbuf.get_height());
        const scaledH = Math.max(12, targetHeight);
        const scaledW = Math.max(12, Math.round(scaledH * (origW / origH)));

        const scaled = pixbuf.scale_simple(scaledW, scaledH, interpType);
        const flipped = scaled.flip(true);

        const rightPb = baseFacingRight ? scaled : flipped;
        const leftPb = baseFacingRight ? flipped : scaled;

        const entry = {
            right: pixbufToImageContent(rightPb),
            left: pixbufToImageContent(leftPb),
            delayMs,
            width: scaledW,
            height: scaledH,
        };

        if (withHitFlash) {
            entry.flashRight = pixbufToImageContent(makeWhiteFlashPixbuf(rightPb));
            entry.flashLeft = pixbufToImageContent(makeWhiteFlashPixbuf(leftPb));
        }

        return entry;
    });
}

/**
 * Load a complete 10-state GPU frame bank for ANY individual Pet Profile
 * (local adopted pet OR remote LAN visitor/challenger pet!).
 */
export function loadSpriteBankForProfile(extensionPath, profile = {}, renderOpts = {}) {
    const mode = profile.skinMode || 'preset';
    const targetHeight = Math.max(16, Math.min(112, renderOpts.targetHeight || 32));
    const pixelCrisp = renderOpts.pixelCrisp !== false;
    const interp = pixelCrisp ? GdkPixbuf.InterpType.NEAREST : GdkPixbuf.InterpType.BILINEAR;
    let baseFacingRight = profile.baseFacingRight !== false;

    let rawStates = null;

    if (mode === 'gif') {
        const defaultDemoGif = GLib.build_filenamev([
            extensionPath, 'assets', 'sprites', 'demo-rainbow-cat.gif',
        ]);
        const mainPath = (profile.customPath || '').trim() || defaultDemoGif;
        let mainFrames = null;
        try {
            mainFrames = decodeAnimationFile(mainPath, Boolean(profile.autoRemoveBg));
        } catch (_e) {
            mainFrames = null;
        }
        if (!mainFrames)
            mainFrames = decodeAnimationFile(defaultDemoGif, false);

        if (mainFrames) {
            const fast = mainFrames.map(f => ({ pixbuf: f.pixbuf, delayMs: Math.max(32, Math.round(f.delayMs * 0.6)) }));
            const slow = mainFrames.map(f => ({ pixbuf: f.pixbuf, delayMs: Math.round(f.delayMs * 1.6) }));
            const still = [{ pixbuf: mainFrames[0].pixbuf, delayMs: 320 }];
            rawStates = {
                idle: slow,
                walk: mainFrames,
                run: fast,
                sleep: still,
                happy: fast,
                drag: mainFrames,
                attack: fast,
                sneak: slow,
                cast: fast,
                hurt: [mainFrames[0]],
                crouch: slow,
                guard: still,
            };
        }
    } else if (mode === 'spritesheet') {
        const sheetPath = (profile.customPath || '').trim();
        if (sheetPath) {
            try {
                rawStates = decodeSpriteSheet(sheetPath, {
                    cols: profile.cols || 4,
                    rows: profile.rows || 10,
                    fps: profile.fps || 8,
                    autoKeyBg: profile.autoRemoveBg !== false,
                });
            } catch (e) {
                console.warn(`[TopBarPet] Custom sprite sheet failed "${sheetPath}":`, e);
            }
        }
    }

    if (!rawStates) {
        const presetId = profile.presetId || 'cat';
        const filename = PRESET_FILES[presetId] || PRESET_FILES.cat;
        const presetPath = GLib.build_filenamev([extensionPath, 'assets', 'sprites', filename]);
        baseFacingRight = true;
        rawStates = decodeSpriteSheet(presetPath, {
            cols: 4,
            rows: 12,
            fps: 8,
            autoKeyBg: false,
        });
    }

    const compiled = {};
    let refWidth = targetHeight;
    let refHeight = targetHeight;

    for (const state of ALL_STATES) {
        const compiledFrames = compileStateFrames(
            rawStates[state],
            targetHeight,
            interp,
            baseFacingRight,
            state === 'hurt' || state === 'idle'
        );
        compiled[state] = compiledFrames;
        if (state === 'walk' && compiledFrames.length > 0) {
            refWidth = compiledFrames[0].width;
            refHeight = compiledFrames[0].height;
        }
    }

    return {
        states: compiled,
        width: refWidth,
        height: refHeight,
    };
}

/**
 * Compute a stable skin hash for LAN sync & export custom files (<= 384KB) as base64.
 */
export function getSkinSyncDescriptor(profile) {
    const mode = profile.skinMode || 'preset';
    if (mode === 'preset' || !profile.customPath) {
        return {
            skinHash: `preset:${profile.presetId || 'cat'}`,
            isCustom: false,
        };
    }

    const path = profile.customPath.trim();
    const hash = GLib.compute_checksum_for_string(
        GLib.ChecksumType.SHA256,
        `${mode}:${path}:${profile.cols || 4}:${profile.rows || 10}:${profile.baseFacingRight !== false}`,
        -1
    ).slice(0, 16);

    return {
        skinHash: `custom:${hash}`,
        isCustom: true,
        filePath: path,
        skinMode: mode,
        cols: profile.cols || 4,
        rows: profile.rows || 10,
        baseFacingRight: profile.baseFacingRight !== false,
        autoRemoveBg: profile.autoRemoveBg !== false,
    };
}

export function encodeCustomSkinBase64(profile) {
    const desc = getSkinSyncDescriptor(profile);
    if (!desc.isCustom || !desc.filePath)
        return null;
    try {
        const file = Gio.File.new_for_path(desc.filePath);
        if (!file.query_exists(null))
            return null;
        const [ok, bytes] = file.load_contents(null);
        if (!ok || !bytes || bytes.length > 393216) // Cap at 384 KB for safe LAN transfer
            return null;
        const ext = desc.filePath.toLowerCase().endsWith('.gif') ? 'gif' : 'png';
        return {
            skinHash: desc.skinHash,
            skinMode: desc.skinMode,
            ext,
            cols: desc.cols,
            rows: desc.rows,
            baseFacingRight: desc.baseFacingRight,
            autoRemoveBg: desc.autoRemoveBg,
            base64: GLib.base64_encode(bytes),
        };
    } catch (_e) {
        return null;
    }
}

export function cacheRemoteCustomSkin(payload) {
    if (!payload?.skinHash || !payload?.base64)
        return null;
    try {
        const cacheDir = GLib.build_filenamev([GLib.get_tmp_dir(), 'topbar-pet-lan-skins']);
        GLib.mkdir_with_parents(cacheDir, 0o700);
        const safeId = payload.skinHash.replace(/[^a-zA-Z0-9_-]/g, '_');
        const ext = payload.ext === 'gif' ? 'gif' : 'png';
        const outPath = GLib.build_filenamev([cacheDir, `${safeId}.${ext}`]);
        const rawBytes = GLib.base64_decode(payload.base64);
        GLib.file_set_contents(outPath, rawBytes);
        return {
            skinMode: payload.skinMode === 'gif' ? 'gif' : 'spritesheet',
            customPath: outPath,
            cols: Number(payload.cols) || 4,
            rows: Number(payload.rows) || 10,
            baseFacingRight: payload.baseFacingRight !== false,
            autoRemoveBg: payload.autoRemoveBg !== false,
        };
    } catch (_e) {
        return null;
    }
}
