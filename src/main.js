// DeskGP: game loop, sporting rules, lobby, HUD, netcode glue.
import { TRACKS, buildTrack, outlineOf, gridPose, wrap, speedProfile } from "./track.js";
import { makeCar, placeCar, stepCar, collideCars, updateTow, respawn, clamp, CLASSES } from "./physics.js";
import { makeBrain, drive, DRIVERS, DIFFS, codeOf } from "./ai.js";
import { createWorld } from "./world.js";
import { TEAMS, teamOf, uiColor } from "./teams.js";
import { createAudio } from "./audio.js";
import { createNet, newRoomCode, parseRoomCode, formatRoomCode, newId } from "./net.js";
import { encodeChallenge, decodeChallenge } from "./challenge.js";
import { locateGlobal } from "./track.js";

const $ = (s) => document.querySelector(s);
const COLORS = ["#e10600", "#ff8000", "#1e3a8a", "#27f4d2", "#006f62", "#2a63d4", "#ff87bc", "#f2f3f5", "#ffd60a", "#16181d"];
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const RANKS = [[0, "Karting"], [40, "Formula 4"], [120, "Formula 3"], [300, "Formula 2"], [600, "Grand Prix rookie"], [1200, "Race winner"], [2500, "World Champion"]];
const EMOTES = ["\u{1F44B}", "\u{1F602}", "\u{1F525}", "\u{1F3C1}"];
const NUMS = { VER: 1, HAM: 44, LEC: 16, NOR: 4, PIA: 81, RUS: 63, ALO: 14, SAI: 55, ANT: 12, GAS: 10, ALB: 23, TSU: 22, SEN: 27, MSC: 7 };
const CAMS = ["Chase cam", "Far chase", "Onboard", "TV cam"];
const DT = 1 / 120, MAXCARS = 10, QUALI_LAPS = 3;
const fmt = (t) => { if (t == null || !isFinite(t)) return "-:--.---"; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, "0")}`; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const angd = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// ---------- persistent bits ----------
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem("deskgp:" + k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("deskgp:" + k, JSON.stringify(v)); } catch {} },
};
const prefs = Object.assign({ name: "", num: 0, color: COLORS[0], team: "mclaren", sound: true, ghost: false, cam: 0, xp: 0, races: 0, wins: 0, line: 1, gfx: "auto" }, store.get("prefs3", {}));
const savePrefs = () => store.set("prefs3", prefs);
if (!TEAMS.some((t) => t.id === prefs.team)) prefs.team = "mclaren"; // teams from an older version
const me = { id: newId(), name: prefs.name || "", team: prefs.team, color: teamOf(prefs.team).body, num: prefs.num || 0, joined: Date.now() };

// circuits are built when first raced (a 7 km circuit takes a moment); menus use cheap outlines
const built = [];
const track = (i) => built[i] || (built[i] = buildTrack(TRACKS[i]));
const world = createWorld($("#gl"));
if (prefs.gfx !== "auto") world.setQuality(prefs.gfx);
const audio = createAudio(); audio.muted = !prefs.sound;
window.__deskgp = { world, track, get S() { return S; }, set auto(v) { S.auto = !!v; }, podium: (r) => showPodium(r) }; // auto: test hook, the AI drives your car

const S = { screen: "menu", room: null, race: null, boss: false, paused: false, clockOff: 0, clockRtt: 1e9, joinedAt: 0 };
const netNow = () => performance.now() + S.clockOff;
// a challenge link (#c=...) opened: someone's best lap to race against
S.challenge = location.hash.startsWith("#c=") ? decodeChallenge(location.hash.slice(3)) : null;
function challengeLink(trackIdx, clsId) {
  const d = TRACKS[trackIdx], pb = store.get(`pb3:${d.id}:${clsId}`, null); if (!pb?.rec?.length) return null;
  return `${location.origin}${location.pathname}#c=${encodeChallenge({ track: d.id, cls: clsId, name: me.name || prefs.name || "Driver", t: pb.t, rec: pb.rec })}`;
}
async function copyChallenge(btn, trackIdx, clsId) {
  const url = challengeLink(trackIdx, clsId); if (!url) return;
  try { await navigator.clipboard.writeText(url); btn.textContent = "Link copied: send it to a rival"; } catch { prompt("Copy this challenge link", url); }
  setTimeout(() => (btn.textContent = "Copy challenge link"), 2500);
}

// ---------- input ----------
const keys = new Set(), touch = { l: 0, r: 0, gas: 0, brake: 0, boost: 0 };
function readInput() {
  const k = (...c) => c.some((x) => keys.has(x));
  let steer = (k("ArrowRight", "KeyD") ? 1 : 0) - (k("ArrowLeft", "KeyA") ? 1 : 0) + touch.r - touch.l;
  let thr = k("ArrowUp", "KeyW") || touch.gas ? 1 : 0, brk = k("ArrowDown", "KeyS") || touch.brake ? 1 : 0, boost = k("Space", "ShiftLeft", "ShiftRight") || !!touch.boost, analog = false;
  const gp = navigator.getGamepads?.()[0];
  if (gp) {
    if (Math.abs(gp.axes[0]) > 0.08) { steer += Math.sign(gp.axes[0]) * ((Math.abs(gp.axes[0]) - 0.08) / 0.92) ** 1.6; analog = true; }
    thr = Math.max(thr, gp.buttons[7]?.value || 0, gp.buttons[0]?.pressed ? 1 : 0); brk = Math.max(brk, gp.buttons[6]?.value || 0);
    boost = boost || gp.buttons[2]?.pressed || gp.buttons[5]?.pressed;
  }
  return { steer: clamp(steer, -1, 1), thr, brk, boost, reverse: brk > 0 && thr === 0, direct: analog };
}
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") { if (e.code === "Enter") e.target.id === "code" ? $("#join").click() : e.target.blur(); return; }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code); audio.init();
  if (e.code === "KeyM") setSound(!prefs.sound);
  else if (e.code === "KeyH") toggleHelp();
  else if (S.screen !== "race") return;
  else if (e.code === "KeyC") { prefs.cam = (prefs.cam + 1) % 4; savePrefs(); toast(CAMS[prefs.cam]); }
  else if (e.code === "KeyR") recover();
  else if (e.code === "Escape") setPaused(!S.paused);
  else if (/^Digit[1-4]$/.test(e.code)) emote(+e.code.slice(5) - 1);
  else if (S.race?.spect && (e.code === "ArrowRight" || e.code === "ArrowLeft")) S.race.spectI = (S.race.spectI || 0) + (e.code === "ArrowRight" ? 1 : -1);
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());
for (const [id, key] of [["t-left", "l"], ["t-right", "r"], ["t-gas", "gas"], ["t-brake", "brake"], ["t-boost", "boost"]]) {
  const b = $("#" + id), on = (e) => { e.preventDefault(); touch[key] = 1; audio.init(); }, off = (e) => { e.preventDefault(); touch[key] = 0; };
  b.addEventListener("pointerdown", on); b.addEventListener("pointerup", off); b.addEventListener("pointercancel", off); b.addEventListener("pointerleave", off);
}
$("#touch").hidden = !matchMedia("(pointer:coarse)").matches;
addEventListener("pointerdown", () => audio.init(), { once: true });

function setSound(on) { prefs.sound = on; savePrefs(); audio.setMuted(!on); $("#p-sound").textContent = `Sound: ${on ? "on" : "off"}`; if (S.screen === "race") toast(on ? "Sound on" : "Muted"); }

// ---------- controls card: shown before a first-ever race, and on H ----------
function toggleHelp(force) { const h = $("#help"); const on = force ?? h.hidden; h.hidden = !on; if (!on && !prefs.seenControls) { prefs.seenControls = true; savePrefs(); } }

// ---------- screens ----------
function show(name) {
  S.screen = name;
  for (const id of ["menu", "lobby", "results"]) $("#" + id).hidden = id !== name;
  $("#hud").hidden = name !== "race"; $("#pause").hidden = true; S.paused = false;
  if (name === "menu") renderMenu();
}
function setPaused(p) {
  S.paused = p; $("#pause").hidden = !p;
  $("#p-title").textContent = isHost() ? (S.room?.solo ? "Paused" : "Paused for everyone") : "Menu (the race goes on)";
  hostHold();
}
// ---------- pausing: when the host is away (tab hidden) or in the pause menu, the whole session stops ----------
function hostAway() { return !!(S.paused || document.hidden); }
function hostHold() {
  const race = S.race; if (!race || race.demo || !isHost() || race.ended) return;
  const want = hostAway();
  if (want === race.held) return;
  const at = Math.round(netNow());
  applyHold(want, at);
  S.room?.net?.send({ t: "hold", on: want, at, n: race.go.n }, { reliable: true });
}
function applyHold(on, at) {
  const race = S.race; if (!race) return;
  race.holdSeen = performance.now();
  if (on === race.held) return;
  if (on) { race.held = true; race.heldAt = at; }
  else {
    race.held = false; race.t0 += Math.max(0, at - race.heldAt); // the race clock skips the paused time
    for (const e of race.cars) { e.snaps.length = 0; e.lastSeen = performance.now(); }
    acc = 0;
  }
  const h = $("#hold"); if (h) { h.hidden = !race.held || (isHost() && S.paused); h.textContent = isHost() ? "Paused" : "Paused \u00b7 waiting for the host to come back"; }
}
document.addEventListener("visibilitychange", hostHold);
setInterval(() => { // keep reminding everyone while held; if the host vanishes mid-pause, carry on without them
  const race = S.race; if (!race || race.demo) return;
  if (isHost()) { if (race.held) S.room?.net?.send({ t: "hold", on: true, at: race.heldAt, n: race.go.n }, { reliable: true }); else hostHold(); }
  else if (race.held && performance.now() - (race.holdSeen || 0) > 8000) applyHold(false, Math.round(netNow()));
}, 2000);
const gfxLabel = () => ({ auto: "auto", 2: "high (effects)", 1: "standard", 0: "low" })[prefs.gfx];
$("#p-resume").onclick = () => setPaused(false);
$("#p-sound").onclick = () => setSound(!prefs.sound);
$("#p-gfx").onclick = () => { const order = ["auto", 2, 1, 0]; prefs.gfx = order[(order.indexOf(prefs.gfx) + 1) % 4]; savePrefs(); world.setQuality(prefs.gfx); $("#p-gfx").textContent = `Graphics: ${gfxLabel()}`; };
$("#p-ghost").onclick = () => { prefs.ghost = !prefs.ghost; savePrefs(); $("#p-ghost").textContent = `Ghost of your best lap: ${prefs.ghost ? "on" : "off"}`; };
$("#p-leave").onclick = () => leaveRoom();
$("#p-sound").textContent = `Sound: ${prefs.sound ? "on" : "off"}`; $("#p-ghost").textContent = `Ghost of your best lap: ${prefs.ghost ? "on" : "off"}`; $("#p-gfx").textContent = `Graphics: ${gfxLabel()}`;
world.onQuality = () => console.info("DeskGP: graphics lowered to keep the frame rate up");

