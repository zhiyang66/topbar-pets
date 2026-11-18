import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { addChromeActor, removeChromeActor, boxLayoutProps } from './compat.js';
import { PixelFxSurface, FX_MODULES } from './pixelfx/bridge.js';

/**
 * Manages non-intrusive visual effects (PixelFX bursts, Level-Up / Achievement / Quest toasts,
 * particles, widget recoil & crowd-throttled 2D anti-overlap speech bubbles).
 */
export class EffectsManager {
    constructor() {
        this._particles = new Set();
        this._fxBursts = new Set();
        this._shakenWidgets = new Map();
        this._bubbles = new Map(); // ownerKey -> { actor, getAnchorRect, createdAt, timerId }
        this._bubbleLayoutTimerId = 0;
        this._bubbleSeq = 0;
        this._maxConcurrentBubbles = 2;
        this._ecoMode = false;
        this._levelToast = null;
        this._levelToastTimerId = 0;
    }

    setEcoMode(enabled) {
        this._ecoMode = Boolean(enabled);
    }

    isEcoMode() {
        return this._ecoMode;
    }

    setMaxConcurrentBubbles(limit = 2) {
        this._maxConcurrentBubbles = Math.max(1, Math.min(4, Number(limit) || 2));
    }

    destroy() {
        this._clearAllBubbles();
        this._clearLevelToast();
        for (const b of this._fxBursts) {
            if (b.timerId)
                GLib.Source.remove(b.timerId);
            if (b.widget) {
                removeChromeActor(b.widget);
                b.widget.destroy();
            }
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
            if (p.get_parent())
                p.destroy();
        }
        this._particles.clear();
    }

