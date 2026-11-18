// Screenshots of the pre-race lineup, the race with the new cars, and the podium board.
import path from "node:path";
const { chromium } = await import(process.env.PW || "playwright");
const out = process.argv[2] || ".", tr = +(process.argv[3] || 0), cls = process.argv[4] || "f1";
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1366, height: 768 } }); p.setDefaultTimeout(240000);
p.on("pageerror", (e) => console.log("[pageerror]", e.message, (e.stack || "").split("\n")[1]));
await p.addInitScript(([t, c]) => { localStorage.setItem("deskgp:prefs3", JSON.stringify({ name: "Abhi", num: 44, team: "ferrari", gfx: +(window.__GFX ?? 1), sound: false, seenControls: true })); localStorage.setItem("deskgp:cfg5", JSON.stringify({ track: t, laps: 3, bots: 7, diff: 1, cls: c, rules: "casual" })); }, [tr, cls]);
await p.goto("file://" + path.resolve("deskgp.html")); await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/0-menu.png` }); await p.click("#solo"); await p.waitForTimeout(800); await p.click("#start");
await p.waitForTimeout(2500); await p.screenshot({ path: `${out}/1-intro.png` });
await p.evaluate(() => (window.__deskgp.auto = true));
await p.waitForTimeout(+(process.env.WAIT || 20000)); await p.screenshot({ path: `${out}/2-race.png` });
console.log("draw calls", await p.evaluate(() => window.__deskgp.world.renderer.info.render.calls), "triangles", await p.evaluate(() => window.__deskgp.world.renderer.info.render.triangles));
await p.evaluate(() => { const r = window.__deskgp.S.race; const o = r.cars.map((e, i) => ({ id: e.id, name: e.name, code: e.code, team: e.team, color: e.color, kind: e.kind, num: e.num, grid: e.grid, time: 92.3 + i * 1.7, laps: 3, best: 30.1 + i * 0.3, pts: [25, 18, 15, 12, 10, 8, 6, 4][i], top: 300 - i * 4, ovt: (i * 3) % 4, clean: 3 - (i % 2), fast: i === 1 })); window.__deskgp.podium({ t: "res", order: o, n: 1, track: r.T.def.name, laps: 3 }); });
await p.waitForTimeout(3500); await p.screenshot({ path: `${out}/3-podium.png` });
await b.close();