function rankOf(xp) { let r = RANKS[0]; for (const x of RANKS) if (xp >= x[0]) r = x; return r[1]; }
function renderMenu() {
  $("#name").value = prefs.name; $("#num").value = prefs.num || "";
  $("#colors").innerHTML = TEAMS.map((t) => `<button class="team${t.id === prefs.team ? " on" : ""}" data-t="${t.id}" style="background:${t.body};color:${t.ink};border-color:${t.id === prefs.team ? "#fff" : t.accent}" aria-label="${t.name}">${esc(t.short || t.name)}</button>`).join("");
  $("#career").textContent = prefs.races ? `${rankOf(prefs.xp)} · ${prefs.xp} points · ${prefs.wins} win${prefs.wins === 1 ? "" : "s"} from ${prefs.races} starts` : "";
  const hc = parseRoomCode(location.hash); if (hc) $("#code").value = formatRoomCode(hc);
  const ch = S.challenge, box = $("#chal"), ti = ch ? TRACKS.findIndex((d) => d.id === ch.track) : -1;
  box.hidden = !(ch && ti >= 0);
  if (ch && ti >= 0) box.querySelector("span").textContent = `${ch.name} challenges you: ${fmt(ch.t)} at ${TRACKS[ti].name} (${CLASSES[ch.cls]?.name || "car"}). Beat that lap.`;
}
$("#colors").onclick = (e) => { const t = e.target.closest("[data-t]")?.dataset.t; if (!t) return; prefs.team = me.team = t; me.color = teamOf(t).body; savePrefs(); renderMenu(); audio.fx("click"); };
$("#name").oninput = (e) => { prefs.name = e.target.value.trim().slice(0, 18); savePrefs(); };
$("#num").oninput = (e) => { const n = parseInt(e.target.value.replace(/\D/g, ""), 10); prefs.num = n >= 1 && n <= 99 ? n : 0; savePrefs(); };
function commitName() { me.name = prefs.name || `Driver ${me.id.slice(0, 3).toUpperCase()}`; me.team = prefs.team; me.color = uiColor(teamOf(prefs.team)); me.num = prefs.num || 2 + Math.floor(Math.random() * 97); }
$("#solo").onclick = () => { audio.init(); commitName(); enterRoom(null); };
$("#chal-go").onclick = () => {
  const ch = S.challenge, ti = TRACKS.findIndex((d) => d.id === ch?.track); if (ti < 0) return;
  audio.init(); commitName(); enterRoom(null);
  Object.assign(S.room.cfg, { track: ti, cls: CLASSES[ch.cls] ? ch.cls : "gt", bots: 0, laps: 3, rules: "casual", quali: false, dmg: 1 });
  startSession("race");
};
$("#create").onclick = () => { audio.init(); commitName(); enterRoom(newRoomCode(), true); };
$("#join").onclick = () => {
  audio.init(); const c = parseRoomCode($("#code").value);
  if (!c) { $("#menuerr").textContent = "That code does not look right. It is six letters and numbers, like KXM-4T9."; return; }
  $("#menuerr").textContent = ""; commitName(); enterRoom(c, false);
};

// ---------- room / lobby ----------
function defaultCfg() { const c = Object.assign({ track: 0, laps: 3, bots: 7, diff: 1, cls: "gt", rules: "casual" }, store.get("cfg5", {})); if (!(c.track < TRACKS.length)) c.track = 0; c.quali = c.rules === "gp"; c.dmg = c.rules === "gp" ? 2 : 1; return c; }
function enterRoom(code, creator) {
  leaveNet();
  me.joined = creator || !code ? 1 : Date.now();
  const R = S.room = { code, solo: !code, net: null, cfg: defaultCfg(), points: {}, raceN: 0, phase: "lobby", go: null, gotLob: !code || creator, qgrid: null };
  if (!R.solo) R.cfg.bots = Math.min(R.cfg.bots, 5);
  S.joinedAt = performance.now(); S.clockOff = 0; S.clockRtt = 1e9;
  if (code) {
    R.net = createNet(code, me, { onPeers: () => { renderLobby(); if (isHost()) sendLob(); }, onMsg, onStatus: renderLobby });
    try { history.replaceState(null, "", "#" + code); } catch {}
  }
  show("lobby"); renderLobby(); startDemo();
}
function leaveNet() { if (S.room?.net) S.room.net.close(); }
function leaveRoom() {
  leaveNet(); S.room = null; closeLineup(); endRace();
  try { history.replaceState(null, "", location.pathname + location.search); } catch {}
  show("menu"); startDemo();
}
function members() {
  const R = S.room, list = [{ id: me.id, name: me.name, team: me.team, color: me.color, num: me.num, joined: me.joined, me: true, rtc: true }];
  if (R?.net) for (const p of R.net.peers.values()) list.push({ id: p.id, name: p.name || "Driver", team: p.team || "mclaren", color: uiColor(teamOf(p.team)), num: p.num || 0, joined: p.joined || 9e15, rtc: p.rtc });
  return list.sort((a, b) => a.joined - b.joined || (a.id < b.id ? -1 : 1));
}
function hostId() { return members()[0].id; }
function isHost() {
  const R = S.room; if (!R) return false; if (R.solo) return true;
  if (hostId() !== me.id) return false;
  return R.gotLob || performance.now() - S.joinedAt > 5000;
}
function sendLob(to) { const R = S.room; if (!R?.net || !isHost()) return; R.gotLob = true; R.net.send({ t: "lob", cfg: R.cfg, points: R.points, raceN: R.raceN, phase: R.phase, go: R.phase === "race" ? R.go : null }, { reliable: true, to }); }
setInterval(() => { const R = S.room; if (!R?.net) return; if (isHost()) sendLob(); else R.net.send({ t: "pi", a: performance.now() }, { to: hostId() }); if (S.screen === "lobby") renderLobby(); }, 2000);

function setCfg(k, v) { const R = S.room; if (!isHost()) return; R.cfg[k] = v; if (k === "rules") { R.cfg.quali = v === "gp"; R.cfg.dmg = v === "gp" ? 2 : 1; } store.set("cfg5", R.cfg); audio.fx("click"); sendLob(); renderLobby(); if (k === "track" || k === "cls") startDemo(true); }
function seg(el, items, cur, onPick) {
  el.innerHTML = items.map(([v, label]) => `<button data-v='${JSON.stringify(v)}' class="${v === cur ? "on" : ""}">${label}</button>`).join("");
  el.onclick = (e) => { const v = e.target.dataset.v; if (v != null) onPick(JSON.parse(v)); };
}
function drawMini(cv, T, dots) {
  const g = cv.getContext("2d"), w = cv.width, h = cv.height, B = T.box, sc = Math.min((w - 16) / (B.hx * 2), (h - 16) / (B.hz * 2));
  const X = (x) => w / 2 + x * sc, Z = (z) => h / 2 + z * sc;
  g.clearRect(0, 0, w, h); g.lineJoin = g.lineCap = "round";
  g.beginPath(); for (let i = 0; i < T.n; i += 3) g.lineTo(X(T.x[i]), Z(T.z[i])); g.closePath();
  g.strokeStyle = "rgba(0,0,0,.6)"; g.lineWidth = w / 34; g.stroke(); g.strokeStyle = "#e9edf5"; g.lineWidth = w / 60; g.stroke();
  g.strokeStyle = "#2fe37a"; g.lineWidth = w / 60;
  for (const [a, b] of T.drsRuns || []) { g.beginPath(); for (let i = a; i < b; i += 3) { const j = wrap(i, T.n); g.lineTo(X(T.x[j]), Z(T.z[j])); } g.stroke(); }
  g.fillStyle = "#e10600"; g.fillRect(X(T.x[0]) - 2, Z(T.z[0]) - w / 50, 4, w / 25);
  if (dots) for (const d of dots) { g.beginPath(); g.arc(X(d.x), Z(d.z), d.me ? w / 44 : w / 62, 0, 6.3); g.fillStyle = d.color; g.fill(); if (d.me) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke(); } }
}
function renderLobby() {
  const R = S.room; if (!R || S.screen !== "lobby") return;
  const host = isHost(), mem = members(), hid = hostId();
  $("#roomlabel").textContent = R.solo ? "GRAND PRIX" : "ROOM CODE - SHARE IT";
  $("#roomcode").textContent = R.solo ? "You vs the AI grid" : formatRoomCode(R.code); $("#roomcode").classList.toggle("solo", R.solo);
  $("#copy").hidden = R.solo;
  const nb = Math.min(R.cfg.bots, MAXCARS - mem.length);
  $("#players").innerHTML = mem.map((m) => `<div class="pl"><i style="background:${esc(m.color)}"></i>${esc(m.name)}${m.me ? " (you)" : ""}<span class="pts">${R.points[m.id] ? R.points[m.id] + " pts" : ""}</span><em>${m.id === hid ? "host" : m.rtc ? "direct" : "relay"}</em></div>`).join("")
    + botPool(mem).slice(0, Math.max(0, nb)).map(([[name], t], i) => `<div class="pl bot"><i style="background:${uiColor(t)}"></i>${esc(name)} <small style="opacity:.6">${esc(t.name)}</small><span class="pts">${R.points["bot" + i] ? R.points["bot" + i] + " pts" : ""}</span><em>AI</em></div>`).join("");
  const n = R.net;
  $("#netstat").textContent = R.solo ? "" : !n.relaysUp ? "Connecting to the matchmaking relays…" : mem.length === 1 ? "Waiting for drivers. Send them the code or the link." : `${mem.length} drivers connected`;
  const tk = $("#tracks");
  if (!tk.childElementCount) {
    tk.innerHTML = TRACKS.map((d, i) => `<button class="trk" data-i="${i}"><canvas width="240" height="150"></canvas><b>${d.name}</b><small>${d.country} \u00b7 ${(d.length / 1000).toFixed(3)} km${d.street ? " \u00b7 street" : ""}${d.mood === "night" ? " \u00b7 night" : ""}</small></button>`).join("");
    tk.insertAdjacentHTML("afterend", `<p id="trkblurb"></p>`);
    tk.querySelectorAll("canvas").forEach((cv, i) => drawMini(cv, outlineOf(TRACKS[i])));
    tk.onclick = (e) => { const b = e.target.closest(".trk"); if (b) setCfg("track", +b.dataset.i); };
  }
  tk.querySelectorAll(".trk").forEach((b, i) => b.classList.toggle("on", i === R.cfg.track));
  const pb = store.get(`pb3:${TRACKS[R.cfg.track].id}:${R.cfg.cls}`, null);
  $("#trkblurb").textContent = `${TRACKS[R.cfg.track].full}. ${TRACKS[R.cfg.track].blurb}` + (pb ? ` Your best lap: ${fmt(pb.t)}.` : "");
  const pick = (k) => (v) => setCfg(k, v);
  seg($("#o-cls"), [["gt", "Electric GT"], ["f1", "Formula"]], R.cfg.cls, pick("cls"));
  seg($("#o-laps"), [[1, "1 lap"], [3, "3"], [5, "5"], [10, "10"]], R.cfg.laps, pick("laps"));
  seg($("#o-bots"), [0, 3, 5, 7, 9].map((b) => [b, String(b)]), R.cfg.bots, pick("bots"));
  seg($("#o-diff"), DIFFS.map((d, i) => [i, d.name]), R.cfg.diff, pick("diff"));
  seg($("#o-rules"), [["casual", "Casual"], ["gp", "Grand Prix"]], R.cfg.rules || "casual", pick("rules"));
  const mine = (k, v) => { prefs[k] = v; savePrefs(); audio.fx("click"); renderLobby(); };
  seg($("#a-line"), [[0, "Off"], [1, "Corners"], [2, "Full"]], prefs.line, (v) => mine("line", v));
  $("#lobby .panel").querySelectorAll(".cols > div:last-child").forEach((d) => d.classList.toggle("locked", !host));
  $("#start").hidden = !host; $("#start").disabled = mem.length + nb < 1;
  $("#start").textContent = R.cfg.quali ? "Start qualifying" : R.raceN ? "Next race" : "Lights out";
  $("#lobbymsg").textContent = host ? (mem.length + nb < 2 ? "Just you: a time trial." : R.cfg.rules === "gp" ? "Grand Prix rules: qualifying sets the grid, then the full rulebook. Race control explains each rule the first time it comes up." : "Grid order is drawn at random.") : R.phase === "race" ? "Session in progress. You will join the next one." : "Waiting for the host to start…";
}
$("#copy").onclick = async () => { const url = location.origin + location.pathname + "#" + S.room.code; try { await navigator.clipboard.writeText(url); $("#copy").textContent = "Link copied"; } catch { prompt("Copy this link", url); } setTimeout(() => ($("#copy").textContent = "Copy invite link"), 1600); };
$("#leave").onclick = leaveRoom;

