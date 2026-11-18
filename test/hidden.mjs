// Host steps away: with the tab hidden the race keeps running (background ticker) for 4 s, then pauses, and it resumes
// when the tab comes back. Exits non-zero if any of that fails. node test/hidden.mjs
import path from "node:path";
const _pw = await import(process.env.PW || "playwright"), { chromium } = _pw.chromium ? _pw : _pw.default;
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } }), errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.addInitScript(() => { localStorage.setItem("deskgp:prefs3", JSON.stringify({ gfx: 0, sound: false, seenControls: true, races: 1 })); localStorage.setItem("deskgp:cfg5", JSON.stringify({ track: 1, laps: 3, bots: 3, diff: 1, cls: "f1", rules: "gp" })); });
await p.goto("file://" + path.resolve("deskgp.html")); await p.waitForTimeout(1500);
await p.click("#solo"); await p.waitForTimeout(500); await p.click("#start"); await p.waitForTimeout(4000);
const ask = () => Promise.race([p.evaluate(() => ({ held: window.__deskgp.S.race.held, moving: window.__deskgp.S.race.cars.filter((e) => e.c.speed > 5).length })), new Promise((r) => setTimeout(() => r(null), 5000))]);
const hide = (on) => p.evaluate((on) => { window.__hid = on; if (!window.__hidSet) { window.__hidSet = 1; Object.defineProperty(document, "hidden", { configurable: true, get: () => window.__hid }); } document.dispatchEvent(new Event("visibilitychange")); }, on);
await hide(true);
await new Promise((r) => setTimeout(r, 1500)); const early = await ask();
await new Promise((r) => setTimeout(r, 4500)); const later = await ask();
await hide(false); await new Promise((r) => setTimeout(r, 1500)); const back = await ask();
const fails = [];
if (!early) fails.push("page stopped answering while hidden"); else if (early.held) fails.push("paused before the 4 s grace");
if (!later?.held) fails.push("did not pause after 4 s hidden");
if (!back || back.held || !back.moving) fails.push("did not resume on return");
if (errs.length) fails.push("page errors: " + errs.slice(0, 2).join("; "));
console.log(JSON.stringify({ early, later, back }), fails.length ? "FAIL " + fails.join(", ") : "ok: runs, pauses after 4 s, resumes");
await b.close(); process.exit(fails.length ? 1 : 0);
