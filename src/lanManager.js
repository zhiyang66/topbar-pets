import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {
    getSkinSyncDescriptor,
    encodeCustomSkinBase64,
    cacheRemoteCustomSkin,
} from './spriteLoader.js';

const UDP_DISCOVERY_PORT = 49271;
const PEER_TIMEOUT_MS = 8500;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

/**
 * Zero-config LAN P2P Manager:
 * - Unlimited peer pets synced onto Top Bar with resolution-independent normX (0..1)
 * - Automatic custom GIF / AI Sprite Sheet transfer & local caching
 * - Battle Request / Accept / Deterministic Seed synchronization over TCP
 */
export class LanManager {
    constructor({ settings, roster, getPrimaryMotionState, callbacks = {} }) {
        this._settings = settings;
        this._roster = roster;
        this._getPrimaryMotionState = getPrimaryMotionState;
        this._callbacks = callbacks;

        this.peerId = GLib.uuid_string_random().slice(0, 12);
        this.peers = new Map(); // peerId -> peerInfo
        this._skinCache = new Map(); // skinHash -> local profile override
        this._pendingSkinFetches = new Set();

        this._udpSocket = null;
        this._udpSource = null;
        this._tcpService = null;
        this._tcpPort = 0;
        this._beaconTimerId = 0;
        this._broadcastTargets = ['255.255.255.255'];
        this._cancellable = new Gio.Cancellable();

        this._enabledSig = this._settings.connect('changed::lan-enabled', () => {
            if (this._settings.get_boolean('lan-enabled'))
                this.start();
            else
                this.stop();
        });

        if (this._settings.get_boolean('lan-enabled'))
            this.start();
    }

    destroy() {
        if (this._enabledSig && this._settings) {
            this._settings.disconnect(this._enabledSig);
            this._enabledSig = 0;
        }
        this.stop();
    }

    start() {
        if (this._udpSocket)
            return;

        this._cancellable = new Gio.Cancellable();
        this._discoverBroadcastSubnets();

        try {
            this._tcpService = new Gio.SocketService();
            this._tcpPort = this._tcpService.add_any_inet_port(null);
            this._tcpService.connect('incoming', (_svc, connection) => {
                this._handleIncomingTcp(connection);
                return false;
            });
            this._tcpService.start();
        } catch (e) {
            console.warn('[TopBarPet LAN] TCP service failed:', e);
        }

        try {
            this._udpSocket = Gio.Socket.new(
                Gio.SocketFamily.IPV4,
                Gio.SocketType.DATAGRAM,
                Gio.SocketProtocol.UDP
            );
            this._udpSocket.set_broadcast(true);
            this._udpSocket.set_blocking(false);
            const bindAddr = Gio.InetSocketAddress.new_from_string('0.0.0.0', UDP_DISCOVERY_PORT);
            this._udpSocket.bind(bindAddr, true);

            this._udpSource = this._udpSocket.create_source(GLib.IOCondition.IN, null);
            this._udpSource.set_callback(() => {
                this._drainUdpPackets();
                return GLib.SOURCE_CONTINUE;
            });
            this._udpSource.attach(null);
        } catch (e) {
            console.warn('[TopBarPet LAN] UDP bind failed:', e);
        }

        this._sendBeacon();
        this._beaconTimerId = GLib.timeout_add(GLib.PRIORITY_LOW, 1100, () => {
            this._sendBeacon();
            this._pruneStalePeers();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._beaconTimerId) {
            GLib.Source.remove(this._beaconTimerId);
            this._beaconTimerId = 0;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._udpSource) {
            this._udpSource.destroy();
            this._udpSource = null;
        }
        if (this._udpSocket) {
            try {
                this._udpSocket.close();
            } catch (_e) {
                // Ignore
            }
            this._udpSocket = null;
        }
        if (this._tcpService) {
            try {
                this._tcpService.stop();
                this._tcpService.close();
            } catch (_e) {
                // Ignore
            }
            this._tcpService = null;
            this._tcpPort = 0;
        }

        if (this.peers.size > 0) {
            this.peers.clear();
            if (this._callbacks.onPeersChanged)
                this._callbacks.onPeersChanged(this.getOnlinePeers());
        }
    }

    getLocalTcpPort() {
        return this._tcpPort || 0;
    }

    getOnlinePeers() {
        return Array.from(this.peers.values());
    }

    resolvePeerSkinProfile(peer) {
        if (peer.skinHash?.startsWith('custom:') && this._skinCache.has(peer.skinHash))
            return this._skinCache.get(peer.skinHash);
        return {
            skinMode: 'preset',
            presetId: peer.presetId || 'shiba',
            baseFacingRight: true,
        };
    }

    buildFighterPacket(pet) {
        const skinDesc = getSkinSyncDescriptor(pet);
        return {
            peerId: this.peerId,
            ownerName: this._roster.getOwnerName(),
            id: pet.id,
            name: pet.name,
            level: pet.level,
            archetype: pet.archetype,
            presetId: pet.presetId || 'cat',
            skinMode: pet.skinMode || 'preset',
            skinHash: skinDesc.skinHash,
        };
    }

    sendGreeting(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer)
            return;
        const primary = this._roster.getPrimaryPet();
        this._sendTcpMessage(peer.ip, peer.tcpPort, {
            type: 'GREET',
            fromPeerId: this.peerId,
            fromOwner: this._roster.getOwnerName(),
            fromPetName: primary.name,
        });
    }