// the real drivers still free once the humans have taken their seats: [[name, code, number], team]
function botPool(mem) { const pool = []; for (const t of TEAMS) { const humans = mem.filter((m) => m.team === t.id).length; t.drivers.slice(humans).forEach((d) => pool.push([d, t])); } return pool; }
function buildGrid(order) {
  const R = S.room, mem = members(), nb = Math.max(0, Math.min(R.cfg.bots, MAXCARS - mem.length));
  let grid = mem.slice(0, MAXCARS).map((m) => ({ id: m.id, name: m.name, team: m.team, color: uiColor(teamOf(m.team)), num: m.num, kind: "h" }));
  // the AI drivers are the real grid, team by team; a human takes one of the two seats in the team they picked
  const pool = botPool(mem);
  for (let i = 0; i < nb && i < pool.length; i++) { const [[name, , num], t] = pool[i]; grid.push({ id: "bot" + i, name, team: t.id, color: uiColor(t), num, kind: "b", skill: DIFFS[R.cfg.diff].skill * (1 - 0.006 * ((i * 7) % 5)), seed: Math.random() }); }
  if (order) grid.sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
  else grid = grid.map((g) => [Math.random(), g]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  return grid;
}
function startSession(mode, order) {
  const R = S.room; if (!isHost()) return;
  R.go = { t: "go", mode, at: Math.round(netNow() + (mode === "race" ? 6500 : 1500)), hold: Math.round(400 + Math.random() * 2200), cfg: { ...R.cfg }, grid: buildGrid(order), n: mode === "race" ? ++R.raceN : R.raceN + 0.5 };
  R.phase = "race"; R.net?.send(R.go, { reliable: true }); sendLob();
  startRace(R.go);
}
$("#start").onclick = () => { const R = S.room; if (!isHost()) return; startSession(R.cfg.quali ? "quali" : "race"); };

// ---------- network messages ----------
function onMsg(from, m) {
  const R = S.room; if (!R) return; const race = S.race;
  switch (m.t) {
    case "pi": R.net.send({ t: "po", a: m.a, b: performance.now() + S.clockOff }, { to: from }); break;
    case "po": { const now = performance.now(), rtt = now - m.a; if (rtt < S.clockRtt * 1.3 || rtt < 60) { if (rtt < S.clockRtt) S.clockRtt = rtt; S.clockOff = m.b + rtt / 2 - now; } S.clockRtt *= 1.05; break; }
    case "lob":
      if (from !== hostId()) break;
      R.gotLob = true; R.cfg = m.cfg; R.points = m.points; R.raceN = m.raceN; R.phase = m.phase;
      if (m.go && (!race || race.demo || race.go.n !== m.go.n) && S.screen !== "results") startRace(m.go);
      if (S.screen === "lobby") { renderLobby(); startDemo(); }
      break;
    case "go": if (from === hostId()) { R.go = m; R.phase = "race"; R.cfg = m.cfg; if (m.mode === "race") R.raceN = m.n; startRace(m); } break;
    case "s": if (race && !race.demo) for (const a of m.c) { const e = race.byId.get(a[0]); if (e && !owns(e)) pushSnap(e, m.ts, a); } break;
    case "lap": { const e = race?.byId.get(m.id); if (e && !owns(e)) onLap(e, m.lt, m.rt, m.fin, true, m.inv); break; }
    case "hit": { if (!race) break; for (const h of m.h) { const e = race.byId.get(h[0]); if (e && !owns(e)) e.c.dents.push({ lx: h[1], lz: h[2], a: h[3] }); } break; }
    case "rc": { const e = race?.byId.get(m.id); if (e && !owns(e)) { e.pen += m.pen || 0; if (m.tl) e.tlN = m.tl; if (m.pen || /RETIRED|BLACK/.test(m.text)) raceControl(m.text, false, false); } break; }
    case "em": if (race) { world.emote(m.id, EMOTES[m.e] || ""); audio.fx("emote"); } break;
    case "tk": { const e = race?.byId.get(m.id); if (e) { e.kind = "b"; e.skill = 0.9; feed(`${esc(e.code)}: autopilot takes over`); } break; }
    case "res": if (from === hostId() && race && !race.demo) showResults(m); break;
    case "hold": if (from === hostId() && race && !race.demo && race.go.n === m.n) applyHold(m.on, m.at); break;
  }
}

// ---------- race ----------
function endRace() { S.race = null; world.clearCars(); world.setRacingLine(null); $("#interval").hidden = true; $("#rc").hidden = true; }
function startDemo(force) {
  if (S.race && !S.race.demo) return;
  const ti = S.room ? S.room.cfg.track : Math.floor(Math.random() * TRACKS.length), cls = S.room ? S.room.cfg.cls : "gt";
  if (!force && S.race?.demo && S.race.T === built[ti] && S.race.cls.id === cls) return;
  const grid = DRIVERS.slice(0, 6).map((d, i) => ({ id: "demo" + i, name: d[0], team: d[4], color: uiColor(teamOf(d[4])), num: d[3], kind: "b", skill: 0.88 + i * 0.012, seed: Math.random() }));
  startRace({ mode: "race", at: netNow() - 9000, hold: 0, cfg: { track: ti, laps: 9999, cls, dmg: 1 }, grid, n: -1 }, true);
}
function owns(e) { return e.id === me.id || (e.kind === "b" && (S.race.demo || isHost())); }

function startRace(go, demo) {
  endRace();
  const T = track(go.cfg.track), cls = CLASSES[go.cfg.cls] || CLASSES.gt, quali = go.mode === "quali";
  T.v = speedProfile(T, cls);
  if (world.T !== T || world.cls !== cls.id) { world.setTrack(T, T.v); world.cls = cls.id; } else world.resetRace();
  audio.mode = cls.id === "f1" ? "v6" : "ev";
  const race = S.race = { go, demo: !!demo, T, cls, quali, laps: quali ? QUALI_LAPS : go.cfg.laps, dmg: go.cfg.rules === "gp" ? 2 : 1, gp: go.cfg.rules === "gp" && !demo, t0: go.at + 5000 + go.hold, cars: [], byId: new Map(), mine: null, state: "pre", order: [], firstFin: null, lightsN: -1, sendT: 0, hudT: 0, monT: 0, bestLap: null, bestBy: null, spect: false, yellowT: [-99, -99, -99], drsOn: !(go.cfg.rules === "gp") || quali, rcQ: [], outHits: [], held: false, heldAt: 0 };
  if (quali) race.t0 = go.at + 3500;
  go.grid.forEach((g, i) => {
    const c = makeCar(g.id, cls), pose = quali ? gridPose(T, i * 3) : gridPose(T, i); placeCar(c, pose); c.total = pose.i - T.n; c.dents = [];
    const e = { ...g, code: codeOf(g.name), c, slot: i, br: null, snaps: [], lapStart: 0, lapTimes: [], valid: [], best: null, lapsDone: 0, fin: false, finT: null, pos: i + 1, px: c.x, pz: c.z, ph: c.h, lastSeen: performance.now(), delay: 110, gapAvg: 50, secT: 0, sec: 0, rec: [], prof: [], recT: 0, pen: 0, tlN: 0, inv: false, wasTl: false, rel: {}, drsArm: [], prevIdx: c.idx, ret: false, bt: new Map(), bk: null, grid: i + 1, ovt: 0, top: 0 };
    race.cars.push(e); race.byId.set(g.id, e);
    world.addCar(g.id, teamOf(g.team).body, cls.id, { number: g.num, team: teamOf(g.team) });
    if (g.id === me.id) race.mine = e;
  });
  race.spect = !demo && !race.mine;
  if (!demo && !quali && netNow() < go.at - 800) startIntro(race);
  if (!demo && race.mine && !prefs.seenControls) toggleHelp(true);
  if (race.mine) loadGhost(race);
  world.snapCamera();
  race.autoBrain = makeBrain(0.92, 0.2); race.jump = false; race.firstThr = null;
  if (!demo) {
    show("race"); $("#towerrows").innerHTML = ""; $("#feed").innerHTML = ""; $("#toasts").innerHTML = ""; $("#spect").hidden = !race.spect; $("#rc").hidden = true; $("#flags").hidden = true;
    for (const el of $("#sectors").children) el.className = "";
    for (const k in hudCache) delete hudCache[k];
    drawMapBase(T);
    $("#sess").textContent = quali ? "QUALIFYING" : "RACE";
    $("#startlights").classList.toggle("on", !quali);
    big(T.def.name.toUpperCase(), quali ? "ONE-SHOT QUALIFYING" : `${race.laps} LAPS · ${cls.name.toUpperCase()}`);
    if (race.spect) $("#spect").textContent = "Spectating. You are in the next session. ← → to switch car.";
  }
}

function loadGhost(race) {
  const pb = store.get(`pb3:${race.T.id}:${race.cls.id}`, null); race.pb = pb;
  const ch = S.challenge;
  if (ch && S.room?.solo && ch.track === race.T.id && ch.cls === race.cls.id) {
    // the challenger's lap: their ghost on track, and their time at every point of the lap for the live gap
    const prof = []; let idx = 0;
    for (let k = 0; k < ch.rec.length; k += 3) { idx = locateGlobal(race.T, ch.rec[k], ch.rec[k + 1]); const b = Math.floor(idx / 8); if (b >= prof.length) { while (prof.length < b) prof.push(prof[prof.length - 1] ?? 0); prof.push(+(k / 30).toFixed(2)); } }
    race.chal = ch; race.pb = { t: ch.t, rec: ch.rec, prof }; race.ghost = race.pb; world.addCar("ghost", "#ffd60a", race.cls.id, { ghost: true });
    toast(`${ch.name}'s ghost: ${fmt(ch.t)}`, "p"); return;
  }
  if (pb?.rec?.length > 10 && prefs.ghost) { world.addCar("ghost", "#ffffff", race.cls.id, { ghost: true }); race.ghost = pb; }
}

function pushSnap(e, ts, a) {
  const s = { ts, x: a[1], z: a[2], h: a[3], vx: a[4], vz: a[5], w: a[6], steer: a[7], fl: a[8], total: a[9], dm: a[10] || 0 };
  const last = e.snaps[e.snaps.length - 1];
  if (last && ts <= last.ts) return;
  if (last) { e.gapAvg += (Math.min(600, ts - last.ts) - e.gapAvg) * 0.1; e.delay += (clamp(e.gapAvg * 2 + 15, 80, 700) - e.delay) * 0.05; }
  e.snaps.push(s); if (e.snaps.length > 30) e.snaps.shift();
  e.lastSeen = performance.now();
}
function applyRemote(e, now) {
  const sn = e.snaps, c = e.c; if (!sn.length) return;
  const rt = now - e.delay; let b = sn.length - 1;
  while (b > 0 && sn[b - 1].ts > rt) b--;
  const B = sn[b], A = sn[b - 1];
  if (A && rt <= B.ts && rt >= A.ts) {
    const d = (B.ts - A.ts) / 1000, u = (rt - A.ts) / (B.ts - A.ts), u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    c.x = h00 * A.x + h10 * d * A.vx + h01 * B.x + h11 * d * B.vx; c.z = h00 * A.z + h10 * d * A.vz + h01 * B.z + h11 * d * B.vz;
    c.h = A.h + angd(B.h, A.h) * u; c.vx = A.vx + (B.vx - A.vx) * u; c.vz = A.vz + (B.vz - A.vz) * u; c.w = A.w + (B.w - A.w) * u; c.steer = A.steer + (B.steer - A.steer) * u;
  } else {
    const L = rt < sn[0].ts ? sn[0] : B, ex = clamp((rt - L.ts) / 1000, 0, 0.35);
    c.x = L.x + L.vx * ex; c.z = L.z + L.vz * ex; c.h = L.h + L.w * ex; c.vx = L.vx; c.vz = L.vz; c.w = L.w; c.steer = L.steer;
  }
  const fl = B.fl, dm = B.dm;
  c.boosting = !!(fl & 1); c.brk = fl & 2 ? 1 : 0; c.drs = !!(fl & 4); c.retired = !!(fl & 8); c.thr = fl & 16 ? 1 : 0; c.slip = fl & 32 ? 0.6 : 0; c.respawned = fl & 64 ? 0.3 : 0; c.surf = fl & 128 ? 2 : 0;
  c.dmg.f = (dm & 15) / 15; c.dmg.r = ((dm >> 4) & 15) / 15; c.dmg.l = ((dm >> 8) & 15) / 15; c.dmg.rt = ((dm >> 12) & 15) / 15; c.dmg.e = ((dm >> 16) & 15) / 15;
  c.total = B.total; c.idx = wrap(B.total, S.race.T.n); c.speed = Math.hypot(c.vx, c.vz);
  c.lat = (c.x - S.race.T.x[c.idx]) * S.race.T.nx[c.idx] + (c.z - S.race.T.z[c.idx]) * S.race.T.nz[c.idx];
}

// ---------- race control ----------
// Race control: the banner is for your own incidents and session-wide calls; everything else goes to the feed.
function raceControl(text, banner, sound) {
  if (S.screen !== "race") return;
  feed(esc(text));
  const race = S.race; if (!race) return;
  if (banner) { race.rcQ.push(text); if (race.rcQ.length > 3) race.rcQ.shift(); }
  if (sound) audio.fx("rc");
}
function penalise(e, text, pen, extra = {}) {
  if (S.race.demo) return;
  e.pen += pen;
  const mine = e === S.race.mine, quiet = !mine && !pen && !/RETIRED|BLACK/.test(text);
  if (!quiet) raceControl(text, mine, mine);
  if (mine && pen) toast(`+${pen}s TIME PENALTY`, "r");
  S.room?.net?.send({ t: "rc", id: e.id, text, pen, ...extra }, { reliable: true });
}

function onLap(e, lt, rt, fin, remote, inv) {
  const race = S.race; e.lapTimes.push(lt); e.valid.push(!inv); e.lapsDone = e.lapTimes.length;
  const timed = !race.quali || e.lapsDone > 1; // the qualifying out lap is not timed
  const ok = !inv && timed;
  const pbLap = ok && (e.best == null || lt < e.best); if (pbLap) e.best = lt;
  const fastest = ok && (race.bestLap == null || lt < race.bestLap);
  if (fastest) { race.bestLap = lt; race.bestBy = e.id; if (!race.demo && e.lapsDone > 1) feed(`<b style="color:#c06bff">FASTEST LAP</b> ${esc(e.code)} ${fmt(lt)}`); }
  if (fin && !e.fin) {
    e.fin = true; e.finT = rt; if (race.firstFin == null && !race.quali) { race.firstFin = rt; if (!race.demo) raceControl("CHEQUERED FLAG", true, true); }
  }
  if (e === race.mine && !remote) {
    // every lap tells you exactly where you stand against your all-time best on this circuit and car
    const key = `pb3:${race.T.id}:${race.cls.id}`, old = store.get(key, null);
    if (timed && e.lapsDone > 1 || !race.quali) {
      if (race.chal && !inv) { const d = lt - race.chal.t; toast(d < 0 ? `YOU BEAT ${race.chal.name.toUpperCase()} BY ${(-d).toFixed(3)}` : `+${d.toFixed(3)} to ${race.chal.name}`, d < 0 ? "p" : ""); if (d < 0) { audio.fx("best"); race.chalBeat = true; } }
      else if (inv) toast(`Lap ${fmt(lt)} \u00b7 not counted (four wheels off)`);
      else if (!old || lt < old.t) { toast(old ? `PERSONAL BEST ${fmt(lt)} \u00b7 \u2212${(old.t - lt).toFixed(3)}` : `PERSONAL BEST ${fmt(lt)}`, "p"); audio.fx("best"); }
      else { toast(`Lap ${fmt(lt)} \u00b7 +${(lt - old.t).toFixed(3)} to your best`, lt - old.t < 0.5 ? "g" : ""); audio.fx("lap"); }
    }
    if (ok && e.rec.length > 20 && (!old || lt < old.t)) { store.set(key, { t: lt, rec: e.rec, prof: e.prof }); race.pb = { t: lt, rec: e.rec, prof: e.prof }; if (old) race.newPB = true; }
    e.rec = []; e.prof = []; e.recT = 0;
    if (!race.quali && !fin && e.lapsDone === race.laps - 1) setTimeout(() => big("FINAL LAP"), 300);
    if (race.quali && e.lapsDone === 1) big("FLYING LAP");
    if (fin) {
      if (race.quali) big("SESSION COMPLETE", e.best ? fmt(e.best) : "NO TIME SET");
      else { const pos = race.order.indexOf(e) + 1; big(`P${pos}`, pos === 1 ? "RACE WINNER" : pos <= 3 ? "PODIUM" : pos <= 10 ? "POINTS FINISH" : "CLASSIFIED"); audio.fx(pos === 1 ? "win" : "finish"); world.confetti(e.c.x, e.c.z, pos <= 3 ? 140 : 40); }
    }
    for (const el of $("#sectors").children) el.className = "";
  }
  e.inv = false;
}

// sector of the circuit a car is in, and whether that sector is under yellow flags
const sectorOf = (race, c) => race.T.sector(c.idx);
function yellowIn(race, s, raceT) { return raceT - race.yellowT[s] < 5; }

// steering assist / pure pursuit along the racing line
function pursuit(c, T) {
  const v = c.speed, li = wrap(c.idx + Math.round((6 + v * 0.34) / T.step), T.n), keep = T.lo[li];
  const tx = T.x[li] + T.nx[li] * keep, tz = T.z[li] + T.nz[li] * keep, err = angd(Math.atan2(tz - c.z, tx - c.x), c.h);
  return clamp(err * (2.8 + 40 / (v + 12)), -1, 1);
}

function simStep(race, now) {
  const T = race.T, raceT = (now - race.t0) / 1000, green = raceT >= 0, n = T.n;
  if (green && race.state === "pre") { race.state = "run"; }
  const all = race.cars, phys = all.map((e) => e.c), host = isHost(), dmg = race.dmg;
  const leaderLaps = Math.max(0, ...all.map((e) => e.lapsDone));
  if (race.gp && !race.drsOn && leaderLaps >= 2) { race.drsOn = true; raceControl("DRS ENABLED", true, true); explain("drs"); }
  for (const e of all) {
    const c = e.c;
    if (e.hide) continue;
    if (!owns(e)) { applyRemote(e, now); continue; }
    e.px = c.x; e.pz = c.z; e.ph = c.h;
    let inp;
    if (e === race.mine && !e.fin && !c.retired && !S.auto) {
      inp = S.paused ? { steer: 0, thr: 0, brk: 0 } : readInput();
      if (race.gp && !green && !race.quali && inp.thr > 0 && raceT > -race.go.hold / 1000 - 0.05) race.jump = true; // moving once all five lights are on
      if (green && race.firstThr == null && inp.thr > 0 && race.jump) { penalise(e, `${e.code} 5 SECOND TIME PENALTY \u00b7 JUMP START`, 5); explain("jump"); race.react = null; }
      if (green && race.firstThr == null && inp.thr > 0) { race.firstThr = raceT; if (!race.quali && !race.jump) { reaction(raceT); race.react = raceT; } setTimeout(() => { if (!$("#help").hidden) toggleHelp(false); }, 2500); }
    } else {
      if (!e.br) e.br = e === race.mine ? race.autoBrain : makeBrain(e.skill || 0.9, e.seed ?? Math.random());
      const br = e.br;
      if (e.fin) br.skill = 0.6;
      else if (e.kind === "b" && !race.demo && !race.quali) { // a gentle pull toward the human drivers
        let hs = 0, hn = 0; for (const o of all) if (o.kind === "h" && !o.gone) { hs += o.c.total; hn++; }
        if (hn) br.band = 1 + clamp((hs / hn - c.total) * T.step / 6000, -0.025, 0.03);
      }
      inp = green ? drive(c, br, T, phys, DT, raceT, { yellow: race.gp && yellowIn(race, sectorOf(race, c), raceT) }) : { steer: 0, thr: 0, brk: 0, direct: true };
      if (inp.respawn) respawn(c, T);
    }
    // DRS: armed if within one second of the car ahead at the detection point
    const zi = T.drsZones.findIndex((z) => wrap(c.idx - z.a, n) < wrap(z.b - z.a, n));
    for (let k = 0; k < T.drsZones.length; k++) {
      const z = T.drsZones[k], dp = wrap(e.prevIdx - z.det, n), dn = wrap(c.idx - z.det, n);
      if (dn < dp && dp > n / 2 && dn < 60) {
        let ahead = 1e9; for (const o of all) { if (o === e || o.hide) continue; const d = o.c.total - c.total; if (d > 0 && d < ahead) ahead = d; }
        const gap = (ahead * T.step) / Math.max(c.speed, 20);
        e.drsArm[k] = race.quali || gap < 1.0;
      }
    }
    inp.drsOk = zi >= 0 && (race.quali || (!!e.drsArm[zi] && race.drsOn && !(race.gp && yellowIn(race, T.sector(T.drsZones[zi].a), raceT))));
    e.drsReady = zi >= 0 ? inp.drsOk : (race.drsOn || race.quali) && T.drsZones.some((z, k) => e.drsArm[k] && wrap(z.a - c.idx, n) < 120);
    updateTow(c, phys);
    e.prevIdx = c.idx;
    if (!green) { c.steer += (clamp(inp.steer, -1, 1) - c.steer) * 0.2; c.thr = inp.thr; continue; }
    const wasDrs = c.drs;
    stepCar(c, inp, DT, T, { damage: race.demo ? 0 : dmg });
    if (c.tl && c.speed > 12 && c.respawned <= 0 && c.total > 0 && (race.gp || e.kind === "h")) e.inv = true; // a cut lap simply doesn't count as a record
    if (race.gp && c.tl && !e.wasTl && c.speed > 12 && c.respawned <= 0 && raceT > 1) { // Grand Prix: track limits are policed
      e.wasTl = true; e.tlN++;
      if (race.quali) { if (e === race.mine) toast("TRACK LIMITS \u00b7 LAP TIME DELETED", "r"); }
      else if (e.tlN < 3) penalise(e, `${e.code} TRACK LIMITS \u00b7 WARNING ${e.tlN} OF 3 \u00b7 LAP TIME DELETED`, 0, { tl: e.tlN });
      else if (e.tlN === 3) { penalise(e, `BLACK AND WHITE FLAG \u00b7 ${e.code} \u00b7 TRACK LIMITS`, 0, { tl: e.tlN }); if (e === race.mine) race.bwT = raceT; }
      else if ((e.tlN - 4) % 2 === 0) penalise(e, `${e.code} 5 SECOND TIME PENALTY \u00b7 TRACK LIMITS`, 5, { tl: e.tlN });
      if (e === race.mine) explain("tl");
    }
    if (!c.tl && Math.abs(c.lat) < T.half) e.wasTl = false;
    if (e === race.mine && c.drs && !wasDrs) audio.fx("drs");
    if (race.demo) { c.hits.length = 0; } else flushHits(race, e);
    // retirement
    if (c.retired && !e.ret) { e.ret = true; e.retT = raceT; if (!race.demo) penalise(e, `${e.code} RETIRED · ACCIDENT DAMAGE`, 0); if (e === race.mine) { big("RETIRED", "ACCIDENT DAMAGE"); audio.fx("lost"); } }
    if (e.ret && raceT - e.retT > 10) { e.hide = true; c.hidden = true; } // marshals recover the car
    // laps (after the leader takes the chequered flag, everyone finishes at their next crossing)
    const ld = Math.floor(c.total / n);
    if (c.total >= 0 && ld > e.lapsDone && !e.fin && !c.retired) {
      const lt = raceT - e.lapStart; e.lapStart = raceT;
      const fin = ld >= race.laps || (race.firstFin != null && !race.quali);
      const inv = e.inv;
      onLap(e, lt, raceT, fin, false, inv);
      if (!race.demo) S.room?.net?.send({ t: "lap", id: e.id, lt, rt: raceT, fin, inv }, { reliable: true });
    }
    if (e === race.mine) myEvents(race, e, raceT);
  }
  // timing beacons: real time gaps, measured the way F1 timing does it
  if (green) for (const e of all) {
    const bk = Math.floor(e.c.total / 12); // a timing beacon every 24 m
    if (e.bk == null) e.bk = bk;
    if (bk > e.bk && bk - e.bk < 40) { for (let b = e.bk + 1; b <= bk; b++) e.bt.set(b, raceT); e.bk = bk; if (e.bt.size > 600) e.bt.delete(e.bt.keys().next().value); }
    else if (bk > e.bk) e.bk = bk;
    if (e.c.speed > e.top && e.c.speed < 120) e.top = e.c.speed;
  }
  // contact, and the stewards' view of it
  if (!race.quali) for (let i = 0; i < all.length; i++) {
    const a = all[i]; if (a.hide || !owns(a)) continue;
    for (let j = 0; j < all.length; j++) {
      if (i === j) continue; const b = all[j]; if (b.hide) continue;
      const bo = owns(b); if (bo && j < i) continue;
      const r = green ? collideCars(a.c, b.c, bo, { damage: race.demo ? 0 : dmg }) : null;
      if (!r) continue;
      if (race.demo) { a.c.hits.length = 0; b.c.hits.length = 0; continue; }
      flushHits(race, a); if (bo) flushHits(race, b);
      if (race.gp && r.rvn < -7 && raceT > 3) { fault(a, b, now); if (bo) fault(b, a, now); }
      if ((a === race.mine || b === race.mine) && r.hit > 0.1) { world.sparks((a.c.x + b.c.x) / 2, (a.c.z + b.c.z) / 2, 6 + r.hit * 16); world.shake(0.2 + r.hit * 0.7); audio.fx(r.hit > 0.4 ? "crash" : "bump", 0.4 + r.hit * 0.6); }
    }
  }
  if (race.gp) {
    // yellow flags: a stopped, recovering or retired car marks its sector for five seconds
    for (const e of all) { if (e.hide || e.fin) continue; const c = e.c; if ((raceT > 6 && c.speed < 7 && c.total > 0) || c.retired || c.respawned > 0) race.yellowT[sectorOf(race, c)] = raceT; }
    if (!race.quali) for (const e of all) {
      if (!owns(e) || e.hide || e.fin || e.kind !== "h") continue; // the AI holds position under yellows instead
      for (const o of all) {
        if (o === e || o.hide) continue;
        const d = e.c.total - o.c.total, prev = e.rel[o.id]; e.rel[o.id] = d;
        if (prev != null && prev < 0 && d >= 0 && d < 20 && o.c.speed > 22 && !o.c.retired && yellowIn(race, sectorOf(race, e.c), raceT) && raceT - (e.yPen || -99) > 8) { e.yPen = raceT; penalise(e, `${e.code} 5 SECOND TIME PENALTY \u00b7 OVERTAKING UNDER YELLOW FLAGS`, 5); if (e === race.mine) explain("yellow"); }
      }
    }
  }
  // dropped drivers: the host hands their car to the autopilot
  if (!race.demo && host && S.room?.net) for (const e of all) {
    if (e.kind === "h" && e.id !== me.id && !e.hide && !e.fin && green && !S.room.net.peers.has(e.id) && performance.now() - e.lastSeen > 6000) {
      e.kind = "b"; e.skill = 0.9; S.room.net.send({ t: "tk", id: e.id }, { reliable: true }); feed(`${esc(e.code)}: autopilot takes over`);
    }
  }
}
// x ran into the back of y: x is to blame (Grand Prix)
function fault(x, y, now) {
  const fx = Math.cos(y.c.h), fz = Math.sin(y.c.h);
  const rel = (x.c.x - y.c.x) * fx + (x.c.z - y.c.z) * fz, closing = (x.c.vx - y.c.vx) * fx + (x.c.vz - y.c.vz) * fz;
  if (rel < -1.2 && closing > 6 && now - (x.lastPen || 0) > 6000) { x.lastPen = now; penalise(x, `${x.code} 5 SECOND TIME PENALTY \u00b7 CAUSING A COLLISION WITH ${y.code}`, 5); if (x === S.race.mine) explain("col"); }
}
// Grand Prix mode teaches as it goes: the first time each rule comes up, race control says what it is
const RULES = {
  tl: "Track limits: the white lines are the edge of the track. All four wheels beyond them deletes the lap. Three warnings, then 5-second penalties.",
  jump: "Jump start: moving before the lights go out costs 5 seconds. Wait for all five lights to go out.",
  col: "Causing a collision: running into the back of another car costs 5 seconds. Penalties are added to your race time.",
  yellow: "Yellow flag: an incident ahead. Slow down; no overtaking and no DRS in that sector.",
  blue: "Blue flag: a car a lap ahead is right behind you. Let it through.",
  drs: "DRS: from lap 3, if you are within one second of the car ahead at the detection line, your rear wing opens on the straight.",
};
function explain(k) { const L = (prefs.learned ||= {}); if (L[k]) return; L[k] = 1; savePrefs(); const race = S.race; if (race) { race.rcQ.push(RULES[k]); feed(`<i>${esc(RULES[k])}</i>`); } }
function flushHits(race, e) {
  const c = e.c; if (!c.hits.length) return;
  for (const h of c.hits) { c.dents.push(h); race.outHits.push([e.id, +h.lx.toFixed(2), +h.lz.toFixed(2), +h.a.toFixed(2)]); if (e === race.mine && h.a > 0.12) { world.shake(0.3 + h.a); audio.fx("crash", Math.min(1, 0.4 + h.a)); } }
  c.hits.length = 0;
}

function myEvents(race, e, raceT) {
  const c = e.c, T = race.T;
  if (c.bump > 0.15 && performance.now() - (e.bumpT || 0) > 250) { e.bumpT = performance.now(); world.shake(c.bump * 0.6); audio.fx("bump", c.bump); world.sparks(c.x, c.z, 8); }
  c.bump = 0;
  // sectors
  const lapPos = wrap(c.total, T.n) / T.n, sec = Math.min(2, Math.floor(lapPos * 3));
  if (c.total >= 0 && sec !== e.sec) {
    const st = raceT - e.secT, k = `${T.id}:${race.cls.id}:${e.sec}`; e.secT = raceT;
    if (sec === (e.sec + 1) % 3 && !e.inv) {
      race.secBest ??= {}; const sb = store.get("sec3:" + k, null), el = $("#sectors").children[e.sec];
      if (sb == null || st < sb) { store.set("sec3:" + k, st); el.className = "p"; } else if (race.secBest[k] == null || st < race.secBest[k]) el.className = "g"; else el.className = "y";
      if (race.secBest[k] == null || st < race.secBest[k]) race.secBest[k] = st;
    }
    e.sec = sec;
    if (!race.quali && raceT > 8) race.ivT = 4.5;
  }
  if (c.total >= 0) { // record this lap for the ghost and the live delta
    const lt = raceT - e.lapStart;
    if (lt >= e.recT) { e.recT += 0.1; e.rec.push(+c.x.toFixed(1), +c.z.toFixed(1), +c.h.toFixed(2)); }
    const bucket = Math.floor(wrap(c.total, T.n) / 8); if (e.prof.length <= bucket) { while (e.prof.length < bucket) e.prof.push(e.prof[e.prof.length - 1] ?? 0); e.prof.push(+lt.toFixed(2)); }
  }
}
function reaction(t) {
  const ms = Math.round(t * 1000), tag = ms < 200 ? "Lightning start" : ms < 300 ? "Great start" : ms < 450 ? "Good start" : "Slow away";
  toast(`Reaction ${(ms / 1000).toFixed(3)}s · ${tag}`, ms < 300 ? "p" : ms < 450 ? "g" : "");
}
function recover() {
  const race = S.race, m = race?.mine; if (!m || race.state !== "run" || m.fin || m.c.retired) return;
  const c = m.c;
  respawn(c, race.T); toast("Back on track", "r");
}
function emote(i) { const race = S.race; if (!race?.mine || performance.now() - (race.emT || 0) < 900) return; race.emT = performance.now(); world.emote(me.id, EMOTES[i]); audio.fx("emote"); S.room?.net?.send({ t: "em", id: me.id, e: i }, { reliable: true }); }

// ---------- HUD ----------
function toast(text, cls = "") { if (S.screen !== "race") return; const d = document.createElement("div"); d.className = "toast " + cls; d.textContent = text; const box = $("#toasts"); box.prepend(d); while (box.childElementCount > 2) box.lastChild.remove(); setTimeout(() => d.remove(), 2200); }
function big(text, sub) { const b = $("#big"); b.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : ""); b.classList.remove("show"); void b.offsetWidth; b.classList.add("show"); }
function feed(html) { if (S.screen !== "race") return; const d = document.createElement("div"); d.innerHTML = html; const box = $("#feed"); box.append(d); while (box.childElementCount > 4) box.firstChild.remove(); setTimeout(() => d.remove(), 7000); }
$("#rpm").innerHTML = Array.from({ length: 15 }, (_, i) => `<i class="${i >= 12 ? "h" : i >= 6 ? "m" : ""}"></i>`).join("");
let mapBase = null;
function drawMapBase(T) { mapBase = document.createElement("canvas"); mapBase.width = 440; mapBase.height = 300; drawMini(mapBase, T); }
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function setClass(id, cls, on) { const k = id + "." + cls; if (hudCache[k] !== on) { hudCache[k] = on; $(id).classList.toggle(cls, on); } }
const gearOf = (cls, v) => cls.id === "f1" ? clamp(Math.floor(Math.pow(Math.max(v, 0) / cls.vtop, 0.85) * 8) + 1, 1, 8) : 0;
function rpmOf(cls, v) { if (cls.id !== "f1") return clamp(v / cls.vtop, 0, 1); const g = gearOf(cls, v), lo = Math.pow((g - 1) / 8, 1 / 0.85) * cls.vtop, hi = Math.pow(g / 8, 1 / 0.85) * cls.vtop; return clamp(0.45 + 0.55 * (v - lo) / (hi - lo), 0.2, 1); }
const dmgColor = (d) => (d < 0.3 ? "#2fe37a" : d < 0.65 ? "#ffb020" : "#ff3b3b");

