#!/usr/bin/env -S gjs -m
/**
 * Standalone Mock LAN Peer Bot 3.0 for testing TopBar Pet LAN 1v1, 2v2 Elemental Duo,
 * 2-Player Co-op Random Boss Raid & Gift Exchange on a single computer!
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
    level: 5,
    archetype: 'fire',
    presetId: 'dragon',
    skinMode: 'preset',
    skinHash: 'preset:dragon',
    stance: 'berserk',
    relicIds: ['prism_ring', 'fang_charm'],
    equippedSkills: ['f2', 'f3', 'f5', 'f6'],
};

const botSubFighter = {
    peerId,
    ownerName: '局域网测试员·阿泽',
    id: 'bot-slime-2',
    name: '霜冠果冻王',
    level: 5,
    archetype: 'ice',
    presetId: 'slime',
    skinMode: 'preset',
    skinHash: 'preset:slime',
    stance: 'counter',
    relicIds: ['chrono_watch'],
    equippedSkills: ['i2', 'i3', 'i5', 'i6'],
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
                    const mode = msg.mode || '1v1';
                    const seed = mode === 'boss_raid'
                        ? (Number(msg.bossSeed) || (Math.floor(Math.random() * 899999) + 100000))
                        : (Math.floor(Math.random() * 899999) + 100000);
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 420, () => {
                        sendTcp(remoteIp, Number(msg.challengerTcpPort), {
                            type: 'BATTLE_ACCEPT',
                            mode,
                            seed,
                            challenger: msg.challenger,
                            challengerSub: msg.challengerSub || null,
                            challengerAssist: msg.challengerAssist || null,
                            defender: botFighter,
                            defenderSub: mode === '2v2' ? botSubFighter : null,
                            defenderAssist: mode === '1v1' ? botSubFighter : null,
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
                } else if (msg.type === 'GIFT_TREAT' && hostTcpPortArg > 0) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 650, () => {
                        sendTcp(remoteIp, hostTcpPortArg, {
                            type: 'GIFT_TREAT',
                            fromPeerId: peerId,
                            fromOwner: botFighter.ownerName,
                            fromPetName: botFighter.name,
                            coinsGift: 12,
                        });
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
        } catch (_e) {}
        try { conn.close(null); } catch (_e2) {}
    });
    return false;
});
tcpService.start();

// Send incoming 2v2 Elemental Duo Challenge 2.2s after spawning!
if (hostTcpPortArg > 0) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2200, () => {
        sendTcp('127.0.0.1', hostTcpPortArg, {
            type: 'BATTLE_REQUEST',
            mode: '2v2',
            challenger: botFighter,
            challengerSub: botSubFighter,
            challengerTcpPort: tcpPort,
        });
        return GLib.SOURCE_REMOVE;
    });
}

const udp = Gio.Socket.new(Gio.SocketFamily.IPV4, Gio.SocketType.DATAGRAM, Gio.SocketProtocol.UDP);
udp.set_broadcast(true);
udp.set_blocking(false);

let normX = 0.68;
let normY = 0.0;
let dir = -1;
let yPhase = 0;
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
    yPhase += 0.22;
    normY = Math.max(0, Math.min(0.85, (Math.sin(yPhase) + 0.6) * 0.38));

    const msg = JSON.stringify({
        magic: 'TOPBAR_PET_V2',
        peerId,
        tcpPort,
        ownerName: botFighter.ownerName,
        titleBadge: '💥 元素炼金师',
        petName: botFighter.name,
        level: botFighter.level,
        archetype: botFighter.archetype,
        presetId: botFighter.presetId,
        skinHash: botFighter.skinHash,
        normX,
        normY,
        freeRoam: normY > 0.04,
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
