// One high-quality still per circuit/class: start a solo race, let the autopilot drive, grab frames.
import path from "node:path";
const _pw = await import(process.env.PW || "playwright"), { chromium } = _pw.chromium ? _pw : _pw.default;
const [out, tr = "0", cls = "gt", gfx = "2", cams = "0"] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.setDefaultTimeout(240000);
p.on("pageerror", (e) => console.log("[pageerror]", e.message, (e.stack || "").split("\n")[1]));
p.on("console", (m) => { if (m.type() === "error" && !/WebSocket/.test(m.text())) console.log("[error]", m.text().slice(0, 200)); });
await p.addInitScript(([g, c, r]) => { localStorage.setItem("deskgp:prefs3", JSON.stringify({ name: "Abhi", gfx: +g, cam: +c, sound: false })); localStorage.setItem("deskgp:cfg4", JSON.stringify({ track: 0, laps: 3, bots: 7, diff: 1, cls: "gt" })); localStorage.setItem("deskgp:cfg5", JSON.stringify({ track: 0, laps: 3, bots: 7, diff: 1, cls: "gt", rules: r })); }, [gfx, cams.split(",")[0], process.env.RULES || "casual"]);
await p.goto("file://" + path.resolve("deskgp.html"));
await p.waitForTimeout(1500);
await p.click("#solo"); await p.waitForTimeout(800);
await p.click(`.trk[data-i="${tr}"]`); if (cls === "f1") await p.click("#o-cls button:nth-child(2)");
await p.waitForTimeout(500); await p.click("#start");
await p.evaluate(() => (window.__deskgp.auto = true)); // autopilot drives
await p.waitForTimeout(+(process.env.WAIT || 22000));
await p.evaluate(() => (window.__deskgp.auto = false));
for (const c of cams.split(",")) {
  await p.evaluate((c) => { const k = "deskgp:prefs3"; const v = JSON.parse(localStorage.getItem(k)); v.cam = +c; localStorage.setItem(k, JSON.stringify(v)); }, c);
  // prefs are read live from the in-memory object: press C until the mode matches
  for (let i = 0; i < 4; i++) { const cur = await p.evaluate(() => JSON.parse(localStorage.getItem("deskgp:prefs3")).cam); if (cur === +c) break; await p.keyboard.press("KeyC"); }
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/t${tr}-${cls}-c${c}.png` });
}
console.log(JSON.stringify(await p.evaluate(() => { const r = window.__deskgp.S.race; return { t: ((performance.now() - r.t0) / 1000).toFixed(1), pos: r.mine.pos, kmh: (r.mine.c.speed * 3.6).toFixed(0), q: window.__deskgp.world.quality }; })));
await b.close();
