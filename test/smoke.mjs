// Browser smoke test: every circuit, rotating through the car classes. Starts a solo race, lets the autopilot drive,
// and reports page errors, frames drawn, draw calls and whether the race is running. node test/smoke.mjs
import path from "node:path";
const _pw = await import(process.env.PW || "playwright"), { chromium } = _pw.chromium ? _pw : _pw.default;
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const classes = ["gt", "f1", "classic"], N = +(process.env.N || 11);
let bad = 0;
for (let t = 0; t < N; t++) {
  const cls = classes[t % 3], p = await b.newPage({ viewport: { width: 800, height: 450 } }), errs = [];
  p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/WebSocket|ERR_/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  await p.addInitScript(([t, cls]) => { localStorage.setItem("deskgp:prefs3", JSON.stringify({ name: "Test", gfx: 0, sound: false, seenControls: true })); localStorage.setItem("deskgp:cfg5", JSON.stringify({ track: t, laps: 3, bots: 5, diff: 1, cls, rules: t % 2 ? "gp" : "casual" })); }, [t, cls]);
  await p.goto("file://" + path.resolve("deskgp.html")); await p.waitForTimeout(1500);
  await p.click("#solo"); await p.waitForTimeout(600); await p.click("#start");
  await p.evaluate(() => (window.__deskgp.auto = true)); await p.waitForTimeout(+(process.env.WAIT || 26000));
  const r = await p.evaluate(() => { const S = window.__deskgp.S, r = S.race, w = window.__deskgp.world; return { track: r?.T.def.name, cls: r?.cls.id, state: r?.state, screen: S.screen, cars: r?.cars.length, moving: r?.cars.filter((e) => e.c.speed > 5).length, calls: w.renderer.info.render.calls, nan: r?.cars.some((e) => !isFinite(e.c.x + e.c.z + e.c.speed)) }; });
  const ok = !errs.length && r.screen === "race" && !r.nan && r.moving > 0;
  if (!ok) bad++;
  console.log(ok ? "ok  " : "BAD ", JSON.stringify(r), errs.length ? errs.slice(0, 3) : "");
  await p.close();
}
console.log(bad ? `${bad} problem(s)` : "all circuits run clean");
await b.close();