function classify(race) {
  const L = (e) => e.lapsDone;
  return race.cars.filter((e) => !e.gone).sort((a, b) => {
    if (race.quali) return (a.best ?? 1e9) - (b.best ?? 1e9) || b.c.total - a.c.total;
    if (a.ret !== b.ret) return a.ret ? 1 : -1;
    if (a.fin && b.fin) return L(b) - L(a) || a.finT + a.pen - (b.finT + b.pen);
    if (a.fin !== b.fin) return a.fin ? (L(a) >= L(b) ? -1 : 1) : (L(b) >= L(a) ? 1 : -1);
    return b.c.total - a.c.total;
  });
}
function updateOrder(race) {
  const prev = race.mine?.pos;
  race.order = race.quali ? classify(race) : race.cars.filter((e) => !e.gone).sort((a, b) => (a.ret !== b.ret ? (a.ret ? 1 : -1) : a.fin && b.fin ? a.finT - b.finT : a.fin ? -1 : b.fin ? 1 : b.c.total - a.c.total));
  race.order.forEach((e, i) => { e.prevPos = e.pos; e.pos = i + 1; });
  // overtakes: a gain on track, not one handed over by a car that retired
  if (race.state === "run" && !race.quali && (netNow() - race.t0) > 3000) for (const e of race.order) if (e.prevPos && e.pos < e.prevPos && !e.fin && race.order.slice(e.pos, e.prevPos).every((o) => !o.ret && !o.hide && !o.fin)) e.ovt += e.prevPos - e.pos;
  const m = race.mine;
  if (m && prev && race.state === "run" && !race.quali && !m.fin && m.pos !== prev && (netNow() - race.t0) > 3000) {
    if (m.pos < prev) { toast(`P${m.pos}`, "g"); audio.fx("pass"); } else { toast(`P${m.pos}`, "r"); }
  }
}

