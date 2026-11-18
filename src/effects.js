import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { addChromeActor, removeChromeActor, boxLayoutProps } from './compat.js';
import { PixelFxSurface } from './pixelfx/bridge.js';

/**
 * Manages non-intrusive visual effects (PixelFX bursts, Level-Up toast, particles, widget recoil & bubbles).
 */
export class EffectsManager {
    constructor() {
        this._particles = new Set();
        this._fxBursts = new Set();
        this._shakenWidgets = new Map();
        this._bubbles = new Map(); // ownerKey -> { actor, getAnchorRect, createdAt, timerId }
        this._bubbleLayoutTimerId = 0;
        this._bubbleSeq = 0;
        this._levelToast = null;
        this._levelToastTimerId = 0;
    }

    destroy() {
        this._clearAllBubbles();
        this._clearLevelToast();
        for (const b of this._fxBursts) {
            if (b.timerId)
                GLib.Source.remove(b.timerId);
            removeChromeActor(b.widget);
            b.widget.destroy();
        }
        this._fxBursts.clear();

        for (const [w, timerId] of this._shakenWidgets.entries()) {
            if (timerId)
                GLib.Source.remove(timerId);
            try {
                w.remove_all_transitions();
                w.translation_x = 0;
                w.translation_y = 0;
            } catch (_e) {
                // Widget may already be disposed
            }
        }
        this._shakenWidgets.clear();

        for (const p of this._particles) {
            p.remove_all_transitions();
            removeChromeActor(p);
            p.destroy();
        }
        this._particles.clear();
    }

