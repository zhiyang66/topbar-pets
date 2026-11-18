import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

function nowTimeStr() {
    const dt = GLib.DateTime.new_now_local();
    return dt ? dt.format('%H:%M') : '';
}

function extractActorReadableLabel(actor, depth = 0) {
    if (!actor || depth > 3)
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
        const kids = actor.get_children();
        const limit = Math.min(kids.length, 8);
        for (let i = 0; i < limit; i++) {
            const sub = extractActorReadableLabel(kids[i], depth + 1);
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

    /**
     * Compute full-screen & top-bar roam boundaries for the primary monitor,
     * respecting top panel and bottom dock / workArea cleanly!
     */
    getScreenRoamBounds(petW = 38, petH = 38, vOffset = 4) {
        const panelBox = Main.layoutManager?.panelBox;
        if (!panelBox || !panelBox.get_stage?.())
            return null;

        const mon = Main.layoutManager?.primaryMonitor;
        const monIdx = Main.layoutManager?.primaryIndex ?? -1;
        const monitors = Main.layoutManager?.monitors;
        let workArea = null;
        if (mon && Array.isArray(monitors) && monIdx >= 0 && monIdx < monitors.length) {
            try {
                workArea = Main.layoutManager?.getWorkAreaForMonitor?.(monIdx) || null;
            } catch (_e) {
                workArea = null;
            }
        }

        const monX = Number.isFinite(mon?.x) ? mon.x : (Number.isFinite(panelBox.x) ? panelBox.x : 0);
        const monY = Number.isFinite(mon?.y) ? mon.y : (Number.isFinite(panelBox.y) ? panelBox.y : 0);
        const monW = (Number.isFinite(mon?.width) && mon.width > 64)
            ? mon.width
            : ((Number.isFinite(panelBox.width) && panelBox.width > 64) ? panelBox.width : (global.stage?.width || 0));
        const monH = (Number.isFinite(mon?.height) && mon.height > 120)
            ? mon.height
            : (global.stage?.height || 768);

        if (monW <= 64)
            return null;

        const py = Number.isFinite(panelBox.y) ? panelBox.y : monY;
        const ph = (Number.isFinite(panelBox.height) && panelBox.height > 12) ? panelBox.height : 32;
        const groundY = Math.max(0, py + ph - petH + vOffset);

        const bottomLimit = (workArea && Number.isFinite(workArea.y) && Number.isFinite(workArea.height) && workArea.height > 120)
            ? (workArea.y + workArea.height)
            : (monY + monH);
        const bottomGroundY = Math.max(groundY + 60, bottomLimit - petH);

        const minX = monX + 6;
        const maxX = Math.max(minX + 16, monX + monW - petW - 6);

        // Keep Top-Bar strolling clear of left Activities & right System Tray / Pet Indicator icons!
        const leftBoxW = Math.min(200, Math.max(58, Main.panel?._leftBox?.width || 64));
        const rightBoxW = Math.min(300, Math.max(115, Main.panel?._rightBox?.width || 130));
        const topBarMinX = Math.min(maxX - 80, monX + leftBoxW + 6);
        const topBarMaxX = Math.max(topBarMinX + 60, monX + monW - rightBoxW - petW - 6);

        return {
            minX,
            maxX,
            topBarMinX,
            topBarMaxX,
            groundY,       // Top-Bar ground Y
            bottomGroundY, // Full-screen floor Y (above Ubuntu bottom dock if any)
            panelY: py,
            panelH: ph,
            monX,
            monY,
            monW,
            monH,
        };
    }

    /**
     * Read-only scan of visible normal window titlebar ledges on the active workspace
     * so pets can hop onto, stroll along, and peek into open windows non-destructively!
     */
    scanWindowLedges(petW = 38, petH = 38, bounds = null) {
        const ledges = [];
        if (!bounds || !global.get_window_actors)
            return ledges;

        let activeWs = null;
        try {
            activeWs = global.workspace_manager?.get_active_workspace?.() || null;
        } catch (_e) {
            activeWs = null;
        }

        const actors = global.get_window_actors();
        // Walk from top-most window downward, collecting up to 6 clean horizontal ledges
        for (let i = actors.length - 1; i >= 0 && ledges.length < 6; i--) {
            const winActor = actors[i];
            if (!winActor || !winActor.visible)
                continue;
            const metaWin = winActor.meta_window;
            if (!metaWin)
                continue;

            try {
                if (metaWin.get_window_type() !== Meta.WindowType.NORMAL)
                    continue;
                if (metaWin.minimized)
                    continue;
                if (activeWs && metaWin.get_workspace?.() !== activeWs && !metaWin.is_on_all_workspaces?.())
                    continue;

                const rect = metaWin.get_frame_rect();
                if (!rect || rect.width < 160 || rect.height < 90)
                    continue;

                const ledgeY = Math.round(rect.y - petH + 4);
                // Only expose titlebars that sit comfortably between Top Bar and Screen Floor
                if (ledgeY < bounds.groundY + 38 || ledgeY > bounds.bottomGroundY - 34)
                    continue;

                const x1 = Math.max(bounds.minX, Math.round(rect.x + 8));
                const x2 = Math.min(bounds.maxX, Math.round(rect.x + rect.width - petW - 8));
                if (x2 - x1 < 64)
                    continue;

                const appName = this._resolveWindowAppName(metaWin) || '应用窗口';
                ledges.push({
                    metaWin,
                    appName,
                    x1,
                    x2,
                    y: ledgeY,
                    winRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                });
            } catch (_e) {
                // Ignore transient destroyed windows
            }
        }

        return ledges;
    }

    /**
     * Read-only classification of currently focused work context for companion RPG perks.
     */
    classifyFocusedAppContext() {
        const focusWin = global.display?.focus_window;
        if (!focusWin)
            return { category: 'idle_desktop', appName: '', rect: null };

        let rect = null;
        try {
            if (focusWin.minimized || focusWin.get_window_type() !== Meta.WindowType.NORMAL)
                return { category: 'idle_desktop', appName: '', rect: null };
            const r = focusWin.get_frame_rect();
            rect = { x: r.x, y: r.y, width: r.width, height: r.height };
        } catch (_e) {
            rect = null;
        }

        const appName = this._resolveWindowAppName(focusWin);
        const wmClass = (focusWin.get_wm_class?.() || '').toLowerCase();
        const key = `${wmClass} ${appName.toLowerCase()}`;

        if (/code|codium|jetbrains|idea|pycharm|webstorm|goland|clion|rustrover|zed|nvim|vim|emacs|terminal|kitty|alacritty|wezterm|ptyxis|konsole|bash|tmux/.test(key))
            return { category: 'coding', appName, rect };
        if (/obsidian|notion|libreoffice|soffice|evince|okular|zotero|gimp|inkscape|krita|blender|figma|typora/.test(key))
            return { category: 'creative_docs', appName, rect };
        if (/firefox|chrome|chromium|brave|edge|epiphany|vivaldi|zen/.test(key))
            return { category: 'browsing', appName, rect };

        return { category: 'general', appName, rect };
    }

    /**
     * Find the widest unoccupied empty gap on the Top Bar so zero-occlusion badges/eggs
     * NEVER overlap or block any software tray icon, clock, or workspace button!
     */
    findSafeTopBarEmptyGap(minWidth = 40) {
        const bounds = this.getScreenRoamBounds(minWidth, 32, 0);
        if (!bounds)
            return null;

        const targets = this.scanLiveTargets().sort((a, b) => a.x - b.x);
        const occupied = [];
        for (const t of targets) {
            const s = Math.max(bounds.monX, t.x - 10);
            const e = Math.min(bounds.monX + bounds.monW, t.x + t.w + 10);
            if (occupied.length > 0 && s <= occupied[occupied.length - 1].e)
                occupied[occupied.length - 1].e = Math.max(occupied[occupied.length - 1].e, e);
            else
                occupied.push({ s, e });
        }

        let bestGap = null;
        let cursor = bounds.monX + 14;
        const rightEnd = bounds.monX + bounds.monW - 14;

        for (const seg of occupied) {
            if (seg.s - cursor >= minWidth) {
                const w = seg.s - cursor;
                if (!bestGap || w > bestGap.width)
                    bestGap = { x: cursor, width: w, centerX: Math.round(cursor + w / 2), panelY: bounds.panelY, panelH: bounds.panelH };
            }
            cursor = Math.max(cursor, seg.e);
        }
        if (rightEnd - cursor >= minWidth) {
            const w = rightEnd - cursor;
            if (!bestGap || w > bestGap.width)
                bestGap = { x: cursor, width: w, centerX: Math.round(cursor + w / 2), panelY: bounds.panelY, panelH: bounds.panelH };
        }

        return bestGap;
    }
}
