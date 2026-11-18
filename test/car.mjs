// Close-up renders of one car from several angles (for model work). node test/car.mjs outdir [team] [cls]
import path from "node:path";
const _pw = await import(process.env.PW || "playwright"), { chromium } = _pw.chromium ? _pw : _pw.default;
const out = process.argv[2] || ".", team = process.argv[3] || "ferrari", cls = process.argv[4] || "f1";
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 900, height: 500 } });
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
await p.addInitScript(() => localStorage.setItem("deskgp:prefs3", JSON.stringify({ gfx: 1, sound: false, seenControls: true })));
await p.goto("file://" + path.resolve("deskgp.html")); await p.waitForTimeout(2500);
await p.evaluate(([team, cls]) => { const d = window.__deskgp; d.world.showLineup([{ team: d.teamOf(team), number: 16, pose: "stand" }], cls); for (const id of ["menu", "lobby"]) document.getElementById(id).hidden = true; }, [team, cls]);
// the lineup car sits at (0,0,-2.9); the driver stands in front of it at z 0.9
const views = (process.env.VIEWS || "side,front34,rear34,top,chase").split(",");
const all = { side: [[0.01, 1.2, 4.6], [0, 0.5, -2.9], 34], front34: [[4.6, 1.9, 0.2], [0, 0.45, -2.9], 34], rear34: [[-4.6, 2.0, -6.4], [0, 0.5, -2.9], 34], top: [[0.01, 10, -2.9], [0, 0, -2.9], 34], chase: [[5.5, 2.3, -2.9], [0, 0.6, -2.9], 40] };
for (const k of views) { const [pos, look, fov] = all[k]; await p.evaluate(([pos, look, fov]) => { window.__deskgp.world.studioCam = { pos, look, fov }; }, [pos, look, fov]); await p.waitForTimeout(900); await p.screenshot({ path: `${out}/car-${k}.png` }); }
await b.close();