function updateHud(race, dt, now) {
  const raceT = (now - race.t0) / 1000, T = race.T, cls = race.cls;
  // start lights: one comes on every second, then all go out after a random hold
  if (!race.quali) {
    const n = raceT >= 0 ? 6 : clamp(Math.floor((now - race.go.at) / 1000), 0, 5);
    if (n !== race.lightsN) {
      race.lightsN = n; const L = $("#startlights");
      if (n >= 1 && n <= 5) audio.fx("light");
      if (n === 6) { audio.fx("go"); big("LIGHTS OUT", "AND AWAY WE GO"); world.setLights(0, false); [...L.children].forEach((i) => (i.className = "")); setTimeout(() => L.classList.remove("on"), 700); }
      else { world.setLights(n, false); [...L.children].forEach((el, i) => (el.className = i < n ? "r" : "")); }
    }
  } else if (raceT < 0) setText("#spect", `Session starts in ${Math.ceil(-raceT)}`), ($("#spect").hidden = false); else if (!race.spect && hudCache.qs !== 1) { hudCache.qs = 1; $("#spect").hidden = true; }
  const view = race.focus; if (!view) return;
  const c = view.c, kmh = Math.round(c.speed * 3.6);
  setText("#speed", String(kmh));
  const g = gearOf(cls, c.speed); setText("#gear", cls.id === "f1" ? String(g) : c.boosting ? "B" : "D");
  if (view === race.mine && g > (race.lastGear || 0) && race.lastGear) audio.fx("shift"); race.lastGear = g;
  const rp = Math.round((cls.id === "f1" ? rpmOf(cls, c.speed) : c.thr) * 15); if (hudCache.rpm !== rp) { hudCache.rpm = rp; [...$("#rpm").children].forEach((el, i) => el.classList.toggle("on", i < rp)); }
  setClass("#b-drs", "on", !!c.drs); setClass("#b-drs", "ready", !c.drs && !!view.drsReady); setClass("#b-tow", "on", c.tow > 0.15); setClass("#b-ers", "on", !!c.boosting);
  const en = Math.round(c.energy * 100); if (hudCache.en !== en) { hudCache.en = en; $("#energy i").style.width = en + "%"; $("#energy").classList.toggle("full", en > 97); }
  $("#wrong").hidden = !(view === race.mine && c.wrong > 1.2);
  const lapNo = clamp(view.lapsDone + 1, 1, race.laps);
  setText("#lapn", race.quali ? (view.fin ? "QUALIFYING · DONE" : view.lapsDone === 0 ? "QUALIFYING · OUT LAP" : `QUALIFYING · LAP ${view.lapsDone}/${QUALI_LAPS - 1}`) : view.fin ? "FINISHED" : `LAP ${lapNo}/${race.laps}`);
  setText("#pos", `P${view.pos}`);
  if (raceT < 0) setText("#laptime", fmt(0)); else if (!view.fin) setText("#laptime", fmt(raceT - view.lapStart).slice(0, -2)); else setText("#laptime", race.quali ? fmt(view.best) : fmt(view.finT));
  let d = "";
  if (view === race.mine && race.pb?.prof && raceT > 0 && !view.fin && c.total >= 0 && !view.inv) {
    const ref = race.pb.prof[Math.floor(wrap(c.total, T.n) / 8)];
    if (ref != null && ref > 0) { const dv = raceT - view.lapStart - ref; d = (dv >= 0 ? "+" : "−") + Math.abs(dv).toFixed(2); setClass("#delta", "neg", dv < 0); setClass("#delta", "posv", dv >= 0); }
  }
  setText("#delta", d);
  // the only flag shown: the chequered flag
  let flag = !race.quali && race.firstFin != null ? "chq" : "", ftxt = flag ? "CHEQUERED FLAG" : "";
  if (!flag && race.gp && raceT > 0) {
    const mySec = sectorOf(race, c);
    if (yellowIn(race, mySec, raceT)) { flag = "yellow"; ftxt = `YELLOW \u00b7 SECTOR ${mySec + 1}`; explain("yellow"); }
    else if (race.bwT != null && raceT - race.bwT < 6 && view === race.mine) { flag = "bw"; ftxt = "TRACK LIMITS"; }
    else if (!race.quali && view === race.mine) for (const o of race.cars) { if (o === view || o.hide) continue; const ahead = o.c.total - c.total, behind = wrap(c.total - o.c.total, T.n) * T.step; if (ahead > T.n * 0.5 && behind > 0 && behind < 70) { flag = "blue"; ftxt = "BLUE FLAG \u00b7 LET THEM BY"; explain("blue"); break; } }
  }
  if (hudCache.flag !== flag + ftxt) { hudCache.flag = flag + ftxt; const f = $("#flags"); f.hidden = !flag; f.className = flag; $("#flagtext").textContent = ftxt; if (flag === "yellow" || flag === "blue") audio.fx("rc"); }
  if (race.gp) { const fl = [0, 1, 2].map((q) => (yellowIn(race, q, raceT) && raceT > 0 ? 1 : 0)), fk = fl.join(); if (hudCache.mflags !== fk) { hudCache.mflags = fk; world.setFlags(fl); } }
  // race control banner
  if (race.rcQ.length && !race.rcShow) { race.rcShow = race.rcQ.shift(); race.rcT = race.rcShow.length > 60 ? 7.5 : 3.6; $("#rctext").textContent = race.rcShow; const b = $("#rc"); b.hidden = false; b.style.animation = "none"; void b.offsetWidth; b.style.animation = ""; }
  if (race.rcShow) { race.rcT -= dt; if (race.rcT <= 0) { race.rcShow = null; $("#rc").hidden = true; } }
  // interval board: for a few seconds after each sector line, who is ahead and behind, and by how much
  if (race.ivT > 0 && view === race.mine && !view.fin) {
    race.ivT -= dt;
    if (!race.ivShown) {
      race.ivShown = true; const o = race.order, i = o.indexOf(view), A = o[i - 1], Bh = o[i + 1], k = view.bk;
      const gapTo = (x, y) => { for (let b = k; b > k - 6; b--) { const tx = x.bt.get(b), ty = y.bt.get(b); if (tx != null && ty != null) return tx - ty; } return null; };
      const row = (e, gap, cls) => `<div class="ir${e === view ? " me" : ""}"><b>${e.pos}</b><i style="background:${esc(e.color)}"></i><span>${esc(e.code)}</span><em class="${cls}">${gap}</em></div>`;
      let h = `<div class="ih">INTERVAL</div>`;
      if (A) { const g = gapTo(view, A); h += row(A, g != null ? `+${g.toFixed(3)}` : "", ""); }
      h += row(view, "", "");
      if (Bh) { const g = gapTo(Bh, view); h += row(Bh, g != null ? `-${g.toFixed(3)}` : "", g != null && g < 1 ? "r" : "g"); }
      $("#interval").innerHTML = h; $("#interval").hidden = false;
    }
    if (race.ivT <= 0) { $("#interval").hidden = true; race.ivShown = false; }
  }
  // timing tower and the big screen (4 Hz)
  race.hudT -= dt;
  if (race.hudT <= 0) {
    race.hudT = 0.25;
    const order = race.quali ? race.order : classify(race), lead = order[0], vref = T.len / (race.bestLap || T.len / 52);
    let html = "";
    const rows = order.map((e, i) => {
      let gap = "", cl = "";
      if (race.quali) gap = e.best == null ? (e.lapsDone === 0 ? "OUT" : "NO TIME") : i === 0 ? fmt(e.best) : "+" + (e.best - lead.best).toFixed(3);
      else if (e.ret) { gap = "OUT"; cl = "out"; }
      else if (e.fin) gap = i === 0 ? "FINISH" : e.lapsDone < lead.lapsDone ? `+${lead.lapsDone - e.lapsDone} LAP` : "+" + (e.finT + e.pen - lead.finT - lead.pen).toFixed(3);
      else if (i === 0) gap = raceT > 0 ? "LEADER" : "";
      else { const dd = (lead.c.total - e.c.total) * T.step; if (dd > T.len) gap = `+${Math.floor(dd / T.len)} LAP`; else { const tl = lead.bt.get(e.bk), te = e.bt.get(e.bk); gap = "+" + (tl != null && te != null ? te - tl : dd / vref).toFixed(1); } }
      if (!race.quali && e.pen && !e.ret) { gap = `${gap} <em class="pen">+${e.pen}</em>`; }
      const moved = e.prevPos && e.prevPos !== e.pos ? (e.pos < e.prevPos ? " up" : " down") : "";
      html += `<div class="tr${e === race.mine ? " me" : ""}${moved}${race.bestBy === e.id ? " fl" : ""}"><b>${i + 1}</b><i style="background:${esc(e.color)}"></i><span>${esc(e.code)}</span><em class="${cl}">${gap}</em></div>`;
      return { name: `${e.code}  ${e.name}`, color: e.color, gap: gap.replace(/<[^>]+>/g, " ") };
    });
    if (hudCache.tower !== html) { hudCache.tower = html; $("#towerrows").innerHTML = html; }
    race.monT -= 0.25; if (race.monT <= 0) { race.monT = 1; world.setMonitor(rows, race.quali ? "QUALIFYING" : raceT < 0 ? "STARTING GRID" : `LAP ${clamp(lead.lapsDone + 1, 1, race.laps)} / ${race.laps}`); }
    if (!race.quali && race.firstFin != null && race.mine && !race.mine.fin && !race.mine.ret) { const left = Math.ceil(75 - (raceT - race.firstFin)); if (left >= 0) { setText("#spect", `Chequered flag is out. Session closes in ${left}s`); $("#spect").hidden = false; } }
  }
  // minimap
  const gx = $("#map").getContext("2d"); gx.clearRect(0, 0, 440, 300); if (mapBase) gx.drawImage(mapBase, 0, 0);
  const sc = Math.min((440 - 16) / (T.box.hx * 2), (300 - 16) / (T.box.hz * 2));
  for (let i = race.order.length - 1; i >= 0; i--) {
    const e = race.order[i]; if (e.hide) continue; const mine = e === view, x = 220 + e.c.x * sc, y = 150 + e.c.z * sc;
    gx.beginPath(); gx.arc(x, y, mine ? 9 : 6, 0, 6.3); gx.fillStyle = e.color; gx.fill(); gx.lineWidth = mine ? 3 : 1.5; gx.strokeStyle = mine ? "#fff" : "rgba(0,0,0,.7)"; gx.stroke();
  }
}

