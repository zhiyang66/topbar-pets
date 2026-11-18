import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import St from 'gi://St';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const SHELL_MAJOR = Number.parseInt(Config.PACKAGE_VERSION.split('.')[0], 10) || 50;

/**
 * Add an actor to Main.layoutManager chrome across GNOME 45–50+.
 * GNOME 49/50 removed `affectsInputRegion` from addChrome params (Mutter derives
 * input regions automatically from `actor.reactive`).
 */
export function addChromeActor(actor, { interactive = false, trackFullscreen = true } = {}) {
    actor.reactive = interactive;
    if (SHELL_MAJOR >= 49) {
        Main.layoutManager.addChrome(actor, { trackFullscreen });
        return;
    }
    try {
        Main.layoutManager.addChrome(actor, {
            affectsInputRegion: interactive,
            trackFullscreen,
        });
    } catch (_e) {
        Main.layoutManager.addChrome(actor, { trackFullscreen });
    }
}

export function removeChromeActor(actor) {
    if (actor && actor.get_parent()) {
        actor.hide();
        Main.layoutManager.removeChrome(actor);
    }
}

/**
 * Build St.BoxLayout constructor properties compatible across GNOME 45–51+.
 */
export function boxLayoutProps(vertical = false, extra = {}) {
    if (SHELL_MAJOR >= 51) {
        return {
            orientation: vertical
                ? Clutter.Orientation.VERTICAL
                : Clutter.Orientation.HORIZONTAL,
            ...extra,
        };
    }
    return {
        vertical,
        ...extra,
    };
}

/**
 * Convert a GdkPixbuf.Pixbuf into a GPU-backed St.ImageContent.
 * Handles both GNOME 45–47 (5-arg set_bytes) and GNOME 48–50+ (6-arg with Cogl.Context).
 */
export function pixbufToImageContent(pixbuf) {
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const rowstride = pixbuf.get_rowstride();
    const hasAlpha = pixbuf.get_has_alpha();
    const pixelFormat = hasAlpha
        ? Cogl.PixelFormat.RGBA_8888
        : Cogl.PixelFormat.RGB_888;
    const bytes = pixbuf.read_pixel_bytes();

    const content = new St.ImageContent({
        preferred_width: width,
        preferred_height: height,
    });

    if (content.set_bytes.length >= 6) {
        const coglContext = global.stage.context.get_backend().get_cogl_context();
        content.set_bytes(coglContext, bytes, pixelFormat, width, height, rowstride);
    } else {
        content.set_bytes(bytes, pixelFormat, width, height, rowstride);
    }

    return content;
}
