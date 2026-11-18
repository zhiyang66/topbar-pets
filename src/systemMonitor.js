import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const decoder = new TextDecoder('utf-8');

/**
 * Lightweight, non-blocking system CPU & Memory usage monitor via /proc.
 * Runs asynchronously so it never blocks the GNOME Shell compositor thread.
 */
export class SystemMonitor {
    constructor(onUpdate = null) {
        this._onUpdate = onUpdate;
        this._prevTotal = 0;
        this._prevIdle = 0;
        this.cpuPercent = 0;
        this.memPercent = 0;
        this._timerId = 0;
        this._cancellable = new Gio.Cancellable();
    }

    start(intervalMs = 2000) {
        this.stop();
        this._cancellable = new Gio.Cancellable();
        this._sampleOnce();
        this._timerId = GLib.timeout_add(GLib.PRIORITY_LOW, intervalMs, () => {
            this._sampleOnce();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = 0;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
    }

    _sampleOnce() {
        if (!this._cancellable || this._cancellable.is_cancelled())
            return;

        const statFile = Gio.File.new_for_path('/proc/stat');
        statFile.load_contents_async(this._cancellable, (file, res) => {
            try {
                const [ok, bytes] = file.load_contents_finish(res);
                if (ok && bytes)
                    this._parseCpu(decoder.decode(bytes));
            } catch (_e) {
                // Ignore cancellation on disable()
            }
            this._sampleMem();
        });
    }

    _sampleMem() {
        if (!this._cancellable || this._cancellable.is_cancelled())
            return;

        const memFile = Gio.File.new_for_path('/proc/meminfo');
        memFile.load_contents_async(this._cancellable, (file, res) => {
            try {
                const [ok, bytes] = file.load_contents_finish(res);
                if (ok && bytes)
                    this._parseMem(decoder.decode(bytes));
                if (this._onUpdate)
                    this._onUpdate(this.cpuPercent, this.memPercent);
            } catch (_e) {
                // Ignore cancellation on disable()
            }
        });
    }

    _parseCpu(text) {
        const firstLine = text.split('\n', 1)[0] || '';
        const parts = firstLine.trim().split(/\s+/);
        if (parts[0] !== 'cpu' || parts.length < 5)
            return;

        let total = 0;
        for (let i = 1; i < parts.length; i++)
            total += Number(parts[i]) || 0;

        const idle = (Number(parts[4]) || 0) + (Number(parts[5]) || 0);

        if (this._prevTotal > 0) {
            const dTotal = total - this._prevTotal;
            const dIdle = idle - this._prevIdle;
            if (dTotal > 0) {
                const used = Math.max(0, Math.min(1, (dTotal - dIdle) / dTotal));
                // Smooth exponential moving average so speed feels organic
                this.cpuPercent = Math.round(this.cpuPercent * 0.35 + (used * 100) * 0.65);
            }
        }

        this._prevTotal = total;
        this._prevIdle = idle;
    }

    _parseMem(text) {
        let memTotal = 0;
        let memAvailable = 0;
        const lines = text.split('\n');
        for (const line of lines) {
            if (line.startsWith('MemTotal:'))
                memTotal = Number(line.split(/\s+/)[1]) || 0;
            else if (line.startsWith('MemAvailable:'))
                memAvailable = Number(line.split(/\s+/)[1]) || 0;
            if (memTotal && memAvailable)
                break;
        }
        if (memTotal > 0) {
            this.memPercent = Math.round(((memTotal - memAvailable) / memTotal) * 100);
        }
    }
}
