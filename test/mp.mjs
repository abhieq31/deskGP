// Two (or more) browsers race each other. MODE=local: same browser context (BroadcastChannel + WebRTC).
// MODE=relay: separate contexts, so they can only find each other through the public relays.
import path from "node:path";
const { chromium } = await import(process.env.PW || "playwright");
const out = process.argv[2] || ".", mode = process.env.MODE || "local", N = +(process.env.N || 2);
const url = "file://" + path.resolve("deskgp.html");
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...(process.env.NORTC ? ["--disable-features=WebRtc", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"] : [])] });
const ctx0 = await b.newContext({ viewport: { width: 960, height: 540 } });
const pages = [];
for (let i = 0; i < N; i++) {
  const ctx = mode === "local" || i === 0 ? ctx0 : await b.newContext({ viewport: { width: 960, height: 540 } });
  const p = await ctx.newPage(); pages.push(p);
  p.on("console", (m) => { if (m.type() === "error") console.log(`[p${i} error]`, m.text().slice(0, 200)); });
  p.on("pageerror", (e) => console.log(`[p${i} pageerror]`, e.message, (e.stack || "").split("\n")[1]));
  if (process.env.NORTC) await p.addInitScript(() => { delete window.RTCPeerConnection; });
}
const [host, ...guests] = pages;
await host.goto(url); await host.fill("#name", "Host"); await host.click("#create"); await host.waitForTimeout(1500);
const code = (await host.textContent("#roomcode")).trim(); console.log("room", code);
for (const [i, g] of guests.entries()) { await g.goto(url + "#" + code.replace("-", "")); await g.fill("#name", "Guest" + (i + 1)); await g.click("#join"); }
const t0 = Date.now(); let ok = false;
while (Date.now() - t0 < 25000) { await host.waitForTimeout(500); const n = await host.evaluate(() => document.querySelectorAll("#players .pl:not(.bot)").length); if (n === N) { ok = true; break; } }
console.log("lobby full:", ok, "after", ((Date.now() - t0) / 1000).toFixed(1), "s");
await host.waitForTimeout(4000);
for (const [i, p] of pages.entries()) console.log(`p${i}`, await p.evaluate(() => { const n = window.__deskgp.S.room.net; return { relays: n.relaysUp, peers: [...n.peers.values()].map((x) => x.name + ":" + (x.rtc ? "direct" : "relay")), startVisible: !document.querySelector("#start").hidden, msg: document.querySelector("#lobbymsg").textContent }; }));
await host.screenshot({ path: out + "/mp-lobby-host.png" });
await host.click('#o-laps button[data-v="1"]'); await host.click('#o-bots button[data-v="1"]'); await host.waitForTimeout(600);
await host.click("#start"); await host.waitForTimeout(9500);
for (const p of pages) await p.keyboard.press("KeyB"); // autopilot drives everyone
await host.waitForTimeout(9000);
for (const [i, p] of pages.entries()) console.log(`p${i}`, await p.evaluate(() => { const r = window.__deskgp.S.race, S = window.__deskgp.S; return { screen: S.screen, state: r?.state, clockOff: Math.round(S.clockOff), cars: r?.cars.map((e) => `${e.name}:${e.c.total}:${e.c.speed.toFixed(0)}:d${Math.round(e.delay)}`) }; }));
for (const p of pages) await p.keyboard.press("KeyB");
await host.screenshot({ path: out + "/mp-race-host.png" }); await guests[0].screenshot({ path: out + "/mp-race-guest.png" });
for (const p of pages) await p.keyboard.press("KeyB");
const t1 = Date.now(); let done = false;
while (Date.now() - t1 < 110000) { await host.waitForTimeout(2000); const s = await Promise.all(pages.map((p) => p.evaluate(() => window.__deskgp.S.screen))); if (s.every((x) => x === "results")) { done = true; break; } }
console.log("all reached results:", done);
for (const p of pages) await p.keyboard.press("KeyB");
for (const [i, p] of pages.entries()) console.log(`p${i} result:`, (await p.evaluate(() => [...document.querySelectorAll("#res-table .rr")].map((r) => r.innerText.replace(/\s+/g, " ")).join(" | "))));
await guests[0].screenshot({ path: out + "/mp-results-guest.png" });
await b.close();