    joltPanelWidget(widget, dirSign = 1) {
        if (this._ecoMode || !widget || !widget.get_stage?.())
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
        if (this._ecoMode || !Main.layoutManager?.uiGroup)
            return;

        // Reuse pooled St.Label on uiGroup: zero addChrome/destroy churn & zero St/Clutter warnings!
        let label = null;
        for (const cand of this._particles) {
            if (!cand._busy && cand.get_stage?.()) {
                label = cand;
                break;
            }
        }
        if (!label) {
            if (this._particles.size >= 18)
                return;
            label = new St.Label({
                text: String(symbol || '✨'),
                style_class: 'topbar-pet-particle',
                reactive: false,
                visible: false,
            });
            label._busy = false;
            label.connect('destroy', () => {
                this._particles.delete(label);
            });
            Main.layoutManager.uiGroup.add_child(label);
            this._particles.add(label);
        }

        label.remove_all_transitions();
        label._busy = true;
        label.text = String(symbol || '✨');
        label.opacity = 255;
        const jitterX = Math.round((Math.random() - 0.5) * 18);
        label.set_position(Math.round(x + jitterX), Math.round(y));
        label.show();

        label.ease({
            y: Math.round(y - rise),
            x: Math.round(x + jitterX * 1.5),
            opacity: 0,
            duration: 860,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._particles.has(label)) {
                    label._busy = false;
                    label.hide();
                }
            },
        });
    }

    spawnBurst(x, y, symbols = ['❤️', '✨'], count = 3) {
        if (this._ecoMode)
            return;
        for (let i = 0; i < count; i++) {
            const sym = symbols[i % symbols.length];
            const ox = (i - (count - 1) / 2) * 10;
            this.spawnParticle(x + ox, y + 4, sym, 20 + i * 5);
        }
    }

    /**
     * Play a crisp patch-gg/pixelfx effect on the desktop stage (100% click-through).
     * Automatically adapts canvas size to the FX module's metadata so wide banners/coins never clip!
     */
    spawnPixelFxBurst(centerX, footY, fxId = 'ui/level-up', pixelScale = 1, extraOpts = {}) {
        if (this._ecoMode)
            return;
        const mod = FX_MODULES[fxId];
        if (!mod)
            return;

        const metaW = Number(mod.meta?.size?.[0]) || 96;
        const metaH = Number(mod.meta?.size?.[1]) || 96;
        const origX = Number(mod.meta?.origin?.[0]) || Math.round(metaW / 2);
        const origY = Number(mod.meta?.origin?.[1]) || Math.round(metaH * 0.75);

        const logW = Math.max(92, metaW + 16);
        const logH = Math.max(92, metaH + 16);
        const spawnX = Math.round(logW / 2);
        const spawnY = Math.min(logH - 8, Math.max(24, origY + 8));

        const surf = new PixelFxSurface(logW, logH, pixelScale);
        if (!surf.spawn(fxId, { x: spawnX, y: spawnY, ...extraOpts }))
            return;

        const widget = new St.Widget({
            width: surf.displayW,
            height: surf.displayH,
            reactive: false,
        });
        widget.set_content(surf.content);
        widget.set_position(
            Math.round(centerX - surf.displayW / 2),
            Math.max(0, Math.round(footY - spawnY * pixelScale))
        );

        addChromeActor(widget, { interactive: false, trackFullscreen: true });
        const entry = { widget, timerId: 0 };
        widget.connect('destroy', () => {
            entry.widget = null;
            if (entry.timerId) {
                GLib.Source.remove(entry.timerId);
                entry.timerId = 0;
            }
            this._fxBursts.delete(entry);
        });
        this._fxBursts.add(entry);

        const fxPriority = (Clutter.PRIORITY_REDRAW || 150) + 15;
        entry.timerId = GLib.timeout_add(fxPriority, 33, () => {
            if (!entry.widget || !surf.step(0.033)) {
                entry.timerId = 0;
                this._fxBursts.delete(entry);
                if (entry.widget) {
                    const w = entry.widget;
                    entry.widget = null;
                    removeChromeActor(w);
                    w.destroy();
                }
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    showBannerToast(titleText, subText, fxId = null, durationMs = 4200) {
        this._clearLevelToast();

        const box = new St.BoxLayout(boxLayoutProps(true, {
            style_class: 'topbar-pet-levelup-toast',
            reactive: false,
            opacity: 0,
        }));

        const title = new St.Label({
            text: titleText,
            style_class: 'topbar-pet-levelup-title',
        });
        const sub = new St.Label({
            text: subText,
            style_class: 'topbar-pet-levelup-sub',
        });

        box.add_child(title);
        box.add_child(sub);
        box.connect('destroy', () => {
            if (this._levelToast === box)
                this._levelToast = null;
        });
        addChromeActor(box, { interactive: false, trackFullscreen: true });
        this._levelToast = box;

        const panelBox = Main.layoutManager.panelBox;
        const px = Number.isFinite(panelBox?.x) ? panelBox.x : 0;
        const py = Number.isFinite(panelBox?.y) ? panelBox.y : 0;
        const pw = (panelBox?.width > 64) ? panelBox.width : 1280;
        const ph = panelBox?.height || 32;
        const [, natW] = box.get_preferred_width(-1);
        const w = Math.max(260, natW);
        const centerX = Math.round(px + pw / 2);

        if (fxId && !this._ecoMode)
            this.spawnPixelFxBurst(centerX, py + ph + 54, fxId, 1);

        box.set_position(Math.round(px + (pw - w) / 2), py + ph + 8);
        box.ease({
            opacity: 255,
            y: py + ph + 14,
            duration: 240,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._levelToastTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, durationMs, () => {
            this._levelToastTimerId = 0;
            if (!this._levelToast)
                return GLib.SOURCE_REMOVE;
            const dying = this._levelToast;
            dying.ease({
                opacity: 0,
                duration: 320,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        if (this._levelToast === dying)
                            this._clearLevelToast();
                        return GLib.SOURCE_REMOVE;
                    });
                },
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    showLevelUpToast(pet, archBadge, unlockedSkills = []) {
        const skillStr = unlockedSkills.length > 0
            ? `  ·  ✨解锁新技能：${unlockedSkills.map(s => `【${s.name}】`).join(' ')}`
            : '';
        this.showBannerToast(
            `🎉 升级提示！「${pet.name}」升至 Lv.${pet.level} [${archBadge}]`,
            `最大生命与攻击力成长，可在配招工坊自由混搭！${skillStr}`,
            null,
            4400
        );
    }

    showAchievementToast(ach) {
        if (!ach)
            return;
        this.showBannerToast(
            `🏆 解锁荣耀成就 · 【${ach.title}】！`,
            `${ach.desc}（已可在设置/菜单佩戴该联机头衔 ✨）`,
            'ui/achievement',
            4800
        );
    }

    showQuestCompleteToast(titleText, subText) {
        this.showBannerToast(titleText, subText, 'ui/quest-complete', 5200);
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

    showBubble(getAnchorRect, text, durationMs = 2600, ownerKey = 'default', highPriority = false) {
        if (Main.layoutManager._startingUp)
            return;
        if (this._ecoMode && !highPriority)
            return;

        this._clearBubbleByKey(ownerKey);

        // Enforce strict crowd-governance concurrent bubble limit (default max 2 on screen!)
        if (this._bubbles.size >= this._maxConcurrentBubbles) {
            let oldestKey = null;
            let oldestSeq = Infinity;
            for (const [k, v] of this._bubbles.entries()) {
                if (v.createdAt < oldestSeq) {
                    oldestSeq = v.createdAt;
                    oldestKey = k;
                }
            }
            if (oldestKey)
                this._clearBubbleByKey(oldestKey);
        }

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
        bubble.connect('destroy', () => {
            entry.actor = null;
            if (entry.timerId) {
                GLib.Source.remove(entry.timerId);
                entry.timerId = 0;
            }
            if (this._bubbles.get(ownerKey) === entry)
                this._bubbles.delete(ownerKey);
        });
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
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        if (this._bubbles.get(ownerKey) === entry)
                            this._clearBubbleByKey(ownerKey);
                        return GLib.SOURCE_REMOVE;
                    });
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

    _layoutAllBubbles() {
        const panelBox = Main.layoutManager?.panelBox;
        const panelX = panelBox?.x ?? 0;
        const panelY = panelBox?.y ?? 0;
        const panelW = panelBox?.width || 1280;
        const panelH = panelBox?.height ?? 32;
        const mon = Main.layoutManager?.primaryMonitor;
        const screenBottom = (Number.isFinite(mon?.y) ? mon.y : panelY) + ((mon?.height > 120) ? mon.height : 1080);

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
            const panelBottom = panelY + panelH;
            const placeAbove = rect.y > panelBottom + 44;
            const baseY = placeAbove
                ? Math.round(Math.max(panelBottom + 4, rect.y - h - 6))
                : Math.round(Math.max(panelBottom + 5, rect.y + rect.height + 4));

            items.push({
                entry,
                w,
                h,
                anchorCenterX,
                baseY,
                stackUp: placeAbove,
                x: 0,
                y: baseY,
            });
        }

        if (items.length === 0)
            return;

        if (items.length >= 2) {
            const byX = [...items].sort((a, b) => a.anchorCenterX - b.anchorCenterX);
            for (let i = 0; i < byX.length; i++) {
                const cur = byX[i];
                let bias = 0.5;
                const prev = byX[i - 1];
                const next = byX[i + 1];
                if (next && Math.abs(next.anchorCenterX - cur.anchorCenterX) < 220)
                    bias = 0.72;
                else if (prev && Math.abs(cur.anchorCenterX - prev.anchorCenterX) < 220)
                    bias = 0.28;

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
                if (item.stackUp && hit.y - item.h - PAD_Y >= panelY + panelH + 4)
                    y = hit.y - item.h - PAD_Y;
                else
                    y = hit.y + hit.h + PAD_Y;
                guard += 1;
            }
            item.y = Math.max(panelY + panelH + 4, Math.min(screenBottom - item.h - 4, Math.round(y)));
            placed.push(item);
            item.entry.actor.set_position(item.x, item.y);
        }
    }

    clearBubbleByKey(ownerKey) {
        this._clearBubbleByKey(ownerKey);
    }

    clearAllBubbles() {
        this._clearAllBubbles();
    }

    _clearBubbleByKey(ownerKey) {
        const entry = this._bubbles.get(ownerKey);
        if (!entry)
            return;
        this._bubbles.delete(ownerKey);
        if (entry.timerId) {
            GLib.Source.remove(entry.timerId);
            entry.timerId = 0;
        }
        if (entry.actor) {
            const act = entry.actor;
            entry.actor = null;
            act.remove_all_transitions();
            removeChromeActor(act);
            act.destroy();
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
