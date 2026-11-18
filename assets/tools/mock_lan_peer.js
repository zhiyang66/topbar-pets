#!/usr/bin/env -S gjs -m
/**
 * Standalone Mock LAN Peer Bot for testing TopBar Pet 2.0 LAN Multiplayer
 * on a single computer! Uses an ephemeral UDP sender port so it never collides
 * with GNOME Shell's own port 49271 listener on the same host.
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const UDP_PORT = 49271;
const hostTcpPortArg = Number(ARGV?.[0] || 0);
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

const peerId = `mock-bot-${GLib.uuid_string_random().slice(0, 6)}`;
const botFighter = {
    peerId,
    ownerName: '局域网测试员·阿泽',
    id: 'bot-dragon-1',
    name: '赤焰小火龙',
    level: 4,
    archetype: 'fire',
    presetId: 'dragon',
    skinMode: 'preset',
    skinHash: 'preset:dragon',
};

const tcpService = new Gio.SocketService();
const tcpPort = tcpService.add_any_inet_port(null);

function sendTcp(ip, port, payload) {
    if (!ip || !port)
        return;
    const client = new Gio.SocketClient();
    const dest = Gio.InetSocketAddress.new_from_string(ip, port);
    client.connect_async(dest, null, (cli, res) => {
        try {
            const c = cli.connect_finish(res);
            c.get_output_stream().write_all(enc.encode(`${JSON.stringify(payload)}\n`), null);
            c.close(null);
        } catch (_e) {}
    });
}

tcpService.connect('incoming', (_svc, conn) => {
    let remoteIp = '127.0.0.1';
    try {
        remoteIp = conn.get_remote_address()?.get_address?.()?.to_string?.() || '127.0.0.1';
    } catch (_e) {}

    const din = new Gio.DataInputStream({ base_stream: conn.get_input_stream() });
    din.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
        try {
            const [line] = stream.read_line_finish(res);
            if (line) {
                const msg = JSON.parse(dec.decode(line));
                if (msg.type === 'BATTLE_REQUEST' && msg.challenger) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 450, () => {
                        sendTcp(remoteIp, Number(msg.challengerTcpPort), {
                            type: 'BATTLE_ACCEPT',
                            seed: Math.floor(Math.random() * 899999) + 100000,
                            challenger: msg.challenger,
                            defender: botFighter,
                        });
                        return GLib.SOURCE_REMOVE;
                    });
                } else if (msg.type === 'GREET') {
                    const replyPort = Number(msg.replyTcpPort) || hostTcpPortArg;
                    if (replyPort > 0) {
                        sendTcp(remoteIp, replyPort, {
                            type: 'GREET',
                            fromPeerId: peerId,
                            fromOwner: botFighter.ownerName,
                            fromPetName: botFighter.name,
                        });
                    }
                }
            }
        } catch (_e) {}
        try { conn.close(null); } catch (_e2) {}
    });
    return false;
});
tcpService.start();

// Send incoming LAN Battle Invitation Popup 2.2s after spawning!
if (hostTcpPortArg > 0) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2200, () => {
        sendTcp('127.0.0.1', hostTcpPortArg, {
            type: 'BATTLE_REQUEST',
            challenger: botFighter,
            challengerTcpPort: tcpPort,
        });
        return GLib.SOURCE_REMOVE;
    });
}

const udp = Gio.Socket.new(Gio.SocketFamily.IPV4, Gio.SocketType.DATAGRAM, Gio.SocketProtocol.UDP);
udp.set_broadcast(true);
udp.set_blocking(false);

let normX = 0.68;
let dir = -1;
const loop = GLib.MainLoop.new(null, false);

const broadcastOnce = () => {
    normX += dir * 0.032;
    if (normX <= 0.18) {
        normX = 0.18;
        dir = 1;
    } else if (normX >= 0.84) {
        normX = 0.84;
        dir = -1;
    }

    const msg = JSON.stringify({
        magic: 'TOPBAR_PET_V2',
        peerId,
        tcpPort,
        ownerName: botFighter.ownerName,
        petName: botFighter.name,
        level: botFighter.level,
        archetype: botFighter.archetype,
        presetId: botFighter.presetId,
        skinHash: botFighter.skinHash,
        normX,
        state: 'walk',
        facing: dir > 0 ? 'right' : 'left',
    });
    const bytes = enc.encode(msg);
    try {
        udp.send_to(Gio.InetSocketAddress.new_from_string('127.0.0.1', UDP_PORT), bytes, null);
    } catch (_e) {}
};

broadcastOnce();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 850, () => {
    broadcastOnce();
    return GLib.SOURCE_CONTINUE;
});

loop.run();
