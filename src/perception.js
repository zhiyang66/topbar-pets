import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

function nowTimeStr() {
    const dt = GLib.DateTime.new_now_local();
    return dt ? dt.format('%H:%M') : '';
}

function extractActorReadableLabel(actor) {
    if (!actor)
        return '';
    if (actor instanceof St.Label) {
        const t = (actor.text || '').trim();
        if (t && t.length <= 28)
            return t;
    }
    const acc = (actor.accessible_name || '').trim();
    if (acc && acc.length <= 28)
        return acc;

    if (actor.get_children) {
        for (const ch of actor.get_children()) {
            const sub = extractActorReadableLabel(ch);
            if (sub)
                return sub;
        }
    }
    return '';
}

/**
 * Real-time Desktop Perception Engine:
 * 1. Recursively discovers ALL live widgets/icons on the Top Panel (zero hardcoded whitelist).
 * 2. Listens to Meta.Display & Shell.WindowTracker for newly opened apps & focus switches.
 * 3. Detects top-snapped / maximized app windows right beneath the Top Bar!
 */
export class DesktopPerception {
    constructor({ selfExtensionUuid, onAppLaunched, onAppFocused, onMonitorsChanged }) {
        this._selfUuid = selfExtensionUuid;
        this._onAppLaunched = onAppLaunched;
        this._onAppFocused = onAppFocused;
        this._onMonitorsChanged = onMonitorsChanged;

        this._displaySignals = [];
        this._layoutSignals = [];
        this._pendingTimers = new Set();
        this._lastFocusApp = '';
        this._lastFocusTime = 0;

        if (global.display) {
            this._displaySignals.push(
                global.display.connect('window-created', (_disp, metaWin) => {
                    this._handleWindowCreated(metaWin);
                }),
                global.display.connect('notify::focus-window', () => {
                    this._handleFocusChanged();
                })
            );
        }

        if (Main.layoutManager) {
            this._layoutSignals.push(
                Main.layoutManager.connect('monitors-changed', () => {
                    if (this._onMonitorsChanged)
                        this._onMonitorsChanged();
                })
            );
        }
    }

    destroy() {
        for (const id of this._displaySignals)
            global.display?.disconnect(id);
        this._displaySignals = [];

        for (const id of this._layoutSignals)
            Main.layoutManager?.disconnect(id);
        this._layoutSignals = [];

        for (const tid of this._pendingTimers)
            GLib.Source.remove(tid);
        this._pendingTimers.clear();
    }

    _resolveWindowAppName(metaWin) {
        if (!metaWin)
            return '';
        try {
            const tracker = Shell.WindowTracker.get_default();
            const app = tracker?.get_window_app(metaWin);
            if (app) {
                const name = (app.get_name() || '').trim();
                if (name)
                    return name;
            }
            const wmClass = (metaWin.get_wm_class?.() || '').trim();
            if (wmClass)
                return wmClass;
            const title = (metaWin.get_title?.() || '').trim();
            return title.slice(0, 20);
        } catch (_e) {
            return '';
        }
    }

