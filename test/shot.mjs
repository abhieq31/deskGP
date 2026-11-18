// Drives the built game in headless Chromium and saves screenshots.
import fs from "node:fs"; import path from "node:path";
const { chromium } = await import(process.env.PW || "playwright");
const out = process.argv[2] || "."; const url = "file://" + path.resolve("deskgp.html");
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("[" + m.type() + "]", m.text().slice(0, 300)); });
p.on("pageerror", (e) => console.log("[pageerror]", e.message, (e.stack || "").split("\n").slice(0, 4).join(" | ")));
if (process.env.GFX) await p.addInitScript((g) => { try { const k = "deskgp:prefs3"; const v = JSON.parse(localStorage.getItem(k) || "{}"); v.gfx = +g; localStorage.setItem(k, JSON.stringify(v)); } catch {} }, process.env.GFX);
p.setDefaultTimeout(120000);
await p.goto(url); await p.waitForTimeout(2500);
await p.screenshot({ path: out + "/1-menu.png" });
await p.fill("#name", "Abhi"); await p.click("#solo"); await p.waitForTimeout(1200);
await p.screenshot({ path: out + "/2-lobby.png" });
const tr = +(process.argv[3] || 0); await p.click(`.trk[data-i="${tr}"]`); await p.waitForTimeout(300);
if (process.argv[4] === "f1") { await p.click("#o-cls button:nth-child(2)"); await p.waitForTimeout(300); }
await p.click("#start"); await p.waitForTimeout(4000);
await p.screenshot({ path: out + "/3-grid.png" });
await p.waitForTimeout(4500); await p.keyboard.down("ArrowUp"); await p.waitForTimeout(3500);
await p.screenshot({ path: out + "/4-race.png" });
await p.keyboard.down("Space"); await p.waitForTimeout(3000); await p.keyboard.down("ArrowRight"); await p.waitForTimeout(900); await p.keyboard.up("ArrowRight");
await p.screenshot({ path: out + "/5-race.png" });
await p.keyboard.press("KeyC"); await p.waitForTimeout(1500); await p.screenshot({ path: out + "/6-deskcam.png" });

await p.keyboard.press("KeyC"); await p.keyboard.press("KeyC"); await p.waitForTimeout(1500); await p.screenshot({ path: out + "/8-drone.png" });
const st = await p.evaluate(() => { const r = window.__deskgp.S.race; return { state: r.state, pos: r.mine.pos, speed: r.mine.c.speed, total: r.mine.c.total, quality: window.__deskgp.world.quality, pen: r.mine.pen, tl: r.mine.tlN, dmg: r.mine.c.dmg }; });
console.log(JSON.stringify(st));
await b.close();
