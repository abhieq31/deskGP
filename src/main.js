// DeskGP: game loop, race rules, lobby, HUD, netcode glue.
import { TRACKS, buildTrack, gridPose, wrap, DESK } from "./track.js";
import { makeCar, placeCar, stepCar, collideCars, updateTow, respawn, gearOf, rpmOf, clamp } from "./physics.js";
import { makeBrain, drive, BOT_NAMES, DIFFS } from "./ai.js";
import { createWorld } from "./world.js";
import { createAudio } from "./audio.js";
import { createNet, newRoomCode, parseRoomCode, formatRoomCode, newId } from "./net.js";

const $ = (s) => document.querySelector(s);
const COLORS = ["#e63946", "#ff9f1c", "#ffd60a", "#2ec4b6", "#3a86ff", "#8338ec", "#ff5d8f", "#f4f4f0"];
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4];
const TITLES = ["Employee of the Month", "Exceeds expectations", "Meets expectations", "Solid contributor", "Room to grow", "Let's circle back", "Needs a development plan", "Performance improvement plan"];
const RANKS = [[0, "Intern"], [60, "Associate"], [180, "Senior Associate"], [400, "Manager"], [800, "Director"], [1500, "VP of Going Fast"], [3000, "Chief Racing Officer"]];
const EMOTES = ["\u{1F44B}", "\u{1F602}", "\u{1F525}", "per my last email…"];
const TEAMS = [{ name: "Team Espresso", c: "#ff7b54" }, { name: "Team Matcha", c: "#7bd389" }];
const DT = 1 / 120, MAXCARS = 8;
const fmt = (t) => { if (t == null || !isFinite(t)) return "-:--.---"; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, "0")}`; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- persistent bits ----------
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem("deskgp:" + k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("deskgp:" + k, JSON.stringify(v)); } catch {} },
};
const prefs = Object.assign({ name: "", color: COLORS[Math.floor(Math.random() * COLORS.length)], sound: true, ghost: true, cam: 0, xp: 0, races: 0, wins: 0 }, store.get("prefs", {}));
const savePrefs = () => store.set("prefs", prefs);
const me = { id: newId(), name: prefs.name || "", color: prefs.color, joined: Date.now() };

const tracks = TRACKS.map(buildTrack);
const world = createWorld($("#gl"));
const audio = createAudio(); audio.muted = !prefs.sound;
window.__deskgp = { world, tracks, get S() { return S; } };

const S = { screen: "menu", room: null, race: null, boss: false, paused: false, clockOff: 0, clockRtt: 1e9, joinedAt: 0 };
const netNow = () => performance.now() + S.clockOff;

// ---------- input ----------
const keys = new Set(), touch = { l: 0, r: 0, gas: 0, brake: 0, boost: 0 };
let firstThrottle = null;
function readInput() {
  const k = (...c) => c.some((x) => keys.has(x));
  let steer = (k("ArrowRight", "KeyD") ? 1 : 0) - (k("ArrowLeft", "KeyA") ? 1 : 0) + touch.r - touch.l;
  let thr = k("ArrowUp", "KeyW") || touch.gas ? 1 : 0, brk = k("ArrowDown", "KeyS") || touch.brake ? 1 : 0, boost = k("Space", "ShiftLeft", "ShiftRight") || !!touch.boost;
  const gp = navigator.getGamepads?.()[0];
  if (gp) {
    if (Math.abs(gp.axes[0]) > 0.08) steer += gp.axes[0];
    thr = Math.max(thr, gp.buttons[7]?.value || 0, gp.buttons[0]?.pressed ? 1 : 0); brk = Math.max(brk, gp.buttons[6]?.value || 0);
    boost = boost || gp.buttons[2]?.pressed || gp.buttons[5]?.pressed;
  }
  return { steer: clamp(steer, -1, 1), thr, brk, boost, reverse: brk > 0 && thr === 0 };
}
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") { if (e.code === "Enter") e.target.id === "code" ? $("#join").click() : e.target.blur(); return; }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code); audio.init();
  if (e.code === "KeyB" || e.code === "Backquote") toggleBoss();
  else if (e.code === "KeyM") setSound(!prefs.sound);
  else if (S.screen !== "race") return;
  else if (e.code === "KeyC") { prefs.cam = (prefs.cam + 1) % 4; savePrefs(); toast(["Chase cam", "Desk cam", "Nose cam", "Office drone"][prefs.cam]); }
  else if (e.code === "KeyR") { const m = S.race?.mine; if (m && S.race.state === "run" && !m.fin) { respawn(m.c, S.race.T); toast("Back on the tarmac", "r"); } }
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
const isTouch = matchMedia("(pointer:coarse)").matches;
$("#touch").hidden = !isTouch;
addEventListener("pointerdown", () => audio.init(), { once: true });

function setSound(on) { prefs.sound = on; savePrefs(); audio.setMuted(!on || S.boss); $("#p-sound").textContent = `Sound: ${on ? "on" : "off"}`; if (S.screen === "race") toast(on ? "Sound on" : "Muted"); }

// ---------- boss key ----------
const realTitle = document.title;
function toggleBoss() {
  S.boss = !S.boss; $("#boss").hidden = !S.boss; audio.setMuted(S.boss || !prefs.sound);
  document.title = S.boss ? "Q4_forecast_FINAL_v7 - Sheets" : realTitle;
  if (S.boss && !$("#bossgrid").childElementCount) {
    const rows = ["Region", "EMEA", "APAC", "Americas", "LATAM", "Nordics", "Benelux", "DACH", "ANZ", "Total", "", "Headcount", "Opex", "Capex", "Synergies", "Run-rate", "Variance", "Buffer"], cols = ["", "A", "B", "C", "D", "E", "F", "G", "H", "I"];
    const heads = ["", "Q1", "Q2", "Q3", "Q4 (F)", "YoY %", "Plan", "Delta", "Owner", "Status"];
    let h = cols.map((c) => `<div class="h">${c}</div>`).join("");
    for (let r = 0; r < 34; r++) {
      h += `<div class="h">${r + 1}</div>`;
      for (let c = 0; c < 9; c++) {
        if (c === 0) h += `<div>${r === 0 ? "" : rows[r % rows.length] || ""}</div>`;
        else if (r === 0) h += `<div><b>${heads[c]}</b></div>`;
        else if (c === 8) h += `<div>${["On track", "At risk", "TBD", "Blocked", "Circling back"][(r * 7 + c) % 5]}</div>`;
        else if (c === 7) h += `<div>${["Dana", "Sam", "Kim", "Stan", "Lou"][(r * 3) % 5]}</div>`;
        else { const v = Math.round(Math.sin(r * 12.9 + c * 78.2) * 43758) % 9000; h += `<div class="n ${v < 0 ? "neg" : ""}">${c === 4 ? (v / 100).toFixed(1) + "%" : v.toLocaleString()}</div>`; }
      }
    }
    $("#bossgrid").innerHTML = h;
  }
}

// ---------- screens ----------
function show(name) {
  S.screen = name;
  for (const id of ["menu", "lobby", "results"]) $("#" + id).hidden = id !== name;
  $("#hud").hidden = name !== "race"; $("#pause").hidden = true; S.paused = false;
  if (name === "menu") renderMenu();
}
function setPaused(p) { S.paused = p; $("#pause").hidden = !p; }
$("#p-resume").onclick = () => setPaused(false);
$("#p-sound").onclick = () => setSound(!prefs.sound);
$("#p-ghost").onclick = () => { prefs.ghost = !prefs.ghost; savePrefs(); $("#p-ghost").textContent = `Ghost of your best lap: ${prefs.ghost ? "on" : "off"}`; };
$("#p-leave").onclick = () => leaveRoom();
$("#p-sound").textContent = `Sound: ${prefs.sound ? "on" : "off"}`; $("#p-ghost").textContent = `Ghost of your best lap: ${prefs.ghost ? "on" : "off"}`;

function rankOf(xp) { let r = RANKS[0]; for (const x of RANKS) if (xp >= x[0]) r = x; return r[1]; }
function renderMenu() {
  $("#name").value = prefs.name;
  $("#colors").innerHTML = COLORS.map((c) => `<button style="background:${c}" data-c="${c}" class="${c === prefs.color ? "on" : ""}" aria-label="Livery ${c}"></button>`).join("");
  $("#career").textContent = prefs.races ? `${rankOf(prefs.xp)} · ${prefs.xp} XP · ${prefs.wins} win${prefs.wins === 1 ? "" : "s"} in ${prefs.races} races` : "";
  const hc = parseRoomCode(location.hash); if (hc) $("#code").value = formatRoomCode(hc);
}
$("#colors").onclick = (e) => { const c = e.target.dataset.c; if (!c) return; prefs.color = me.color = c; savePrefs(); renderMenu(); audio.fx("click"); };
$("#name").oninput = (e) => { prefs.name = e.target.value.trim().slice(0, 16); savePrefs(); };
function commitName() { me.name = prefs.name || `Driver ${me.id.slice(0, 3).toUpperCase()}`; me.color = prefs.color; }
$("#solo").onclick = () => { audio.init(); commitName(); enterRoom(null); };
$("#create").onclick = () => { audio.init(); commitName(); enterRoom(newRoomCode(), true); };
$("#join").onclick = () => {
  audio.init(); const c = parseRoomCode($("#code").value);
  if (!c) { $("#menuerr").textContent = "That code does not look right. It is six letters and numbers, like KXM-4T9."; return; }
  $("#menuerr").textContent = ""; commitName(); enterRoom(c, false);
};

// ---------- room / lobby ----------
function defaultCfg() { return Object.assign({ track: 0, laps: 3, bots: 5, diff: 1, teams: false }, store.get("cfg", {})); }
function enterRoom(code, creator) {
  leaveNet();
  me.joined = creator || !code ? 1 : Date.now();
  const R = S.room = { code, solo: !code, net: null, cfg: defaultCfg(), points: {}, raceN: 0, phase: "lobby", go: null, botNames: [...BOT_NAMES].sort(() => Math.random() - 0.5), gotLob: !code || creator };
  if (!R.solo) R.cfg.bots = Math.min(R.cfg.bots, 3);
  S.joinedAt = performance.now(); S.clockOff = 0; S.clockRtt = 1e9;
  if (code) {
    R.net = createNet(code, me, { onPeers: () => { renderLobby(); if (isHost()) sendLob(); }, onMsg, onStatus: renderLobby });
    try { history.replaceState(null, "", "#" + code); } catch {}
  }
  show("lobby"); renderLobby(); startDemo();
}
function leaveNet() { if (S.room?.net) S.room.net.close(); }
function leaveRoom() {
  leaveNet(); S.room = null; endRace();
  try { history.replaceState(null, "", location.pathname + location.search); } catch {}
  show("menu"); startDemo();
}
function members() {
  const R = S.room, list = [{ id: me.id, name: me.name, color: me.color, joined: me.joined, me: true, rtc: true }];
  if (R?.net) for (const p of R.net.peers.values()) list.push({ id: p.id, name: p.name || "Driver", color: p.color || "#fff", joined: p.joined || 9e15, rtc: p.rtc });
  return list.sort((a, b) => a.joined - b.joined || (a.id < b.id ? -1 : 1));
}
function hostId() { return members()[0].id; }
function isHost() {
  const R = S.room; if (!R) return false; if (R.solo) return true;
  if (hostId() !== me.id) return false;
  return R.gotLob || performance.now() - S.joinedAt > 5000; // a joiner waits to hear from the real host first
}
function sendLob(to) { const R = S.room; if (!R?.net || !isHost()) return; R.gotLob = true; R.net.send({ t: "lob", cfg: R.cfg, points: R.points, raceN: R.raceN, phase: R.phase, go: R.phase === "race" ? R.go : null }, { reliable: true, to }); }
setInterval(() => { const R = S.room; if (!R?.net) return; if (isHost()) sendLob(); else R.net.send({ t: "pi", a: performance.now() }, { to: hostId() }); if (S.screen === "lobby") renderLobby(); }, 2000);

function setCfg(k, v) { const R = S.room; if (!isHost()) return; R.cfg[k] = v; store.set("cfg", R.cfg); audio.fx("click"); sendLob(); renderLobby(); if (k === "track") startDemo(); }
function seg(el, items, cur, key) {
  el.innerHTML = items.map(([v, label]) => `<button data-v="${v}" class="${v === cur ? "on" : ""}">${label}</button>`).join("");
  el.onclick = (e) => { const v = e.target.dataset.v; if (v != null) setCfg(key, JSON.parse(v)); };
}
function drawMini(cv, T, dots) {
  const g = cv.getContext("2d"), w = cv.width, h = cv.height, sc = Math.min((w - 16) / (DESK.hx * 2), (h - 16) / (DESK.hz * 2));
  const X = (x) => w / 2 + x * sc, Z = (z) => h / 2 + z * sc;
  g.clearRect(0, 0, w, h); g.lineJoin = g.lineCap = "round";
  g.beginPath(); for (let i = 0; i < T.n; i += 3) g.lineTo(X(T.x[i]), Z(T.z[i])); g.closePath();
  g.strokeStyle = "rgba(0,0,0,.6)"; g.lineWidth = w / 34; g.stroke(); g.strokeStyle = "#e9edf5"; g.lineWidth = w / 60; g.stroke();
  g.strokeStyle = "#2fe37a"; g.lineWidth = w / 60;
  for (const [a, b] of T.def.drs) { g.beginPath(); for (let i = Math.floor(a * T.n); i < b * T.n; i += 3) g.lineTo(X(T.x[i]), Z(T.z[i])); g.stroke(); }
  g.fillStyle = "#ff2d2d"; g.fillRect(X(T.x[0]) - 2, Z(T.z[0]) - w / 50, 4, w / 25);
  if (dots) for (const d of dots) { g.beginPath(); g.arc(X(d.x), Z(d.z), d.me ? w / 44 : w / 62, 0, 6.3); g.fillStyle = d.color; g.fill(); if (d.me) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke(); } }
}
function renderLobby() {
  const R = S.room; if (!R || S.screen !== "lobby") return;
  const host = isHost(), mem = members(), hid = hostId();
  $("#roomlabel").textContent = R.solo ? "SOLO SESSION" : "ROOM CODE - SHARE IT";
  $("#roomcode").textContent = R.solo ? "You vs the office" : formatRoomCode(R.code); $("#roomcode").classList.toggle("solo", R.solo);
  $("#copy").hidden = R.solo;
  const nb = Math.min(R.cfg.bots, MAXCARS - mem.length);
  $("#players").innerHTML = mem.map((m) => `<div class="pl"><i style="background:${esc(m.color)}"></i>${esc(m.name)}${m.me ? " (you)" : ""}<span class="pts">${R.points[m.id] ? R.points[m.id] + " pts" : ""}</span><em>${m.id === hid ? "host" : m.rtc ? "direct" : "relay"}</em></div>`).join("")
    + Array.from({ length: Math.max(0, nb) }, (_, i) => `<div class="pl bot"><i style="background:#666"></i>${esc(R.botNames[i])}<span class="pts">${R.points["bot" + i] ? R.points["bot" + i] + " pts" : ""}</span><em>bot</em></div>`).join("");
  const n = R.net;
  $("#netstat").textContent = R.solo ? "" : !n.relaysUp ? "Connecting to the matchmaking relays…" : mem.length === 1 ? "Waiting for colleagues. Send them the code or the link." : `${mem.length} drivers connected`;
  const tk = $("#tracks");
  if (!tk.childElementCount) {
    tk.innerHTML = tracks.map((T, i) => `<button class="trk" data-i="${i}"><canvas width="240" height="150"></canvas><b>${T.def.name}</b><small>${(T.len * 1.6 / 1000).toFixed(2)} m of desk · ${T.def.mood}</small></button>`).join("") ;
    tk.insertAdjacentHTML("afterend", `<p id="trkblurb"></p>`);
    tk.querySelectorAll("canvas").forEach((cv, i) => drawMini(cv, tracks[i]));
    tk.onclick = (e) => { const b = e.target.closest(".trk"); if (b) setCfg("track", +b.dataset.i); };
  }
  tk.querySelectorAll(".trk").forEach((b, i) => b.classList.toggle("on", i === R.cfg.track));
  const pb = store.get("pb:" + tracks[R.cfg.track].id, null);
  $("#trkblurb").textContent = tracks[R.cfg.track].def.blurb + (pb ? ` Your best lap: ${fmt(pb.t)}.` : "");
  seg($("#o-laps"), [[1, "1"], [2, "2"], [3, "3"], [5, "5"]], R.cfg.laps, "laps");
  seg($("#o-bots"), [0, 1, 3, 5, 7].map((b) => [b, String(b)]), R.cfg.bots, "bots");
  seg($("#o-diff"), DIFFS.map((d, i) => [i, d.name]), R.cfg.diff, "diff");
  seg($("#o-teams"), [[false, "Every desk for itself"], [true, "Two teams"]], R.cfg.teams, "teams");
  $("#lobby .panel").classList.toggle("locked", !host);
  $("#start").hidden = !host; $("#start").disabled = mem.length + nb < 1;
  $("#start").textContent = R.raceN ? "Next race" : "Start race";
  $("#lobbymsg").textContent = host ? (mem.length + nb < 2 ? "Just you: a time trial against your own ghost." : R.raceN ? "Grid is reversed by championship points. Leaders start at the back." : "") : R.phase === "race" ? "Race in progress. You will join the next one." : "Waiting for the host to start…";
}
$("#copy").onclick = async () => { const url = location.origin + location.pathname + "#" + S.room.code; try { await navigator.clipboard.writeText(url); $("#copy").textContent = "Link copied"; } catch { prompt("Copy this link", url); } setTimeout(() => ($("#copy").textContent = "Copy invite link"), 1600); };
$("#leave").onclick = leaveRoom;
$("#start").onclick = () => {
  const R = S.room; if (!isHost()) return;
  const mem = members(), nb = Math.max(0, Math.min(R.cfg.bots, MAXCARS - mem.length)), used = new Set(mem.map((m) => m.color));
  const free = COLORS.filter((c) => !used.has(c)).concat(COLORS);
  let grid = mem.slice(0, MAXCARS).map((m) => ({ id: m.id, name: m.name, color: m.color, kind: "h" }));
  for (let i = 0; i < nb; i++) grid.push({ id: "bot" + i, name: R.botNames[i], color: free[i], kind: "b", skill: DIFFS[R.cfg.diff].skill, seed: Math.random() });
  grid = grid.map((g) => [R.raceN ? (R.points[g.id] || 0) + Math.random() * 0.5 : Math.random(), g]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  if (R.cfg.teams) grid.forEach((g, i) => (g.team = i % 2));
  R.go = { t: "go", at: Math.round(netNow() + 2600), hold: Math.round(500 + Math.random() * 1600), cfg: { ...R.cfg }, grid, n: ++R.raceN };
  R.phase = "race"; R.net?.send(R.go, { reliable: true }); sendLob();
  startRace(R.go);
};

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
      if (S.screen === "lobby") { renderLobby(); if (S.race?.demo && S.race.T !== tracks[R.cfg.track]) startDemo(); }
      break;
    case "go": if (from === hostId()) { R.go = m; R.phase = "race"; R.raceN = m.n; R.cfg = m.cfg; startRace(m); } break;
    case "s": if (race && !race.demo) for (const a of m.c) { const e = race.byId.get(a[0]); if (e && !owns(e)) pushSnap(e, m.ts, a); } break;
    case "lap": { const e = race?.byId.get(m.id); if (e && !owns(e)) onLap(e, m.lt, m.rt, m.fin, true); break; }
    case "em": if (race) { world.emote(m.id, EMOTES[m.e] || ""); audio.fx("emote"); } break;
    case "tk": { const e = race?.byId.get(m.id); if (e) { e.kind = "b"; e.skill = 0.9; feed(`Autopilot takes over for ${e.name}`); } break; }
    case "res": if (from === hostId() && race && !race.demo) showResults(m); break;
  }
}

// ---------- race ----------
function endRace() { S.race = null; world.clearCars(); }
function startDemo() {
  if (S.race && !S.race.demo) return;
  const ti = S.room ? S.room.cfg.track : Math.floor(Math.random() * tracks.length);
  const grid = Array.from({ length: 6 }, (_, i) => ({ id: "demo" + i, name: BOT_NAMES[i], color: COLORS[i], kind: "b", skill: 0.9 + i * 0.012, seed: Math.random() }));
  startRace({ at: netNow() - 6000, hold: 0, cfg: { track: ti, laps: 9999, teams: false }, grid, n: -1 }, true);
}
function owns(e) { return e.id === me.id || (e.kind === "b" && (S.race.demo || isHost())); }

function startRace(go, demo) {
  endRace();
  const T = tracks[go.cfg.track];
  if (world.T !== T) world.setTrack(T);
  const race = S.race = { go, demo: !!demo, T, laps: go.cfg.laps, t0: go.at + 4200 + go.hold, cars: [], byId: new Map(), mine: null, state: "pre", order: [], firstFin: null, lightsN: -1, sendT: 0, hudT: 0, monT: 0, bestLap: null, bestBy: null, spect: false };
  go.grid.forEach((g, i) => {
    const c = makeCar(g.id), pose = gridPose(T, i); placeCar(c, pose, T); c.total = pose.i - T.n;
    const e = { ...g, c, slot: i, br: null, snaps: [], lapStart: 0, lapTimes: [], best: null, lapsDone: 0, fin: false, finT: null, pos: i + 1, px: c.x, pz: c.z, ph: c.h, py: 0, lastSeen: performance.now(), delay: 110, gapAvg: 50, secT: 0, sec: 0, rec: [], prof: [], recT: 0 };
    race.cars.push(e); race.byId.set(g.id, e);
    world.addCar(g.id, g.color, g.name, { helmet: g.team != null ? TEAMS[g.team].c : "#ffffff" });
    if (g.id === me.id) race.mine = e;
  });
  race.spect = !demo && !race.mine;
  if (race.mine) { world.showTag(me.id, false); loadGhost(race); }
  world.snapCamera();
  firstThrottle = null; race.jump = false; race.autoBrain = makeBrain(0.9, 0.2);
  if (!demo) {
    show("race"); $("#tower").innerHTML = ""; $("#feed").innerHTML = ""; $("#toasts").innerHTML = ""; $("#spect").hidden = !race.spect;
    for (const el of $("#sectors").children) el.className = "";
    drawMapBase(T); toast(`${T.def.name} · ${race.laps} lap${race.laps > 1 ? "s" : ""}`);
    if (race.spect) $("#spect").textContent = "Spectating. You are in the next race. ← → to switch car.";
  }
}

function loadGhost(race) {
  const pb = store.get("pb:" + race.T.id, null); race.pb = pb;
  if (pb?.rec?.length > 10 && prefs.ghost) { world.addCar("ghost", "#ffffff", "", { ghost: true }); race.ghost = pb; }
}

function pushSnap(e, ts, a) {
  const s = { ts, x: a[1], z: a[2], h: a[3], vx: a[4], vz: a[5], w: a[6], steer: a[7], fl: a[8], total: a[9], y: a[10] || 0 };
  const last = e.snaps[e.snaps.length - 1];
  if (last && ts <= last.ts) return;
  if (last) { e.gapAvg += (Math.min(600, ts - last.ts) - e.gapAvg) * 0.1; e.delay += (clamp(e.gapAvg * 2 + 15, 90, 700) - e.delay) * 0.05; }
  e.snaps.push(s); if (e.snaps.length > 30) e.snaps.shift();
  e.lastSeen = performance.now();
}
const angd = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
function applyRemote(e, now) {
  const sn = e.snaps, c = e.c; if (!sn.length) return;
  const rt = now - e.delay; let b = sn.length - 1;
  while (b > 0 && sn[b - 1].ts > rt) b--;
  const B = sn[b], A = sn[b - 1];
  if (A && rt <= B.ts && rt >= A.ts) {
    const d = (B.ts - A.ts) / 1000, u = (rt - A.ts) / (B.ts - A.ts), u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    c.x = h00 * A.x + h10 * d * A.vx + h01 * B.x + h11 * d * B.vx; c.z = h00 * A.z + h10 * d * A.vz + h01 * B.z + h11 * d * B.vz;
    c.h = A.h + angd(B.h, A.h) * u; c.vx = A.vx + (B.vx - A.vx) * u; c.vz = A.vz + (B.vz - A.vz) * u; c.w = A.w + (B.w - A.w) * u; c.steer = A.steer + (B.steer - A.steer) * u; c.y = A.y + (B.y - A.y) * u;
  } else {
    const L = rt < sn[0].ts ? sn[0] : B, ex = clamp((rt - L.ts) / 1000, 0, 0.35);
    c.x = L.x + L.vx * ex; c.z = L.z + L.vz * ex; c.h = L.h + L.w * ex; c.vx = L.vx; c.vz = L.vz; c.w = L.w; c.steer = L.steer; c.y = L.y;
  }
  const fl = B.fl;
  c.boosting = !!(fl & 1); c.brk = fl & 2 ? 1 : 0; c.drs = !!(fl & 4); c.fall = fl & 8 ? Math.max(c.fall, 0.01) + 0.008 : 0; c.thr = fl & 16 ? 1 : 0; c.slip = fl & 32 ? 0.6 : 0; c.respawned = fl & 64 ? 0.3 : 0; c.surf = fl & 128 ? 2 : 0;
  c.total = B.total; c.idx = wrap(B.total, S.race.T.n); c.speed = Math.hypot(c.vx, c.vz);
}

function onLap(e, lt, rt, fin, remote) {
  const race = S.race; e.lapTimes.push(lt); e.lapsDone = e.lapTimes.length;
  const pbLap = e.best == null || lt < e.best; if (pbLap) e.best = lt;
  const fastest = race.bestLap == null || lt < race.bestLap;
  if (fastest) { race.bestLap = lt; race.bestBy = e.id; if (!race.demo && e.lapsDone > 0) feed(`<b style="color:#c06bff">Fastest lap</b> ${esc(e.name)} ${fmt(lt)}`); }
  if (fin && !e.fin) {
    e.fin = true; e.finT = rt; if (race.firstFin == null) race.firstFin = rt;
    if (!race.demo) feed(`\u{1F3C1} ${esc(e.name)} finishes`);
  }
  if (e === race.mine && !remote) {
    if (fastest && e.lapsDone > 0) { toast(`FASTEST LAP ${fmt(lt)}`, "p"); audio.fx("best"); } else if (pbLap) { toast(`Lap ${fmt(lt)}`, "g"); audio.fx("lap"); } else { toast(`Lap ${fmt(lt)}`); audio.fx("lap"); }
    // personal best across sessions, with its ghost
    const key = "pb:" + race.T.id, old = store.get(key, null);
    if (e.rec.length > 20 && (!old || lt < old.t)) { store.set(key, { t: lt, rec: e.rec, prof: e.prof }); race.pb = { t: lt, rec: e.rec, prof: e.prof }; if (old) setTimeout(() => toast("NEW PERSONAL BEST", "p"), 700); }
    e.rec = []; e.prof = []; e.recT = 0;
    if (!fin && e.lapsDone === race.laps - 1) setTimeout(() => big("FINAL LAP"), 300);
    if (fin) {
      const pos = race.order.indexOf(e) + 1;
      big(`P${pos}`, TITLES[Math.min(pos - 1, TITLES.length - 1)]); audio.fx(pos === 1 ? "win" : "finish");
      world.confetti(e.c.x, e.c.z, pos <= 3 ? 140 : 40);
    }
    for (const el of $("#sectors").children) el.className = "";
  }
}

function simStep(race, now) {
  const T = race.T, raceT = (now - race.t0) / 1000, green = raceT >= 0;
  if (green && race.state === "pre") race.state = "run";
  const all = race.cars, phys = all.map((e) => e.c), hostNow = isHost();
  for (const e of all) {
    if (e.gone) continue;
    const c = e.c;
    if (!owns(e)) { applyRemote(e, now); continue; }
    e.px = c.x; e.pz = c.z; e.ph = c.h; e.py = c.y;
    let inp;
    if (e === race.mine && !e.fin && !S.boss) {
      inp = S.paused ? { steer: 0, thr: 0, brk: 0 } : readInput();
      if (!green && inp.thr > 0 && raceT > -race.go.hold / 1000 - 3.4) race.jump = true;
      if (green && firstThrottle == null && inp.thr > 0) { firstThrottle = raceT; if (!race.jump) reaction(raceT); }
      if (green && race.jump && raceT < 1.2) inp = { steer: 0, thr: 0, brk: 1 };
      inp.drsOk = updateTow(c, phys, T);
    } else {
      if (!e.br) e.br = e === race.mine ? race.autoBrain : makeBrain(e.skill || 0.9, e.seed ?? Math.random());
      const br = e.br;
      if (e.fin) br.skill = 0.6;
      else if (e.kind === "b" && !race.demo && br.skill < 0.99) { // gentle rubber band toward the humans
        let hs = 0, hn = 0; for (const o of all) if (o.kind === "h" && !o.gone) { hs += o.c.total; hn++; }
        if (hn) br.band = 1 + clamp((hs / hn - c.total) * T.step / 5000, -0.03, 0.035);
      }
      inp = green ? drive(c, br, T, phys, DT, raceT) : { steer: 0, thr: 0, brk: 0 };
      inp.drsOk = updateTow(c, phys, T);
      if (inp.respawn) respawn(c, T);
    }
    if (!green) { c.steer += (clamp(inp.steer, -1, 1) - c.steer) * 0.2; c.thr = inp.thr; continue; }
    const wasFall = c.fall > 0, wasSurf = c.surf, e0 = c.energy;
    stepCar(c, inp, DT, T);
    if (e === race.mine) myEvents(race, e, wasFall, wasSurf, inp, e0);
    // laps
    const ld = Math.floor(c.total / T.n);
    if (c.total >= 0 && ld > e.lapsDone && !e.fin) {
      const lt = raceT - e.lapStart; e.lapStart = raceT;
      const fin = ld >= race.laps;
      onLap(e, lt, raceT, fin, false);
      if (!race.demo) S.room?.net?.send({ t: "lap", id: e.id, lt, rt: raceT, fin }, { reliable: true });
    }
  }
  // contact
  for (let i = 0; i < all.length; i++) {
    const a = all[i]; if (a.gone || !owns(a)) continue;
    for (let j = 0; j < all.length; j++) {
      if (i === j) continue; const b = all[j]; if (b.gone) continue;
      const bo = owns(b); if (bo && j < i) continue;
      const hit = green ? collideCars(a.c, b.c, bo) : 0;
      if (hit > 0.12 && (a === race.mine || b === race.mine) && !race.demo) { world.sparks((a.c.x + b.c.x) / 2, (a.c.z + b.c.z) / 2, 6 + hit * 14); world.shake(0.25 + hit * 0.6); audio.fx("bump", 0.4 + hit * 0.6); }
    }
  }
  // dropped drivers: host hands their car to the autopilot
  if (!race.demo && hostNow && S.room?.net) for (const e of all) {
    if (e.kind === "h" && e.id !== me.id && !e.gone && !e.fin && green && !S.room.net.peers.has(e.id) && performance.now() - e.lastSeen > 6000) {
      e.kind = "b"; e.skill = 0.9; S.room.net.send({ t: "tk", id: e.id }, { reliable: true }); feed(`Autopilot takes over for ${esc(e.name)}`);
    }
  }
}

let lastBumpT = 0;
function myEvents(race, e, wasFall, wasSurf, inp, e0) {
  const c = e.c;
  if (c.fall > 0 && !wasFall) { toast("Fell off the desk. HR has been notified.", "r"); audio.fx("fall"); }
  if (c.surf === 3 && wasSurf !== 3) { toast("Coffee spill!", "r"); audio.fx("splash"); }
  if (c.padHit) { c.padHit = false; toast("STICKY-NOTE BOOST", "g"); audio.fx("pad"); world.shake(0.2); }
  if (c.boosting && !e.wasBoost) audio.fx("boost");
  e.wasBoost = c.boosting;
  if (c.bump > 0.15 && performance.now() - lastBumpT > 250) { lastBumpT = performance.now(); world.shake(c.bump * 0.7); audio.fx("bump", c.bump); world.sparks(c.x, c.z, 8); }
  c.bump = 0;
  // sectors
  const T = race.T, lapPos = wrap(c.total, T.n) / T.n, sec = Math.min(2, Math.floor(lapPos * 3)), raceT = (netNow() - race.t0) / 1000;
  if (c.total >= 0 && sec !== e.sec) {
    const st = raceT - e.secT, k = `${T.id}:${e.sec}`; e.secT = raceT;
    if (sec === (e.sec + 1) % 3) {
      race.secBest ??= {}; const sb = store.get("sec:" + k, null), el = $("#sectors").children[e.sec];
      if (sb == null || st < sb) { store.set("sec:" + k, st); el.className = "p"; } else if (race.secBest[k] == null || st < race.secBest[k]) el.className = "g"; else el.className = "y";
      if (race.secBest[k] == null || st < race.secBest[k]) race.secBest[k] = st;
    }
    e.sec = sec;
  }
  // record this lap (ghost + delta profile)
  if (c.total >= 0) {
    const lt = raceT - e.lapStart;
    if (lt >= e.recT) { e.recT += 0.1; e.rec.push(+c.x.toFixed(1), +c.z.toFixed(1), +c.h.toFixed(2)); }
    const bucket = Math.floor(wrap(c.total, T.n) / 8); if (e.prof.length <= bucket) { while (e.prof.length < bucket) e.prof.push(e.prof[e.prof.length - 1] ?? 0); e.prof.push(+lt.toFixed(2)); }
  }
}

function reaction(t) {
  const ms = Math.round(t * 1000), tag = ms < 180 ? "Lightning" : ms < 260 ? "Great start" : ms < 400 ? "Good start" : "Asleep at the desk";
  toast(`Reaction ${(ms / 1000).toFixed(3)}s · ${tag}`, ms < 260 ? "p" : ms < 400 ? "g" : "");
}

function emote(i) { const race = S.race; if (!race?.mine || performance.now() - (race.emT || 0) < 900) return; race.emT = performance.now(); world.emote(me.id, EMOTES[i]); world.showTag(me.id, true); setTimeout(() => world.showTag(me.id, false), 2600); audio.fx("emote"); S.room?.net?.send({ t: "em", id: me.id, e: i }, { reliable: true }); }

// ---------- HUD ----------
function toast(text, cls = "") { if (S.screen !== "race") return; const d = document.createElement("div"); d.className = "toast " + cls; d.textContent = text; const box = $("#toasts"); box.prepend(d); while (box.childElementCount > 3) box.lastChild.remove(); setTimeout(() => d.remove(), 2300); }
function big(text, sub) { const b = $("#big"); b.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : ""); b.classList.remove("show"); void b.offsetWidth; b.classList.add("show"); }
function feed(html) { if (S.screen !== "race") return; const d = document.createElement("div"); d.innerHTML = html; const box = $("#feed"); box.append(d); while (box.childElementCount > 4) box.firstChild.remove(); setTimeout(() => d.remove(), 6000); }
$("#rpm").innerHTML = Array.from({ length: 12 }, (_, i) => `<i class="${i > 9 ? "h" : i > 6 ? "m" : ""}"></i>`).join("");
let mapBase = null;
function drawMapBase(T) { mapBase = document.createElement("canvas"); mapBase.width = 440; mapBase.height = 300; drawMini(mapBase, T); }
const hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function setClass(id, cls, on) { const k = id + cls; if (hudCache[k] !== on) { hudCache[k] = on; $(id).classList.toggle(cls, on); } }

function updateOrder(race) {
  const prev = race.mine?.pos;
  race.order = race.cars.filter((e) => !e.gone).sort((a, b) => (a.fin && b.fin ? a.finT - b.finT : a.fin ? -1 : b.fin ? 1 : b.c.total - a.c.total));
  race.order.forEach((e, i) => { e.prevPos = e.pos; e.pos = i + 1; });
  const m = race.mine;
  if (m && prev && race.state === "run" && !m.fin && m.pos !== prev && (netNow() - race.t0) > 3000) {
    if (m.pos < prev) { toast(`OVERTAKE · P${m.pos}`, "g"); audio.fx("pass"); } else { toast(`Lost a place · P${m.pos}`, "r"); audio.fx("lost"); }
  }
}

function updateHud(race, dt, now) {
  const raceT = (now - race.t0) / 1000, T = race.T;
  // start lights
  const seq = (now - race.go.at) / 1000, n = raceT >= 0 ? 6 : clamp(Math.floor(seq / 0.8) , 0, 5);
  if (n !== race.lightsN) {
    race.lightsN = n; const L = $("#startlights");
    if (n >= 1 && n <= 5) { audio.fx("light"); }
    if (n === 6) { audio.fx("go"); big("GO!"); world.setLights(5, true); [...L.children].forEach((i) => (i.className = "g")); setTimeout(() => L.classList.remove("on"), 900); setTimeout(() => world.setLights(0, false), 2500); }
    else { world.setLights(n, false); [...L.children].forEach((el, i) => (el.className = i < n ? "r" : "")); L.classList.toggle("on", !race.spect || true); }
  }
  const view = race.focus; if (!view) return;
  const c = view.c, kmh = Math.round(c.speed * 3.6);
  setText("#speed", String(kmh)); setText("#gear", String(gearOf(c.speed)));
  const rp = Math.round(rpmOf(c.speed) * 12); if (hudCache.rpm !== rp) { hudCache.rpm = rp; [...$("#rpm").children].forEach((el, i) => el.classList.toggle("on", i < rp)); }
  setClass("#b-drs", "on", !!c.drs); setClass("#b-tow", "on", c.tow > 0.15); setClass("#b-cafe", "on", !!c.boosting);
  const en = Math.round(c.energy * 100); if (hudCache.en !== en) { hudCache.en = en; $("#energy i").style.width = en + "%"; $("#energy").classList.toggle("full", en > 97); }
  $("#wrong").hidden = !(view === race.mine && c.wrong > 1.2);
  const lapNo = clamp(view.lapsDone + 1, 1, race.laps);
  setText("#lapn", view.fin ? "FINISHED" : `LAP ${lapNo}/${race.laps}`); setText("#pos", `P${view.pos}/${race.order.length}`);
  if (raceT < 0) setText("#laptime", fmt(0)); else if (!view.fin) setText("#laptime", fmt(raceT - view.lapStart).slice(0, -2)); else setText("#laptime", fmt(view.finT));
  // live delta to personal best
  let d = "";
  if (view === race.mine && race.pb?.prof && raceT > 0 && !view.fin && c.total >= 0) {
    const ref = race.pb.prof[Math.floor(wrap(c.total, T.n) / 8)];
    if (ref != null && ref > 0) { const dv = raceT - view.lapStart - ref; d = (dv >= 0 ? "+" : "−") + Math.abs(dv).toFixed(2); setClass("#delta", "neg", dv < 0); setClass("#delta", "posv", dv >= 0); }
  }
  setText("#delta", d);
  // speed rush
  const rush = clamp((c.speed - 55) / 45, 0, 1) * 0.55 + (c.boosting || c.padT > 0 ? 0.4 : 0);
  $("#speedfx").style.opacity = (view === race.mine || race.spect ? rush : 0).toFixed(2);
  // tower + monitor (4 Hz)
  race.hudT -= dt;
  if (race.hudT <= 0) {
    race.hudT = 0.25;
    const lead = race.order[0]; let html = "";
    const rows = race.order.map((e, i) => {
      let gap = "";
      if (e.fin) gap = i === 0 ? fmt(e.finT) : "+" + (e.finT - lead.finT).toFixed(2);
      else if (i === 0) gap = raceT > 0 ? "LEADER" : "";
      else { const dd = (lead.c.total - e.c.total) * T.step; gap = lead.fin ? "" : dd > T.len ? `+${Math.floor(dd / T.len)} LAP` : "+" + (dd / 52).toFixed(1); }
      const moved = e.prevPos && e.prevPos !== e.pos ? (e.pos < e.prevPos ? " up" : " down") : "";
      html += `<div class="tr${e === race.mine ? " me" : ""}${moved}"><b>${i + 1}</b><i style="background:${esc(e.color)}"></i><span>${e.team != null ? (e.team ? "\u{1F375} " : "☕ ") : ""}${esc(e.name)}</span><em>${gap}</em></div>`;
      return { name: e.name, color: e.color, gap };
    });
    if (hudCache.tower !== html) { hudCache.tower = html; $("#tower").innerHTML = html; }
    race.monT -= 0.25; if (race.monT <= 0) { race.monT = 1; world.setMonitor(rows, raceT < 0 ? "DESKGP · STARTING GRID" : `DESKGP · LAP ${clamp(lead.lapsDone + 1, 1, race.laps)}/${race.laps}`); }
    if (race.firstFin != null && race.mine && !race.mine.fin) { const left = Math.ceil(30 - (raceT - race.firstFin)); if (left >= 0 && left <= 30) setText("#spect", `Leader has finished. Race ends in ${left}s`), ($("#spect").hidden = false); }
  }
  // minimap
  const g = $("#map").getContext("2d"); g.clearRect(0, 0, 440, 300); if (mapBase) g.drawImage(mapBase, 0, 0);
  const sc = Math.min((440 - 16) / (DESK.hx * 2), (300 - 16) / (DESK.hz * 2));
  for (let i = race.order.length - 1; i >= 0; i--) {
    const e = race.order[i], mine = e === view, x = 220 + e.c.x * sc, y = 150 + e.c.z * sc;
    g.beginPath(); g.arc(x, y, mine ? 9 : 6, 0, 6.3); g.fillStyle = e.color; g.fill(); g.lineWidth = mine ? 3 : 1.5; g.strokeStyle = mine ? "#fff" : "rgba(0,0,0,.7)"; g.stroke();
  }
}

// ---------- results ----------
function hostFinish(race, raceT) {
  const R = S.room; if (!R || race.ended || !isHost()) return;
  const humans = race.cars.filter((e) => e.kind === "h" && !e.gone);
  const allDone = humans.length ? humans.every((e) => e.fin) : race.cars.every((e) => e.fin);
  if (!(allDone && race.firstFin != null && raceT > race.firstFin + 2.5) && !(race.firstFin != null && raceT > race.firstFin + 30)) return;
  race.ended = true; updateOrder(race);
  const order = race.order.map((e, i) => { const pts = (POINTS[i] || 0) + (race.bestBy === e.id ? 1 : 0); R.points[e.id] = (R.points[e.id] || 0) + pts; return { id: e.id, name: e.name, color: e.color, team: e.team, kind: e.kind, time: e.fin ? e.finT : null, best: e.best, pts, total: R.points[e.id], fast: race.bestBy === e.id }; });
  R.phase = "lobby";
  const res = { t: "res", order, n: race.go.n, track: race.T.def.name };
  R.net?.send(res, { reliable: true }); sendLob();
  showResults(res);
}
function showResults(res) {
  const R = S.room; if (!R) return;
  R.phase = "lobby";
  const myI = res.order.findIndex((o) => o.id === me.id), lead = res.order[0];
  if (myI >= 0) { prefs.races++; prefs.xp += res.order[myI].pts + 5; if (myI === 0) prefs.wins++; savePrefs(); }
  $("#res-sub").textContent = `${res.track} · RACE ${res.n}`;
  $("#res-title").textContent = myI >= 0 ? `P${myI + 1} · ${TITLES[Math.min(myI, TITLES.length - 1)]}` : `${lead.name} wins`;
  $("#res-table").innerHTML = res.order.map((o, i) => `<div class="rr${o.id === me.id ? " me" : ""}" style="animation-delay:${i * 60}ms"><b>P${i + 1}</b><i style="background:${esc(o.color)}"></i><span>${o.team != null ? (o.team ? "\u{1F375} " : "☕ ") : ""}${esc(o.name)}${o.kind === "b" ? " <small style='opacity:.5'>bot</small>" : ""}</span><span class="t">${o.time == null ? "DNF" : i === 0 ? fmt(o.time) : "+" + (o.time - lead.time).toFixed(3)}</span><span class="bl${o.fast ? " fast" : ""}">${o.best ? fmt(o.best) : ""}</span><span class="p">+${o.pts} <small style="opacity:.6">(${o.total})</small></span></div>`).join("");
  if (res.order.some((o) => o.team != null)) { const ts = [0, 0]; res.order.forEach((o) => (ts[o.team] += o.pts)); $("#res-teams").innerHTML = `☕ ${TEAMS[0].name} <b>${ts[0]}</b> · \u{1F375} ${TEAMS[1].name} <b>${ts[1]}</b> — ${ts[0] === ts[1] ? "a perfectly aligned tie" : (ts[0] > ts[1] ? TEAMS[0].name : TEAMS[1].name) + " take the round"}`; } else $("#res-teams").innerHTML = "";
  $("#res-msg").textContent = myI >= 0 ? `${rankOf(prefs.xp)} · ${prefs.xp} XP` : "";
  show("results");
  if (myI === 0) audio.fx("win");
}
$("#res-next").onclick = () => { endRace(); show("lobby"); renderLobby(); startDemo(); };

// ---------- main loop ----------
let last = performance.now(), acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (t - last) / 1000); last = t;
  const race = S.race, now = netNow();
  if (!race) { world.updateCamera(null, 0, dt); world.render(dt); return; }
  acc += dt; let steps = 0;
  while (acc >= DT && steps < 12) { simStep(race, now - (acc - DT) * 1000); acc -= DT; steps++; }
  if (steps === 12) acc = 0;
  const raceT = (now - race.t0) / 1000, al = acc / DT;
  updateOrder(race);
  // who the camera follows
  let focus = race.mine;
  if (race.spect) { const o = race.order; focus = o[wrap(race.spectI || 0, o.length)] || null; }
  if (race.demo) focus = null;
  race.focus = focus;
  // draw cars (owned cars are interpolated between physics steps)
  for (const e of race.cars) {
    const c = e.c;
    if (e.gone) { c.hidden = true; world.syncCar(e.id, c, dt); continue; }
    if (owns(e) && raceT >= 0) {
      const x = c.x, z = c.z, h = c.h, y = c.y;
      c.x = e.px + (x - e.px) * al; c.z = e.pz + (z - e.pz) * al; c.h = e.ph + angd(h, e.ph) * al; c.y = e.py + (y - e.py) * al;
      world.syncCar(e.id, c, dt); c.x = x; c.z = z; c.h = h; c.y = y;
    } else world.syncCar(e.id, c, dt);
  }
  // ghost of my best lap
  if (race.ghost && race.mine) {
    const m = race.mine, lt = raceT - m.lapStart, rec = race.ghost.rec, k = lt * 10, i = Math.floor(k), n = rec.length / 3, gv = world.cars.get("ghost");
    if (gv) {
      if (raceT > 0 && i < n - 1 && !m.fin && prefs.ghost && m.c.total >= 0) { const u = k - i, a = i * 3, b = a + 3; world.syncCar("ghost", { x: rec[a] + (rec[b] - rec[a]) * u, z: rec[a + 1] + (rec[b + 1] - rec[a + 1]) * u, h: rec[a + 2] + angd(rec[b + 2], rec[a + 2]) * u, vx: 0, vz: 0, speed: 40 }, dt); }
      else gv.g.visible = false;
    }
  }
  if (focus && raceT >= 0 && owns(focus)) { const c = focus.c, x = c.x, z = c.z, h = c.h; c.x = focus.px + (x - focus.px) * al; c.z = focus.pz + (z - focus.pz) * al; c.h = focus.ph + angd(h, focus.ph) * al; world.updateCamera(c, prefs.cam, dt); c.x = x; c.z = z; c.h = h; }
  else world.updateCamera(focus ? focus.c : null, prefs.cam, dt);
  if (!race.demo) {
    updateHud(race, dt, now);
    // audio
    if (focus) {
      const c = focus.c, cam = world.camera, near = [];
      for (const e of race.cars) { if (e === focus || e.gone) continue; const dx = e.c.x - c.x, dz = e.c.z - c.z, d = Math.hypot(dx, dz); if (d < 90) near.push({ d, speed: e.c.speed, thr: e.c.thr ?? 1, pan: clamp((dx * -Math.sin(c.h) + dz * Math.cos(c.h)) / 20, -1, 1), dop: clamp(((c.vx - e.c.vx) * dx + (c.vz - e.c.vz) * dz) / (d + 1) / 30, -1, 1) }); }
      near.sort((a, b) => a.d - b.d);
      audio.frame({ speed: c.speed, thr: c.thr || 0, slip: c.slip || 0 }, near.slice(0, 3));
    } else audio.frame(null, null);
    // send my cars
    race.sendT -= dt;
    const net = S.room?.net;
    if (net && race.sendT <= 0 && net.peers.size) {
      race.sendT = 0.05; const arr = [];
      for (const e of race.cars) if (owns(e) && !e.gone) { const c = e.c; arr.push([e.id, +c.x.toFixed(2), +c.z.toFixed(2), +c.h.toFixed(3), +c.vx.toFixed(1), +c.vz.toFixed(1), +c.w.toFixed(2), +c.steer.toFixed(2), (c.boosting ? 1 : 0) | (c.brk > 0.1 ? 2 : 0) | (c.drs ? 4 : 0) | (c.fall > 0 ? 8 : 0) | (c.thr > 0.2 ? 16 : 0) | (c.slip > 0.4 ? 32 : 0) | (c.respawned > 0 ? 64 : 0) | (c.surf === 2 ? 128 : 0), c.total, +(c.y || 0).toFixed(1)]); }
      if (arr.length) net.send({ t: "s", ts: Math.round(now), c: arr });
    }
    hostFinish(race, raceT);
  } else audio.frame(null, null);
  world.render(dt);
}
// keep bots and the clock alive (slowly) if the host's tab is in the background
setInterval(() => { if (document.hidden && S.race && !S.race.demo) { const now = netNow(); for (let i = 0; i < 24; i++) simStep(S.race, now - (24 - i) * DT * 1000); updateOrder(S.race); hostFinish(S.race, (now - S.race.t0) / 1000); last = performance.now(); } }, 200);

show("menu"); startDemo();
requestAnimationFrame(frame);