    _handleWindowCreated(metaWin) {
        if (!metaWin)
            return;
        try {
            if (metaWin.get_window_type() !== Meta.WindowType.NORMAL)
                return;
        } catch (_e) {
            return;
        }

        const tid = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 320, () => {
            this._pendingTimers.delete(tid);
            const appName = this._resolveWindowAppName(metaWin);
            if (appName && this._onAppLaunched) {
                let rect = null;
                try {
                    const r = metaWin.get_frame_rect();
                    rect = { x: r.x, y: r.y, width: r.width, height: r.height };
                } catch (_e) {
                    rect = null;
                }
                this._onAppLaunched({ appName, rect });
            }
            return GLib.SOURCE_REMOVE;
        });
        this._pendingTimers.add(tid);
    }

    _handleFocusChanged() {
        const focusWin = global.display?.focus_window;
        if (!focusWin)
            return;
        const appName = this._resolveWindowAppName(focusWin);
        if (!appName)
            return;

        const now = Date.now();
        if (appName !== this._lastFocusApp && now - this._lastFocusTime > 6000) {
            this._lastFocusApp = appName;
            this._lastFocusTime = now;
            if (this._onAppFocused)
                this._onAppFocused({ appName });
        }
    }

    /**
     * Dynamically discover ALL visible interactive widgets on the Top Bar + focused window roof.
     */
    scanLiveTargets() {
        const results = [];
        if (!Main.panel)
            return results;

        const statusArea = Main.panel.statusArea || {};
        const selfIndicator = statusArea[this._selfUuid];
        const selfContainer = selfIndicator?.container || selfIndicator;
        const dateIndicator = statusArea.dateMenu;
        const dateContainer = dateIndicator?.container || dateIndicator;
        const actIndicator = statusArea.activities;
        const actContainer = actIndicator?.container || actIndicator;
        const qsIndicator = statusArea.quickSettings;
        const qsContainer = qsIndicator?.container || qsIndicator;

        const focusWin = global.display?.focus_window;
        const focusedAppName = this._resolveWindowAppName(focusWin);

        const collectFromBox = (box, side) => {
            if (!box || !box.visible)
                return;

            const visit = (node, depth) => {
                if (!node || !node.visible)
                    return;
                if (node === selfIndicator || node === selfContainer)
                    return;

                const w = node.width || 0;
                const h = node.height || 0;
                if (w < 8 || h < 8)
                    return;

                // If a container holds multiple separate tray icons (e.g., AppIndicator box),
                // descend into its children so each software tray icon is recognized individually!
                const children = node.get_children ? node.get_children().filter(c => c.visible && c.width >= 10) : [];
                const isKnownSingle = (
                    node === dateContainer || node === dateIndicator ||
                    node === actContainer || node === actIndicator ||
                    node === qsContainer || node === qsIndicator
                );

                if (!isKnownSingle && depth < 3 && children.length >= 2 && w > 48) {
                    for (const ch of children)
                        visit(ch, depth + 1);
                    return;
                }

                let cx = 0;
                try {
                    [cx] = node.get_transformed_position();
                } catch (_e) {
                    return;
                }

                let kind = 'app';
                let label = extractActorReadableLabel(node);

                if (node === dateContainer || node === dateIndicator || side === 'center') {
                    kind = 'clock';
                    const t = nowTimeStr();
                    label = label || (t ? `时间 ${t}` : '顶部时钟');
                } else if (node === actContainer || node === actIndicator) {
                    kind = 'activities';
                    label = focusedAppName ? `工作区 · ${focusedAppName}` : '工作区';
                } else if (node === qsContainer || node === qsIndicator) {
                    kind = 'system';
                    label = '系统控制栏';
                } else if (!label) {
                    label = (side === 'left' && focusedAppName) ? focusedAppName : '运行中的软件图标';
                }

                results.push({
                    actor: node,
                    kind,
                    label,
                    x: Math.round(cx),
                    w: Math.round(w),
                });
            };

            const topChildren = box.get_children ? box.get_children() : [];
            for (const ch of topChildren)
                visit(ch, 0);
        };

        collectFromBox(Main.panel._leftBox, 'left');
        collectFromBox(Main.panel._centerBox, 'center');
        collectFromBox(Main.panel._rightBox, 'right');

        return results;
    }

    /**
     * Check if there is a maximized or top-snapped window right beneath X on the primary monitor!
     */
    getTopSnappedWindowAt(x) {
        const focusWin = global.display?.focus_window;
        if (!focusWin)
            return null;
        try {
            if (focusWin.get_window_type() !== Meta.WindowType.NORMAL || focusWin.minimized)
                return null;
            const rect = focusWin.get_frame_rect();
            const panelBox = Main.layoutManager.panelBox;
            const panelBottom = (panelBox?.y ?? 0) + (panelBox?.height ?? 32);
            if (rect.y <= panelBottom + 28 && x >= rect.x && x <= rect.x + rect.width) {
                const name = this._resolveWindowAppName(focusWin);
                return name ? { appName: name, rect } : null;
            }
        } catch (_e) {
            return null;
        }
        return null;
    }
}