    joltPanelWidget(widget, dirSign = 1) {
        if (!widget || !widget.get_stage?.())
            return;

        const prevTimer = this._shakenWidgets.get(widget);
        if (prevTimer)
            GLib.Source.remove(prevTimer);

        try {
            widget.remove_all_transitions();
            widget.translation_x = dirSign * 3;
            widget.translation_y = -1;
        } catch (_e) {
            return;
        }

        const step1 = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 65, () => {
            try {
                widget.translation_x = -dirSign * 2;
                widget.translation_y = 1;
            } catch (_e) {
                this._shakenWidgets.delete(widget);
                return GLib.SOURCE_REMOVE;
            }
            const step2 = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 75, () => {
                this._shakenWidgets.delete(widget);
                try {
                    widget.translation_x = 0;
                    widget.translation_y = 0;
                } catch (_e) {
                    // Ignore
                }
                return GLib.SOURCE_REMOVE;
            });
            this._shakenWidgets.set(widget, step2);
            return GLib.SOURCE_REMOVE;
        });
        this._shakenWidgets.set(widget, step1);
    }

    spawnParticle(x, y, symbol = '❤️', rise = 24) {
        const label = new St.Label({
            text: symbol,
            style_class: 'topbar-pet-particle',
            reactive: false,
            opacity: 255,
        });

        const jitterX = Math.round((Math.random() - 0.5) * 18);
        label.set_position(Math.round(x + jitterX), Math.round(y));

        addChromeActor(label, {
            interactive: false,
            trackFullscreen: true,
        });
        this._particles.add(label);

        label.ease({
            y: Math.round(y - rise),
            x: Math.round(x + jitterX * 1.5),
            opacity: 0,
            duration: 900,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._particles.has(label)) {
                    this._particles.delete(label);
                    removeChromeActor(label);
                    label.destroy();
                }
            },
        });
    }

    spawnBurst(x, y, symbols = ['❤️', '✨'], count = 3) {
        for (let i = 0; i < count; i++) {
            const sym = symbols[i % symbols.length];
            const ox = (i - (count - 1) / 2) * 10;
            this.spawnParticle(x + ox, y + 4, sym, 20 + i * 5);
        }
    }

    /**
     * Play a compact 1x patch-gg/pixelfx effect on the desktop stage!
     */
    spawnPixelFxBurst(centerX, footY, fxId = 'ui/level-up', pixelScale = 1) {
        const logW = 92;
        const logH = 92;
        const surf = new PixelFxSurface(logW, logH, pixelScale);
        if (!surf.spawn(fxId, { x: logW / 2, y: Math.round(logH * 0.72) }))
            return;

        const widget = new St.Widget({
            width: surf.displayW,
            height: surf.displayH,
            reactive: false,
        });
        widget.set_content(surf.content);
        widget.set_position(
            Math.round(centerX - surf.displayW / 2),
            Math.max(0, Math.round(footY - surf.displayH * 0.72))
        );

        addChromeActor(widget, { interactive: false, trackFullscreen: true });
        const entry = { widget, timerId: 0 };
        this._fxBursts.add(entry);

        entry.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
            if (!surf.step(0.033)) {
                this._fxBursts.delete(entry);
                removeChromeActor(widget);
                widget.destroy();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * Show a prominent golden Level-Up Notification Banner below the center of the Top Bar!
     */
    showLevelUpToast(pet, archBadge, unlockedSkills = []) {
        this._clearLevelToast();

        const box = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-levelup-toast',
            reactive: false,
            opacity: 0,
        }));

        const title = new St.Label({
            text: `🎉 升级提示！「${pet.name}」升至 Lv.${pet.level} [${archBadge}]`,
            style_class: 'topbar-pet-levelup-title',
        });

        const skillStr = unlockedSkills.length > 0
            ? `  ·  ✨解锁新技能：${unlockedSkills.map(s => `【${s.name}】`).join(' ')}`
            : '';
        const sub = new St.Label({
            text: `最大生命与攻击力全面成长！${skillStr}`,
            style_class: 'topbar-pet-levelup-sub',
        });

        box.add_child(title);
        box.add_child(sub);
        addChromeActor(box, { interactive: false, trackFullscreen: true });
        this._levelToast = box;

        const panelBox = Main.layoutManager.panelBox;
        const px = Number.isFinite(panelBox?.x) ? panelBox.x : 0;
        const py = Number.isFinite(panelBox?.y) ? panelBox.y : 0;
        const pw = (panelBox?.width > 64) ? panelBox.width : 1280;
        const ph = panelBox?.height || 32;
        const [, natW] = box.get_preferred_width(-1);
        const w = Math.max(260, natW);

        box.set_position(Math.round(px + (pw - w) / 2), py + ph + 8);
        box.ease({
            opacity: 255,
            y: py + ph + 14,
            duration: 240,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._levelToastTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4500, () => {
            this._levelToastTimerId = 0;
            if (!this._levelToast)
                return GLib.SOURCE_REMOVE;
            const dying = this._levelToast;
            dying.ease({
                opacity: 0,
                duration: 320,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._levelToast === dying)
                        this._clearLevelToast();
                },
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearLevelToast() {
        if (this._levelToastTimerId) {
            GLib.Source.remove(this._levelToastTimerId);
            this._levelToastTimerId = 0;
        }
        if (this._levelToast) {
            this._levelToast.remove_all_transitions();
            removeChromeActor(this._levelToast);
            this._levelToast.destroy();
            this._levelToast = null;
        }
    }

    showBubble(getAnchorRect, text, durationMs = 2600, ownerKey = 'default') {
        if (Main.layoutManager._startingUp)
            return;
        this._clearBubbleByKey(ownerKey);

        const bubble = new St.Label({
            text,
            style_class: 'topbar-pet-bubble',
            reactive: false,
            opacity: 0,
        });

        addChromeActor(bubble, {
            interactive: false,
            trackFullscreen: true,
        });
        if (!bubble.get_stage?.()) {
            removeChromeActor(bubble);
            bubble.destroy();
            return;
        }

        const entry = {
            actor: bubble,
            getAnchorRect,
            createdAt: ++this._bubbleSeq,
            timerId: 0,
        };
        this._bubbles.set(ownerKey, entry);

        this._layoutAllBubbles();
        this._ensureBubbleLayoutLoop();

        bubble.ease({
            opacity: 255,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        entry.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, durationMs, () => {
            entry.timerId = 0;
            if (this._bubbles.get(ownerKey) !== entry || !entry.actor)
                return GLib.SOURCE_REMOVE;
            entry.actor.ease({
                opacity: 0,
                duration: 240,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._bubbles.get(ownerKey) === entry)
                        this._clearBubbleByKey(ownerKey);
                },
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _ensureBubbleLayoutLoop() {
        if (this._bubbleLayoutTimerId)
            return;
        this._bubbleLayoutTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
            if (this._bubbles.size === 0) {
                this._bubbleLayoutTimerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._layoutAllBubbles();
            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * Multi-Bubble Collision Avoidance Solver:
     * 1) Tries gentle left/right horizontal separation when two nearby pets speak at once;
     * 2) Automatically cascades overlapping bubbles downward into clean vertical rows so text NEVER overlaps!
     */
    _layoutAllBubbles() {
        const panelBox = Main.layoutManager?.panelBox;
        const panelX = panelBox?.x ?? 0;
        const panelY = panelBox?.y ?? 0;
        const panelW = panelBox?.width || 1280;
        const panelH = panelBox?.height ?? 32;

        const items = [];
        for (const [key, entry] of this._bubbles.entries()) {
            if (!entry.actor || !entry.actor.get_stage?.()) {
                this._clearBubbleByKey(key);
                continue;
            }
            const rect = entry.getAnchorRect?.();
            if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y))
                continue;

            const [, natW] = entry.actor.get_preferred_width(-1);
            const [, natH] = entry.actor.get_preferred_height(-1);
            const w = Math.max(48, Number.isFinite(natW) ? natW : 110);
            const h = Math.max(24, Number.isFinite(natH) ? natH : 26);
            const anchorCenterX = rect.x + rect.width / 2;
            const baseY = Math.round(Math.max(panelY + panelH + 5, rect.y + rect.height + 4));

            items.push({
                entry,
                w,
                h,
                anchorCenterX,
                baseY,
                x: 0,
                y: baseY,
            });
        }

        if (items.length === 0)
            return;

        // First compute ideal centered X, with gentle left/right outward bias if multiple bubbles are close!
        if (items.length >= 2) {
            const byX = [...items].sort((a, b) => a.anchorCenterX - b.anchorCenterX);
            for (let i = 0; i < byX.length; i++) {
                const cur = byX[i];
                let bias = 0.5; // centered
                const prev = byX[i - 1];
                const next = byX[i + 1];
                if (next && Math.abs(next.anchorCenterX - cur.anchorCenterX) < 220)
                    bias = 0.72; // shift left pet's bubble slightly left
                else if (prev && Math.abs(cur.anchorCenterX - prev.anchorCenterX) < 220)
                    bias = 0.28; // shift right pet's bubble slightly right

                const minX = panelX + 6;
                const maxX = Math.max(minX + 16, panelX + panelW - cur.w - 6);
                cur.x = Math.max(minX, Math.min(maxX, Math.round(cur.anchorCenterX - cur.w * bias)));
            }
        } else {
            const single = items[0];
            const minX = panelX + 6;
            const maxX = Math.max(minX + 16, panelX + panelW - single.w - 6);
            single.x = Math.max(minX, Math.min(maxX, Math.round(single.anchorCenterX - single.w / 2)));
        }

        // Order by speaking order (older bubble stays steadily on top, newer reply stacks cleanly below if overlapping!)
        items.sort((a, b) => a.entry.createdAt - b.entry.createdAt);

        const placed = [];
        const PAD_X = 8;
        const PAD_Y = 5;

        for (const item of items) {
            let y = item.baseY;
            let guard = 0;
            while (guard < 8) {
                const hit = placed.find(p =>
                    item.x < p.x + p.w + PAD_X &&
                    item.x + item.w + PAD_X > p.x &&
                    y < p.y + p.h + PAD_Y &&
                    y + item.h + PAD_Y > p.y
                );
                if (!hit)
                    break;
                y = hit.y + hit.h + PAD_Y;
                guard += 1;
            }
            item.y = Math.round(y);
            placed.push(item);
            item.entry.actor.set_position(item.x, item.y);
        }
    }

    _clearBubbleByKey(ownerKey) {
        const entry = this._bubbles.get(ownerKey);
        if (!entry)
            return;
        this._bubbles.delete(ownerKey);
        if (entry.timerId)
            GLib.Source.remove(entry.timerId);
        if (entry.actor) {
            entry.actor.remove_all_transitions();
            removeChromeActor(entry.actor);
            entry.actor.destroy();
        }
        if (this._bubbles.size > 0)
            this._layoutAllBubbles();
    }

    _clearAllBubbles() {
        if (this._bubbleLayoutTimerId) {
            GLib.Source.remove(this._bubbleLayoutTimerId);
            this._bubbleLayoutTimerId = 0;
        }
        for (const key of Array.from(this._bubbles.keys()))
            this._clearBubbleByKey(key);
    }
}