// ---------- results ----------
function hostFinish(race, raceT) {
  const R = S.room; if (!R || race.ended || !isHost()) return;
  const humans = race.cars.filter((e) => e.kind === "h" && !e.gone), done = (e) => e.fin || e.ret;
  let over;
  if (race.quali) over = (humans.length ? humans.every(done) : race.cars.every(done)) || raceT > 330;
  else over = (race.firstFin != null && (humans.length ? humans.every(done) : race.cars.every(done)) && raceT > race.firstFin + 3) || (race.firstFin != null && raceT > race.firstFin + 75);
  if (!over) return;
  race.ended = true;
  const order = classify(race);
  if (race.quali) {
    R.qgrid = order.map((e) => e.id); R.phase = "lobby";
    const res = { t: "res", quali: true, order: order.map((e) => ({ id: e.id, name: e.name, code: e.code, color: e.color, kind: e.kind, best: e.best })), track: race.T.def.name, n: race.go.n };
    R.net?.send(res, { reliable: true }); sendLob(); showResults(res);
    return;
  }
  const res = order.map((e, i) => { const pts = e.ret ? 0 : POINTS[i] || 0; R.points[e.id] = (R.points[e.id] || 0) + pts; return { id: e.id, name: e.name, code: e.code, color: e.color, kind: e.kind, time: e.fin ? e.finT + e.pen : null, laps: e.lapsDone, ret: e.ret, best: e.best, pen: e.pen, pts, total: R.points[e.id], fast: race.bestBy === e.id, num: e.num, grid: e.grid, team: e.team, top: Math.round(e.top * 3.6), ovt: e.ovt, clean: e.valid.filter(Boolean).length }; });
  R.phase = "lobby";
  const msg = { t: "res", order: res, n: race.go.n, track: race.T.def.name, laps: race.laps };
  R.net?.send(msg, { reliable: true }); sendLob();
  showResults(msg);
}
let qTimer = null;
function showResults(res, skipPodium) {
  const R = S.room; if (!R) return;
  if (!res.quali && !skipPodium && !res.podiumShown) { res.podiumShown = true; return showPodium(res); }
  R.phase = "lobby";
  const myI = res.order.findIndex((o) => o.id === me.id), lead = res.order[0];
  clearTimeout(qTimer);
  if (res.quali) {
    $("#res-sub").textContent = `${res.track} · QUALIFYING`;
    $("#res-title").textContent = myI >= 0 ? (myI === 0 ? "POLE POSITION" : `You start P${myI + 1}`) : `${lead.name} takes pole`;
    $("#res-table").innerHTML = res.order.map((o, i) => `<div class="rr${o.id === me.id ? " me" : ""}" style="animation-delay:${i * 50}ms"><b>P${i + 1}</b><i style="background:${esc(o.color)}"></i><span>${esc(o.code)} · ${esc(o.name)}${o.kind === "b" ? " <small style='opacity:.5'>AI</small>" : ""}</span><span class="t">${o.best == null ? "NO TIME" : i === 0 ? fmt(o.best) : "+" + (o.best - lead.best).toFixed(3)}</span><span></span><span></span><span class="p"></span></div>`).join("");
    $("#res-msg").textContent = isHost() ? "The race starts from this grid in 10 seconds." : "The host starts the race from this grid.";
    $("#res-next").textContent = isHost() ? "Start the race" : "Back to lobby";
    if (isHost()) qTimer = setTimeout(() => { if (S.screen === "results") $("#res-next").click(); }, 10000);
    show("results"); return;
  }
  const mo = res.order[myI], race = S.race, mine = race?.mine;
  // skill points: the result, plus the driving that got you there
  let skill = null;
  if (mo && mine) {
    const gained = (mo.grid || 0) - (myI + 1), clean = mine.valid.filter(Boolean).length, pbKey = `pb3:${race.T.id}:${race.cls.id}`;
    const items = [["Finishing position", mo.ret ? 0 : mo.pts + (myI === 0 ? 10 : 5)], ["Places gained", Math.max(0, gained) * 3], ["Overtakes", mine.ovt * 2], ["Clean laps", clean * 2],
      ["Start", race.react != null && race.react < 0.3 ? 3 : 0], ["Fastest lap", mo.fast ? 5 : 0], ["Personal best", race.newPB ? 10 : 0]].filter((x) => x[1] > 0);
    const total = items.reduce((a, x) => a + x[1], 0);
    skill = { items, total, gained, clean, laps: mine.lapsDone };
    prefs.races++; prefs.xp += total; if (myI === 0 && !mo.ret) prefs.wins++; savePrefs();
  }
  $("#res-sub").textContent = `${res.track.toUpperCase()} \u00b7 ${res.laps || ""} LAPS \u00b7 CLASSIFICATION`;
  $("#res-title").textContent = mo ? (mo.ret ? "RETIRED" : myI === 0 ? "RACE WINNER" : myI <= 2 ? `P${myI + 1} \u00b7 PODIUM` : myI <= 9 ? `P${myI + 1} \u00b7 POINTS` : `P${myI + 1}`) : `${lead.name} wins`;
  const fastest = res.order.find((o) => o.fast);
  $("#res-table").innerHTML = `<div class="rr hd"><b>POS</b><i></i><span>DRIVER</span><span class="t">TIME / GAP</span><span class="pn"></span><span class="bl">BEST LAP</span><span class="p">PTS</span></div>` + res.order.map((o, i) => `<div class="rr${o.id === me.id ? " me" : ""}" style="animation-delay:${i * 45}ms"><b>${o.ret ? "DNF" : i + 1}</b><i style="background:${esc(o.color)}"></i><span><em class="no">${o.num ?? ""}</em> ${esc(o.name)} <small>${esc(o.code)}${o.kind === "b" ? " \u00b7 AI" : ""}</small></span><span class="t">${o.ret ? "RETIRED" : o.laps < lead.laps ? `+${lead.laps - o.laps} LAP${lead.laps - o.laps > 1 ? "S" : ""}` : o.time == null ? "-" : i === 0 ? fmt(o.time) : "+" + (o.time - lead.time).toFixed(3)}</span><span class="pn">${o.pen ? `+${o.pen}s` : ""}</span><span class="bl${o.fast ? " fast" : ""}">${o.best ? fmt(o.best) : ""}</span><span class="p">${o.pts || ""}</span></div>`).join("")
    + (skill ? `<div class="yr"><div><b>YOUR RACE</b><p>Started P${mo.grid} \u00b7 finished ${mo.ret ? "DNF" : "P" + (myI + 1)}${skill.gained > 0 ? ` <em class="g">\u25b2${skill.gained}</em>` : skill.gained < 0 ? ` <em class="r">\u25bc${-skill.gained}</em>` : ""}</p><p>Best lap ${fmt(mo.best)}${fastest && fastest.id !== me.id && mo.best ? ` \u00b7 +${(mo.best - fastest.best).toFixed(3)} to fastest` : mo.fast ? " \u00b7 fastest lap" : ""}</p><p>${skill.clean}/${skill.laps} clean laps \u00b7 ${mine.ovt} overtake${mine.ovt === 1 ? "" : "s"} \u00b7 top ${Math.round(mine.top * 3.6)} km/h${race.react != null ? ` \u00b7 reaction ${race.react.toFixed(3)}s` : ""}</p></div><div><b>SKILL POINTS +${skill.total}</b>${skill.items.map(([k, v]) => `<p>${k}<span>+${v}</span></p>`).join("")}<p class="rk">${rankOf(prefs.xp)} \u00b7 ${prefs.xp} career</p></div></div>` : "");
  $("#res-msg").textContent = fastest ? `Fastest lap: ${fastest.name} ${fmt(fastest.best)}` : "";
  $("#res-next").textContent = "Continue";
  const cb = $("#res-chal"); cb.hidden = !race || !challengeLink(race.go.cfg.track, race.cls.id);
  if (race) cb.onclick = () => copyChallenge(cb, race.go.cfg.track, race.cls.id);
  show("results");
  if (myI === 0) audio.fx("win");
}
// ---------- lineup: before the race, and the podium after ----------
let luTimer = null, luTags = [];
function lineupOverlay(title, sub, tags, board, foot, btn) {
  const L = $("#lineup"); L.hidden = false; $("#hud").hidden = true;
  $("#lu-title").textContent = title; $("#lu-sub").textContent = sub;
  $("#lu-tags").innerHTML = tags.map((t) => `<div class="lu-tag" style="--c:${esc(t.color)};--i:${esc(t.ink || "#fff")}"><b>${esc(t.top)}</b><span>${esc(t.name)}</span><em>${esc(t.team)}</em></div>`).join("");
  luTags = [...$("#lu-tags").children];
  $("#lu-board").innerHTML = board || ""; $("#lu-board").hidden = !board;
  $("#lu-count").textContent = foot || ""; const b = $("#lu-next"); b.hidden = !btn; if (btn) { b.textContent = btn.label; b.onclick = btn.go; }
}
function placeTags() { if ($("#lineup").hidden) return; world.lineupTags().forEach(([x, y], i) => { const el = luTags[i]; if (el) { el.style.left = (x * 100).toFixed(2) + "%"; el.style.top = (y * 100).toFixed(2) + "%"; } }); }
function closeLineup() { clearInterval(luTimer); $("#lineup").hidden = true; world.hideLineup(); if (S.screen === "race") $("#hud").hidden = false; }
function startIntro(race) {
  const g = race.go.grid, mine = race.mine, pick = [];
  for (const x of g) if (x.kind === "h" && pick.length < 4) pick.push(x);
  for (const x of [g[0], g[1], g[(mine?.slot ?? 0) + 1], g[2], g[3]]) if (x && pick.length < 4 && !pick.includes(x)) pick.push(x);
  pick.sort((a, b) => g.indexOf(a) - g.indexOf(b));
  world.showLineup(pick.map((x) => ({ team: teamOf(x.team), number: x.num })), race.cls.id);
  const tags = pick.map((x) => ({ top: `P${g.indexOf(x) + 1}`, name: x.name + (x.id === me.id ? " (you)" : ""), team: teamOf(x.team).name, color: uiColor(teamOf(x.team)), ink: teamOf(x.team).ink }));
  const tick = () => { const left = Math.ceil((race.go.at - 800 - netNow()) / 1000); if (left <= 0 || S.race !== race) { closeLineup(); world.snapCamera(); return; } lineupOverlay(race.T.def.name.toUpperCase(), `${race.laps} LAPS \u00b7 ${race.cls.name.toUpperCase()} \u00b7 ${race.gp ? "GRAND PRIX RULES" : "CASUAL"}`, tags, "", `Lights out in ${left}`, null); };
  tick(); clearInterval(luTimer); luTimer = setInterval(tick, 250);
}
const rating = (o, i) => Math.round(clamp(55 + ((o.grid || i + 1) - (i + 1)) * 4 + (o.ovt || 0) * 2 + (o.clean || 0) * 2 + (i === 0 ? 10 : 0) - (o.pen || 0) - (o.ret ? 30 : 0), 10, 99));
function showPodium(res) {
  const top = res.order.slice(0, 3), mine = res.order.find((o) => o.id === me.id), shown = [...top];
  if (mine && !shown.includes(mine)) shown.push(mine);
  // podium order on stage: P2, P1, P3 (then you)
  const stage = shown.length >= 3 ? [shown[1], shown[0], shown[2], ...shown.slice(3)] : shown;
  const steps = { 0: 0.62, 1: 0.42, 2: 0.26 };
  world.showLineup(stage.map((o) => { const i = res.order.indexOf(o); return { team: teamOf(o.team), number: o.num, podium: steps[i] || 0, pose: i === 0 ? "trophy" : i < 3 ? "wave" : "hips" }; }), S.race?.cls.id || "gt");
  const tags = stage.map((o) => { const i = res.order.indexOf(o); return { top: o.ret ? "DNF" : `P${i + 1}`, name: o.name + (o.id === me.id ? " (you)" : ""), team: teamOf(o.team).name, color: uiColor(teamOf(o.team)), ink: teamOf(o.team).ink }; });
  const lead = res.order[0];
  const board = `<div class="lb-row lb-h"><span>DRIVER</span><span>POS</span><span>GRID</span><span>TIME</span><span>BEST LAP</span><span>TOP</span><span>OVERTAKES</span><span>PTS</span><span>RATING</span></div>` + shown.map((o) => { const i = res.order.indexOf(o), gained = (o.grid || i + 1) - (i + 1); return `<div class="lb-row${o.id === me.id ? " me" : ""}"><span><i style="background:${esc(uiColor(teamOf(o.team)))}"></i>${esc(o.name)}</span><span>${o.ret ? "DNF" : "P" + (i + 1)}</span><span>${o.grid ? "P" + o.grid : "-"} ${gained > 0 ? `<em class="g">\u25b2${gained}</em>` : gained < 0 ? `<em class="r">\u25bc${-gained}</em>` : ""}</span><span>${o.ret ? "-" : i === 0 ? fmt(o.time) : o.laps < lead.laps ? `+${lead.laps - o.laps}L` : o.time != null ? "+" + (o.time - lead.time).toFixed(3) : "-"}</span><span class="${o.fast ? "p" : ""}">${o.best ? fmt(o.best) : "-"}</span><span>${o.top || "-"} km/h</span><span>${o.ovt ?? 0}</span><span>${o.pts || 0}</span><span class="rt">${rating(o, i)}</span></div>`; }).join("");
  let left = 12;
  const tick = () => { lineupOverlay("RACE RESULT", `${res.track.toUpperCase()} \u00b7 ${res.laps || ""} LAPS`, tags, board, `Classification in ${left}s`, { label: "Classification", go: () => { closeLineup(); showResults(res, true); } }); if (left-- <= 0) { closeLineup(); showResults(res, true); } };
  $("#hud").hidden = true; for (const id of ["menu", "lobby", "results"]) $("#" + id).hidden = true;
  tick(); clearInterval(luTimer); luTimer = setInterval(tick, 1000);
  if (mine && res.order.indexOf(mine) === 0) audio.fx("win");
}
$("#res-next").onclick = () => {
  clearTimeout(qTimer);
  const R = S.room;
  if ($("#res-next").textContent === "Start the race" && isHost() && R?.qgrid) { endRace(); startSession("race", R.qgrid); return; }
  endRace(); show("lobby"); renderLobby(); startDemo(true);
};

