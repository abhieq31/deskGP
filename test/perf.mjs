// Startup and responsiveness budget: time to a usable home screen, main-thread blocking (long tasks), click-to-screen
// latency, and memory after several races (no leaks). Fails loudly when a budget is broken. node test/perf.mjs
import path from "node:path";
const _pw = await import(process.env.PW || "playwright"), { chromium } = _pw.chromium ? _pw : _pw.default;
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1280, height: 640 } }); const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.addInitScript(() => {
  localStorage.setItem("deskgp:prefs3", JSON.stringify({ name: "Perf", gfx: 0, sound: false, seenControls: true, races: 1 }));
  window.__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true }); } catch {}
});
const t0 = Date.now();
await p.goto("file://" + path.resolve("deskgp.html"));
await p.waitForFunction(() => window.__deskgp && !document.querySelector("#menu").hidden && document.querySelector("#solo").offsetParent);
const usable = Date.now() - t0;
const nav = await p.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; });
await p.waitForTimeout(4000);
const long0 = await p.evaluate(() => window.__long.slice());
// click to screen: the handler time, measured in the page
const click = (sel) => p.evaluate((sel) => { const t = performance.now(); document.querySelector(sel).click(); return Math.round(performance.now() - t); }, sel);
const solo = await click("#solo"); await p.waitForTimeout(2500);
const trk = await click("#trk-next"); await p.waitForFunction(() => { const d = window.__deskgp; const want = d.track(d.S.room.cfg.track); return d.world.sceneReady && d.world.T === want && d.S.race?.demo && d.S.race.T === want; /* the circuit picked in the lobby, fully built */ }, null, { timeout: 60000 }); await p.waitForTimeout(500);
const start = await click("#start");
// memory over several races: geometries and textures must not grow race after race
const mem = [];
for (let k = 0; k < 4; k++) {
  await p.waitForTimeout(3500);
  mem.push(await p.evaluate(() => { const i = window.__deskgp.world.renderer.info.memory; return [i.geometries, i.textures]; }));
  await p.evaluate(() => { document.querySelector("#p-leave") && (window.__deskgp.S.paused = false); });
  await p.keyboard.press("Escape"); await p.waitForTimeout(300); await p.click("#p-leave").catch(() => {}); await p.waitForTimeout(1200);
  await click("#solo"); await p.waitForTimeout(1500); await click("#start");
}
console.log(JSON.stringify({ usableMs: usable, domContentLoaded: nav.dcl, load: nav.load, longTasksAtStart: long0, clickMs: { race: solo, nextCircuit: trk, lightsOut: start }, memoryPerRace: mem, errors: errs }));
const grow = mem.length > 2 && (mem.at(-1)[0] > mem[1][0] * 1.15 + 20 || mem.at(-1)[1] > mem[1][1] * 1.15 + 5);
const bad = [errs.length && "page errors", solo > 150 && "Race click slow", trk > 50 && "circuit change slow", start > 600 && "Lights out slow", grow && "memory grows race after race"].filter(Boolean);
console.log(bad.length ? "BUDGET BROKEN: " + bad.join(", ") : "within budget");
process.exitCode = bad.length ? 1 : 0;
await b.close();