    sendBattleRequest(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer)
            return false;
        const primary = this._roster.getPrimaryPet();
        this._sendTcpMessage(peer.ip, peer.tcpPort, {
            type: 'BATTLE_REQUEST',
            challenger: this.buildFighterPacket(primary),
            challengerTcpPort: this._tcpPort,
        });
        return true;
    }

    acceptBattleChallenge(challengeInfo) {
        const defenderPet = this._roster.getPrimaryPet();
        const defender = this.buildFighterPacket(defenderPet);
        const seed = Math.floor(Math.random() * 899999) + 100000;

        this._sendTcpMessage(challengeInfo.fromIp, challengeInfo.challengerTcpPort, {
            type: 'BATTLE_ACCEPT',
            seed,
            challenger: challengeInfo.challenger,
            defender,
        });

        // Start identical deterministic battle locally at the exact same moment!
        if (this._callbacks.onBattleStart) {
            this._callbacks.onBattleStart({
                seed,
                leftFighter: defender,
                rightFighter: challengeInfo.challenger,
                localPetId: defenderPet.id,
                isLanBattle: true,
            });
        }
    }

    declineBattleChallenge(challengeInfo) {
        const primary = this._roster.getPrimaryPet();
        this._sendTcpMessage(challengeInfo.fromIp, challengeInfo.challengerTcpPort, {
            type: 'BATTLE_DECLINE',
            fromOwner: this._roster.getOwnerName(),
            fromPetName: primary.name,
        });
    }

    // =========================================================================
    // Internal UDP Discovery & Subnet Detection
    // =========================================================================
    _discoverBroadcastSubnets() {
        try {
            const proc = Gio.Subprocess.new(
                ['ip', '-4', '-o', 'addr', 'show'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    if (!stdout)
                        return;
                    const targets = new Set(['255.255.255.255']);
                    for (const line of stdout.split('\n')) {
                        const m = line.match(/\bbrd\s+(\d+\.\d+\.\d+\.\d+)/);
                        if (m && m[1] !== '0.0.0.0')
                            targets.add(m[1]);
                    }
                    this._broadcastTargets = Array.from(targets);
                } catch (_e) {
                    // Keep 255.255.255.255 fallback
                }
            });
        } catch (_e) {
            // Keep fallback
        }
    }

    _sendBeacon() {
        if (!this._udpSocket || !this._tcpPort)
            return;

        const primary = this._roster.getPrimaryPet();
        if (!primary)
            return;

        const motion = this._getPrimaryMotionState ? this._getPrimaryMotionState() : { normX: 0.5, state: 'walk', facing: 'right' };
        const skinDesc = getSkinSyncDescriptor(primary);

        const packet = JSON.stringify({
            magic: 'TOPBAR_PET_V2',
            peerId: this.peerId,
            tcpPort: this._tcpPort,
            ownerName: this._roster.getOwnerName(),
            petName: primary.name,
            level: primary.level,
            archetype: primary.archetype,
            presetId: primary.presetId || 'cat',
            skinHash: skinDesc.skinHash,
            normX: Math.max(0, Math.min(1, Number(motion.normX) || 0.5)),
            state: motion.state || 'walk',
            facing: motion.facing || 'right',
        });

        const bytes = textEncoder.encode(packet);
        for (const bcast of this._broadcastTargets) {
            try {
                const addr = Gio.InetSocketAddress.new_from_string(bcast, UDP_DISCOVERY_PORT);
                this._udpSocket.send_to(addr, bytes, null);
            } catch (_e) {
                // Ignore unreachable interface
            }
        }
    }

    _drainUdpPackets() {
        if (!this._udpSocket)
            return;
        const buf = new Uint8Array(2048);
        while (true) {
            try {
                const [len, srcAddr] = this._udpSocket.receive_from(buf, null);
                if (len <= 0)
                    break;
                const raw = textDecoder.decode(buf.subarray(0, len));
                const msg = JSON.parse(raw);
                if (msg?.magic !== 'TOPBAR_PET_V2' || !msg.peerId || msg.peerId === this.peerId)
                    continue;

                const senderIp = srcAddr?.get_address?.()?.to_string?.() || '';
                if (!senderIp)
                    continue;

                const isNew = !this.peers.has(msg.peerId);
                const peerObj = {
                    peerId: msg.peerId,
                    ip: senderIp,
                    tcpPort: Number(msg.tcpPort) || 0,
                    ownerName: String(msg.ownerName || 'LAN伙伴').slice(0, 20),
                    petName: String(msg.petName || '萌宠').slice(0, 20),
                    level: Math.max(1, Number(msg.level) || 1),
                    archetype: String(msg.archetype || 'martial'),
                    presetId: String(msg.presetId || 'shiba'),
                    skinHash: String(msg.skinHash || 'preset:shiba'),
                    normX: Math.max(0.02, Math.min(0.98, Number(msg.normX) || 0.5)),
                    state: String(msg.state || 'walk'),
                    facing: msg.facing === 'left' ? 'left' : 'right',
                    lastSeenMs: Date.now(),
                };
                this.peers.set(msg.peerId, peerObj);

                if (
                    peerObj.skinHash.startsWith('custom:') &&
                    !this._skinCache.has(peerObj.skinHash) &&
                    !this._pendingSkinFetches.has(peerObj.skinHash) &&
                    peerObj.tcpPort > 0
                ) {
                    this._fetchRemoteCustomSkin(peerObj);
                }

                if (this._callbacks.onPeerBeacon)
                    this._callbacks.onPeerBeacon(peerObj, isNew);
                if (isNew && this._callbacks.onPeersChanged)
                    this._callbacks.onPeersChanged(this.getOnlinePeers());
            } catch (_e) {
                // EWOULDBLOCK when UDP buffer is drained
                break;
            }
        }
    }

    _pruneStalePeers() {
        const now = Date.now();
        let removed = false;
        for (const [id, peer] of this.peers.entries()) {
            if (now - peer.lastSeenMs > PEER_TIMEOUT_MS) {
                this.peers.delete(id);
                removed = true;
                if (this._callbacks.onPeerLeft)
                    this._callbacks.onPeerLeft(id);
            }
        }
        if (removed && this._callbacks.onPeersChanged)
            this._callbacks.onPeersChanged(this.getOnlinePeers());
    }

    // =========================================================================
    // Internal Async TCP Messaging & Custom Skin Transfer
    // =========================================================================
    _fetchRemoteCustomSkin(peer) {
        this._pendingSkinFetches.add(peer.skinHash);
        this._sendTcpMessage(peer.ip, peer.tcpPort, {
            type: 'GET_SKIN',
            skinHash: peer.skinHash,
        }, response => {
            this._pendingSkinFetches.delete(peer.skinHash);
            if (response?.type === 'SKIN_PAYLOAD' && response.payload) {
                const localProfile = cacheRemoteCustomSkin(response.payload);
                if (localProfile) {
                    this._skinCache.set(peer.skinHash, localProfile);
                    if (this._callbacks.onPeerSkinReady)
                        this._callbacks.onPeerSkinReady(peer.peerId);
                }
            }
        });
    }

    _sendTcpMessage(ip, port, obj, onResponse = null) {
        if (!ip || !port)
            return;
        const client = new Gio.SocketClient();
        client.set_timeout(4);
        const dest = Gio.InetSocketAddress.new_from_string(ip, port);

        client.connect_async(dest, this._cancellable, (cli, res) => {
            let conn = null;
            try {
                conn = cli.connect_finish(res);
                const out = conn.get_output_stream();
                const line = `${JSON.stringify(obj)}\n`;
                out.write_all(textEncoder.encode(line), null);

                if (onResponse) {
                    const dataIn = new Gio.DataInputStream({
                        base_stream: conn.get_input_stream(),
                    });
                    dataIn.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (din, r2) => {
                        try {
                            const [lineBytes] = din.read_line_finish(r2);
                            if (lineBytes) {
                                const parsed = JSON.parse(textDecoder.decode(lineBytes));
                                onResponse(parsed);
                            }
                        } catch (_e) {
                            onResponse(null);
                        } finally {
                            try { conn.close(null); } catch (_e2) {}
                        }
                    });
                } else {
                    conn.close(null);
                }
            } catch (_e) {
                if (onResponse)
                    onResponse(null);
                if (conn) {
                    try { conn.close(null); } catch (_e2) {}
                }
            }
        });
    }

    _handleIncomingTcp(connection) {
        let remoteIp = '';
        try {
            const remoteAddr = connection.get_remote_address();
            remoteIp = remoteAddr?.get_address?.()?.to_string?.() || '';
        } catch (_e) {
            remoteIp = '';
        }

        const dataIn = new Gio.DataInputStream({
            base_stream: connection.get_input_stream(),
        });

        dataIn.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable, (din, res) => {
            try {
                const [lineBytes] = din.read_line_finish(res);
                if (!lineBytes) {
                    connection.close(null);
                    return;
                }
                const msg = JSON.parse(textDecoder.decode(lineBytes));
                this._dispatchTcpMessage(msg, remoteIp, connection);
            } catch (_e) {
                try { connection.close(null); } catch (_e2) {}
            }
        });
    }

    _dispatchTcpMessage(msg, remoteIp, connection) {
        if (!msg?.type) {
            connection.close(null);
            return;
        }

        if (msg.type === 'GET_SKIN') {
            const primary = this._roster.getPrimaryPet();
            const encoded = primary ? encodeCustomSkinBase64(primary) : null;
            try {
                const out = connection.get_output_stream();
                const reply = `${JSON.stringify({ type: 'SKIN_PAYLOAD', payload: encoded })}\n`;
                out.write_all(textEncoder.encode(reply), null);
            } catch (_e) {
                // Ignore
            }
            connection.close(null);
            return;
        }

        connection.close(null);

        if (msg.type === 'GREET') {
            if (this._callbacks.onPeerGreet)
                this._callbacks.onPeerGreet(msg);
        } else if (msg.type === 'BATTLE_REQUEST' && msg.challenger) {
            if (this._callbacks.onBattleChallengeReceived) {
                this._callbacks.onBattleChallengeReceived({
                    fromIp: remoteIp,
                    challengerTcpPort: Number(msg.challengerTcpPort) || 0,
                    challenger: msg.challenger,
                });
            }
        } else if (msg.type === 'BATTLE_ACCEPT' && msg.seed && msg.defender) {
            const localPrimary = this._roster.getPrimaryPet();
            if (this._callbacks.onBattleStart) {
                this._callbacks.onBattleStart({
                    seed: Number(msg.seed),
                    leftFighter: msg.challenger || this.buildFighterPacket(localPrimary),
                    rightFighter: msg.defender,
                    localPetId: localPrimary?.id,
                    isLanBattle: true,
                });
            }
        } else if (msg.type === 'BATTLE_DECLINE') {
            if (this._callbacks.onBattleDeclined)
                this._callbacks.onBattleDeclined(msg);
        }
    }
}