// ---------- main loop ----------
let last = performance.now(), acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (t - last) / 1000); last = t;
  const race = S.race;
  if (world.lineup) placeTags();
  if (!race) { world.updateCamera(null, 0, dt); world.render(dt); return; }
  const frozen = race.held && !race.demo;
  const now = frozen ? race.heldAt : netNow();
  if (!frozen) {
    acc += dt; let steps = 0;
    while (acc >= DT && steps < 30) { simStep(race, now - (acc - DT) * 1000); acc -= DT; steps++; }
    if (steps === 30) acc = 0;
  }
  const raceT = (now - race.t0) / 1000, al = frozen ? 1 : acc / DT;
  updateOrder(race);
  let focus = race.mine;
  if (race.spect) { const o = race.order.filter((e) => !e.hide); focus = o[wrap(race.spectI || 0, o.length)] || null; }
  if (race.demo) focus = null;
  race.focus = focus;
  for (const e of race.cars) {
    const c = e.c;
    if (owns(e) && raceT >= 0) {
      const x = c.x, z = c.z, h = c.h;
      c.x = e.px + (x - e.px) * al; c.z = e.pz + (z - e.pz) * al; c.h = e.ph + angd(h, e.ph) * al;
      world.syncCar(e.id, c, dt); c.x = x; c.z = z; c.h = h;
    } else world.syncCar(e.id, c, dt);
  }
  if (race.ghost && race.mine && (prefs.ghost || race.chal)) {
    const m = race.mine, lt = raceT - m.lapStart, rec = race.ghost.rec, k = lt * 10, i = Math.floor(k), n = rec.length / 3, gv = world.cars.get("ghost");
    if (gv) {
      if (raceT > 0 && i < n - 1 && !m.fin && m.c.total >= 0) { const u = k - i, a = i * 3, b = a + 3; world.syncCar("ghost", { x: rec[a] + (rec[b] - rec[a]) * u, z: rec[a + 1] + (rec[b + 1] - rec[a + 1]) * u, h: rec[a + 2] + angd(rec[b + 2], rec[a + 2]) * u, vx: 0, vz: 0, speed: 40 }, dt); }
      else gv.g.visible = false;
    }
  }
  if (focus && raceT >= 0 && owns(focus)) { const c = focus.c, x = c.x, z = c.z, h = c.h; c.x = focus.px + (x - focus.px) * al; c.z = focus.pz + (z - focus.pz) * al; c.h = focus.ph + angd(h, focus.ph) * al; world.updateCamera(c, prefs.cam, dt); c.x = x; c.z = z; c.h = h; }
  else world.updateCamera(focus ? focus.c : null, prefs.cam, dt);
  world.setRacingLine(!race.demo && focus === race.mine && race.mine && !race.mine.fin ? race.mine.c : null, prefs.line, race.T.v, race.cls);
  if (!race.demo) {
    updateHud(race, dt, now);
    if (focus) {
      const c = focus.c, near = [];
      for (const e of race.cars) { if (e === focus || e.hide) continue; const dx = e.c.x - c.x, dz = e.c.z - c.z, d = Math.hypot(dx, dz); if (d < 90) near.push({ d, speed: e.c.speed, thr: e.c.thr ?? 1, pan: clamp((dx * -Math.sin(c.h) + dz * Math.cos(c.h)) / 20, -1, 1), dop: clamp(((c.vx - e.c.vx) * dx + (c.vz - e.c.vz) * dz) / (d + 1) / 30, -1, 1) }); }
      near.sort((a, b) => a.d - b.d);
      audio.frame({ speed: c.speed, thr: c.thr || 0, slip: c.slip || 0, rpm: rpmOf(race.cls, c.speed) }, near.slice(0, 3));
    } else audio.frame(null, null);
    // network: my cars at 30 Hz direct (20 Hz when relayed), dents as they happen
    race.sendT -= dt;
    const net = S.room?.net;
    if (net && net.peers.size && !race.held) {
      if (race.outHits.length) { net.send({ t: "hit", h: race.outHits.splice(0) }, { reliable: true }); }
      if (race.sendT <= 0) {
        race.sendT = net.direct() === net.peers.size ? 1 / 30 : 0.05; const arr = [];
        const q = (v) => Math.round(clamp(v, 0, 1) * 15);
        for (const e of race.cars) if (owns(e) && !e.hide) { const c = e.c, D = c.dmg; arr.push([e.id, +c.x.toFixed(2), +c.z.toFixed(2), +c.h.toFixed(3), +c.vx.toFixed(1), +c.vz.toFixed(1), +c.w.toFixed(2), +c.steer.toFixed(2), (c.boosting ? 1 : 0) | (c.brk > 0.1 ? 2 : 0) | (c.drs ? 4 : 0) | (c.retired ? 8 : 0) | (c.thr > 0.2 ? 16 : 0) | (c.slip > 0.4 ? 32 : 0) | (c.respawned > 0 ? 64 : 0) | (c.surf === 2 ? 128 : 0), c.total, q(D.f) | (q(D.r) << 4) | (q(D.l) << 8) | (q(D.rt) << 12) | (q(D.e) << 16)]); }
        if (arr.length) net.send({ t: "s", ts: Math.round(now), c: arr });
      }
    } else race.outHits.length = 0;
    hostFinish(race, raceT);
  } else audio.frame(null, null);
  world.render(dt);
}
world.onDetach = (id) => { if (S.race?.mine?.id === id) audio.fx("part"); };

show("menu"); startDemo();
requestAnimationFrame(frame);
