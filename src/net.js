// Multiplayer transport. No game server.
//  1. Players who share a room code find each other on public Nostr relays (encrypted with a key derived from the code)
//     and, for tabs in the same browser, on a BroadcastChannel.
//  2. They then open direct WebRTC data channels (full mesh) and race over those.
//  3. If a pair cannot connect directly (strict office firewall), their messages fall back to the relays at a lower rate.
import { schnorr } from "@noble/curves/secp256k1.js";

// checked: these pass ephemeral events between two connections. Six, so a couple being down never matters.
const DEFAULT_RELAYS = ["wss://nos.lol", "wss://relay.primal.net", "wss://offchain.pub", "wss://nostr.mom", "wss://relay.snort.social", "wss://relay.damus.io"];
const RELAYS = (() => {
  try { const c = JSON.parse(localStorage.getItem("deskgp:relays") || "null"); if (Array.isArray(c) && c.length && c.every((u) => /^wss?:\/\//.test(u))) return c; } catch {}
  return DEFAULT_RELAYS;
})();
const KIND = 21078; // ephemeral: relays pass it on and do not store it, so a wide "since" (for clock skew) replays nothing
const ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const newRoomCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => ALPHABET[b % ALPHABET.length]).join("");
export function parseRoomCode(text) {
  const s = String(text || "").toUpperCase().replace(/^.*#/, "").replace(/[^A-Z0-9]/g, "");
  return s.length === 6 && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}
export const formatRoomCode = (c) => `${c.slice(0, 3)}-${c.slice(3)}`;
export const newId = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);

const enc = new TextEncoder(), dec = new TextDecoder();
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s));
const b64 = (u) => btoa(String.fromCharCode(...u));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function createNet(code, me, handlers, opts = {}) {
  const N = { peers: new Map(), relaysUp: 0, closed: false, id: me.id };
  const seen = new Set(); let seq = 0, secret, pubkey, aes, sockets = new Map(), bc = null;
  const useRelays = opts.relays !== false, useRtc = opts.rtc !== false && typeof RTCPeerConnection !== "undefined";
  const lastBus = new Map();

  const ready = (async () => {
    secret = await sha(`deskgp-room:${code}`); pubkey = hex(schnorr.getPublicKey(secret));
    aes = await crypto.subtle.importKey("raw", await sha(`deskgp-key:${code}`), "AES-GCM", false, ["encrypt", "decrypt"]);
  })();

  // ---- bus: relays + BroadcastChannel ----
  function openRelay(url, attempt) {
    if (N.closed) return;
    let ws; try { ws = new WebSocket(url); } catch { return retry(url, attempt); }
    sockets.set(url, ws);
    ws.onopen = () => { attempt = 0; ws.send(JSON.stringify(["REQ", "gp", { kinds: [KIND], authors: [pubkey], since: Math.floor(Date.now() / 1000) - 900 }])); status(); hello(); };
    ws.onmessage = (m) => relayMsg(m.data);
    ws.onclose = () => { if (sockets.get(url) === ws) sockets.delete(url); status(); retry(url, attempt + 1); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  const retry = (url, attempt) => { if (!N.closed) setTimeout(() => openRelay(url, attempt), Math.min(30000, 1000 * 2 ** attempt)); };
  function status() { let n = 0; for (const ws of sockets.values()) if (ws.readyState === 1) n++; N.relaysUp = n; handlers.onStatus?.(N); }
  async function relayMsg(data) {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m[0] !== "EVENT" || !m[2]) return;
    const ev = m[2]; if (seen.has(ev.id) || ev.pubkey !== pubkey || ev.kind !== KIND) return;
    seen.add(ev.id); if (seen.size > 4000) seen.clear();
    try {
      const raw = unb64(ev.content), pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, aes, raw.slice(12));
      busIn(JSON.parse(dec.decode(pt)));
    } catch {}
  }
  async function busOut(obj) {
    obj.f = me.id; obj.n = `${me.id}:${seq++}`;
    seen.add(obj.n);
    try { bc?.postMessage(obj); } catch {}
    if (!useRelays) return;
    await ready;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, enc.encode(JSON.stringify(obj))));
    const buf = new Uint8Array(12 + ct.length); buf.set(iv); buf.set(ct, 12);
    const content = b64(buf), created_at = Math.floor(Date.now() / 1000), tags = [];
    const idBytes = await sha(JSON.stringify([0, pubkey, created_at, KIND, tags, content])), id = hex(idBytes);
    const sig = hex(schnorr.sign(idBytes, secret));
    seen.add(id);
    const frame = JSON.stringify(["EVENT", { id, pubkey, created_at, kind: KIND, tags, content, sig }]);
    for (const ws of sockets.values()) if (ws.readyState === 1) ws.send(frame);
  }
  function busIn(o) {
    if (N.closed || !o || o.f === me.id) return;
    if (o.n) { if (seen.has(o.n)) return; seen.add(o.n); }
    if (o.to && o.to !== me.id) return;
    if (o.tl && !o.tl.includes(me.id)) return;
    const p = touch(o.f, o.hi);
    if (o.hi) { if (o.hi.ask) hello(o.f); return; }
    if (!p) return;
    if (o.sdp) return onSdp(p, o.sdp);
    if (o.m) handlers.onMsg?.(o.f, o.m);
  }

  // ---- presence ----
  function touch(id, info) {
    let p = N.peers.get(id);
    if (!p) {
      if (!info) { hello(id, true); return null; } // somebody we have not been introduced to: ask them to say hi
      p = { id, ...info, last: performance.now(), rtc: false, pc: null, u: null, r: null, tries: 0, lastTry: 0 };
      N.peers.set(id, p); handlers.onPeers?.(N);
      hello(id);
      if (useRtc && me.id < id) connect(p);
    } else if (info) { const ch = p.name !== info.name || p.color !== info.color; Object.assign(p, info); if (ch) handlers.onPeers?.(N); }
    p.last = performance.now();
    return p;
  }
  function hello(to, ask) { busOut({ hi: { name: me.name, color: me.color, team: me.team, num: me.num, joined: me.joined, ask: ask || undefined }, to: to || undefined }); }
  const beat = setInterval(() => {
    if (N.closed) return;
    const now = performance.now(); let allRtc = N.peers.size > 0;
    for (const p of [...N.peers.values()]) {
      if (now - p.last > 9000) { drop(p); continue; }
      if (!p.rtc) { allRtc = false; if (useRtc && me.id < p.id && now - p.lastTry > (p.tries < 2 ? 9000 : 30000) && (!p.pc || p.pc.connectionState !== "connecting" || now - p.lastTry > 12000)) connect(p); }
      else sendRaw(p.u, { k: 1 });
    }
    N.tick = (N.tick || 0) + 1;
    if (!allRtc || N.tick % 3 === 0) hello();
  }, 2500);
  function drop(p) { try { p.pc?.close(); } catch {} N.peers.delete(p.id); handlers.onPeers?.(N); }

  // ---- WebRTC mesh ----
  function makePc(p) {
    try { p.pc?.close(); } catch {}
    const pc = p.pc = new RTCPeerConnection({ iceServers: ICE }); p.rtc = false; p.u = p.r = null;
    pc.onconnectionstatechange = () => {
      if (p.pc !== pc) return;
      if (["failed", "closed", "disconnected"].includes(pc.connectionState) && p.rtc) { p.rtc = false; handlers.onPeers?.(N); }
    };
    pc.ondatachannel = (e) => wire(p, pc, e.channel);
    return pc;
  }
  function wire(p, pc, ch) {
    ch.onopen = () => { if (p.pc !== pc) return; if (ch.label === "u") p.u = ch; else p.r = ch; if (p.u && p.r && !p.rtc) { p.rtc = true; p.tries = 0; handlers.onPeers?.(N); } };
    ch.onclose = () => { if (p.pc === pc && p.rtc) { p.rtc = false; handlers.onPeers?.(N); } };
    ch.onmessage = (e) => { p.last = performance.now(); let o; try { o = JSON.parse(e.data); } catch { return; } if (o.m) handlers.onMsg?.(p.id, o.m); };
  }
  const gathered = (pc) => new Promise((res) => {
    if (pc.iceGatheringState === "complete") return res();
    const t = setTimeout(res, 1800); pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } });
  });
  async function connect(p) {
    p.tries++; p.lastTry = performance.now();
    try {
      const pc = makePc(p);
      wire(p, pc, pc.createDataChannel("u", { ordered: false, maxRetransmits: 0 }));
      wire(p, pc, pc.createDataChannel("r", { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer()); await gathered(pc);
      if (p.pc === pc) busOut({ to: p.id, sdp: pc.localDescription });
    } catch {}
  }
  async function onSdp(p, sdp) {
    if (!useRtc) return;
    try {
      if (sdp.type === "offer") {
        const pc = makePc(p); p.lastTry = performance.now();
        await pc.setRemoteDescription(sdp); await pc.setLocalDescription(await pc.createAnswer()); await gathered(pc);
        if (p.pc === pc) busOut({ to: p.id, sdp: pc.localDescription });
      } else if (p.pc && p.pc.signalingState === "have-local-offer") await p.pc.setRemoteDescription(sdp);
    } catch {}
  }
  function sendRaw(ch, o) { try { if (ch && ch.readyState === "open" && ch.bufferedAmount < 262144) ch.send(JSON.stringify(o)); } catch {} }

  // ---- public ----
  // send(msg, {to, reliable}): direct where possible, relayed otherwise. Unreliable relayed messages are rate-limited per type.
  N.send = function (m, o = {}) {
    if (N.closed) return;
    const targets = o.to ? [N.peers.get(o.to)].filter(Boolean) : [...N.peers.values()], viaBus = [];
    for (const p of targets) { if (p.rtc) sendRaw(o.reliable ? p.r : p.u, { m }); else viaBus.push(p.id); }
    if (!viaBus.length) return;
    if (!o.reliable) { const now = performance.now(), key = m.t; if (now - (lastBus.get(key) || 0) < 240) return; lastBus.set(key, now); }
    busOut(o.to ? { to: o.to, m } : { tl: viaBus, m });
  };
  N.direct = () => { let n = 0; for (const p of N.peers.values()) if (p.rtc) n++; return n; };
  N.setInfo = (info) => { Object.assign(me, info); hello(); };
  N.close = function () {
    N.closed = true; clearInterval(beat);
    for (const p of N.peers.values()) try { p.pc?.close(); } catch {}
    for (const ws of sockets.values()) { ws.onclose = null; try { ws.close(); } catch {} }
    try { bc?.close(); } catch {}
    sockets.clear(); N.peers.clear();
  };

  try { if (typeof BroadcastChannel !== "undefined" && opts.local !== false) { bc = new BroadcastChannel(`deskgp:${code}`); bc.onmessage = (e) => busIn(e.data); } } catch {}
  ready.then(() => { if (useRelays) for (const u of RELAYS) openRelay(u, 0); hello(); });
  return N;
}
