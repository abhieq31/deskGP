// Host steps away: with the tab hidden the race keeps running (background ticker) for 4 s, then pauses; it resumes on return.
// node test/hidden.mjs
import path from "node:path";
const _pw = await import(process.env.PW || "playwright"), { chromium } = _pw.chromium ? _pw : _pw.default;
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on("pageerror", (e) => console.log("pageerror", e.message)); p.on("dialog", (d) => { console.log("DIALOG", d.type(), d.message()); d.dismiss(); });
await p.addInitScript(() => { localStorage.setItem("deskgp:prefs3", JSON.stringify({ gfx: 0, sound: false, seenControls: true })); localStorage.setItem("deskgp:cfg5", JSON.stringify({ track: 1, laps: 3, bots: 3, diff: 1, cls: "f1", rules: "gp" })); });
await p.goto("file://" + path.resolve("deskgp.html")); await p.waitForTimeout(1500);
await p.click("#solo"); await p.waitForTimeout(500); await p.click("#start"); await p.waitForTimeout(4000);
const st = () => p.evaluate(() => ({ held: window.__deskgp.S.race.held }));
await p.evaluate(() => { window.__hid = true; Object.defineProperty(document, "hidden", { configurable: true, get: () => window.__hid }); document.dispatchEvent(new Event("visibilitychange")); });
const t0 = Date.now();
for (let k = 0; k < 5; k++) { await new Promise((r) => setTimeout(r, 1000)); const r = await Promise.race([p.evaluate(() => ({ held: window.__deskgp.S.race.held, pt: Math.round(performance.now()), st: window.__deskgp.S.race.state })), new Promise((r) => setTimeout(() => r("NO ANSWER"), 4000))]); console.log(((Date.now() - t0) / 1000).toFixed(1), JSON.stringify(r)); }
await p.evaluate(() => { window.__hid = false; document.dispatchEvent(new Event("visibilitychange")); }); await new Promise((r) => setTimeout(r, 1500)); console.log("visible again", JSON.stringify(await p.evaluate(() => ({ held: window.__deskgp.S.race.held, hold: !document.querySelector("#hold").hidden, moving: window.__deskgp.S.race.cars.filter((e) => e.c.speed > 5).length })))); await b.close(); process.exit(0);
