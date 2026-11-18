import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

export const GITHUB_REPO = 'zhiyang66/topbar-pets';
export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_REPO}/releases`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const EXTENSION_ZIP_NAME = 'topbar-pet@local.gnome-extension.shell-extension.zip';

/**
 * Read local installed semantic version from metadata.json (e.g. "2.0.0").
 */
export function readInstalledVersion(extensionPath) {
    try {
        const metaPath = GLib.build_filenamev([extensionPath, 'metadata.json']);
        const [ok, bytes] = GLib.file_get_contents(metaPath);
        if (ok && bytes) {
            const text = new TextDecoder('utf-8').decode(bytes);
            const meta = JSON.parse(text);
            if (meta['version-name'])
                return String(meta['version-name']).replace(/^v/i, '').trim();
            if (meta.version !== undefined)
                return `${meta.version}.0.0`;
        }
    } catch (_e) {
        // Fallback
    }
    return '2.0.0';
}

/**
 * Compare two semantic version strings (e.g. "2.1.0" vs "2.0.0").
 * Returns > 0 if a > b, < 0 if a < b, 0 if equal.
 */
export function compareSemver(a, b) {
    const parse = v => String(v || '0.0.0')
        .replace(/^v/i, '')
        .split('-')[0]
        .split('.')
        .map(n => Number.parseInt(n, 10) || 0);
    const pa = parse(a);
    const pb = parse(b);
    const len = Math.max(pa.length, pb.length, 3);
    for (let i = 0; i < len; i++) {
        const da = pa[i] || 0;
        const db = pb[i] || 0;
        if (da !== db)
            return da - db;
    }
    return 0;
}

/**
 * Non-blocking GitHub Releases Update Checker & One-Click Bundle Installer.
 * Usable from both GNOME Shell (extension.js / panelMenu.js) and GTK4 Preferences!
 */
export class UpdateChecker {
    constructor({ extensionPath, settings = null, onUpdateStateChanged = null }) {
        this._extensionPath = extensionPath;
        this._settings = settings;
        this._onUpdateStateChanged = onUpdateStateChanged;

        this.currentVersion = readInstalledVersion(extensionPath);
        this.latestVersion = null;
        this.hasUpdate = false;
        this.downloadUrl = null;
        this.htmlUrl = RELEASES_PAGE_URL;
        this.releaseNotes = '';
        this.statusText = `当前已安装 v${this.currentVersion}`;
        this.isChecking = false;
        this.isInstalling = false;

        this._session = new Soup.Session({
            timeout: 12,
            user_agent: `TopBar-Pets-GNOME-Extension/${this.currentVersion}`,
        });
        this._cancellable = new Gio.Cancellable();
        this._startupTimerId = 0;
        this._periodicTimerId = 0;
        this._notifiedVersion = null;
    }

    startAutoCheck(onNewVersionFound = null) {
        this.stopAutoCheck();

        const runAuto = () => {
            if (this._settings && !this._settings.get_boolean('auto-check-updates'))
                return;
            this.checkForUpdates().then(res => {
                if (res.hasUpdate && res.latestVersion !== this._notifiedVersion) {
                    this._notifiedVersion = res.latestVersion;
                    onNewVersionFound?.(res);
                }
            });
        };

        // Check silently 12 seconds after startup, then every 12 hours
        this._startupTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 12, () => {
            this._startupTimerId = 0;
            runAuto();
            return GLib.SOURCE_REMOVE;
        });

        this._periodicTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 43200, () => {
            runAuto();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stopAutoCheck() {
        if (this._startupTimerId) {
            GLib.Source.remove(this._startupTimerId);
            this._startupTimerId = 0;
        }
        if (this._periodicTimerId) {
            GLib.Source.remove(this._periodicTimerId);
            this._periodicTimerId = 0;
        }
    }

    destroy() {
        this.stopAutoCheck();
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
    }

    _notify() {
        this._onUpdateStateChanged?.(this.getSnapshot());
    }

    getSnapshot() {
        return {
            currentVersion: this.currentVersion,
            latestVersion: this.latestVersion,
            hasUpdate: this.hasUpdate,
            downloadUrl: this.downloadUrl,
            htmlUrl: this.htmlUrl,
            releaseNotes: this.releaseNotes,
            statusText: this.statusText,
            isChecking: this.isChecking,
            isInstalling: this.isInstalling,
        };
    }

    checkForUpdates() {
        if (!this._session)
            return Promise.resolve(this.getSnapshot());
        if (this.isChecking)
            return Promise.resolve(this.getSnapshot());

        this.currentVersion = readInstalledVersion(this._extensionPath);
        this.isChecking = true;
        this.statusText = '正在连接 GitHub 检查最新版本…';
        this._notify();

        return new Promise(resolve => {
            const msg = Soup.Message.new('GET', LATEST_RELEASE_API);
            msg.get_request_headers().append('Accept', 'application/vnd.github+json');

            this._session.send_and_read_async(
                msg,
                GLib.PRIORITY_DEFAULT,
                this._cancellable,
                (session, res) => {
                    this.isChecking = false;
                    try {
                        const gbytes = session.send_and_read_finish(res);
                        const httpStatus = msg.get_status();

                        if (httpStatus === 404) {
                            this.hasUpdate = false;
                            this.statusText = `当前 v${this.currentVersion} 已是最新（仓库尚无更高 Release）`;
                            this._notify();
                            resolve(this.getSnapshot());
                            return;
                        }

                        if (httpStatus < 200 || httpStatus >= 300 || !gbytes) {
                            this.statusText = `检查更新失败 (HTTP ${httpStatus})`;
                            this._notify();
                            resolve(this.getSnapshot());
                            return;
                        }

                        const rawText = new TextDecoder('utf-8').decode(gbytes.get_data());
                        const data = JSON.parse(rawText);
                        const remoteTag = String(data.tag_name || '').trim();
                        const cleanRemote = remoteTag.replace(/^v/i, '');

                        this.latestVersion = cleanRemote || this.currentVersion;
                        this.htmlUrl = data.html_url || RELEASES_PAGE_URL;
                        this.releaseNotes = String(data.body || '').trim();

                        // Locate attached .shell-extension.zip asset
                        const assets = Array.isArray(data.assets) ? data.assets : [];
                        const zipAsset = assets.find(a =>
                            String(a.name || '').endsWith('.shell-extension.zip') ||
                            String(a.name || '').endsWith('.zip')
                        );
                        this.downloadUrl = zipAsset?.browser_download_url || null;

                        if (cleanRemote && compareSemver(cleanRemote, this.currentVersion) > 0) {
                            this.hasUpdate = true;
                            this.statusText = `🎉 发现新版本 v${cleanRemote}（当前 v${this.currentVersion}）`;
                        } else {
                            this.hasUpdate = false;
                            this.statusText = `✅ 当前 v${this.currentVersion} 已是最新版本`;
                        }
                    } catch (e) {
                        if (!e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                            this.statusText = '网络请求超时或无法访问 GitHub API';
                    }
                    this._notify();
                    resolve(this.getSnapshot());
                }
            );
        });
    }

    /**
     * Download the release .shell-extension.zip bundle and install via `gnome-extensions install --force`.
     */
    downloadAndInstallUpdate() {
        if (!this._session || this.isInstalling)
            return Promise.resolve({ ok: false, message: '正在安装中…' });

        if (!this.downloadUrl) {
            try {
                Gio.AppInfo.launch_default_for_uri(this.htmlUrl || RELEASES_PAGE_URL, null);
            } catch (_e) {}
            return Promise.resolve({
                ok: false,
                message: '已为你打开 GitHub Release 页面下载更新包',
            });
        }

        this.isInstalling = true;
        this.statusText = `⬇️ 正在下载 v${this.latestVersion} 更新包…`;
        this._notify();

        const tmpZipPath = GLib.build_filenamev([GLib.get_tmp_dir(), EXTENSION_ZIP_NAME]);

        return new Promise(resolve => {
            const msg = Soup.Message.new('GET', this.downloadUrl);
            this._session.send_and_read_async(
                msg,
                GLib.PRIORITY_DEFAULT,
                this._cancellable,
                (session, res) => {
                    try {
                        const gbytes = session.send_and_read_finish(res);
                        const httpStatus = msg.get_status();
                        if (httpStatus < 200 || httpStatus >= 300 || !gbytes) {
                            this.isInstalling = false;
                            this.statusText = `❌ 下载失败 (HTTP ${httpStatus})`;
                            this._notify();
                            resolve({ ok: false, message: this.statusText });
                            return;
                        }

                        const rawBytes = gbytes.get_data();
                        GLib.file_set_contents(tmpZipPath, rawBytes);

                        this.statusText = '📦 正在覆盖安装新版本扩展…';
                        this._notify();

                        const proc = Gio.Subprocess.new(
                            ['gnome-extensions', 'install', '--force', tmpZipPath],
                            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                        );

                        proc.communicate_utf8_async(null, this._cancellable, (p, pRes) => {
                            this.isInstalling = false;
                            try {
                                const [, , stderr] = p.communicate_utf8_finish(pRes);
                                if (p.get_successful()) {
                                    this.hasUpdate = false;
                                    this.currentVersion = this.latestVersion || this.currentVersion;
                                    this.statusText = `✅ 已更新至 v${this.currentVersion}！注销重登桌面即可加载新版本 🎉`;
                                    this._notify();
                                    resolve({ ok: true, message: this.statusText });
                                } else {
                                    this.statusText = `❌ 安装失败: ${(stderr || '').trim().slice(0, 60)}`;
                                    this._notify();
                                    resolve({ ok: false, message: this.statusText });
                                }
                            } catch (err) {
                                this.statusText = `❌ 安装异常: ${err.message}`;
                                this._notify();
                                resolve({ ok: false, message: this.statusText });
                            }
                        });
                    } catch (e) {
                        this.isInstalling = false;
                        this.statusText = '❌ 下载更新包失败，请检查网络连接';
                        this._notify();
                        resolve({ ok: false, message: this.statusText });
                    }
                }
            );
        });
    }
}
